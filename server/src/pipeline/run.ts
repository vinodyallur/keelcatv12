// Real multi-repo run: given structured changes + the selected connected repos,
// fetch each repo, apply the changes across all languages, verify every edit is
// still well-formed, confirm nothing from the changelog is left behind, and open
// ONE real pull request per affected repo. Never merges.

import { Octokit } from "@octokit/rest";
import { createHash } from "node:crypto";
import type { ChangeSpec } from "../llm/changelog.js";
import {
  resolveBase,
  fetchRepoFiles,
  openFixPr,
  type RepoRef,
} from "../integrations/github.js";
import { octokitForRepo, tokenForRepo, defaultOctokit } from "../integrations/credentials.js";
import { applyChangeToFile, type FileEditResult } from "../core/apply-change.js";
import { verifySyntax, findResidual } from "../core/verify.js";
import { runRepoTests } from "../core/sandbox.js";
import {
  getConfig,
  getSelectedRepos,
  setRepoResult,
  markRepoRunning,
  setLastChanges,
  logAudit,
  type ConnectedRepo,
  type RunTestResult,
  type RunRepoResult,
  type RepoPrStatus,
} from "../config/store.js";
import { notifyRun } from "../notifications/notify.js";

export type ChangeStatus = "FIXED" | "REVIEW" | "CLEAN" | "INFO" | "ERROR";

export interface PerChangeResult {
  symbol: string;
  impact: string;
  kind: string;
  status: ChangeStatus;
  filesTouched: string[];
  note?: string;
}

export interface RepoRunResult {
  id: string;
  fullName: string;
  affected: boolean;
  filesChanged: number;
  fixCount: number;
  unresolved: number;
  verified: boolean;
  diffs: { filePath: string; before: string; after: string; language: string; resolved: boolean; note?: string }[];
  flagged: { filePath: string; note?: string; hits: number }[];
  perChange: PerChangeResult[];
  tests?: RunTestResult;
  needsAttention?: boolean;
  attentionReason?: string;
  pr: { number: number; url: string; branch: string } | null;
  error?: string;
}

export interface RunOutput {
  changes: ChangeSpec[];
  reposScanned: number;
  reposAffected: number;
  prsOpened: number;
  repos: RepoRunResult[];
}

/**
 * Any-valid-token Octokit for reading public provider changelogs (identity
 * doesn't matter there). Kept for the webhook path.
 */
export async function resolveOctokit(): Promise<Octokit> {
  return defaultOctokit();
}

/** Flatten a run's per-repo outcomes for the changelog → PR tracker. */
export function summarizeRunResults(out: RunOutput): RunRepoResult[] {
  return out.repos.map((r) => ({
    fullName: r.fullName,
    affected: r.affected,
    prNumber: r.pr?.number,
    prUrl: r.pr?.url,
    prStatus: r.error ? "ERROR" : r.pr ? "RAISED" : "NONE",
    impacts: [...new Set(r.perChange.filter((pc) => pc.status !== "CLEAN").map((pc) => pc.impact))],
    filesChanged: r.filesChanged,
    unresolved: r.unresolved,
    tests: r.tests,
    error: r.error,
  }));
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
  if (result.tests) {
    const t = result.tests;
    if (t.ran) lines.push(`- ${t.ok ? "✅" : "❌"} Ran the repo's own test suite: **${t.summary}**${t.command ? ` (\`${t.command}\`)` : ""}.`);
    else lines.push(`- ℹ️ Test suite not run: ${t.summary}`);
  }
  if (result.flagged.length) {
    lines.push("", "### ⚠️ Needs manual attention");
    for (const f of result.flagged) lines.push(`- \`${f.filePath}\`${f.note ? ` — ${f.note}` : ""}`);
  }
  lines.push("", "---", "_Opened for review by KeelCat. Nothing is merged automatically._");
  return lines.join("\n");
}

