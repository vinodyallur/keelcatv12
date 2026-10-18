import type { RepoToken, RunSettings } from "./pipeline/run";

// Typed client for the real KeelCat backend (:8787).

// In production the SPA is served by the API server itself, so calls go to the
// same origin (BASE=""). In dev we point at the local engine on :8787.
// An explicit VITE_API_URL always wins (e.g. split hosting).
const BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? "" : "http://localhost:8787");

export type ChangeImpact = "BREAKING" | "DEPRECATION" | "NEW_FEATURE";
export type ChangeKind =
  | "PARAM_RENAME"
  | "SYMBOL_RENAME"
  | "PARAM_REMOVED"
  | "PARAM_ADDED_REQUIRED"
  | "SYMBOL_REMOVED"
  | "SYMBOL_DEPRECATED"
  | "SYMBOL_ADDED"
  | "OTHER";

export type ChangeStatus = "FIXED" | "REVIEW" | "CLEAN" | "INFO" | "ERROR";

export interface ChangeSpec {
  provider?: string;
  symbol: string;
  kind: ChangeKind;
  from?: string;
  to?: string;
  impact: ChangeImpact;
  description: string;
}

export interface GitHubAccountView {
  id: string;
  name: string;
  mode: "pat" | "app";
  login?: string;
  enabled: boolean;
  appSlug?: string;
  addedAt: string;
  repoCount: number;
}

export interface ConnectedRepo {
  id: string;
  accountId?: string;
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  languages: string[];
  selected: boolean;
  lastRunAt?: string;
  lastResult?: {
    affected: boolean;
    filesChanged: number;
    fixCount: number;
    unresolved: number;
    prNumber?: number;
    prUrl?: string;
    branch?: string;
    prStatus?: "RAISING" | "RAISED" | "NOT_RAISED" | "CLEAN" | "ERROR";
    impacts?: string[];
    tests?: RunTestResult;
    needsAttention?: boolean;
    error?: string;
  };
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

export interface RegistryProvider {
  id: string;
  name: string;
  sdkPackage?: string;
  changelogUrl?: string;
  enabled: boolean;
  watch: boolean;
  lastSeenHash?: string;
  lastCheckedAt?: string;
}

export interface WatchSource {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  lastSeenHash?: string;
  lastCheckedAt?: string;
}

export interface Settings {
  autoOpenPr: boolean;
  watchEnabled: boolean;
  intervalMinutes: number;
  godMode: boolean;
  verifyFixes: boolean;
  completenessCheck: boolean;
  runTests: boolean;
  securityWatch: boolean;
  email: EmailConfig;
  slack: { enabled: boolean };
}

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export interface Finding {
  ruleId: string;
  title: string;
  severity: Severity;
  filePath: string;
  line: number;
  snippet: string;
}
export interface ScanSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  status: "CLEAN" | "WARN" | "THREAT";
}
export interface RepoSecurityResult {
  id: string;
  fullName: string;
  scannedFiles: number;
  summary: ScanSummary;
  findings: Finding[];
  error?: string;
}
export interface SecurityScan {
  at: string;
  repos: RepoSecurityResult[];
  totals: ScanSummary;
}
export interface PrSecurityResult {
  repo: string;
  number: number;
  title: string;
  author: string;
  url: string;
  headSha: string;
  summary: ScanSummary;
  findings: Finding[];
  commented: boolean;
  error?: string;
}
export interface PrScan {
  at: string;
  prs: PrSecurityResult[];
  totals: ScanSummary;
}

export interface PublicConfig {
  github: { mode: "pat" | "app"; appId?: string; installationId?: string; appSlug?: string };
  accounts: GitHubAccountView[];
  llm: { provider: string; model: string; baseUrl?: string };
  settings: Settings;
  repos: ConnectedRepo[];
  providers: RegistryProvider[];
  watchSources: WatchSource[];
  hasPat: boolean;
  hasLlmKey: boolean;
  hasAppKey: boolean;
  hasWebhookSecret: boolean;
  hasSmtpPass: boolean;
  hasSlackWebhook: boolean;
  billing: { plan: "free" | "premium"; runsUsed: number; freeLimit: number; remaining: number | null };
  allowServerRun: boolean; // admin toggle: expose the machine/server run choice
}

