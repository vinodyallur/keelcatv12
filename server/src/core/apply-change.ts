// Apply a single structured change to a source file across many languages.
// Strategy: fast, deterministic edits for the common, safe cases (symbol rename,
// parameter rename in named-arg languages). Anything ambiguous falls back to the
// LLM when configured, and otherwise is flagged for human review. Output always
// goes into a reviewable PR — nothing is auto-merged.

import type { ChangeSpec } from "../llm/changelog.js";
import { languageOf, namedArgStyle, type Language } from "./languages.js";
import { chat, extractJson, llmConfigured } from "../llm/client.js";

export interface FileToScan {
  filePath: string;
  content: string;
}

export interface UsageHit {
  line: number;
  text: string;
}

export interface FileEditResult {
  filePath: string;
  language: Language;
  before: string;
  after: string;
  changed: boolean;
  resolved: boolean; // confidently applied vs flagged for human
  method: "DETERMINISTIC" | "LLM" | "NONE";
  hits: UsageHit[];
  note?: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Does this file plausibly use the changed symbol / parameter? */
export function findHits(file: FileToScan, change: ChangeSpec): UsageHit[] {
  const lines = file.content.split("\n");
  const symbol = change.symbol;
  const needles: string[] = [];
  // For dotted symbols (e.g. "customers.create") match the FULL path only —
  // never the bare last segment, which would match common words like "create"
  // in unrelated files and trigger false-positive edits / needless LLM calls.
  if (symbol.includes(".")) needles.push(escapeRegExp(symbol));
  else needles.push(`\\b${escapeRegExp(symbol)}\\b`);
  if (change.from) needles.push(`\\b${escapeRegExp(change.from)}\\b`);
  const re = new RegExp(needles.join("|"));

  const hits: UsageHit[] = [];
  lines.forEach((text, i) => {
    if (re.test(text)) hits.push({ line: i + 1, text: text.trim().slice(0, 200) });
  });
  return hits;
}

/** Deterministic symbol rename (whole word / dotted sequence). Works in all langs. */
function renameSymbol(content: string, from: string, to: string): string {
  if (from.includes(".")) {
    const re = new RegExp(escapeRegExp(from), "g");
    return content.replace(re, to);
  }
  const re = new RegExp(`\\b${escapeRegExp(from)}\\b`, "g");
  return content.replace(re, to);
}

/** Deterministic parameter/key rename for named-arg languages. */
function renameParam(content: string, lang: Language, from: string, to: string): string {
  const style = namedArgStyle(lang);
  const f = escapeRegExp(from);
  if (style === "colon") {
    // object/struct literal key:  source: ...   and   "source":
    return content
      .replace(new RegExp(`(^|[\\s{,(])${f}(\\s*:)`, "g"), `$1${to}$2`)
      .replace(new RegExp(`(["'\\\`])${f}\\1(\\s*:)`, "g"), `$1${to}$1$2`);
  }
  if (style === "equals") {
    // Python kwarg:  source=...   (not ==)
    return content.replace(new RegExp(`(^|[\\s(,])${f}(\\s*=(?!=))`, "g"), `$1${to}$2`);
  }
  // Positional-arg language: renaming a provider parameter does not change calls.
  return content;
}

/** Apply one change to one file deterministically where safe. */
export function applyDeterministic(file: FileToScan, change: ChangeSpec): FileEditResult {
  const language = languageOf(file.filePath);
  const hits = findHits(file, change);
  const base: Omit<FileEditResult, "after" | "changed" | "resolved" | "method"> = {
    filePath: file.filePath,
    language,
    before: file.content,
    hits,
  };

  let after = file.content;
  let method: FileEditResult["method"] = "NONE";
  let resolved = false;
  let note: string | undefined;

  switch (change.kind) {
    case "SYMBOL_RENAME":
      if (change.from && change.to) {
        after = renameSymbol(file.content, change.from, change.to);
        method = "DETERMINISTIC";
        resolved = after !== file.content;
      }
      break;
    case "PARAM_RENAME":
      if (change.from && change.to) {
        const style = namedArgStyle(language);
        if (style === "none") {
          // Positional language: no call-site change required.
          note = "positional-argument language — no call-site change needed";
          resolved = true; // resolved as "nothing to do"
        } else {
          after = renameParam(file.content, language, change.from, change.to);
          method = "DETERMINISTIC";
          resolved = after !== file.content;
        }
      }
      break;
    case "SYMBOL_DEPRECATED":
      // No code change; informational. Considered resolved (notify only).
      note = "deprecation — usage flagged, no automatic rewrite";
      resolved = false;
      break;
    // PARAM_REMOVED, PARAM_ADDED_REQUIRED, SYMBOL_REMOVED, OTHER:
    // no safe deterministic edit here.
    default:
      break;
  }

  return { ...base, after, changed: after !== file.content, resolved, method, note };
}

/** LLM fallback: ask the model to apply ONLY this change and return the full file. */
export async function applyWithLlm(file: FileToScan, change: ChangeSpec): Promise<FileEditResult> {
  const language = languageOf(file.filePath);
  const hits = findHits(file, change);

  const system = `You are a precise code migration tool. You are given ONE source file and ONE API change. Apply ONLY that change to the file. Do not refactor, reformat, or alter anything unrelated. Preserve all whitespace and style. If the change does not apply to this file, return the file unchanged.

Respond with STRICT JSON: { "content": "<full updated file>", "changed": true|false, "note": "<short reason>" }`;

  const user = `API change:
- symbol: ${change.symbol}
- kind: ${change.kind}
- from: ${change.from ?? ""}
- to: ${change.to ?? ""}
- impact: ${change.impact}
- description: ${change.description}

Language: ${language}
File path: ${file.filePath}

--- FILE START ---
${file.content}
--- FILE END ---`;

  const raw = await chat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0,
    maxTokens: Math.min(8000, Math.ceil(file.content.length / 2) + 1200),
  });

  const parsed = extractJson<{ content?: string; changed?: boolean; note?: string }>(raw);
  const after = typeof parsed.content === "string" ? parsed.content : file.content;
  const changed = after !== file.content;
  return {
    filePath: file.filePath,
    language,
    before: file.content,
    after,
    changed,
    resolved: changed || parsed.changed === false,
    method: "LLM",
    hits,
    note: parsed.note,
  };
}

