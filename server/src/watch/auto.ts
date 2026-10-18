// Automatic engine: scheduled watching + God Mode.
//
//  • watchEnabled  -> on a timer, re-run the last parsed changes across the
//                     selected repos (catches repos that changed since).
//  • godMode       -> on a timer, poll provider changelog URLs + watch sources;
//                     when new content appears, parse it with the LLM and run
//                     the full detect → fix → PR pipeline with NO button press.
//                     Also driven by the /api/webhook/changelog endpoint.
//
// Everything is best-effort and defensive: a failure in one tick is logged and
// never crashes the server or stops the schedule.

import { createHash } from "node:crypto";
import {
  getConfig,
  getWatchSources,
  getProviders,
  setLastChanges,
  setWatchSourceSeen,
  setProviderSeen,
  addRun,
  updateRun,
  logAudit,
  listTenantIds,
  type StoredChange,
} from "../config/store.js";
import { runWithTenant, OWNER_TENANT } from "../auth/context.js";
import { parseChangelog, fallbackParse, type ChangeSpec } from "../llm/changelog.js";
import { runChanges, summarizeRunResults, type RunOutput } from "../pipeline/run.js";
import { scanPullRequests } from "../pipeline/security.js";

let timer: NodeJS.Timeout | null = null;
let currentIntervalMs = 0;
let ticking = false;
let lastTickAt: string | null = null;

export interface AutoStatus {
  running: boolean;
  godMode: boolean;
  watchEnabled: boolean;
  intervalMinutes: number;
  lastTickAt: string | null;
  sources: number;
}

export function getAutoStatus(): AutoStatus {
  const { settings, watchSources } = getConfig();
  const providerSources = getProviders().filter((p) => p.enabled && p.watch && p.changelogUrl).length;
  return {
    running: timer !== null,
    godMode: settings.godMode,
    watchEnabled: settings.watchEnabled,
    intervalMinutes: settings.intervalMinutes,
    lastTickAt,
    sources: watchSources.filter((s) => s.enabled).length + providerSources,
  };
}

/**
 * Inspect every tenant to decide whether the shared timer should run and how
 * often. The interval is the smallest interval any active tenant asked for.
 */
function computeSchedule(): { shouldRun: boolean; intervalMs: number } {
  let shouldRun = false;
  let minMinutes = Infinity;
  for (const tid of listTenantIds()) {
    runWithTenant({ tenantId: tid }, () => {
      const { settings } = getConfig();
      if (settings.godMode || settings.watchEnabled || settings.securityWatch) {
        shouldRun = true;
        minMinutes = Math.min(minMinutes, Math.max(1, settings.intervalMinutes));
      }
    });
  }
  return { shouldRun, intervalMs: (Number.isFinite(minMinutes) ? minMinutes : 30) * 60_000 };
}

/** Align the shared schedule with all tenants' settings. Call after any change. */
export function syncAuto(): AutoStatus {
  const { shouldRun, intervalMs } = computeSchedule();

  if (!shouldRun) {
    stopAuto();
    return getAutoStatus();
  }
  if (timer && intervalMs === currentIntervalMs) return getAutoStatus();

  stopAuto();
  currentIntervalMs = intervalMs;
  timer = setInterval(() => void tick(), intervalMs);
  runWithTenant({ tenantId: OWNER_TENANT }, () =>
    logAudit("AUTO_STARTED", `Automatic engine on (every ${Math.round(intervalMs / 60_000)}m across active workspaces).`)
  );
  return getAutoStatus();
}

