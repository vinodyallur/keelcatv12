// Persistent application state: settings, repo configs, providers, audit log,
// and notifications. Persisted to a JSON file so the UI has real, durable
// control (toggles, schedule, channels) across restarts.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FLEET_FIXTURES } from "./fleet-fixtures.js";
import { BASELINE_SPEC, cloneSpec } from "./default-specs.js";
import type { OpenAPISpec } from "../core/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const STATE_FILE = join(DATA_DIR, "state.json");

export interface NotificationChannels {
  email: { enabled: boolean; address: string };
  slack: { enabled: boolean; webhook: string };
}

export interface Settings {
  watchEnabled: boolean;
  intervalSeconds: number;
  autoOpenPr: boolean;
  notifyOnDeprecation: boolean;
  notifyOnNewFeature: boolean;
  channels: NotificationChannels;
}

export interface RepoResultSummary {
  affected: boolean;
  changeCount: number;
  fixCount: number;
  unresolved: number;
  filesChanged: number;
  prBranch?: string;
  prNumber?: number;
}

export interface RepoConfig {
  repositoryId: string;
  fullName: string;
  state: "CONNECTED" | "PAUSED" | "ERROR";
  enabled: boolean;
  languages: string[];
  dependsOn: string[];
  kind: "SAMPLE" | "GITHUB";
  lastScan?: string;
  lastResult?: RepoResultSummary;
}

export interface ProviderConfig {
  providerId: string;
  displayName: string;
  status: "ACTIVE" | "PAUSED";
  sdkPackage: string;
  logo: string;
  enabled: boolean;
  currentVersion: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  kind: string;
  message: string;
  repositoryId?: string;
}

export interface NotificationEntry {
  id: string;
  at: string;
  channel: "IN_APP" | "EMAIL" | "SLACK";
  kind: string;
  message: string;
  repositoryId?: string;
  read: boolean;
}

export interface ProviderSpecState {
  providerId: string;
  baseline: OpenAPISpec;
  current: OpenAPISpec;
}

export interface AppState {
  settings: Settings;
  repos: RepoConfig[];
  providers: ProviderConfig[];
  specs: ProviderSpecState[];
  audit: AuditEntry[];
  notifications: NotificationEntry[];
  lastFleetScanAt?: string;
}

function defaultState(): AppState {
  const repos: RepoConfig[] = FLEET_FIXTURES.map((f) => ({
    repositoryId: f.repositoryId,
    fullName: f.fullName,
    state: "CONNECTED",
    enabled: true,
    languages: f.languages,
    dependsOn: f.dependsOn,
    kind: "SAMPLE",
  }));

  return {
    settings: {
      watchEnabled: false,
      intervalSeconds: 30,
      autoOpenPr: true,
      notifyOnDeprecation: true,
      notifyOnNewFeature: true,
      channels: {
        email: { enabled: false, address: "" },
        slack: { enabled: false, webhook: "" },
      },
    },
    repos,
    providers: [
      {
        providerId: "demo-pay",
        displayName: "Demo Pay",
        status: "ACTIVE",
        sdkPackage: "demo-pay",
        logo: "💳",
        enabled: true,
        currentVersion: "2024-06-01",
      },
    ],
    specs: [
      { providerId: "demo-pay", baseline: cloneSpec(BASELINE_SPEC), current: cloneSpec(BASELINE_SPEC) },
    ],
    audit: [],
    notifications: [],
  };
}

let state: AppState = load();

function load(): AppState {
  try {
    if (existsSync(STATE_FILE)) {
      const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Partial<AppState>;
      const base = defaultState();
      // Shallow-merge so new fields get defaults but user config is preserved.
      return {
        settings: { ...base.settings, ...parsed.settings, channels: { ...base.settings.channels, ...parsed.settings?.channels } },
        repos: parsed.repos?.length ? parsed.repos : base.repos,
        providers: parsed.providers?.length ? parsed.providers : base.providers,
        specs: parsed.specs?.length ? parsed.specs : base.specs,
        audit: parsed.audit ?? [],
        notifications: parsed.notifications ?? [],
        lastFleetScanAt: parsed.lastFleetScanAt,
      };
    }
  } catch {
    // Corrupt state file: fall back to defaults rather than crash.
  }
  return defaultState();
}

function persist() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch {
    // Best-effort persistence; state remains valid in memory regardless.
  }
}

let idCounter = 0;
function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}

// ---- Accessors ----

