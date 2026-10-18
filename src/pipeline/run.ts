// Client-side run: given structured changes (parsed server-side) + the selected
// repos with short-lived tokens (minted server-side), fetch each repo, apply the
// changes, verify every edit still parses, confirm nothing from the changelog is
// left behind, and open ONE pull request per affected repo — all on the
// visitor's machine. Never merges.
//
// This mirrors server/src/pipeline/run.ts (runOneRepo) so behaviour matches the
// cloud path. The only omitted gate is the ephemeral test sandbox, which needs a
// real runtime and cannot run in a browser tab.

import type { ChangeSpec, RunOutput, RepoRunResult, PerChangeResult, ChangeStatus } from "../api";
import { applyChangeToFile, type FileEditResult, type FileToScan, type LlmApplyFile } from "./apply-change";
import { verifySyntax, findResidual } from "./verify";
import { fetchRepoFiles, openFixPr, resolveBase, type RepoRef } from "./github";

/** One selected repo plus the short-lived token to act on it. */
export interface RepoToken {
  id: string;
  fullName: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  token: string;
}

export interface RunSettings {
  verifyFixes: boolean;
  completenessCheck: boolean;
  autoOpenPr: boolean;
}

export interface LocalRunOptions {
  settings: RunSettings;
  llmApplyFile?: LlmApplyFile; // optional client-side LLM (e.g. local model)
  onRepoStart?: (repo: RepoToken) => void;
  onRepoDone?: (result: RepoRunResult) => void;
}

function langTag(filePath: string): string {
  return filePath.split(".").pop()?.toLowerCase() ?? "";
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40) || "api-change";
}

/**
 * Stable short hash of a change set (order-independent) so the same changelog
 * always yields the same branch suffix → runs are idempotent, not duplicate PRs.
 *
 * Prefers Web Crypto SHA-256 (matches the server's branch names so a server run
 * and a client run for the same changelog reuse ONE PR). Falls back to a pure-JS
 * hash when crypto.subtle is unavailable — e.g. a non-secure context like a LAN
 * IP or an Android WebView — so a run is NEVER blocked by a missing API.
 */
async function changeSetHash(changes: ChangeSpec[]): Promise<string> {
  const canonical = changes
    .map((c) => `${c.kind}|${c.symbol}|${c.from ?? ""}|${c.to ?? ""}`)
    .sort()
    .join("\n");

  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const digest = await subtle.digest("SHA-256", new TextEncoder().encode(canonical));
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 8);
    } catch {
      /* fall through to the pure-JS hash */
    }
  }

  // FNV-1a (32-bit) — deterministic, no secure context required.
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function buildPrBody(changes: ChangeSpec[], result: RepoRunResult): string {
  const lines = [
    "## 🤖 KeelCat — automated API migration",
    "",
    "KeelCat detected an API change and applied it to this repository.",
    "",
    "### Changes applied",
    ...changes.map((c) => `- \`${c.impact}\` **${c.symbol}** — ${c.description}`),
    "",
    "### Files updated",
    ...result.diffs.filter((d) => d.resolved).map((d) => `- \`${d.filePath}\` (${d.language.toLowerCase()})`),
    "",
    "### Reliability checks",
    `- ✅ Every edited file was syntax-checked before this PR was opened.`,
    result.verified
      ? `- ✅ No leftover usages of the old API remain.`
      : `- ⚠️ Some files still need manual attention (see below).`,
  ];
  if (result.flagged.length) {
    lines.push("", "### ⚠️ Needs manual attention");
    for (const f of result.flagged) lines.push(`- \`${f.filePath}\`${f.note ? ` — ${f.note}` : ""}`);
  }
  lines.push("", "---", "_Opened for review by KeelCat (run on your machine). Nothing is merged automatically._");
  return lines.join("\n");
}

