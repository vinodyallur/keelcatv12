// Real configuration + run state for the production system.
//
// MULTI-TENANT: every logged-in GitHub user gets an isolated workspace. Data is
// namespaced per tenant under data/tenants/<tenantId>/{config.json,secrets.json}.
// The "current tenant" is resolved from the AsyncLocalStorage context set by the
// auth middleware (see auth/context.ts), so the ~60 accessors below keep their
// original signatures — they just operate on the current tenant's slice. Code
// running with no context (CLI/demo/startup) falls back to the OWNER tenant,
// which is where a pre-existing single-tenant data/config.json is migrated to.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { currentTenantId, OWNER_TENANT } from "../auth/context.js";
import { getAdminSettings } from "./admin.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const TENANTS_DIR = join(DATA_DIR, "tenants");
// Legacy single-tenant locations (pre multi-tenancy). Migrated on first boot.
const LEGACY_CONFIG_FILE = join(DATA_DIR, "config.json");
const LEGACY_SECRETS_FILE = join(DATA_DIR, "secrets.json");

export type GitHubMode = "pat" | "app";
export type LlmProvider = "openrouter" | "gemini" | "custom" | "disabled";

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  baseUrl?: string; // for custom / overrides
}

export interface GitHubConfig {
  mode: GitHubMode;
  appId?: string;
  installationId?: string;
  // Public app slug (e.g. "apisteward") used to build the one-click install URL
  // https://github.com/apps/<slug>/installations/new
  appSlug?: string;
}

/**
 * A single connected GitHub identity (a PAT or an App installation). KeelCat
 * supports any number of these so you can watch repos across multiple accounts
 * / orgs at once. Each account can be enabled/disabled and removed independently,
 * and every ConnectedRepo is tied to the account it came from.
 */
export interface GitHubAccount {
  id: string;
  name: string; // user-provided label to tell accounts apart
  mode: GitHubMode; // "pat" | "app"
  login?: string; // the GitHub login / org this account authenticated as
  enabled: boolean; // disabled accounts are skipped in runs/scans
  addedAt: string;
  // App-mode only:
  appId?: string;
  installationId?: string;
  appSlug?: string;
}

export interface ConnectedRepo {
  id: string; // owner/repo
  accountId?: string; // which GitHubAccount this repo was listed from
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  languages: string[]; // detected on connect
  selected: boolean; // included in runs
  lastRunAt?: string;
  lastResult?: RepoRunSummary;
}

export type RepoPrStatus = "RAISING" | "RAISED" | "NOT_RAISED" | "CLEAN" | "ERROR";

export interface RepoRunSummary {
  affected: boolean;
  filesChanged: number;
  fixCount: number;
  unresolved: number;
  prNumber?: number;
  prUrl?: string;
  branch?: string;
  prStatus?: RepoPrStatus;
  impacts?: string[]; // BREAKING / DEPRECATION / NEW_FEATURE that touched this repo
  tests?: RunTestResult;
  needsAttention?: boolean; // affected but no PR could be opened
  error?: string;
}

export interface EmailConfig {
  enabled: boolean;
  to: string;
  from: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
}

export interface SlackConfig {
  enabled: boolean;
  // webhook URL is stored as a secret
}

export interface Settings {
  autoOpenPr: boolean;
  watchEnabled: boolean;
  intervalMinutes: number;
  // God mode: fully automatic — watch sources / webhook trigger runs with no
  // button press, detect affected repos, and open PRs automatically.
  godMode: boolean;
  // Reliability gates in the pipeline.
  verifyFixes: boolean; // syntax/error check every edited file; never PR broken code
  completenessCheck: boolean; // ensure nothing from the changelog is left behind
  runTests: boolean; // clone the repo in an ephemeral sandbox and run its own tests on the fix
  securityWatch: boolean; // auto-scan open PRs for threats on the schedule
  email: EmailConfig;
  slack: SlackConfig;
}

/** A provider in the curated registry KeelCat watches. */
export interface RegistryProvider {
  id: string;
  name: string;
  sdkPackage?: string; // e.g. "stripe", "demo-pay"
  changelogUrl?: string; // polled in god mode for new change announcements
  enabled: boolean;
  watch: boolean; // include this provider's changelogUrl in auto polling
  lastSeenHash?: string; // content hash of the last changelog we processed
  lastChangeHash?: string; // fingerprint of the last PARSED change set (actionable content)
  lastCheckedAt?: string;
}

