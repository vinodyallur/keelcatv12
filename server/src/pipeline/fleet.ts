// Multi-repo fan-out: run the detection/fix pipeline across every enabled repo
// in the fleet, open (simulated) PRs only on the repos that are actually
// affected, and record results, audit entries, and notifications.

import { runPipeline } from "./orchestrator.js";
import { fixtureFiles } from "../state/fleet-fixtures.js";
import {
  getRepos,
  getProviders,
  getSettings,
  getSpec,
  setRepoResult,
  setLastFleetScan,
  logAudit,
  pushNotification,
} from "../state/store.js";
import { BASELINE_SPEC } from "../state/default-specs.js";
import type { OpenAPISpec, ChangeRecord } from "../core/types.js";

export interface FileDiff {
  filePath: string;
  before: string;
  after: string;
}

export interface RepoScanResult {
  repositoryId: string;
  fullName: string;
  scanned: boolean;
  affected: boolean;
  scannedFiles: number;
  changeRecords: ChangeRecord[];
  affectedRecordIds: string[];
  fixCount: number;
  unresolved: number;
  diffs: FileDiff[];
  pr: { simulated: true; branch: string; title: string; filesChanged: number; number: number } | null;
  reason?: string;
}

export interface FleetScanResult {
  at: string;
  trigger: "MANUAL" | "SCHEDULED";
  totalRepos: number;
  scanned: number;
  affected: number;
  prsOpened: number;
  provider: { id: string; from: string; to: string };
  repos: RepoScanResult[];
}

let prCounter = 128;

/**
 * Run the full fan-out. `trigger` distinguishes a manual "scan now" from an
 * automatic scheduler tick (used only for audit wording).
 */
