import type { OpenAPISpec, ApiSymbol, SymbolDiff } from "./types.js";

function indexByName(spec: OpenAPISpec): Map<string, ApiSymbol> {
  const m = new Map<string, ApiSymbol>();
  for (const s of spec.symbols) m.set(s.name, s);
  return m;
}

/**
 * Pure diff of two normalized specs (design R2.2).
 * Emits at most a small set of SymbolDiffs per differing symbol. Unchanged
 * symbols emit nothing.
 */
export function diff(previous: OpenAPISpec | null, current: OpenAPISpec): SymbolDiff[] {
  const diffs: SymbolDiff[] = [];
  const prevSymbols = previous ? indexByName(previous) : new Map<string, ApiSymbol>();
  const currSymbols = indexByName(current);

  // Removed symbols
  for (const [name] of prevSymbols) {
    if (!currSymbols.has(name)) {
      diffs.push({ symbol: name, kind: "SYMBOL_REMOVED" });
    }
  }

  for (const [name, curr] of currSymbols) {
    const prev = prevSymbols.get(name);
    if (!prev) {
      // Added symbol (only meaningful if we had a baseline)
      if (previous) diffs.push({ symbol: name, kind: "SYMBOL_ADDED" });
      continue;
    }

    // Deprecation flip: was not deprecated, now deprecated, still present
    if (!prev.deprecated && curr.deprecated) {
      diffs.push({ symbol: name, kind: "SYMBOL_DEPRECATED" });
    }

    const prevReq = new Set(prev.requiredParams);
    const currReq = new Set(curr.requiredParams);
    const prevAll = new Set([...prev.requiredParams, ...prev.optionalParams]);
    const currAll = new Set([...curr.requiredParams, ...curr.optionalParams]);

    const removedRequired = [...prevReq].filter((p) => !currAll.has(p));
    const addedRequired = [...currReq].filter((p) => !prevAll.has(p));

    // Detect a rename: exactly one required removed and one required added.
    if (removedRequired.length === 1 && addedRequired.length === 1) {
      diffs.push({
        symbol: name,
        kind: "PARAM_RENAMED",
        paramFrom: removedRequired[0],
        paramTo: addedRequired[0],
      });
    } else {
      for (const p of removedRequired) {
        diffs.push({ symbol: name, kind: "REQUIRED_PARAM_REMOVED", paramFrom: p });
      }
      for (const p of addedRequired) {
        diffs.push({ symbol: name, kind: "REQUIRED_PARAM_ADDED", paramTo: p });
      }
    }
  }

  return diffs;
}
