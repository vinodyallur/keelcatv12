import type { AffectedUsage, ChangeRecord, FixResult, ProposedEdit } from "./types.js";

/**
 * Generate proposed source edits for a BREAKING Change Record (design R5).
 * Only deterministic migrations produce edits; anything else is returned as
 * unresolved (R5.5) rather than guessing. Input usages are partitioned exactly:
 * every usage ends up in either `edits` or `unresolved`, never both, never lost.
 */
export function generateFix(changeRecord: ChangeRecord, usages: AffectedUsage[]): FixResult {
  const edits: ProposedEdit[] = [];
  const unresolved: AffectedUsage[] = [];

  const migration = changeRecord.migration;

  for (const usage of usages) {
    // PARAM_RENAME: the scanner pointed us at the property key; replace it.
    if (migration?.operation === "PARAM_RENAME" && migration.to && usage.snippet === migration.from) {
      const key = migration.from;
      edits.push({
        filePath: usage.location.filePath,
        startLine: usage.location.line,
        startColumn: usage.location.column,
        endLine: usage.location.line,
        endColumn: usage.location.column + key.length,
        replacement: migration.to,
        usageId: usage.usageId,
      });
      usage.resolved = true;
      continue;
    }

    // Everything else (symbol removed, required param added, no migration hint):
    // no safe deterministic edit -> mark for manual attention.
    unresolved.push({ ...usage, resolved: false });
  }

  return { edits, unresolved };
}

/**
 * Apply a set of edits to file contents in memory. Edits on the same file are
 * applied right-to-left so earlier offsets stay valid. Returns updated file map.
 */
export function applyEdits(
  files: Map<string, string>,
  edits: ProposedEdit[]
): Map<string, string> {
  const byFile = new Map<string, ProposedEdit[]>();
  for (const e of edits) {
    const arr = byFile.get(e.filePath) ?? [];
    arr.push(e);
    byFile.set(e.filePath, arr);
  }

  const out = new Map(files);
  for (const [filePath, fileEdits] of byFile) {
    const content = out.get(filePath);
    if (content === undefined) continue;
    const lines = content.split("\n");
    // Sort by line desc, then column desc, so edits don't shift each other.
    const sorted = [...fileEdits].sort(
      (a, b) => b.startLine - a.startLine || b.startColumn - a.startColumn
    );
    for (const e of sorted) {
      const idx = e.startLine - 1;
      if (idx < 0 || idx >= lines.length) continue;
      const line = lines[idx];
      lines[idx] =
        line.slice(0, e.startColumn) + e.replacement + line.slice(e.endColumn);
    }
    out.set(filePath, lines.join("\n"));
  }
  return out;
}