/** A raw URL to poll for changelog changes (in addition to providers). */
export interface WatchSource {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  lastSeenHash?: string;
  lastChangeHash?: string; // fingerprint of the last PARSED change set (actionable content)
  lastCheckedAt?: string;
}

/** Result of running a repo's own test suite on the applied fix. */
export interface RunTestResult {
  ran: boolean;
  ok?: boolean;
  passed?: number;
  failed?: number;
  total?: number;
  command?: string;
  durationMs?: number;
  summary: string;
}

/** Per-repo outcome kept on the run record for the changelog → PR tracker. */
export interface RunRepoResult {
  fullName: string;
  affected: boolean;
  prNumber?: number;
  prUrl?: string;
  prStatus: "RAISED" | "NONE" | "ERROR";
  impacts: string[]; // distinct impacts that touched this repo: BREAKING / DEPRECATION / NEW_FEATURE
  filesChanged: number;
  unresolved: number;
  tests?: RunTestResult;
  error?: string;
}

export interface RunRecord {
  id: string; // unique, trackable changelog/run id (e.g. run_xxx)
  at: string;
  source: "CHANGELOG" | "MANUAL" | "WATCH" | "GODMODE" | "WEBHOOK";
  changelogText?: string;
  sourceName?: string; // where the changelog came from (provider / repo / webhook)
  changeCount: number;
  reposScanned: number;
  reposAffected: number;
  prsOpened: number;
  status: "RUNNING" | "DONE" | "ERROR";
  changes?: StoredChange[]; // the parsed changes for this changelog
  results?: RunRepoResult[]; // per-repo PR outcomes
  error?: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  kind: string;
  message: string;
}

export interface StoredChange {
  provider?: string;
  symbol: string;
  kind: string;
  from?: string;
  to?: string;
  impact: string;
  description: string;
}

export type BillingPlan = "free" | "premium";
/** Which subscription interval a premium workspace is on. */
export type BillingInterval = "monthly" | "annual";

export interface AppConfig {
  github: GitHubConfig; // legacy single-connection view (kept for back-compat)
  githubAccounts: GitHubAccount[]; // all connected GitHub identities
  llm: LlmConfig;
  settings: Settings;
  repos: ConnectedRepo[];
  providers: RegistryProvider[];
  watchSources: WatchSource[];
  lastChanges: StoredChange[]; // remembered for watch re-runs
  runs: RunRecord[];
  audit: AuditEntry[];
  // ---- Billing / usage (per tenant) ----
  plan: BillingPlan; // "free" until upgraded via Razorpay
  runsUsed: number; // count of runs consumed against the free allowance
  premiumSince?: string; // ISO timestamp of upgrade
  premiumInterval?: BillingInterval; // billing interval when premium (monthly | annual)
}

/** Number of free runs a workspace gets before an upgrade is required. */
export const FREE_RUN_LIMIT = Number(process.env.FREE_RUN_LIMIT ?? 10);

interface Secrets {
  githubPat?: string; // legacy single PAT (kept for back-compat / migration)
  githubAppPrivateKey?: string; // legacy single App key
  githubTokens?: Record<string, string>; // accountId -> PAT
  githubAppKeys?: Record<string, string>; // accountId -> App private key (PEM)
  githubWebhookSecret?: string; // shared secret GitHub signs webhook payloads with
  llmApiKey?: string;
  smtpPass?: string;
  slackWebhookUrl?: string;
}

/** The in-memory + on-disk state for one tenant. */
interface TenantStore {
  id: string;
  config: AppConfig;
  secrets: Secrets;
}

function defaultEmail(): EmailConfig {
  return { enabled: false, to: "", from: "", host: "smtp.gmail.com", port: 465, secure: true, user: "" };
}

function defaultSettings(): Settings {
  return {
    autoOpenPr: true,
    watchEnabled: false,
    intervalMinutes: 30,
    godMode: false,
    verifyFixes: true,
    completenessCheck: true,
    runTests: false,
    securityWatch: false,
    email: defaultEmail(),
    slack: { enabled: false },
  };
}

function defaultProviders(): RegistryProvider[] {
  return [
    { id: "demo-pay", name: "demo-pay", sdkPackage: "demo-pay", enabled: true, watch: false },
    { id: "stripe", name: "Stripe", sdkPackage: "stripe", changelogUrl: "https://raw.githubusercontent.com/stripe/stripe-node/master/CHANGELOG.md", enabled: true, watch: false },
  ];
}

