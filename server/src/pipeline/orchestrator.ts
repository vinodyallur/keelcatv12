import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { diff } from "../core/spec-differ.js";
import { classify, migrationFor, summarize } from "../core/classifier.js";
import { scanJsTs, languageOf, type FileToScan } from "../core/scanner.js";
import { generateFix, applyEdits } from "../core/fix-generator.js";
import { serialize } from "../core/change-record-codec.js";
import type {
  OpenAPISpec,
  ChangeRecord,
  ChangeType,
  AffectedUsage,
  ProposedEdit,
} from "../core/types.js";

let crCounter = 0;
function nextChangeRecordId(symbol: string): string {
  return `cr_${symbol.replace(/[^a-z0-9]/gi, "_")}_${(crCounter++).toString(36)}`;
}

export interface PipelineResult {
  changeRecords: ChangeRecord[];
  usagesByRecord: Record<string, AffectedUsage[]>;
  edits: ProposedEdit[];
  unresolved: AffectedUsage[];
  updatedFiles: Record<string, string>; // path -> new content (only changed files)
  notifications: { kind: string; message: string }[];
  serializedRecords: string[];
}

/** Detect + classify: turn two specs into Change Records (R2, R3, R10). */
export function detect(prev: OpenAPISpec | null, curr: OpenAPISpec): ChangeRecord[] {
  const diffs = diff(prev, curr);
  return diffs.map((d) => {
    const changeType: ChangeType = classify(d);
    const migration = migrationFor(d);
    return {
      changeRecordId: nextChangeRecordId(d.symbol),
      providerId: curr.providerId,
      symbol: d.symbol,
      changeType,
      sourceVersion: curr.version,
      detectedAt: new Date().toISOString(),
      sourceKind: "OPENAPI",
      summary: summarize(d),
      ...(migration ? { migration } : {}),
    } satisfies ChangeRecord;
  });
}

/** Recursively read scannable source files under a directory. */
export function readRepoFiles(root: string): FileToScan[] {
  const out: FileToScan[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".git") continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else {
        const lang = languageOf(full);
        if (lang === "TYPESCRIPT" || lang === "JAVASCRIPT") {
          out.push({ filePath: relative(root, full).replace(/\\/g, "/"), content: readFileSync(full, "utf8") });
        }
      }
    }
  }
  walk(root);
  return out;
}

/** Full pipeline on a set of in-memory files (R2 -> R7). */
export function runPipeline(
  prev: OpenAPISpec | null,
  curr: OpenAPISpec,
  files: FileToScan[],
  repositoryId: string,
  sdkPackage?: string
): PipelineResult {
  const changeRecords = detect(prev, curr);
  const usagesByRecord: Record<string, AffectedUsage[]> = {};
  const allEdits: ProposedEdit[] = [];
  const allUnresolved: AffectedUsage[] = [];
  const notifications: { kind: string; message: string }[] = [];

  for (const cr of changeRecords) {
    if (cr.changeType === "NEW_FEATURE") {
      notifications.push({ kind: "NEW_FEATURE", message: cr.summary + " (notify only, no PR)" });
      usagesByRecord[cr.changeRecordId] = [];
      continue;
    }

    const usages = scanJsTs(files, cr, repositoryId, sdkPackage);
    usagesByRecord[cr.changeRecordId] = usages;

    if (cr.changeType === "DEPRECATION") {
      if (usages.length > 0) {
        notifications.push({
          kind: "DEPRECATION",
          message: `${cr.summary} — ${usages.length} usage(s) affected.`,
        });
      }
      continue;
    }

    // BREAKING
    notifications.push({ kind: "BREAKING_DETECTED", message: cr.summary });
    if (usages.length === 0) continue;
    const fix = generateFix(cr, usages);
    allEdits.push(...fix.edits);
    allUnresolved.push(...fix.unresolved);
  }

  const fileMap = new Map(files.map((f) => [f.filePath, f.content]));
  const updated = applyEdits(fileMap, allEdits);
  const updatedFiles: Record<string, string> = {};
  for (const [path, content] of updated) {
    if (content !== fileMap.get(path)) updatedFiles[path] = content;
  }

  if (allEdits.length > 0) {
    notifications.push({
      kind: "PR_OPENED",
      message: `Fix PR ready: ${Object.keys(updatedFiles).length} file(s), ${allEdits.length} edit(s)${
        allUnresolved.length ? `, ${allUnresolved.length} need manual attention` : ""
      }.`,
    });
  }

  return {
    changeRecords,
    usagesByRecord,
    edits: allEdits,
    unresolved: allUnresolved,
    updatedFiles,
    notifications,
    serializedRecords: changeRecords.map(serialize),
  };
}