/**
 * Apply a change to a file: deterministic first, LLM fallback if configured and
 * deterministic produced no confident edit. Returns null if the file is not
 * affected at all (no hits).
 */
// Kinds where a real code edit is needed but can't be done deterministically —
// only these fall back to the LLM. Renames and deprecations are handled
// deterministically (or flagged), so we never let the model guess-edit them and
// open a bogus PR.
const KINDS_NEEDING_LLM = new Set(["PARAM_REMOVED", "PARAM_ADDED_REQUIRED", "SYMBOL_REMOVED", "OTHER"]);

export async function applyChangeToFile(file: FileToScan, change: ChangeSpec): Promise<FileEditResult | null> {
  const hits = findHits(file, change);
  if (hits.length === 0) return null; // not affected

  const det = applyDeterministic(file, change);
  if (det.changed || det.resolved) return det;

  // Deterministic made no confident edit. Only use the LLM for kinds that
  // genuinely need it (removals / additions / other). For renames &
  // deprecations we flag for review instead of letting the model hallucinate.
  if (KINDS_NEEDING_LLM.has(change.kind) && llmConfigured()) {
    try {
      const llm = await applyWithLlm(file, change);
      if (llm.changed) return llm;
      // LLM said no change needed but there were hits -> flag for review.
      return { ...det, resolved: false, note: llm.note ?? "no automatic edit; review recommended" };
    } catch (e) {
      return { ...det, resolved: false, note: `LLM fix failed: ${(e as Error).message}` };
    }
  }

  // No deterministic edit and no LLM: flag for human review.
  return { ...det, resolved: false, note: det.note ?? "needs manual migration (no LLM configured)" };
}