function defaultConfig(): AppConfig {
  return {
    github: { mode: "pat" },
    githubAccounts: [],
    llm: { provider: "openrouter", model: "google/gemma-4-26b-a4b-it:free" },
    settings: defaultSettings(),
    repos: [],
    providers: defaultProviders(),
    watchSources: [],
    lastChanges: [],
    runs: [],
    audit: [],
    plan: "free",
    runsUsed: 0,
  };
}

// ---- Per-tenant state resolution -------------------------------------------

const tenants = new Map<string, TenantStore>();
migrateLegacy();

function tenantDir(id: string): string {
  return join(TENANTS_DIR, id);
}
function configFile(id: string): string {
  return join(tenantDir(id), "config.json");
}
function secretsFile(id: string): string {
  return join(tenantDir(id), "secrets.json");
}

/** Resolve (and lazily load) the store for the tenant in the current context. */
function store(): TenantStore {
  const id = currentTenantId();
  let s = tenants.get(id);
  if (!s) {
    s = loadTenant(id);
    tenants.set(id, s);
  }
  return s;
}

function loadTenant(id: string): TenantStore {
  const s: TenantStore = { id, config: loadConfig(id), secrets: loadSecrets(id) };
  migrateAccounts(s);
  return s;
}

/**
 * One-time move of a pre-multi-tenancy data/config.json + data/secrets.json into
 * the OWNER tenant folder, so an existing deploy keeps every repo/connection and
 * simply becomes the owner's workspace. Runs only if the owner folder is empty.
 */
function migrateLegacy() {
  try {
    if (!existsSync(LEGACY_CONFIG_FILE) && !existsSync(LEGACY_SECRETS_FILE)) return;
    const ownerDir = tenantDir(OWNER_TENANT);
    if (existsSync(join(ownerDir, "config.json"))) return; // already migrated
    if (!existsSync(ownerDir)) mkdirSync(ownerDir, { recursive: true });
    if (existsSync(LEGACY_CONFIG_FILE)) renameSync(LEGACY_CONFIG_FILE, join(ownerDir, "config.json"));
    if (existsSync(LEGACY_SECRETS_FILE)) renameSync(LEGACY_SECRETS_FILE, join(ownerDir, "secrets.json"));
  } catch {
    /* best effort — a fresh install simply has nothing to migrate */
  }
}

/**
 * One-time migration from the old single-connection model to named accounts.
 * If there are no accounts yet but a legacy PAT / App connection exists, turn
 * it into an account and stamp existing repos with it so nothing is lost.
 */
function migrateAccounts(s: TenantStore) {
  if (s.config.githubAccounts.length > 0) return;
  const now = new Date().toISOString();
  const accounts: GitHubAccount[] = [];
  s.secrets.githubTokens = s.secrets.githubTokens ?? {};
  s.secrets.githubAppKeys = s.secrets.githubAppKeys ?? {};

  if (s.secrets.githubPat) {
    const id = "acct_legacy_pat";
    accounts.push({ id, name: "My GitHub", mode: "pat", enabled: true, addedAt: now });
    s.secrets.githubTokens[id] = s.secrets.githubPat;
  }
  if (s.config.github?.appId && s.secrets.githubAppPrivateKey) {
    const id = "acct_legacy_app";
    accounts.push({
      id,
      name: s.config.github.appSlug ? `GitHub App (${s.config.github.appSlug})` : "GitHub App",
      mode: "app",
      enabled: true,
      addedAt: now,
      appId: s.config.github.appId,
      installationId: s.config.github.installationId,
      appSlug: s.config.github.appSlug,
    });
    s.secrets.githubAppKeys[id] = s.secrets.githubAppPrivateKey;
  }

  if (accounts.length === 0) return;
  s.config.githubAccounts = accounts;
  const firstId = accounts[0].id;
  for (const r of s.config.repos) if (!r.accountId) r.accountId = firstId;
  persistConfigFor(s);
  persistSecretsFor(s);
}