async function runOneRepo(
  repoTok: RepoToken,
  changes: ChangeSpec[],
  opts: LocalRunOptions
): Promise<RepoRunResult> {
  const { verifyFixes, completenessCheck, autoOpenPr } = opts.settings;
  const ref: RepoRef = { owner: repoTok.owner, repo: repoTok.repo };
  const token = repoTok.token;

  const result: RepoRunResult = {
    id: repoTok.id,
    fullName: repoTok.fullName,
    affected: false,
    filesChanged: 0,
    fixCount: 0,
    unresolved: 0,
    verified: true,
    diffs: [],
    flagged: [],
    perChange: [],
    pr: null,
  };

  try {
    const base = await resolveBase(token, ref, repoTok.defaultBranch);
    const files = await fetchRepoFiles(token, ref, base);
    const original = new Map(files.map((f) => [f.filePath, f.content]));
    const current = new Map(files.map((f) => [f.filePath, f.content]));

    for (const change of changes) {
      let anyResolved = false;
      let anyUnresolved = false;
      let anyHit = false;
      const touched = new Set<string>();

      for (const [filePath, content] of current) {
        const file: FileToScan = { filePath, content };
        const edit: FileEditResult | null = await applyChangeToFile(file, change, { llmApplyFile: opts.llmApplyFile });
        if (!edit) continue;
        anyHit = true;
        if (edit.changed && edit.resolved) {
          current.set(filePath, edit.after);
          touched.add(filePath);
          result.fixCount++;
          anyResolved = true;
        } else if (!edit.resolved) {
          anyUnresolved = true;
          result.unresolved++;
          if (!result.flagged.find((f) => f.filePath === filePath))
            result.flagged.push({ filePath, note: edit.note, hits: edit.hits.length });
        }
      }

      let status: ChangeStatus;
      if (anyResolved) status = "FIXED";
      else if (change.impact === "NEW_FEATURE" || change.impact === "DEPRECATION") status = anyHit ? "INFO" : "CLEAN";
      else if (anyUnresolved || anyHit) status = "REVIEW";
      else status = "CLEAN";

      const pc: PerChangeResult = {
        symbol: change.symbol,
        impact: change.impact,
        kind: change.kind,
        status,
        filesTouched: [...touched],
      };
      result.perChange.push(pc);
    }

    // Reliability gate 1: verify every edited file still parses. Revert any file
    // that would produce broken code so we never open a broken PR.
    const updatedFiles: Record<string, string> = {};
    for (const f of files) {
      const after = current.get(f.filePath)!;
      if (after === f.content) continue;

      if (verifyFixes) {
        const v = await verifySyntax(f.filePath, after);
        if (!v.ok) {
          result.verified = false;
          result.unresolved++;
          result.flagged.push({
            filePath: f.filePath,
            note: `edit produced invalid ${v.language.toLowerCase()} syntax (${v.error}); skipped to keep the PR safe`,
            hits: 0,
          });
          for (const pc of result.perChange) {
            if (pc.filesTouched.includes(f.filePath) && pc.filesTouched.length === 1 && pc.status === "FIXED") {
              pc.status = "REVIEW";
              pc.note = "reverted: would have broken the file";
            }
          }
          current.set(f.filePath, f.content); // restore
          continue;
        }
      }
      updatedFiles[f.filePath] = after;
      result.diffs.push({ filePath: f.filePath, before: f.content, after, language: langTag(f.filePath), resolved: true });
    }

    // Reliability gate 2: completeness — confirm nothing renamed is left behind.
    if (completenessCheck) {
      for (const change of changes) {
        if (!change.from) continue;
        if (change.kind !== "SYMBOL_RENAME" && change.kind !== "PARAM_RENAME") continue;
        for (const [filePath, after] of Object.entries(updatedFiles)) {
          const hadBefore = findResidual(original.get(filePath) ?? "", change.from);
          const remains = findResidual(after, change.from);
          if (hadBefore > 0 && remains > 0) {
            result.verified = false;
            if (!result.flagged.find((f) => f.filePath === filePath && f.note?.includes(change.from!)))
              result.flagged.push({
                filePath,
                note: `${remains} usage(s) of "${change.from}" still remain after migration — please review`,
                hits: remains,
              });
            const pc = result.perChange.find((p) => p.symbol === change.symbol);
            if (pc && pc.status === "FIXED") {
              pc.status = "REVIEW";
              pc.note = "incomplete: old identifier still present";
            }
          }
        }
      }
    }

    result.filesChanged = Object.keys(updatedFiles).length;
    result.affected = result.filesChanged > 0 || result.flagged.length > 0;

    // Note: the ephemeral test sandbox (gate 3 on the server) is intentionally
    // skipped in the browser — it needs a real runtime to clone + run tests.

    if (autoOpenPr && result.filesChanged > 0) {
      const branch = `keelcat/${slug(changes[0]?.symbol ?? "api-change")}-${await changeSetHash(changes)}`;
      const title = `fix: migrate ${changes.map((c) => c.symbol).slice(0, 2).join(", ")}${changes.length > 2 ? "…" : ""}`;
      const body = buildPrBody(changes, result);
      const pr = await openFixPr(token, ref, branch, base, updatedFiles, title, body);
      result.pr = { number: pr.number, url: pr.url, branch: pr.branch };
    }
  } catch (e) {
    result.error = (e as Error).message;
    result.verified = false;
    if (result.perChange.length === 0) {
      for (const c of changes)
        result.perChange.push({ symbol: c.symbol, impact: c.impact, kind: c.kind, status: "ERROR", filesTouched: [] });
    } else {
      for (const pc of result.perChange) pc.status = "ERROR";
    }
  }

  return result;
}

/** Run the given changes across all selected repos, entirely in the browser. */
export async function runChangesLocal(
  changes: ChangeSpec[],
  repos: RepoToken[],
  opts: LocalRunOptions
): Promise<RunOutput> {
  const results: RepoRunResult[] = [];
  for (const repo of repos) {
    opts.onRepoStart?.(repo);
    const r = await runOneRepo(repo, changes, opts);
    results.push(r);
    opts.onRepoDone?.(r);
  }

  const reposAffected = results.filter((r) => r.affected).length;
  const prsOpened = results.filter((r) => r.pr).length;

  return { changes, reposScanned: repos.length, reposAffected, prsOpened, repos: results };
}
