// Automatic scheduled watching. When enabled in settings, runs a fleet scan on
// a fixed interval. Fully controllable from the UI via settings + toggle.

import { getSettings, logAudit } from "../state/store.js";
import { runFleetScan, setLastScanCache, type FleetScanResult } from "../pipeline/fleet.js";

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastRunAt: string | null = null;
let nextRunAt: string | null = null;
let lastSummary: { affected: number; scanned: number; prsOpened: number } | null = null;

export interface WatchStatus {
  running: boolean;
  intervalSeconds: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastSummary: { affected: number; scanned: number; prsOpened: number } | null;
}

function tick() {
  try {
    const result: FleetScanResult = runFleetScan("SCHEDULED");
    setLastScanCache(result);
    lastRunAt = result.at;
    lastSummary = { affected: result.affected, scanned: result.scanned, prsOpened: result.prsOpened };
  } catch (e) {
    logAudit("WATCH_ERROR", `Scheduled scan failed: ${(e as Error).message}`);
  }
  scheduleNext();
}

function scheduleNext() {
  if (timer) clearTimeout(timer);
  const { intervalSeconds } = getSettings();
  const ms = Math.max(5, intervalSeconds) * 1000;
  nextRunAt = new Date(Date.now() + ms).toISOString();
  timer = setTimeout(tick, ms);
}

/** Start the scheduler loop (idempotent). */
export function startWatch(): WatchStatus {
  if (!running) {
    running = true;
    logAudit("WATCH_STARTED", `Automatic watching enabled (every ${getSettings().intervalSeconds}s).`);
    scheduleNext();
  }
  return getWatchStatus();
}

/** Stop the scheduler loop (idempotent). */
export function stopWatch(): WatchStatus {
  if (running) {
    running = false;
    if (timer) clearTimeout(timer);
    timer = null;
    nextRunAt = null;
    logAudit("WATCH_STOPPED", "Automatic watching disabled.");
  }
  return getWatchStatus();
}

/** Re-read settings and (re)align the running state + interval. */
export function syncWatchWithSettings(): WatchStatus {
  const { watchEnabled } = getSettings();
  if (watchEnabled && !running) return startWatch();
  if (!watchEnabled && running) return stopWatch();
  if (running) scheduleNext(); // interval may have changed
  return getWatchStatus();
}

export function getWatchStatus(): WatchStatus {
  return {
    running,
    intervalSeconds: getSettings().intervalSeconds,
    lastRunAt,
    nextRunAt,
    lastSummary,
  };
}