function loadConfig(id: string): AppConfig {
  try {
    const file = configFile(id);
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<AppConfig>;
      const base = defaultConfig();
      return {
        github: { ...base.github, ...parsed.github },
        githubAccounts: parsed.githubAccounts ?? [],
        llm: { ...base.llm, ...parsed.llm },
        settings: {
          ...base.settings,
          ...parsed.settings,
          email: { ...base.settings.email, ...(parsed.settings?.email ?? {}) },
          slack: { ...base.settings.slack, ...(parsed.settings?.slack ?? {}) },
        },
        repos: parsed.repos ?? [],
        providers: parsed.providers ?? base.providers,
        watchSources: parsed.watchSources ?? [],
        lastChanges: parsed.lastChanges ?? [],
        runs: parsed.runs ?? [],
        // Retroactively scrub any credential that leaked into older log entries.
        audit: (parsed.audit ?? []).map((a) => ({ ...a, message: scrub(a.message) })),
        plan: parsed.plan === "premium" ? "premium" : "free",
        runsUsed: typeof parsed.runsUsed === "number" ? parsed.runsUsed : 0,
        premiumSince: parsed.premiumSince,
        premiumInterval: parsed.premiumInterval === "annual" ? "annual" : parsed.premiumInterval === "monthly" ? "monthly" : undefined,
      };
    }
  } catch {
    /* fall through to defaults */
  }
  return defaultConfig();
}

function loadSecrets(id: string): Secrets {
  try {
    const file = secretsFile(id);
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    /* ignore */
  }
  // Env fallback seeds ONLY the owner tenant, so a single-operator hosted deploy
  // still works from env vars. Other tenants start empty and configure via the UI.
  if (id !== OWNER_TENANT) return {};
  return {
    githubPat: process.env.GITHUB_PAT,
    githubAppPrivateKey: loadAppKeyFromEnv(),
    githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
    llmApiKey: process.env.LLM_API_KEY,
    smtpPass: process.env.SMTP_PASS,
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
  };
}

/**
 * The GitHub App private key is a multi-line PEM, which is awkward as an env
 * var. Accept either the raw PEM (GITHUB_APP_PRIVATE_KEY) or a base64-encoded
 * PEM (GITHUB_APP_PRIVATE_KEY_BASE64) so it can be injected cleanly in hosting.
 */
function loadAppKeyFromEnv(): string | undefined {
  const b64 = process.env.GITHUB_APP_PRIVATE_KEY_BASE64;
  if (b64 && b64.trim()) {
    try {
      return Buffer.from(b64.trim(), "base64").toString("utf8");
    } catch {
      /* ignore malformed base64 */
    }
  }
  const raw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (raw && raw.trim()) {
    // Support "\n"-escaped single-line values as well as real newlines.
    return raw.includes("BEGIN") ? raw.replace(/\\n/g, "\n") : raw;
  }
  return undefined;
}

