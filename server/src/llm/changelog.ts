// Turn a human changelog / API-change announcement into a precise, structured
// list of changes. The LLM only does *understanding* here (text -> schema).
// The actual code edits downstream are deterministic where possible and always
// land in a reviewable PR — never auto-merged.

import { chat, extractJson, llmConfigured } from "./client.js";

export type ChangeImpact = "BREAKING" | "DEPRECATION" | "NEW_FEATURE";
export type ChangeKind =
  | "PARAM_RENAME"
  | "SYMBOL_RENAME"
  | "PARAM_REMOVED"
  | "PARAM_ADDED_REQUIRED"
  | "SYMBOL_REMOVED"
  | "SYMBOL_DEPRECATED"
  | "SYMBOL_ADDED"
  | "OTHER";

export interface ChangeSpec {
  provider?: string;
  symbol: string; // method/function/field, e.g. "charges.create", "createCharge"
  kind: ChangeKind;
  from?: string; // old name (param or symbol)
  to?: string; // new name (param or symbol)
  impact: ChangeImpact;
  description: string;
}

const SYSTEM = `You are an API change extractor. You read a changelog or API-change announcement and output a STRICT JSON object describing the concrete, machine-actionable changes.

Output shape:
{ "changes": [ {
  "provider": string | null,       // API/library name if mentioned
  "symbol": string,                // the method/function/field affected, e.g. "charges.create" or "createCharge"
  "kind": "PARAM_RENAME" | "SYMBOL_RENAME" | "PARAM_REMOVED" | "PARAM_ADDED_REQUIRED" | "SYMBOL_REMOVED" | "SYMBOL_DEPRECATED" | "SYMBOL_ADDED" | "OTHER",
  "from": string | null,           // old name (parameter or symbol)
  "to": string | null,             // new name (parameter or symbol)
  "impact": "BREAKING" | "DEPRECATION" | "NEW_FEATURE",
  "description": string            // one concise sentence
} ] }

Rules:
- Only include changes that a tool could act on. Ignore prose, marketing, and version headers.
- Renaming a parameter => PARAM_RENAME with from/to. Renaming a method => SYMBOL_RENAME with from/to.
- Removing/requiring a parameter => PARAM_REMOVED / PARAM_ADDED_REQUIRED, impact BREAKING.
- Deprecations => SYMBOL_DEPRECATED, impact DEPRECATION.
- New additions => SYMBOL_ADDED, impact NEW_FEATURE.
- Prefer the exact identifiers as written. Do not invent names.
- Output ONLY the JSON object, no commentary.`;

/**
 * Parse a changelog into structured changes. The LLM is the smart path for
 * messy prose, but free models are inconsistent — so a deterministic regex
 * fallback guarantees the common, well-formed phrasings ("renamed X to Y",
 * "the P parameter was renamed", "X is deprecated") are always extracted. If
 * the LLM returns nothing (or isn't configured), we fall back automatically.
 */