export type BillingInterval = "monthly" | "annual";
export interface BillingInfo {
  plan: "free" | "premium";
  runsUsed: number;
  freeLimit: number;
  remaining: number | null;
  premiumSince?: string;
  premiumInterval?: BillingInterval;
  configured: boolean;
  priceInr: number; // monthly price (back-compat)
  prices: { monthly: number; annual: number };
  currency: string;
  keyId: string | null;
}
export interface RazorpayOrder {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  interval: BillingInterval;
}

export interface AutoStatus {
  running: boolean;
  godMode: boolean;
  watchEnabled: boolean;
  intervalMinutes: number;
  lastTickAt: string | null;
  sources: number;
}

export interface PerChangeResult {
  symbol: string;
  impact: string;
  kind: string;
  status: ChangeStatus;
  filesTouched: string[];
  note?: string;
}

export interface RepoRunResult {
  id: string;
  fullName: string;
  affected: boolean;
  filesChanged: number;
  fixCount: number;
  unresolved: number;
  verified: boolean;
  diffs: { filePath: string; before: string; after: string; language: string; resolved: boolean; note?: string }[];
  flagged: { filePath: string; note?: string; hits: number }[];
  perChange: PerChangeResult[];
  pr: { number: number; url: string; branch: string } | null;
  error?: string;
}

export interface RunOutput {
  runId?: string;
  changes: ChangeSpec[];
  reposScanned: number;
  reposAffected: number;
  prsOpened: number;
  repos: RepoRunResult[];
}

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

export interface RunRepoResult {
  fullName: string;
  affected: boolean;
  prNumber?: number;
  prUrl?: string;
  prStatus: "RAISED" | "NONE" | "ERROR";
  impacts: string[];
  filesChanged: number;
  unresolved: number;
  tests?: RunTestResult;
  error?: string;
}

export interface RunRecord {
  id: string;
  at: string;
  source: "CHANGELOG" | "MANUAL" | "WATCH" | "GODMODE" | "WEBHOOK";
  sourceName?: string;
  changeCount: number;
  reposScanned: number;
  reposAffected: number;
  prsOpened: number;
  status: "RUNNING" | "DONE" | "ERROR";
  changes?: ChangeSpec[];
  results?: RunRepoResult[];
  error?: string;
}

export type LogExportType = "audit" | "runs" | "prs";
export interface LogExportParams {
  type: LogExportType;
  from?: string;
  to?: string;
  runId?: string;
  q?: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  kind: string;
  message: string;
}

export interface CreatedRepo {
  name: string;
  fullName: string;
  url: string;
  created: boolean;
  error?: string;
}

export interface AuthUser {
  id: number;
  login: string;
  name?: string;
  avatar?: string;
  provider?: "github" | "google" | "guest";
  admin?: boolean;
}

export interface AdminSettings {
  billingEnabled: boolean;
  freeRunLimit: number;
  priceInr: number;
  allowServerRun: boolean;
}
export interface AdminTenant {
  id: string;
  isOwner: boolean;
  plan: "free" | "premium";
  runsUsed: number;
  repoCount: number;
  premiumSince?: string;
  accounts: { login?: string; mode: "pat" | "app"; enabled: boolean }[];
}
export interface AdminOverview {
  settings: AdminSettings;
  tenants: AdminTenant[];
  tenantCount: number;
}
export interface AuthState {
  enabled: boolean; // whether ANY login provider is configured on this server
  github: boolean; // GitHub login available
  google: boolean; // Google login available
  guest: boolean; // guest (try-it) mode available
  user: AuthUser | null; // the currently signed-in user, if any
}