function ensureTenantDir(id: string) {
  const dir = tenantDir(id);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function persistConfigFor(s: TenantStore) {
  try {
    ensureTenantDir(s.id);
    writeFileSync(configFile(s.id), JSON.stringify(s.config, null, 2), "utf8");
  } catch {
    /* best effort */
  }
}

function persistSecretsFor(s: TenantStore) {
  try {
    ensureTenantDir(s.id);
    writeFileSync(secretsFile(s.id), JSON.stringify(s.secrets, null, 2), "utf8");
  } catch {
    /* best effort */
  }
}

function persistConfig() {
  persistConfigFor(store());
}
function persistSecrets() {
  persistSecretsFor(store());
}

/** Every tenant id that has persisted data (used by the background scheduler). */
export function listTenantIds(): string[] {
  const ids = new Set<string>(tenants.keys());
  try {
    if (existsSync(TENANTS_DIR)) {
      for (const name of readdirSync(TENANTS_DIR, { withFileTypes: true })) {
        if (name.isDirectory()) ids.add(name.name);
      }
    }
  } catch {
    /* ignore */
  }
  return [...ids];
}

let idc = 0;
function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${(idc++).toString(36)}`;
}

// ---- Accessors ----
export function getConfig(): AppConfig {
  return store().config;
}
export function getSecrets(): Secrets {
  return store().secrets;
}
export function getPat(): string | undefined {
  return store().secrets.githubPat?.trim() || undefined;
}
export function getLlmKey(): string | undefined {
  return store().secrets.llmApiKey;
}
export function getSmtpPass(): string | undefined {
  return store().secrets.smtpPass;
}
export function getSlackWebhook(): string | undefined {
  return store().secrets.slackWebhookUrl;
}
export function getWebhookSecret(): string | undefined {
  // Trim so a stray space/newline pasted into the secret field can't silently
  // break signature verification (a common cause of webhook 401s).
  return store().secrets.githubWebhookSecret?.trim() || undefined;
}

/** Public (secret-free) view for the UI. */
export function publicConfig() {
  const { config, secrets } = store();
  return {
    github: config.github,
    accounts: config.githubAccounts.map((a) => ({
      id: a.id,
      name: a.name,
      mode: a.mode,
      login: a.login,
      enabled: a.enabled,
      appSlug: a.appSlug,
      addedAt: a.addedAt,
      repoCount: config.repos.filter((r) => r.accountId === a.id).length,
    })),
    llm: config.llm,
    settings: config.settings,
    repos: config.repos,
    providers: config.providers,
    watchSources: config.watchSources,
    hasPat: Boolean(secrets.githubPat) || config.githubAccounts.some((a) => a.mode === "pat"),
    hasLlmKey: Boolean(secrets.llmApiKey),
    hasAppKey: Boolean(secrets.githubAppPrivateKey) || config.githubAccounts.some((a) => a.mode === "app"),
    hasWebhookSecret: Boolean(secrets.githubWebhookSecret),
    hasSmtpPass: Boolean(secrets.smtpPass),
    hasSlackWebhook: Boolean(secrets.slackWebhookUrl),
    billing: getBilling(),
    // Global (admin) toggle: when false the UI runs on-machine only (no choice).
    allowServerRun: getAdminSettings().allowServerRun,
  };
}

// ---- Billing / usage ----
/** Whether this workspace may start another run (premium = unlimited). */
export function canRun(): boolean {
  const admin = getAdminSettings();
  if (!admin.billingEnabled) return true; // paywall globally off
  const { config } = store();
  return config.plan === "premium" || config.runsUsed < admin.freeRunLimit;
}

/** Count one consumed run against the free allowance. */
export function incrementRuns(): number {
  const { config } = store();
  config.runsUsed += 1;
  persistConfig();
  return config.runsUsed;
}

export function getBilling() {
  const { config } = store();
  const admin = getAdminSettings();
  const limit = admin.freeRunLimit;
  return {
    plan: config.plan,
    runsUsed: config.runsUsed,
    freeLimit: limit,
    remaining: config.plan === "premium" || !admin.billingEnabled ? null : Math.max(0, limit - config.runsUsed),
    billingEnabled: admin.billingEnabled,
    premiumSince: config.premiumSince,
    premiumInterval: config.premiumInterval,
  };
}

/** Mark this workspace premium (called after a verified Razorpay payment). */
export function setPremium(interval?: BillingInterval): void {
  setPlan("premium", interval);
}

/** Set this workspace's plan directly (used by admin grant/revoke). */
export function setPlan(plan: BillingPlan, interval?: BillingInterval): void {
  const { config } = store();
  config.plan = plan;
  config.premiumSince = plan === "premium" ? new Date().toISOString() : undefined;
  config.premiumInterval = plan === "premium" ? interval : undefined;
  persistConfig();
}

/** Admin summary for the CURRENT tenant (call inside runWithTenant). */
export function tenantAdminSummary() {
  const { config } = store();
  return {
    plan: config.plan,
    runsUsed: config.runsUsed,
    repoCount: config.repos.length,
    accounts: config.githubAccounts.map((a) => ({ login: a.login, mode: a.mode, enabled: a.enabled })),
    premiumSince: config.premiumSince,
  };
}

/** Delete a tenant workspace entirely (admin only). Never deletes the owner. */
export function deleteTenant(id: string): boolean {
  if (id === OWNER_TENANT) return false;
  tenants.delete(id);
  try {
    rmSync(tenantDir(id), { recursive: true, force: true });
  } catch {
    return false;
  }
  return true;
}

// ---- Mutations ----
export function setSecret(patch: Partial<Secrets>) {
  const s = store();
  // Trim credentials that must not carry stray whitespace (a leading/trailing
  // space in a token makes GitHub reject it as "Bad credentials").
  const clean = { ...patch };
  if (typeof clean.githubPat === "string") clean.githubPat = clean.githubPat.trim();
  if (typeof clean.githubWebhookSecret === "string") clean.githubWebhookSecret = clean.githubWebhookSecret.trim();
  if (typeof clean.llmApiKey === "string") clean.llmApiKey = clean.llmApiKey.trim();
  s.secrets = { ...s.secrets, ...clean };
  persistSecrets();
}

export function setGitHubConfig(patch: Partial<GitHubConfig>) {
  const { config } = store();
  config.github = { ...config.github, ...patch };
  persistConfig();
}

// ---- GitHub accounts (multi-connection) ----
export function getAccounts(): GitHubAccount[] {
  return store().config.githubAccounts;
}

export function getEnabledAccounts(): GitHubAccount[] {
  return store().config.githubAccounts.filter((a) => a.enabled);
}

export function getAccount(id: string): GitHubAccount | undefined {
  return store().config.githubAccounts.find((a) => a.id === id);
}

export function getAccountPat(id: string): string | undefined {
  return store().secrets.githubTokens?.[id]?.trim() || undefined;
}

export function getAccountAppKey(id: string): string | undefined {
  return store().secrets.githubAppKeys?.[id] || undefined;
}

/** First enabled account (used for provider-changelog fetches, where any valid token works). */
export function getDefaultAccount(): GitHubAccount | undefined {
  const { config } = store();
  return config.githubAccounts.find((a) => a.enabled) ?? config.githubAccounts[0];
}

/** First enabled PAT account + its token (test-repo creation needs a real user PAT). */
export function getAnyPatAccount(): { account: GitHubAccount; pat: string } | undefined {
  const { config } = store();
  for (const a of config.githubAccounts) {
    if (a.mode !== "pat" || !a.enabled) continue;
    const pat = getAccountPat(a.id);
    if (pat) return { account: a, pat };
  }
  return undefined;
}

/**
 * Create or update a PAT account. Keyed by GitHub login so reconnecting the
 * same user refreshes the token instead of creating a duplicate.
 */
export function upsertPatAccount(opts: { name?: string; login: string; pat: string }): GitHubAccount {
  const s = store();
  const id = `acct_pat_${slugId(opts.login)}`;
  let acct = s.config.githubAccounts.find((a) => a.id === id);
  if (acct) {
    if (opts.name) acct.name = opts.name;
    acct.login = opts.login;
    acct.enabled = true;
  } else {
    acct = { id, name: opts.name?.trim() || opts.login, mode: "pat", login: opts.login, enabled: true, addedAt: new Date().toISOString() };
    s.config.githubAccounts.push(acct);
  }
  s.secrets.githubTokens = { ...(s.secrets.githubTokens ?? {}), [id]: opts.pat.trim() };
  persistConfig();
  persistSecrets();
  return acct;
}

/** Create or update an App-installation account, keyed by installation id. */
export function upsertAppAccount(opts: {
  name?: string;
  appId: string;
  installationId: string;
  appSlug?: string;
  privateKey: string;
  login?: string;
}): GitHubAccount {
  const s = store();
  const id = `acct_app_${opts.installationId}`;
  let acct = s.config.githubAccounts.find((a) => a.id === id);
  if (acct) {
    if (opts.name) acct.name = opts.name;
    acct.appId = opts.appId;
    acct.installationId = opts.installationId;
    acct.appSlug = opts.appSlug ?? acct.appSlug;
    if (opts.login) acct.login = opts.login;
    acct.enabled = true;
  } else {
    acct = {
      id,
      name: opts.name?.trim() || (opts.login ? `${opts.login} (App)` : opts.appSlug ? `${opts.appSlug} (App)` : "GitHub App"),
      mode: "app",
      login: opts.login,
      enabled: true,
      addedAt: new Date().toISOString(),
      appId: opts.appId,
      installationId: opts.installationId,
      appSlug: opts.appSlug,
    };
    s.config.githubAccounts.push(acct);
  }
  s.secrets.githubAppKeys = { ...(s.secrets.githubAppKeys ?? {}), [id]: opts.privateKey };
  persistConfig();
  persistSecrets();
  return acct;
}

export function setAccountEnabled(id: string, enabled: boolean): boolean {
  const acct = store().config.githubAccounts.find((a) => a.id === id);
  if (!acct) return false;
  acct.enabled = enabled;
  persistConfig();
  return true;
}

export function renameAccount(id: string, name: string): boolean {
  const acct = store().config.githubAccounts.find((a) => a.id === id);
  if (!acct || !name.trim()) return false;
  acct.name = name.trim();
  persistConfig();
  return true;
}

/** Remove an account, its stored credential, and every repo it contributed. */
export function removeAccount(id: string): boolean {
  const s = store();
  const before = s.config.githubAccounts.length;
  s.config.githubAccounts = s.config.githubAccounts.filter((a) => a.id !== id);
  if (s.config.githubAccounts.length === before) return false;
  s.config.repos = s.config.repos.filter((r) => r.accountId !== id);
  if (s.secrets.githubTokens) delete s.secrets.githubTokens[id];
  if (s.secrets.githubAppKeys) delete s.secrets.githubAppKeys[id];
  persistConfig();
  persistSecrets();
  return true;
}

/**
 * Replace the repo set for one account (preserving prior selection by id),
 * leaving repos from other accounts untouched. This is what a re-list does, so
 * repos deleted on GitHub's side disappear from that account here.
 */
export function setAccountRepos(accountId: string, repos: ConnectedRepo[]) {
  const { config } = store();
  const prevSelected = new Map(config.repos.filter((r) => r.accountId === accountId).map((r) => [r.id, r.selected]));
  const others = config.repos.filter((r) => r.accountId !== accountId);
  const mine = repos.map((r) => ({ ...r, accountId, selected: prevSelected.get(r.id) ?? r.selected }));
  config.repos = [...others, ...mine];
  persistConfig();
}

export function setLlmConfig(patch: Partial<LlmConfig>) {
  const { config } = store();
  config.llm = { ...config.llm, ...patch };
  persistConfig();
}

export function setSettings(patch: Partial<Settings>) {
  const { config } = store();
  config.settings = {
    ...config.settings,
    ...patch,
    email: { ...config.settings.email, ...(patch.email ?? {}) },
    slack: { ...config.settings.slack, ...(patch.slack ?? {}) },
  };
  persistConfig();
}

export function setRepos(repos: ConnectedRepo[]) {
  store().config.repos = repos;
  persistConfig();
}

export function upsertRepos(repos: ConnectedRepo[]) {
  const { config } = store();
  const byId = new Map(config.repos.map((r) => [r.id, r]));
  for (const r of repos) {
    const existing = byId.get(r.id);
    byId.set(r.id, existing ? { ...existing, ...r, selected: existing.selected } : r);
  }
  config.repos = [...byId.values()];
  persistConfig();
}

export function setRepoSelected(id: string, selected: boolean) {
  const r = store().config.repos.find((x) => x.id === id);
  if (r) r.selected = selected;
  persistConfig();
}

export function setRepoResult(id: string, result: RepoRunSummary) {
  const r = store().config.repos.find((x) => x.id === id);
  if (r) {
    r.lastRunAt = new Date().toISOString();
    r.lastResult = result;
  }
  persistConfig();
}

/** Mark a repo as actively being processed (shows "raising" in the UI). */
export function markRepoRunning(id: string) {
  const r = store().config.repos.find((x) => x.id === id);
  if (r) {
    // Preserve prior impacts/affected so the transient row isn't contradictory;
    // only the PR status flips to RAISING while this repo is being processed.
    r.lastResult = {
      affected: r.lastResult?.affected ?? false,
      filesChanged: r.lastResult?.filesChanged ?? 0,
      fixCount: 0,
      unresolved: r.lastResult?.unresolved ?? 0,
      impacts: r.lastResult?.impacts ?? [],
      prStatus: "RAISING",
    };
  }
  persistConfig();
}

/**
 * Reset any "RAISING" repo left over from a run that was interrupted (e.g. the
 * server restarted mid-run). Without this, such repos are stuck showing
 * "raising…" forever. Called once on startup (per tenant).
 */
export function clearStaleRunning(): number {
  const { config } = store();
  let n = 0;
  for (const r of config.repos) {
    if (r.lastResult?.prStatus === "RAISING") {
      r.lastResult = undefined;
      r.lastRunAt = undefined;
      n++;
    }
  }
  if (n) persistConfig();
  return n;
}

export function getSelectedRepos(): ConnectedRepo[] {
  const { config } = store();
  const disabled = new Set(config.githubAccounts.filter((a) => !a.enabled).map((a) => a.id));
  // Repos from a disabled account are skipped. Repos with no account (legacy)
  // are treated as enabled so nothing silently disappears from runs.
  return config.repos.filter((r) => r.selected && !(r.accountId && disabled.has(r.accountId)));
}

// ---- Provider registry ----
export function getProviders(): RegistryProvider[] {
  return store().config.providers;
}

export function upsertProvider(p: Partial<RegistryProvider> & { name: string }): RegistryProvider {
  const { config } = store();
  const id = p.id || slugId(p.name);
  const existing = config.providers.find((x) => x.id === id);
  if (existing) {
    Object.assign(existing, p, { id });
    persistConfig();
    return existing;
  }
  const created: RegistryProvider = {
    id,
    name: p.name,
    sdkPackage: p.sdkPackage,
    changelogUrl: p.changelogUrl,
    enabled: p.enabled ?? true,
    watch: p.watch ?? false,
  };
  config.providers.push(created);
  persistConfig();
  return created;
}

export function deleteProvider(id: string): boolean {
  const { config } = store();
  const before = config.providers.length;
  config.providers = config.providers.filter((p) => p.id !== id);
  const changed = config.providers.length !== before;
  if (changed) persistConfig();
  return changed;
}

export function setProviderSeen(id: string, hash: string, changeHash?: string) {
  const p = store().config.providers.find((x) => x.id === id);
  if (p) {
    p.lastSeenHash = hash;
    if (changeHash !== undefined) p.lastChangeHash = changeHash;
    p.lastCheckedAt = new Date().toISOString();
    persistConfig();
  }
}

// ---- Watch sources ----
export function getWatchSources(): WatchSource[] {
  return store().config.watchSources;
}

export function upsertWatchSource(s: Partial<WatchSource> & { url: string; name: string }): WatchSource {
  const { config } = store();
  const id = s.id || newId("ws");
  const existing = config.watchSources.find((x) => x.id === id);
  if (existing) {
    Object.assign(existing, s, { id });
    persistConfig();
    return existing;
  }
  const created: WatchSource = { id, name: s.name, url: s.url, enabled: s.enabled ?? true };
  config.watchSources.push(created);
  persistConfig();
  return created;
}

export function deleteWatchSource(id: string): boolean {
  const { config } = store();
  const before = config.watchSources.length;
  config.watchSources = config.watchSources.filter((s) => s.id !== id);
  const changed = config.watchSources.length !== before;
  if (changed) persistConfig();
  return changed;
}

export function setWatchSourceSeen(id: string, hash: string, changeHash?: string) {
  const s = store().config.watchSources.find((x) => x.id === id);
  if (s) {
    s.lastSeenHash = hash;
    if (changeHash !== undefined) s.lastChangeHash = changeHash;
    s.lastCheckedAt = new Date().toISOString();
    persistConfig();
  }
}

// ---- Remembered changes (for watch re-runs) ----
export function setLastChanges(changes: StoredChange[]) {
  store().config.lastChanges = changes;
  persistConfig();
}
export function getLastChanges(): StoredChange[] {
  return store().config.lastChanges;
}

export function addRun(run: Omit<RunRecord, "id" | "at">): RunRecord {
  const { config } = store();
  const record: RunRecord = { id: newId("run"), at: new Date().toISOString(), ...run };
  config.runs.unshift(record);
  if (config.runs.length > 1000) config.runs.length = 1000;
  persistConfig();
  return record;
}

export function updateRun(id: string, patch: Partial<RunRecord>) {
  const r = store().config.runs.find((x) => x.id === id);
  if (r) Object.assign(r, patch);
  persistConfig();
}

/** Strip anything that looks like a credential before it hits the audit trail. */
function scrub(message: string): string {
  return message
    .replace(/x-access-token:[^@\s]+@/gi, "x-access-token:***@")
    .replace(/https:\/\/[^@\s/]+:[^@\s/]+@/gi, "https://***@")
    .replace(/gh[posru]_[A-Za-z0-9]{16,}/g, "***")
    .replace(/github_pat_[A-Za-z0-9_]{16,}/g, "***");
}

export function logAudit(kind: string, message: string): AuditEntry {
  const { config } = store();
  const e: AuditEntry = { id: newId("a"), at: new Date().toISOString(), kind, message: scrub(message) };
  config.audit.unshift(e);
  if (config.audit.length > 10000) config.audit.length = 10000;
  persistConfig();
  return e;
}

function slugId(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || newId("p");
}