export function stopAuto() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    currentIntervalMs = 0;
    runWithTenant({ tenantId: OWNER_TENANT }, () => logAudit("AUTO_STOPPED", "Automatic engine stopped."));
  }
}

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/** A single scheduler tick — runs every active tenant in its own context. */
async function tick(): Promise<void> {
  if (ticking) return; // never overlap runs
  ticking = true;
  lastTickAt = new Date().toISOString();
  try {
    for (const tid of listTenantIds()) {
      await runWithTenant({ tenantId: tid }, async () => {
        try {
          const { settings } = getConfig();
          // Both God Mode and Scheduled watching DETECT changelog changes via the
          // same path and only run when a watched changelog actually changed.
          if (settings.godMode || settings.watchEnabled) await pollSources();
          if (settings.securityWatch) {
            try {
              await scanPullRequests(true);
            } catch (e) {
              logAudit("SECURITY_PR_ERROR", `PR scan failed: ${(e as Error).message}`);
            }
          }
        } catch (e) {
          logAudit("AUTO_ERROR", `Auto tick failed: ${(e as Error).message}`);
        }
      });
    }
  } finally {
    ticking = false;
  }
}

/** God Mode: check every enabled source; run when content changed. */
export async function pollSources(): Promise<void> {
  const sources = getWatchSources()
    .filter((s) => s.enabled && s.url)
    .map((s) => ({ id: s.id, name: s.name, url: s.url, lastSeenHash: s.lastSeenHash, lastChangeHash: s.lastChangeHash, kind: "source" as const }));
  const providerSources = getProviders()
    .filter((p) => p.enabled && p.watch && p.changelogUrl)
    .map((p) => ({ id: p.id, name: p.name, url: p.changelogUrl!, lastSeenHash: p.lastSeenHash, lastChangeHash: p.lastChangeHash, kind: "provider" as const }));
  const all = [...sources, ...providerSources];

  for (const src of all) {
    const persist = (contentHash: string, changeHash?: string) => {
      if (src.kind === "provider") setProviderSeen(src.id, contentHash, changeHash);
      else setWatchSourceSeen(src.id, contentHash, changeHash);
    };
    try {
      // A GitHub "/blob/" URL is a dynamic HTML page (tokens, timestamps) whose
      // bytes change every request — always fetch the RAW file instead so we
      // hash the real changelog, not the page chrome.
      const fetchUrl = toRawUrl(src.url);
      const res = await fetchWithTimeout(fetchUrl, 15_000);
      if (!res.ok) {
        logAudit("WATCH_ERROR", `Could not fetch ${src.name} (${res.status}).`);
        continue;
      }
      const text = await res.text();
      const contentHash = hash(normalizeContent(text));

      // Fingerprint of the actionable changes computed with the DETERMINISTIC
      // parser (no LLM). Used purely for duplicate detection, so we never spend
      // an LLM call on a changelog whose actionable content hasn't changed.
      const detFingerprint = changeFingerprint(fallbackParse(text.slice(0, 12000)));

      // First observation → baseline the content hash + deterministic change
      // fingerprint. Never fire a run on the very first content we see.
      if (!src.lastSeenHash) {
        persist(contentHash, detFingerprint);
        logAudit("WATCH_BASELINE", `Baselined ${src.name}'s changelog.`);
        continue;
      }

      // Gate 1 (cheapest): identical content after whitespace normalization →
      // skip. No parsing at all.
      if (src.lastSeenHash === contentHash) continue;

      // Gate 2 (still no LLM): content bytes changed but the actionable change
      // set is identical → a cosmetic/prose edit. Skip the run AND the LLM call.
      if (detFingerprint === src.lastChangeHash) {
        persist(contentHash, detFingerprint);
        logAudit("WATCH_NOOP", `${src.name}'s changelog changed but its actionable changes are unchanged — skipped before any LLM call.`);
        continue;
      }

      // Genuine new change → NOW spend the smart LLM parse for the actual run.
      logAudit("WATCH_DETECTED", `New changelog change detected in ${src.name} — running.`);
      persist(contentHash, detFingerprint);
      const ingest = await ingestChangelog({ text, trigger: "GODMODE", sourceName: src.name });
      if (!ingest.ran) logAudit("WATCH_NOOP", `No actionable changes found in ${src.name}'s update.`);
    } catch (e) {
      logAudit("WATCH_ERROR", `${src.name}: ${(e as Error).message}`);
    }
  }
}

/**
 * Convert a GitHub "blob" page URL into the raw file URL, e.g.
 *   https://github.com/o/r/blob/main/CHANGELOG.md
 *     -> https://raw.githubusercontent.com/o/r/main/CHANGELOG.md
 * Other URLs are returned unchanged.
 */
