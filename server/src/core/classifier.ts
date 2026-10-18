import type { SymbolDiff, ChangeType, MigrationHint } from "./types.js";

/**
 * Pure classification of a SymbolDiff into a ChangeType (design R3).
 * - removed symbol / incompatible required-param change -> BREAKING
 * - still-callable, newly deprecated -> DEPRECATION
 * - purely additive -> NEW_FEATURE
 */
export function classify(d: SymbolDiff): ChangeType {
  switch (d.kind) {
    case "SYMBOL_REMOVED":
    case "REQUIRED_PARAM_REMOVED":
    case "REQUIRED_PARAM_ADDED":
    case "PARAM_RENAMED":
      return "BREAKING";
    case "SYMBOL_DEPRECATED":
      return "DEPRECATION";
    case "SYMBOL_ADDED":
      return "NEW_FEATURE";
  }
}

/** Derive a machine-applicable migration hint from a diff, when one exists. */
export function migrationFor(d: SymbolDiff): MigrationHint | undefined {
  switch (d.kind) {
    case "PARAM_RENAMED":
      return { operation: "PARAM_RENAME", from: d.paramFrom!, to: d.paramTo! };
    case "REQUIRED_PARAM_REMOVED":
      return { operation: "PARAM_REMOVED", from: d.paramFrom! };
    case "REQUIRED_PARAM_ADDED":
      return { operation: "PARAM_REQUIRED", from: d.paramTo! };
    case "SYMBOL_REMOVED":
    case "SYMBOL_DEPRECATED":
    case "SYMBOL_ADDED":
      return undefined;
  }
}

export function summarize(d: SymbolDiff): string {
  switch (d.kind) {
    case "SYMBOL_REMOVED":
      return `Symbol \`${d.symbol}\` was removed.`;
    case "SYMBOL_ADDED":
      return `New symbol \`${d.symbol}\` is available.`;
    case "SYMBOL_DEPRECATED":
      return `Symbol \`${d.symbol}\` is deprecated but still callable.`;
    case "REQUIRED_PARAM_REMOVED":
      return `Parameter \`${d.paramFrom}\` was removed from \`${d.symbol}\`.`;
    case "REQUIRED_PARAM_ADDED":
      return `\`${d.symbol}\` now requires new parameter \`${d.paramTo}\`.`;
    case "PARAM_RENAMED":
      return `Parameter \`${d.paramFrom}\` renamed to \`${d.paramTo}\` in \`${d.symbol}\`.`;
  }
}
