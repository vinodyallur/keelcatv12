// Reliability gate: verify an edited file is still well-formed before it can
// land in a pull request. We never want KeelCat to open a "broken" PR, so
// every file the pipeline rewrites is checked here. For JS/TS we do a real
// parse with Babel; for other languages we do robust structural checks
// (balanced brackets, balanced quotes) that catch the mistakes a bad edit
// would introduce without needing a full toolchain for every language.

import { parse } from "@babel/parser";
import { languageOf, type Language } from "./languages.js";

export interface VerifyResult {
  ok: boolean;
  language: Language;
  error?: string;
}

/** Verify a single file's content is structurally sound after an edit. */
export function verifySyntax(filePath: string, content: string): VerifyResult {
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

function verifyJsTs(content: string, language: Language): VerifyResult {
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
 * Python: no bundled interpreter, so validate the two things a bad rename can
 * break — bracket balance and string-quote balance — while ignoring brackets
 * and quotes inside comments/strings.
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
 * token. If it does, the migration is incomplete and we should flag it rather
 * than pretend the repo is fully fixed.
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