export async function parseChangelog(text: string): Promise<ChangeSpec[]> {
  let llmChanges: ChangeSpec[] = [];
  if (llmConfigured()) {
    try {
      const raw = await chat({
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Changelog:\n\n${text}\n\nExtract the changes as JSON.` },
        ],
        temperature: 0,
        maxTokens: 1500,
      });
      const parsed = extractJson<{ changes?: ChangeSpec[] } | ChangeSpec[]>(raw);
      const arr = Array.isArray(parsed) ? parsed : parsed.changes ?? [];
      llmChanges = arr.filter(isValidChange).map(normalize);
    } catch {
      llmChanges = [];
    }
  }

  if (llmChanges.length > 0) return llmChanges;

  // Deterministic safety net — never let a flaky/absent model drop obvious changes.
  return fallbackParse(text);
}

/**
 * Regex-based extractor for the common, well-formed changelog phrasings. This
 * runs whenever the LLM produces nothing, so the pipeline stays reliable
 * regardless of model quality or availability.
 */
/** An API symbol looks like `a.b` (dotted) or `camelCase` — not a heading word. */
function looksLikeSymbol(s: string | undefined): s is string {
  return Boolean(s && (s.includes(".") || /[a-z][A-Z]/.test(s) || /_/.test(s)));
}

export function fallbackParse(text: string): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  const seen = new Set<string>();
  const add = (c: ChangeSpec) => {
    const key = `${c.kind}:${c.symbol}:${c.from ?? ""}:${c.to ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    changes.push(c);
  };

  // Split on newlines and sentence boundaries so multiple changes on one line
  // are still handled.
  const lines = text.split(/\r?\n/).flatMap((l) => l.split(/(?<=\.)\s+(?=[-*A-Z"'`])/));

  for (const rawLine of lines) {
    const line = rawLine.replace(/^\s*[-*•]\s*/, "").trim();
    if (!line) continue;

    // Leading "symbol:" prefix, e.g. `charges.create: the "source" ...`
    const prefix = line.match(/^([A-Za-z_$][\w.$]*)\s*:/);
    const leadingSymbol = prefix?.[1];

    const quoted = [...line.matchAll(/["'`]([A-Za-z_$][\w.$]*)["'`]/g)].map((m) => m[1]);
    const lower = line.toLowerCase();
    const renamed = /\b(renamed?|now|becomes?|replaced?\s+by|→|->)\b/.test(lower) || lower.includes("renamed");

    // Parameter / argument / field rename.
    if (renamed && /\b(parameter|param|argument|arg|field|property|key|option)\b/.test(lower) && quoted.length >= 2) {
      add({
        symbol: leadingSymbol ?? quoted[0],
        kind: "PARAM_RENAME",
        from: quoted[0],
        to: quoted[1],
        impact: "BREAKING",
        description: line.slice(0, 200),
      });
      continue;
    }

    // Method / function / symbol rename.
    if (renamed && /\b(method|function|endpoint|call|api|renamed)\b/.test(lower) && quoted.length >= 2) {
      add({
        symbol: quoted[0],
        kind: "SYMBOL_RENAME",
        from: quoted[0],
        to: quoted[1],
        impact: "BREAKING",
        description: line.slice(0, 200),
      });
      continue;
    }

    // "renamed from A to B" (order flipped vs. "A renamed to B").
    const fromTo = line.match(/renamed?\s+from\s+["'`]?([A-Za-z_$][\w.$]*)["'`]?\s+to\s+["'`]?([A-Za-z_$][\w.$]*)["'`]?/i);
    if (renamed && fromTo && fromTo[1] !== fromTo[2]) {
      const isParam = /\b(parameter|param|argument|field|property|key)\b/.test(lower);
      add({
        symbol: leadingSymbol ?? fromTo[1],
        kind: isParam ? "PARAM_RENAME" : "SYMBOL_RENAME",
        from: fromTo[1],
        to: fromTo[2],
        impact: "BREAKING",
        description: line.slice(0, 200),
      });
      continue;
    }

    // Generic "A renamed/now/now called/replaced by/replaced with/-> B".
    const rn = line.match(/["'`]?([A-Za-z_$][\w.$]*)["'`]?\s*(?:->|→|(?:is\s+)?(?:now(?:\s+called)?|renamed(?:\s+to)?|replaced\s+(?:by|with)|becomes?))\s*["'`]?([A-Za-z_$][\w.$]*)["'`]?/i);
    if (renamed && rn && rn[1] !== rn[2]) {
      const isParam = /\b(parameter|param|argument|field|property|key)\b/.test(lower);
      add({
        symbol: leadingSymbol ?? rn[1],
        kind: isParam ? "PARAM_RENAME" : "SYMBOL_RENAME",
        from: rn[1],
        to: rn[2],
        impact: "BREAKING",
        description: line.slice(0, 200),
      });
      continue;
    }

    // Deprecation. Require a real symbol (quoted, "X is deprecated", or a
    // dotted/camelCase leading symbol) so section headers like "Deprecations:"
    // are ignored.
    if (lower.includes("deprecat")) {
      const sym = quoted[0] ?? line.match(/([A-Za-z_$][\w.$]*)\s+is\s+deprecated/i)?.[1] ?? (looksLikeSymbol(leadingSymbol) ? leadingSymbol : undefined);
      if (sym) {
        add({ symbol: sym, kind: "SYMBOL_DEPRECATED", impact: "DEPRECATION", description: line.slice(0, 200) });
        continue;
      }
    }

    // Removal.
    if (/\b(removed|deleted|no longer (available|supported))\b/.test(lower)) {
      const sym = quoted[0] ?? (looksLikeSymbol(leadingSymbol) ? leadingSymbol : undefined);
      if (sym) {
        add({ symbol: sym, kind: "SYMBOL_REMOVED", impact: "BREAKING", description: line.slice(0, 200) });
        continue;
      }
    }

    // New feature / addition.
    if (/\b(added|introduced|new)\b/.test(lower)) {
      const sym = quoted[0] ?? line.match(/\b(?:added|introduced)\s+([A-Za-z_$][\w.$]*)/i)?.[1];
      if (sym && /[.]/.test(sym)) {
        add({ symbol: sym, kind: "SYMBOL_ADDED", impact: "NEW_FEATURE", description: line.slice(0, 200) });
        continue;
      }
    }
  }

  return changes;
}

function isValidChange(c: any): c is ChangeSpec {
  return c && typeof c.symbol === "string" && typeof c.kind === "string" && typeof c.impact === "string";
}

function normalize(c: any): ChangeSpec {
  return {
    provider: c.provider ?? undefined,
    symbol: String(c.symbol).trim(),
    kind: c.kind,
    from: c.from ?? undefined,
    to: c.to ?? undefined,
    impact: c.impact,
    description: c.description ?? `${c.kind} on ${c.symbol}`,
  };
}