function toRawUrl(url: string): string {
  const m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i);
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : url;
}

/** fetch with a hard timeout so one slow/dead source URL can't stall the whole poll. */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, redirect: "follow" });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`fetch timed out after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Normalize text so pure whitespace/CRLF churn doesn't register as a change. */
function normalizeContent(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}

/**
 * Order-independent fingerprint of the actionable change set. Two changelogs
 * that parse to the same set of changes produce the same fingerprint, so the
 * watcher only runs when the changes themselves actually differ.
 */
function changeFingerprint(changes: ChangeSpec[]): string {
  const canonical = changes
    .map((c) => `${c.kind}|${c.symbol}|${c.from ?? ""}|${c.to ?? ""}`)
    .sort()
    .join("\n");
  return hash(canonical);
}

/**
 * Single ingestion path shared by the webhook AND God Mode polling: take raw
 * changelog text (or already-structured changes), parse it, and — if there is
 * anything actionable — run it through the full detect → fix → PR pipeline.
 * Both entry points behave identically because they call this one function.
 */
export async function ingestChangelog(opts: {
  text?: string;
  changes?: ChangeSpec[];
  trigger: "GODMODE" | "WATCH" | "WEBHOOK";
  sourceName?: string;
}): Promise<{ ran: boolean; changes: ChangeSpec[]; message?: string; out?: RunOutput }> {
  const text = opts.text ?? "";
  let changes = opts.changes ?? [];
  if (changes.length === 0) {
    if (!text.trim()) throw new Error("Provide text or changes.");
    changes = await parseChangelog(text.slice(0, 12000));
  }
  if (changes.length === 0) {
    logAudit("INGEST_NOOP", `No actionable changes detected${opts.sourceName ? ` in ${opts.sourceName}` : ""}.`);
    return { ran: false, changes: [], message: "No actionable changes detected." };
  }

  // Webhook-driven ingestion (the manual /api/webhook/changelog endpoint AND the
  // instant GitHub push webhook) only auto-runs the full pipeline when God Mode
  // is ON. With God Mode off we still accept and validate the change — staging it
  // as the "last changes" so it can be run manually — but we do NOT scan repos or
  // open PRs. This is the safety gate: nothing fires automatically unless the
  // operator has explicitly turned God Mode on.
  if (opts.trigger === "WEBHOOK" && !getConfig().settings.godMode) {
    setLastChanges(changes as any);
    logAudit(
      "WEBHOOK_PARKED",
      `Received ${changes.length} change(s) via webhook${opts.sourceName ? ` from ${opts.sourceName}` : ""}, but God Mode is off — staged, not auto-run.`
    );
    return {
      ran: false,
      changes,
      message: "God Mode is off — change received and staged, but not auto-run. Turn on God Mode to auto-run webhooks.",
    };
  }

  const out = await autoRun(changes, opts.trigger, text || undefined, opts.sourceName);
  return { ran: true, changes, out };
}

/** Shared run wrapper that records a run row and updates it with the outcome. */
export async function autoRun(
  changes: ChangeSpec[],
  trigger: "GODMODE" | "WATCH" | "WEBHOOK",
  changelogText?: string,
  sourceName?: string
) {
  const run = addRun({
    source: trigger,
    changelogText,
    sourceName,
    changeCount: changes.length,
    reposScanned: 0,
    reposAffected: 0,
    prsOpened: 0,
    status: "RUNNING",
  });
  try {
    const out = await runChanges(changes, trigger);
    updateRun(run.id, {
      status: "DONE",
      reposScanned: out.reposScanned,
      reposAffected: out.reposAffected,
      prsOpened: out.prsOpened,
      changes: out.changes as any,
      results: summarizeRunResults(out),
    });
    return out;
  } catch (e) {
    updateRun(run.id, { status: "ERROR", error: (e as Error).message });
    throw e;
  }
}

/** Manual "check now" trigger for God Mode polling. */
export async function pollNow(): Promise<{ ok: true }> {
  await pollSources();
  return { ok: true };
}
