// Admin-managed default Meta model ("KeelCat AI"): Muse Spark via OpenRouter by
// default, or any OpenAI-compatible host serving Meta models. Workspaces without
// their own key use it automatically. Its URL, model and key never leave the
// server; users only learn whether it covers their workspace.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { currentContext, currentTenantId } from "../auth/context.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const FILE = join(DATA_DIR, "default-llm.json");

export interface DefaultLlmSettings {
  enabled: boolean;
  provider: string; // preset name, only for the admin form
  baseUrl: string;
  model: string;
  forGuests: boolean;
  forUsers: boolean; // signed-in GitHub/Google users, including the owner
  dailyLimitPerWorkspace: number; // 0 = unlimited
  dailyLimitTotal: number; // 0 = unlimited
}

export interface DefaultLlmTarget {
  baseUrl: string;
  model: string;
  key: string;
}

interface Stored extends DefaultLlmSettings {
  apiKey?: string;
}

function defaults(): Stored {
  return {
    enabled: false,
    provider: "meta-muse",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "meta/muse-spark-1.3",
    forGuests: true,
    forUsers: false,
    dailyLimitPerWorkspace: 50,
    dailyLimitTotal: 1000,
  };
}

let stored: Stored = load();

function load(): Stored {
  try {
    if (existsSync(FILE)) return { ...defaults(), ...JSON.parse(readFileSync(FILE, "utf8")) };
  } catch {
    /* fall back to defaults */
  }
  return defaults();
}

function persist() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(stored, null, 2), { encoding: "utf8", mode: 0o600 });
}

function normalizeBaseUrl(raw: string): string {
  const v = raw.trim().replace(/\/+$/, "");
  if (!v) return "";
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw new Error("Base URL must be a full http(s) URL, for example https://host/v1.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Base URL must start with http:// or https://.");
  return v;
}

function limit(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1_000_000, Math.max(0, Math.floor(n))) : fallback;
}

// Daily cost guard, not billing: counters reset at UTC midnight and on restart.
let usageDay = "";
let usedTotal = 0;
const usedByTenant = new Map<string, number>();

function rollUsageDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== usageDay) {
    usageDay = today;
    usedTotal = 0;
    usedByTenant.clear();
  }
}

function isGuestWorkspace(): boolean {
  return currentContext()?.provider === "guest" || currentTenantId().startsWith("guest_");
}

/** Whether the admin's default covers the current workspace (ignores daily limits). */
export function defaultLlmAvailable(): boolean {
  if (!stored.enabled || !stored.apiKey || !stored.baseUrl || !stored.model) return false;
  return isGuestWorkspace() ? stored.forGuests : stored.forUsers;
}

/** Whether the current workspace has used up today's default-AI allowance. */
export function defaultLlmExhausted(): boolean {
  rollUsageDay();
  if (stored.dailyLimitTotal > 0 && usedTotal >= stored.dailyLimitTotal) return true;
  const mine = usedByTenant.get(currentTenantId()) ?? 0;
  return stored.dailyLimitPerWorkspace > 0 && mine >= stored.dailyLimitPerWorkspace;
}

/** The default's connection for the current workspace, or null if it doesn't apply or today's limit is reached. */
export function defaultLlmFor(): DefaultLlmTarget | null {
  if (!defaultLlmAvailable() || defaultLlmExhausted()) return null;
  return { baseUrl: stored.baseUrl, model: stored.model, key: stored.apiKey! };
}

export function recordDefaultLlmUse(): void {
  rollUsageDay();
  usedTotal += 1;
  const id = currentTenantId();
  usedByTenant.set(id, (usedByTenant.get(id) ?? 0) + 1);
}

/** Display name of the default model, e.g. "meta/muse-spark-1.3" -> "Muse Spark 1.3". */
export function defaultLlmModelName(): string {
  const id = stored.model.split("/").pop() ?? stored.model;
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Whether the default is a Meta model (Muse or Llama), on any host. */
export function defaultLlmIsMeta(): boolean {
  return /(^|\/)(meta|muse|llama)/i.test(stored.model);
}

/** The configured connection regardless of audience or limits (admin test only). */
export function defaultLlmTarget(): DefaultLlmTarget | null {
  if (!stored.apiKey || !stored.baseUrl || !stored.model) return null;
  return { baseUrl: stored.baseUrl, model: stored.model, key: stored.apiKey };
}

/** Admin view: everything except the key itself. */
export function defaultLlmAdminView() {
  rollUsageDay();
  const { apiKey, ...settings } = stored;
  return { ...settings, hasKey: Boolean(apiKey), keyLast4: apiKey ? apiKey.slice(-4) : null, usedToday: usedTotal };
}

export function setDefaultLlm(patch: Partial<DefaultLlmSettings> & { apiKey?: unknown }): void {
  const next: Stored = { ...stored };
  if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
  if (typeof patch.provider === "string") next.provider = patch.provider.trim().slice(0, 40);
  if (typeof patch.baseUrl === "string") next.baseUrl = normalizeBaseUrl(patch.baseUrl);
  if (typeof patch.model === "string") next.model = patch.model.trim().slice(0, 200);
  if (typeof patch.forGuests === "boolean") next.forGuests = patch.forGuests;
  if (typeof patch.forUsers === "boolean") next.forUsers = patch.forUsers;
  if (patch.dailyLimitPerWorkspace !== undefined) next.dailyLimitPerWorkspace = limit(patch.dailyLimitPerWorkspace, next.dailyLimitPerWorkspace);
  if (patch.dailyLimitTotal !== undefined) next.dailyLimitTotal = limit(patch.dailyLimitTotal, next.dailyLimitTotal);
  if (typeof patch.apiKey === "string" && patch.apiKey.trim()) next.apiKey = patch.apiKey.trim();
  if (next.enabled && (!next.apiKey || !next.baseUrl || !next.model)) {
    throw new Error("Add a base URL, model and API key before enabling the default AI.");
  }
  stored = next;
  persist();
}

/** Remove the default entirely, including its key. */
export function clearDefaultLlm(): void {
  stored = defaults();
  persist();
}