export function getState(): AppState {
  return state;
}
export function getSettings(): Settings {
  return state.settings;
}
export function getRepos(): RepoConfig[] {
  return state.repos;
}
export function getProviders(): ProviderConfig[] {
  return state.providers;
}
export function getAudit(limit = 100): AuditEntry[] {
  return state.audit.slice(0, limit);
}
export function getNotifications(limit = 100): NotificationEntry[] {
  return state.notifications.slice(0, limit);
}
export function getSpecs(): ProviderSpecState[] {
  return state.specs;
}
export function getSpec(providerId: string): ProviderSpecState | undefined {
  return state.specs.find((s) => s.providerId === providerId);
}

/** Replace a provider's current (draft) spec — used by the API Studio. */
export function updateCurrentSpec(providerId: string, current: OpenAPISpec): ProviderSpecState | null {
  const entry = state.specs.find((s) => s.providerId === providerId);
  if (!entry) return null;
  entry.current = current;
  const p = state.providers.find((x) => x.providerId === providerId);
  if (p) p.currentVersion = current.version;
  logAudit("SPEC_PUBLISHED", `${providerId} spec updated to ${current.version}.`);
  persist();
  return entry;
}

/** Reset the current spec back to the baseline (clears all pending changes). */
export function resetSpec(providerId: string): ProviderSpecState | null {
  const entry = state.specs.find((s) => s.providerId === providerId);
  if (!entry) return null;
  entry.current = JSON.parse(JSON.stringify(entry.baseline));
  const p = state.providers.find((x) => x.providerId === providerId);
  if (p) p.currentVersion = entry.current.version;
  logAudit("SPEC_RESET", `${providerId} spec reset to baseline ${entry.baseline.version}.`);
  persist();
  return entry;
}

// ---- Mutations ----

export function updateSettings(patch: Partial<Settings>): Settings {
  state.settings = {
    ...state.settings,
    ...patch,
    channels: { ...state.settings.channels, ...(patch.channels ?? {}) },
  };
  logAudit("SETTINGS_CHANGED", "Settings updated.");
  persist();
  return state.settings;
}

export function toggleRepo(repositoryId: string, enabled?: boolean): RepoConfig | null {
  const repo = state.repos.find((r) => r.repositoryId === repositoryId);
  if (!repo) return null;
  repo.enabled = enabled ?? !repo.enabled;
  repo.state = repo.enabled ? "CONNECTED" : "PAUSED";
  logAudit("REPO_TOGGLED", `${repo.fullName} ${repo.enabled ? "resumed" : "paused"}.`, repositoryId);
  persist();
  return repo;
}

export function toggleProvider(providerId: string, enabled?: boolean): ProviderConfig | null {
  const p = state.providers.find((x) => x.providerId === providerId);
  if (!p) return null;
  p.enabled = enabled ?? !p.enabled;
  p.status = p.enabled ? "ACTIVE" : "PAUSED";
  logAudit("PROVIDER_TOGGLED", `${p.displayName} monitoring ${p.enabled ? "enabled" : "paused"}.`, undefined);
  persist();
  return p;
}

export function setRepoResult(repositoryId: string, result: RepoResultSummary) {
  const repo = state.repos.find((r) => r.repositoryId === repositoryId);
  if (!repo) return;
  repo.lastScan = new Date().toISOString();
  repo.lastResult = result;
  persist();
}

export function setLastFleetScan(at: string) {
  state.lastFleetScanAt = at;
  persist();
}

export function logAudit(kind: string, message: string, repositoryId?: string): AuditEntry {
  const entry: AuditEntry = { id: newId("a"), at: new Date().toISOString(), kind, message, repositoryId };
  state.audit.unshift(entry);
  if (state.audit.length > 500) state.audit.length = 500;
  persist();
  return entry;
}

export function pushNotification(
  kind: string,
  message: string,
  repositoryId?: string
): NotificationEntry[] {
  const { channels, notifyOnDeprecation, notifyOnNewFeature } = state.settings;
  if (kind === "DEPRECATION" && !notifyOnDeprecation) return [];
  if (kind === "NEW_FEATURE" && !notifyOnNewFeature) return [];

  const created: NotificationEntry[] = [];
  const at = new Date().toISOString();

  // In-app always fires.
  created.push({ id: newId("n"), at, channel: "IN_APP", kind, message, repositoryId, read: false });
  if (channels.email.enabled && channels.email.address) {
    created.push({ id: newId("n"), at, channel: "EMAIL", kind, message, repositoryId, read: false });
  }
  if (channels.slack.enabled && channels.slack.webhook) {
    created.push({ id: newId("n"), at, channel: "SLACK", kind, message, repositoryId, read: false });
  }

  state.notifications.unshift(...created);
  if (state.notifications.length > 500) state.notifications.length = 500;
  persist();
  return created;
}

export function markNotificationsRead(): void {
  for (const n of state.notifications) n.read = true;
  persist();
}