export function runFleetScan(trigger: "MANUAL" | "SCHEDULED" = "MANUAL"): FleetScanResult {
  // Diff the editable spec: baseline (what the fleet's code targets) -> current.
  const specState = getSpec("demo-pay");
  const prev: OpenAPISpec = specState?.baseline ?? BASELINE_SPEC;
  const curr: OpenAPISpec = specState?.current ?? BASELINE_SPEC;
  const settings = getSettings();
  const providers = getProviders();
  const enabledProviders = new Set(providers.filter((p) => p.enabled).map((p) => p.providerId));

  const repos = getRepos();
  const results: RepoScanResult[] = [];
  const at = new Date().toISOString();

  logAudit("SCAN_STARTED", `${trigger === "SCHEDULED" ? "Scheduled" : "Manual"} fleet scan started across ${repos.length} repo(s).`);

  let scanned = 0;
  let affectedCount = 0;
  let prsOpened = 0;

  for (const repo of repos) {
    // Skip paused repos.
    if (!repo.enabled) {
      results.push(emptyResult(repo.repositoryId, repo.fullName, "paused"));
      continue;
    }
    // Skip repos that depend only on paused/unknown providers.
    const watches = repo.dependsOn.some((d) => enabledProviders.has(d));
    if (!watches) {
      results.push(emptyResult(repo.repositoryId, repo.fullName, repo.dependsOn.length ? "provider paused" : "no monitored dependency"));
      setRepoResult(repo.repositoryId, { affected: false, changeCount: 0, fixCount: 0, unresolved: 0, filesChanged: 0 });
      continue;
    }

    const files = fixtureFiles(repo.repositoryId);
    const result = runPipeline(prev, curr, files, repo.fullName, curr.providerId);
    scanned++;

    const affectedRecordIds = result.changeRecords
      .filter((c) => (result.usagesByRecord[c.changeRecordId] ?? []).length > 0)
      .map((c) => c.changeRecordId);
    const affected = affectedRecordIds.length > 0;

    const before = new Map(files.map((f) => [f.filePath, f.content]));
    const diffs: FileDiff[] = Object.entries(result.updatedFiles).map(([filePath, after]) => ({
      filePath,
      before: before.get(filePath) ?? "",
      after,
    }));

    const hasFix = Object.keys(result.updatedFiles).length > 0;
    let pr: RepoScanResult["pr"] = null;
    if (hasFix && settings.autoOpenPr) {
      const breaking = result.changeRecords.find((c) => c.changeType === "BREAKING");
      const branch = `keelcat/${breaking?.migration?.from ?? "fix"}-to-${breaking?.migration?.to ?? "update"}`;
      pr = {
        simulated: true,
        branch,
        title: breaking
          ? `fix(${curr.providerId}): migrate ${breaking.symbol} (${breaking.migration?.from} → ${breaking.migration?.to})`
          : `chore(${curr.providerId}): API changes`,
        filesChanged: diffs.length,
        number: prCounter++,
      };
      prsOpened++;
      logAudit("PR_OPENED", `Opened PR #${pr.number} on ${repo.fullName} — ${diffs.length} file(s), ${result.edits.length} edit(s).`, repo.repositoryId);
      pushNotification("PR_OPENED", `Fix PR #${pr.number} ready on ${repo.fullName}.`, repo.repositoryId);
    }

    // Deprecation notices for this repo.
    for (const cr of result.changeRecords) {
      if (cr.changeType === "DEPRECATION" && (result.usagesByRecord[cr.changeRecordId] ?? []).length > 0) {
        pushNotification("DEPRECATION", `${repo.fullName}: ${cr.summary}`, repo.repositoryId);
      }
    }

    if (affected) {
      affectedCount++;
      logAudit("REPO_AFFECTED", `${repo.fullName} affected — ${affectedRecordIds.length} change(s), ${result.edits.length} auto-fix(es), ${result.unresolved.length} to review.`, repo.repositoryId);
    }

    setRepoResult(repo.repositoryId, {
      affected,
      changeCount: affectedRecordIds.length,
      fixCount: result.edits.length,
      unresolved: result.unresolved.length,
      filesChanged: diffs.length,
      prBranch: pr?.branch,
      prNumber: pr?.number,
    });

    results.push({
      repositoryId: repo.repositoryId,
      fullName: repo.fullName,
      scanned: true,
      affected,
      scannedFiles: files.length,
      changeRecords: result.changeRecords,
      affectedRecordIds,
      fixCount: result.edits.length,
      unresolved: result.unresolved.length,
      diffs,
      pr,
    });
  }

  setLastFleetScan(at);
  logAudit(
    "SCAN_COMPLETED",
    `Fleet scan complete: ${affectedCount}/${scanned} affected, ${prsOpened} PR(s) opened.`
  );

  // New-feature notice fires once per scan (repo-independent).
  const newFeature = results.find((r) => r.changeRecords.some((c) => c.changeType === "NEW_FEATURE"));
  if (newFeature) {
    const nf = newFeature.changeRecords.find((c) => c.changeType === "NEW_FEATURE");
    if (nf) pushNotification("NEW_FEATURE", nf.summary, undefined);
  }

  return {
    at,
    trigger,
    totalRepos: repos.length,
    scanned,
    affected: affectedCount,
    prsOpened,
    provider: { id: curr.providerId, from: prev.version, to: curr.version },
    repos: results,
  };
}

function emptyResult(repositoryId: string, fullName: string, reason: string): RepoScanResult {
  return {
    repositoryId,
    fullName,
    scanned: false,
    affected: false,
    scannedFiles: 0,
    changeRecords: [],
    affectedRecordIds: [],
    fixCount: 0,
    unresolved: 0,
    diffs: [],
    pr: null,
    reason,
  };
}

// Cache the most recent scan so the UI can load fleet status without re-running.
let lastScan: FleetScanResult | null = null;
export function getLastFleetScan(): FleetScanResult | null {
  return lastScan;
}
export function setLastScanCache(r: FleetScanResult) {
  lastScan = r;
}
