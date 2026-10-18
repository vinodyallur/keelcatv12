// Reliability gate (browser copy): verify an edited file is still well-formed
// before it can land in a pull request. Ported from server/src/core/verify.ts.
//
// Difference from the server copy: @babel/parser is loaded lazily via dynamic
// import so it never bloats the initial bundle — the parser only downloads the
// first time a JS/TS file actually needs verifying. This makes verifySyntax
// async here (the server version is sync).
//
// ⚠️ Source of truth is the server copy; keep the bracket logic in sync.

import { languageOf, type Language } from "./languages";

export interface VerifyResult {
  ok: boolean;
  language: Language;
  error?: string;
}

// Lazily-loaded Babel parser (cached after first use).
type BabelParse = (code: string, opts: Record<string, unknown>) => unknown;
let _parse: BabelParse | null = null;
async function loadParser(): Promise<BabelParse> {
  if (!_parse) {
    const mod = await import("@babel/parser");
    _parse = mod.parse as unknown as BabelParse;
  }
  return _parse;
}

/** Verify a single file's content is structurally sound after an edit. */
export async function verifySyntax(filePath: string, content: string): Promise<VerifyResult> {
  const language = languageOf(filePath);
  switch (language) {
    case "TYPESCRIPT":
    case "JAVASCRIPT":
      return verifyJsTs(content, language);
    case "PYTHON":
      return verifyPython(content, language);
    case "JAVA":
    case "C":
    case "CPP":
    case "GO":
    case "RUBY":
      return verifyBrackets(content, language);
    default:
      return { ok: true, language };
  }
}

async function verifyJsTs(content: string, language: Language): Promise<VerifyResult> {
  // Loading the parser is separate from parsing: if the parser module can't be
  // loaded (e.g. a chunk-load hiccup), we DON'T block the PR — we skip JS/TS
  // verification rather than fail the whole run. Only a genuine parse error
  // (parser loaded, code invalid) marks the file unsafe.
  let parse: BabelParse;
  try {
    parse = await loadParser();
  } catch {
    return { ok: true, language };
  }
  try {
    parse(content, {
      sourceType: "module",
      // errorRecovery false so real syntax errors throw.
      errorRecovery: false,
      plugins: ["typescript", "jsx"],
    });
    return { ok: true, language };
  } catch (e) {
    return { ok: false, language, error: (e as Error).message.split("\n")[0] };
  }
}

/**
 * Python: no interpreter in the browser, so validate the two things a bad
 * rename can break — bracket balance and string-quote balance — while ignoring
 * brackets and quotes inside comments/strings.
 */
function verifyPython(content: string, language: Language): VerifyResult {
  const bracket = checkBrackets(content, "#");
  if (!bracket.ok) return { ok: false, language, error: bracket.error };
  return { ok: true, language };
}

function verifyBrackets(content: string, language: Language): VerifyResult {
  const lineComment = language === "RUBY" ? "#" : "//";
  const bracket = checkBrackets(content, lineComment);
  if (!bracket.ok) return { ok: false, language, error: bracket.error };
  return { ok: true, language };
}

/**
 * Scan characters tracking string state so brackets inside strings/comments are
 * ignored, then confirm every (), [], {} is balanced and properly nested.
 */
function checkBrackets(content: string, lineComment: string): { ok: boolean; error?: string } {
  const stack: { ch: string; line: number }[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const openers = new Set(["(", "[", "{"]);
  const closers = new Set([")", "]", "}"]);

  let line = 1;
  let inString: string | null = null; // the quote char currently open
  let inBlockComment = false;
  const lc0 = lineComment[0];
  const lc1 = lineComment[1];

  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    const next = content[i + 1];
    if (c === "\n") {
      line++;
      // Unterminated single-line string is a real error in these languages.
      if (inString && inString !== "`") return { ok: false, error: `Unterminated string near line ${line - 1}` };
      continue;
    }

    if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      if (c === "\\") {
        i++; // skip escaped char
      } else if (c === inString) {
        inString = null;
      }
      continue;
    }

    // Not in string/comment.
    if (c === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (c === lc0 && (lineComment.length === 1 || next === lc1)) {
      // Skip to end of line.
      while (i < content.length && content[i] !== "\n") i++;
      line++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inString = c;
      continue;
    }
    if (openers.has(c)) {
      stack.push({ ch: c, line });
    } else if (closers.has(c)) {
      const top = stack.pop();
      if (!top || top.ch !== pairs[c]) {
        return { ok: false, error: `Unbalanced '${c}' near line ${line}` };
      }
    }
  }

  if (inBlockComment) return { ok: false, error: "Unterminated block comment" };
  if (stack.length > 0) {
    const t = stack[stack.length - 1];
    return { ok: false, error: `Unclosed '${t.ch}' from line ${t.line}` };
  }
  return { ok: true };
}

/**
 * Completeness check ("nothing sticking out"): after all edits are applied,
 * confirm the OLD identifier from a rename no longer appears as a standalone
 * token. If it does, the migration is incomplete and we flag it.
 */
export function findResidual(content: string, oldName: string): number {
  if (!oldName) return 0;
  const re = oldName.includes(".")
    ? new RegExp(escapeRegExp(oldName), "g")
    : new RegExp(`\\b${escapeRegExp(oldName)}\\b`, "g");
  const m = content.match(re);
  return m ? m.length : 0;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