// `credentials: "include"` so the session cookie rides along (needed in dev,
// where the SPA on :5173 talks to the API on :8787 cross-origin).
async function req<T>(path: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error || `${path} -> ${r.status}`);
  return data as T;
}

export async function health(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/api/health`, { credentials: "include" });
    return r.ok;
  } catch {
    return false;
  }
}

export const auth = {
  config: () => req<AuthState>("/api/auth/config", "GET"),
  logout: () => req<{ ok: boolean }>("/api/auth/logout", "POST", {}),
  guest: (name: string) => req<{ ok: boolean }>("/api/auth/guest", "POST", { name }),
  loginUrl: (provider: "github" | "google" = "github") =>
    provider === "google" ? `${BASE}/api/auth/google/login` : `${BASE}/api/auth/login`,
};

/** Response from POST /api/run/token — selected repos + short-lived tokens. */
export interface RunTokenResponse {
  repos: RepoToken[];
  settings: RunSettings;
  errors: { fullName: string; error: string }[];
}

export const api = {
  health,
  auth,
  config: {
    get: () => req<PublicConfig>("/api/config", "GET"),
    setLlm: (b: { provider?: string; model?: string; baseUrl?: string; apiKey?: string }) =>
      req<PublicConfig>("/api/config/llm", "PUT", b),
    testLlm: () => req<{ ok: boolean; model: string; sample: string }>("/api/config/llm/test", "POST", {}),
    setGitHub: (b: {
      mode?: "pat" | "app";
      appId?: string;
      installationId?: string;
      appSlug?: string;
      pat?: string;
      privateKey?: string;
      webhookSecret?: string;
    }) => req<PublicConfig>("/api/config/github", "PUT", b),
    setSettings: (b: Partial<Settings>) => req<PublicConfig & { auto?: AutoStatus }>("/api/config/settings", "PUT", b),
    setEmail: (b: Partial<EmailConfig> & { pass?: string }) => req<PublicConfig>("/api/config/email", "PUT", b),
    testEmail: () => req<{ ok: boolean; to: string }>("/api/config/email/test", "POST", {}),
    setSlack: (b: { enabled?: boolean; webhookUrl?: string }) => req<PublicConfig>("/api/config/slack", "PUT", b),
    testSlack: () => req<{ ok: boolean }>("/api/config/slack/test", "POST", {}),
  },
  github: {
    connect: (pat: string, name?: string) =>
      req<{ login: string; repos: ConnectedRepo[]; accountId: string }>("/api/github/connect", "POST", { pat, name }),
    appManifest: (name: string) =>
      req<{ manifest: Record<string, unknown>; action: string }>(`/api/github/app/manifest?name=${encodeURIComponent(name)}`, "GET"),
    appInstallations: (b: { appId: string; privateKey: string }) =>
      req<{ installations: { installationId: string; account: string; type: string }[] }>("/api/github/app/installations", "POST", b),
    appRepos: (b: { installationId: string; name?: string; account?: string }) =>
      req<{ repos: ConnectedRepo[]; accountId: string }>("/api/github/app/repos", "POST", b),
    accounts: {
      update: (id: string, b: { name?: string; enabled?: boolean }) =>
        req<PublicConfig>(`/api/github/accounts/${encodeURIComponent(id)}`, "PATCH", b),
      remove: (id: string) => req<PublicConfig>(`/api/github/accounts/${encodeURIComponent(id)}`, "DELETE"),
    },
  },
  repos: {
    select: (id: string, selected: boolean) => req<ConnectedRepo[]>("/api/repos/select", "POST", { id, selected }),
    selectAll: (selected: boolean) => req<ConnectedRepo[]>("/api/repos/select-all", "POST", { selected }),
  },
  providers: {
    list: () => req<RegistryProvider[]>("/api/providers", "GET"),
    save: (p: Partial<RegistryProvider> & { name: string }) => req<RegistryProvider[]>("/api/providers", "POST", p),
    remove: (id: string) => req<RegistryProvider[]>(`/api/providers/${encodeURIComponent(id)}`, "DELETE"),
  },
  watchSources: {
    list: () => req<WatchSource[]>("/api/watch/sources", "GET"),
    save: (s: Partial<WatchSource> & { name: string; url: string }) => req<WatchSource[]>("/api/watch/sources", "POST", s),
    remove: (id: string) => req<WatchSource[]>(`/api/watch/sources/${encodeURIComponent(id)}`, "DELETE"),
  },
  auto: {
    status: () => req<AutoStatus>("/api/auto/status", "GET"),
    setGodMode: (enabled: boolean) => req<PublicConfig & { auto: AutoStatus }>("/api/auto/godmode", "POST", { enabled }),
    pollNow: () => req<{ ok: boolean; auto: AutoStatus }>("/api/auto/poll", "POST", {}),
  },
  changelog: {
    parse: (text: string) => req<{ changes: ChangeSpec[] }>("/api/changelog/parse", "POST", { text }),
    sample: () => req<{ changelog: string }>("/api/testkit/changelog", "GET"),
  },
  security: {
    status: () => req<SecurityScan | null>("/api/security/status", "GET"),
    scan: () => req<SecurityScan>("/api/security/scan", "POST", {}),
    prs: () => req<PrScan | null>("/api/security/prs", "GET"),
    scanPrs: (comment = true) => req<PrScan>("/api/security/scan-prs", "POST", { comment }),
  },
  run: (changes: ChangeSpec[], changelogText?: string) => req<RunOutput>("/api/run", "POST", { changes, changelogText }),
  // Client-side run: mint short-lived per-repo tokens, then record the outcome.
  runToken: () => req<RunTokenResponse>("/api/run/token", "POST", {}),
  runRepoResult: (repo: RepoRunResult) => req<{ ok: boolean }>("/api/run/repo", "POST", repo),
  runRecord: (out: RunOutput & { changelogText?: string }) =>
    req<{ runId: string; billing: BillingInfo }>("/api/run/record", "POST", out),
  runs: () => req<RunRecord[]>("/api/runs", "GET"),
  activity: () => req<AuditEntry[]>("/api/activity", "GET"),
  logs: {
    exportUrl: (p: LogExportParams) => {
      const qs = new URLSearchParams();
      qs.set("type", p.type);
      if (p.from) qs.set("from", p.from);
      if (p.to) qs.set("to", p.to);
      if (p.runId) qs.set("runId", p.runId);
      if (p.q) qs.set("q", p.q);
      return `${BASE}/api/logs/export?${qs.toString()}`;
    },
    download: async (p: LogExportParams) => {
      const r = await fetch(api.logs.exportUrl(p));
      if (!r.ok) throw new Error(`export failed (${r.status})`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `keelcat-${p.type}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  },
  testkit: {
    create: () => req<{ created: CreatedRepo[]; repos: ConnectedRepo[] }>("/api/testkit/create", "POST", {}),
  },
  billing: {
    get: () => req<BillingInfo>("/api/billing", "GET"),
    order: (plan: BillingInterval = "monthly") => req<RazorpayOrder>("/api/billing/order", "POST", { plan }),
    verify: (p: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string; plan?: BillingInterval }) =>
      req<{ ok: boolean; billing: BillingInfo }>("/api/billing/verify", "POST", p),
  },
  admin: {
    overview: () => req<AdminOverview>("/api/admin/overview", "GET"),
    setSettings: (p: Partial<AdminSettings>) => req<AdminSettings>("/api/admin/settings", "PUT", p),
    setTenantPlan: (id: string, plan: "free" | "premium") =>
      req<{ ok: boolean; plan: string }>(`/api/admin/tenants/${encodeURIComponent(id)}/plan`, "POST", { plan }),
    deleteTenant: (id: string) => req<{ ok: boolean }>(`/api/admin/tenants/${encodeURIComponent(id)}`, "DELETE"),
  },
};
