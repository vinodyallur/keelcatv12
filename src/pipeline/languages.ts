// Language detection + which named-argument style each language uses.
// Ported verbatim from server/src/core/languages.ts so the browser pipeline
// classifies files exactly the same way the server does. Pure — no imports.
//
// ⚠️ Source of truth is the server copy; keep the two in sync until the shared
// core is extracted into a package both builds import.

export type Language =
  | "TYPESCRIPT"
  | "JAVASCRIPT"
  | "PYTHON"
  | "JAVA"
  | "C"
  | "CPP"
  | "GO"
  | "RUBY"
  | "OTHER";

const EXT: Record<string, Language> = {
  ts: "TYPESCRIPT",
  tsx: "TYPESCRIPT",
  mts: "TYPESCRIPT",
  cts: "TYPESCRIPT",
  js: "JAVASCRIPT",
  jsx: "JAVASCRIPT",
  mjs: "JAVASCRIPT",
  cjs: "JAVASCRIPT",
  py: "PYTHON",
  java: "JAVA",
  c: "C",
  h: "C",
  cpp: "CPP",
  cc: "CPP",
  cxx: "CPP",
  hpp: "CPP",
  hh: "CPP",
  go: "GO",
  rb: "RUBY",
};

export function languageOf(filePath: string): Language {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT[ext] ?? "OTHER";
}

export function isScannable(filePath: string): boolean {
  return languageOf(filePath) !== "OTHER";
}

/** Named-argument syntax used at call sites, if any. */
export function namedArgStyle(lang: Language): "colon" | "equals" | "none" {
  switch (lang) {
    case "TYPESCRIPT":
    case "JAVASCRIPT":
    case "GO": // struct literal fields use colon
    case "RUBY": // symbol keys often key:
      return "colon";
    case "PYTHON":
      return "equals";
    // Positional-arg languages: a parameter rename in the provider doesn't
    // change call sites in consumer code.
    case "JAVA":
    case "C":
    case "CPP":
    default:
      return "none";
  }
}

export const SCANNABLE_EXTENSIONS = Object.keys(EXT);