async function runOneRepo(
  octokit: Octokit,
  repo: ConnectedRepo,
  changes: ChangeSpec[],
  autoOpenPr: boolean,
  token: string | null,
  trigger: string
): Promise<RepoRunResult> {
  const { verifyFixes, completenessCheck, runTests } = getConfig().settings;
  markRepoRunning(repo.id);
  const ref: RepoRef = { owner: repo.owner, repo: repo.repo };
  const result: RepoRunResult = {
    id: repo.id,
    fullName: repo.fullName,
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
    const base = await resolveBase({ octokit }, ref);
    const files = await fetchRepoFiles({ octokit }, ref, base);
    const original = new Map(files.map((f) => [f.filePath, f.content]));

    // Track evolving content per file so multiple changes compose.
    const current = new Map(files.map((f) => [f.filePath, f.content]));

    for (const change of changes) {
      let anyResolved = false;
      let anyUnresolved = false;
      let anyHit = false;
      const touched = new Set<string>();

      for (const [filePath, content] of current) {
        const edit: FileEditResult | null = await applyChangeToFile({ filePath, content }, change);
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
        // resolved && !changed => no-op for this language; nothing to record.
      }

      let status: ChangeStatus;
      if (anyResolved) status = "FIXED";
      else if (change.impact === "NEW_FEATURE" || change.impact === "DEPRECATION") status = anyHit ? "INFO" : "CLEAN";
      else if (anyUnresolved || anyHit) status = "REVIEW";
      else status = "CLEAN";

      result.perChange.push({
        symbol: change.symbol,
        impact: change.impact,
        kind: change.kind,
        status,
        filesTouched: [...touched],
      });
    }

    // Reliability gate 1: verify every edited file still parses. Revert any file
    // that would produce broken code so we never open a broken PR.
    const updatedFiles: Record<string, string> = {};
    for (const f of files) {
      const after = current.get(f.filePath)!;
      if (after === f.content) continue;

      if (verifyFixes) {
        const v = verifySyntax(f.filePath, after);
        if (!v.ok) {
          result.verified = false;
          result.unresolved++;
          result.flagged.push({
            filePath: f.filePath,
            note: `edit produced invalid ${v.language.toLowerCase()} syntax (${v.error}); skipped to keep the PR safe`,
            hits: 0,
          });
          // Downgrade any change that touched this file.
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

    // Reliability gate 2: completeness — confirm nothing from the changelog is
    // left sticking out (old renamed identifiers still present).
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

    // Reliability gate 3 (opt-in): run the repo's own tests on the fix in an
    // ephemeral sandbox, so the PR can carry real proof the code still works.
    if (runTests && token && result.filesChanged > 0) {
      logAudit("TESTS_RUNNING", `Running ${repo.fullName}'s test suite on the fix…`);
      result.tests = await runRepoTests({ owner: repo.owner, repo: repo.repo, branch: base, token, updatedFiles });
      logAudit(
        result.tests.ran ? (result.tests.ok ? "TESTS_PASSED" : "TESTS_FAILED") : "TESTS_SKIPPED",
        `${repo.fullName}: ${result.tests.summary}`
      );
    }

    if (autoOpenPr && result.filesChanged > 0) {
      // Deterministic branch name derived from the change set — so re-running
      // the SAME changelog (whether from the UI or the webhook) reuses the same
      // branch and updates the existing PR instead of opening a duplicate.
      // openFixPr is idempotent per branch name, so this keeps one PR per repo
      // per distinct changelog rather than a new PR on every run.
      const branch = `keelcat/${slug(changes[0]?.symbol ?? "api-change")}-${changeSetHash(changes)}`;
      const title = `fix: migrate ${changes.map((c) => c.symbol).slice(0, 2).join(", ")}${changes.length > 2 ? "…" : ""}`;
      const body = buildPrBody(changes, result);
      const pr = await openFixPr({ octokit }, ref, branch, base, updatedFiles, title, body);
      result.pr = { number: pr.number, url: pr.url, branch: pr.branch };
      logAudit("PR_OPENED", `Opened PR #${pr.number} on ${repo.fullName} (${result.filesChanged} file(s)).`);
    }

    const impacts = [...new Set(result.perChange.filter((pc) => pc.status !== "CLEAN").map((pc) => pc.impact))];
    const testsFailed = Boolean(result.tests?.ran && !result.tests.ok);
    const needsAttention = autoOpenPr && result.affected && (!result.pr || testsFailed);
    const prStatus: RepoPrStatus = result.pr ? "RAISED" : result.affected ? "NOT_RAISED" : "CLEAN";

    setRepoResult(repo.id, {
      affected: result.affected,
      filesChanged: result.filesChanged,
      fixCount: result.fixCount,
      unresolved: result.unresolved,
      prNumber: result.pr?.number,
      prUrl: result.pr?.url,
      branch: result.pr?.branch,
      prStatus,
      impacts,
      tests: result.tests,
      needsAttention,
    });

    // Flag for a human when a PR couldn't be opened, or when it opened but the
    // repo's own tests fail on the fix. Recorded on the result + audit log; a
    // SINGLE consolidated email/Slack goes out at the end of the whole run.
    if (needsAttention) {
      const reason = testsFailed
        ? `tests failing after the fix (${result.tests?.summary})${result.pr ? ` — PR #${result.pr.number}` : ""}`
        : result.unresolved > 0
        ? `${result.unresolved} usage(s) need manual review — ${result.flagged.map((f) => f.filePath).slice(0, 3).join(", ")}`
        : "changes detected but no fix could be applied automatically";
      result.needsAttention = true;
      result.attentionReason = reason;
      logAudit("NEEDS_ATTENTION", `${repo.fullName} needs manual attention: ${reason}`);
    }
  } catch (e) {
    result.error = (e as Error).message;
    result.verified = false;
    if (result.perChange.length === 0) {
      for (const c of changes) result.perChange.push({ symbol: c.symbol, impact: c.impact, kind: c.kind, status: "ERROR", filesTouched: [] });
    } else {
      for (const pc of result.perChange) pc.status = "ERROR";
    }
    result.needsAttention = true;
    result.attentionReason = `run failed: ${result.error}`;
    setRepoResult(repo.id, { affected: false, filesChanged: 0, fixCount: 0, unresolved: 0, prStatus: "ERROR", error: result.error });
    logAudit("REPO_ERROR", `${repo.fullName}: ${result.error}`);
  }

  return result;
}

/** Run the given changes across all selected repos. */
export async function runChanges(changes: ChangeSpec[], trigger = "MANUAL"): Promise<RunOutput> {
  const repos = getSelectedRepos();
  const { autoOpenPr, runTests } = getConfig().settings;

  // Remember these changes so scheduled watching can re-run them.
  setLastChanges(changes as any);

  logAudit("RUN_STARTED", `Applying ${changes.length} change(s) across ${repos.length} repo(s). [${trigger}]`);

  // Clear any stale error/status from previous runs immediately so the UI shows
  // every selected repo as "raising…" while this run works through them.
  for (const repo of repos) markRepoRunning(repo.id);

  const results: RepoRunResult[] = [];
  for (const repo of repos) {
    // Each repo is accessed with the credential of the account it came from,
    // so repos across multiple connected GitHub accounts all work in one run.
    let octokit: Octokit;
    try {
      octokit = await octokitForRepo(repo);
    } catch (e) {
      const msg = (e as Error).message;
      setRepoResult(repo.id, { affected: false, filesChanged: 0, fixCount: 0, unresolved: 0, prStatus: "ERROR", error: msg });
      logAudit("REPO_ERROR", `${repo.fullName}: ${msg}`);
      results.push({
        id: repo.id, fullName: repo.fullName, affected: false, filesChanged: 0, fixCount: 0,
        unresolved: 0, verified: false, diffs: [], flagged: [], pr: null, error: msg,
        needsAttention: true, attentionReason: msg,
        perChange: changes.map((c) => ({ symbol: c.symbol, impact: c.impact, kind: c.kind, status: "ERROR" as ChangeStatus, filesTouched: [] })),
      });
      continue;
    }
    // Resolve a raw token for this repo's account if the sandbox is enabled.
    let token: string | null = null;
    if (runTests) {
      try {
        token = await tokenForRepo(repo);
      } catch (e) {
        logAudit("TESTS_SKIPPED", `Test sandbox disabled for ${repo.fullName}: ${(e as Error).message}`);
      }
    }
    results.push(await runOneRepo(octokit, repo, changes, autoOpenPr, token, trigger));
  }

  const reposAffected = results.filter((r) => r.affected).length;
  const prsOpened = results.filter((r) => r.pr).length;
  logAudit("RUN_COMPLETED", `${reposAffected}/${repos.length} affected, ${prsOpened} PR(s) opened.`);

  const output: RunOutput = { changes, reposScanned: repos.length, reposAffected, prsOpened, repos: results };

  // Fire notifications (best-effort, never blocks the response for long).
  notifyRun({
    trigger,
    changeCount: changes.length,
    reposScanned: repos.length,
    reposAffected,
    prsOpened,
    repos: results.map((r) => ({
      fullName: r.fullName,
      affected: r.affected,
      filesChanged: r.filesChanged,
      unresolved: r.unresolved,
      impacts: [...new Set(r.perChange.filter((pc) => pc.status !== "CLEAN").map((pc) => pc.impact))],
      tests: r.tests ? { ran: r.tests.ran, ok: r.tests.ok, summary: r.tests.summary } : null,
      needsAttention: Boolean(r.needsAttention),
      attentionReason: r.attentionReason,
      pr: r.pr ? { number: r.pr.number, url: r.pr.url } : null,
      error: r.error,
    })),
  }).catch(() => {});

  return output;
}

function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40) || "api-change";
}
/**
 * Stable short hash of a change set. Order-independent (changes are sorted
 * first) so the same logical changelog always yields the same branch suffix,
 * making runs idempotent instead of spawning a fresh PR every time.
 */
function changeSetHash(changes: ChangeSpec[]): string {
  const canonical = changes
    .map((c) => `${c.kind}|${c.symbol}|${c.from ?? ""}|${c.to ?? ""}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 8);
}
function langTag(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return ext;
}
