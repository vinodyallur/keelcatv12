// Real production API: GitHub connect (PAT + App), repo selection, changelog
// parsing (LLM), multi-repo runs with real PRs, test-repo creation, settings.

import { Router } from "express";
import {
  getConfig,
  getSelectedRepos,
  setRepoResult,
  markRepoRunning,
  publicConfig,
  setSecret,
  setGitHubConfig,
  setLlmConfig,
  setSettings,
  setRepoSelected,
  setRepos,
  getSecrets,
  upsertPatAccount,
  upsertAppAccount,
  setAccountRepos,
  removeAccount,
  setAccountEnabled,
  renameAccount,
  addRun,
  updateRun,
  logAudit,
  canRun,
  incrementRuns,
  getBilling,
  getProviders,
  upsertProvider,
  deleteProvider,
  getWatchSources,
  upsertWatchSource,
  deleteWatchSource,
  type ConnectedRepo,
} from "../config/store.js";
import {
  listReposForToken,
  listAppInstallations,
  installationOctokit,
  listReposForInstallation,
  makeClient,
  convertAppManifest,
} from "../integrations/github.js";
import { tokenForRepo } from "../integrations/credentials.js";
import { pingLlm, llmConfigured } from "../llm/client.js";
import { parseChangelog, type ChangeSpec } from "../llm/changelog.js";
import { runChanges, summarizeRunResults } from "../pipeline/run.js";
import { createTestRepos } from "../testkit/create.js";
import { SAMPLE_CHANGELOG } from "../testkit/samples.js";
import { syncAuto, getAutoStatus, pollNow, ingestChangelog } from "../watch/auto.js";
import { handlePush, resolveWebhookTenant, anyWebhookSecretConfigured } from "../watch/github-webhook.js";
import { runWithTenant } from "../auth/context.js";
import { scanAllRepos, getLastSecurityScan, scanPullRequests, getLastPrScan } from "../pipeline/security.js";
import { testEmail } from "../notifications/email.js";
import { testSlack } from "../notifications/slack.js";

export const real = Router();

// ---- Config ----
real.get("/api/config", (_req, res) => res.json(publicConfig()));

real.put("/api/config/llm", (req, res) => {
  const { provider, model, baseUrl, apiKey } = req.body ?? {};
  if (provider || model || baseUrl !== undefined) setLlmConfig({ provider, model, baseUrl });
  if (typeof apiKey === "string" && apiKey.length) setSecret({ llmApiKey: apiKey });
  res.json(publicConfig());
});

real.post("/api/config/llm/test", async (_req, res) => {
  try {
    if (!llmConfigured()) return res.status(400).json({ error: "LLM not configured (set provider + API key)." });
    const r = await pingLlm();
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

real.put("/api/config/github", (req, res) => {
  const { mode, appId, installationId, appSlug, pat, privateKey, webhookSecret } = req.body ?? {};
  const patch: any = {};
  if (mode) patch.mode = mode;
  if (appId !== undefined) patch.appId = appId;
  if (installationId !== undefined) patch.installationId = installationId;
  if (appSlug !== undefined) patch.appSlug = appSlug;
  if (Object.keys(patch).length) setGitHubConfig(patch);
  if (typeof pat === "string" && pat.length) setSecret({ githubPat: pat });
  if (typeof privateKey === "string" && privateKey.length) setSecret({ githubAppPrivateKey: privateKey });
  if (typeof webhookSecret === "string" && webhookSecret.length) setSecret({ githubWebhookSecret: webhookSecret });
  res.json(publicConfig());
});

real.put("/api/config/settings", (req, res) => {
  setSettings(req.body ?? {});
  // Keep the automatic engine (watch / God Mode) aligned with the new settings.
  syncAuto();
  res.json({ ...publicConfig(), auto: getAutoStatus() });
});

// ---- Email config + test ----
real.put("/api/config/email", (req, res) => {
  const { enabled, to, from, host, port, secure, user, pass } = req.body ?? {};
  setSettings({
    email: {
      enabled: Boolean(enabled),
      to: to ?? "",
      from: from ?? "",
      host: host ?? "smtp.gmail.com",
      port: Number(port ?? 465),
      secure: secure ?? true,
      user: user ?? "",
    },
  });
  if (typeof pass === "string" && pass.length) setSecret({ smtpPass: pass });
  res.json(publicConfig());
});
real.post("/api/config/email/test", async (_req, res) => {
  try {
    const r = await testEmail();
    logAudit("EMAIL_TEST", `Test email sent to ${r.to}.`);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---- Slack config + test ----
real.put("/api/config/slack", (req, res) => {
  const { enabled, webhookUrl } = req.body ?? {};
  setSettings({ slack: { enabled: Boolean(enabled) } });
  if (typeof webhookUrl === "string" && webhookUrl.length) setSecret({ slackWebhookUrl: webhookUrl });
  res.json(publicConfig());
});
real.post("/api/config/slack/test", async (_req, res) => {
  try {
    const r = await testSlack();
    logAudit("SLACK_TEST", "Test message sent to Slack.");
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---- Provider registry ----
real.get("/api/providers", (_req, res) => res.json(getProviders()));
real.post("/api/providers", (req, res) => {
  const { name } = req.body ?? {};
  if (!name) return res.status(400).json({ error: "name required." });
  const p = upsertProvider(req.body);
  logAudit("PROVIDER_SAVED", `Provider "${p.name}" saved.`);
  res.json(getProviders());
});
real.delete("/api/providers/:id", (req, res) => {
  const ok = deleteProvider(req.params.id);
  if (!ok) return res.status(404).json({ error: "provider not found" });
  res.json(getProviders());
});

// ---- Watch sources ----
real.get("/api/watch/sources", (_req, res) => res.json(getWatchSources()));
real.post("/api/watch/sources", (req, res) => {
  const { name, url } = req.body ?? {};
  if (!name || !url) return res.status(400).json({ error: "name and url required." });
  upsertWatchSource(req.body);
  res.json(getWatchSources());
});
real.delete("/api/watch/sources/:id", (req, res) => {
  const ok = deleteWatchSource(req.params.id);
  if (!ok) return res.status(404).json({ error: "watch source not found" });
  res.json(getWatchSources());
});

// ---- Automatic engine (watch + God Mode) ----
real.get("/api/auto/status", (_req, res) => res.json(getAutoStatus()));
real.post("/api/auto/godmode", (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  setSettings({ godMode: enabled });
  const status = syncAuto();
  logAudit(enabled ? "GODMODE_ON" : "GODMODE_OFF", `God Mode ${enabled ? "enabled — running fully automatically" : "disabled"}.`);
  res.json({ ...publicConfig(), auto: status });
});
real.post("/api/auto/poll", async (_req, res) => {
  try {
    await pollNow();
    res.json({ ok: true, auto: getAutoStatus() });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---- Security scanner ----
real.get("/api/security/status", (_req, res) => res.json(getLastSecurityScan()));
real.post("/api/security/scan", async (_req, res) => {
  try {
    res.json(await scanAllRepos());
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});
real.get("/api/security/prs", (_req, res) => res.json(getLastPrScan()));
real.post("/api/security/scan-prs", async (req, res) => {
  try {
    res.json(await scanPullRequests(req.body?.comment !== false));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---- Inbound webhook: post a changelog from anywhere (GitHub Action, email
// forwarder, Zapier, etc.). When God Mode is on, this runs the full pipeline
// automatically. Body: { text?: string, changes?: ChangeSpec[] }
real.post("/api/webhook/changelog", async (req, res) => {
  const text = (req.body?.text as string) || "";
  const changes = (req.body?.changes as ChangeSpec[]) ?? [];
  if (changes.length === 0 && !text.trim()) return res.status(400).json({ error: "Provide text or changes." });
  try {
    logAudit("WEBHOOK_RECEIVED", `Changelog received via webhook.`);
    const res2 = await ingestChangelog({ text, changes, trigger: "WEBHOOK" });
    if (!res2.ran) return res.json({ ok: true, ran: false, message: res2.message, changes: res2.changes });
    res.json({ ok: true, ran: true, ...res2.out });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---- Inbound GitHub webhook: INSTANT detection ----
// Point a provider's repo webhook (push events) at this URL. The moment they
// commit to their changelog, GitHub calls us, we verify the signature, pull the
// new content, and run the full detect → fix → PR pipeline. No polling delay.
real.post("/api/webhook/github", async (req, res) => {
  const signature = req.header("x-hub-signature-256") ?? "";
  if (!signature) {
    // No signature at all → the webhook was added on GitHub without a Secret,
    // or with a different one. Tell the user precisely instead of a bare 401.
    logAudit("WEBHOOK_REJECTED", "GitHub webhook had no x-hub-signature-256 header — set the same Secret on the GitHub webhook as in KeelCat.");
    return res.status(401).json({ error: "Missing signature. Add the same Secret on the GitHub webhook that you saved in KeelCat." });
  }
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
  // Match the signature against each workspace's saved secret to find its owner.
  const tenantId = resolveWebhookTenant(rawBody, signature);
  if (!tenantId) {
    if (!anyWebhookSecretConfigured()) {
      return res.status(400).json({ error: "Webhook secret not configured. Set it in Connect → Instant detection (webhook)." });
    }
    logAudit("WEBHOOK_REJECTED", "GitHub webhook signature did not match any workspace's secret — the Secret on the GitHub webhook differs from the one saved in KeelCat.");
    return res.status(401).json({ error: "Invalid signature. The Secret on the GitHub webhook doesn't match the one saved in KeelCat." });
  }

  const event = req.header("x-github-event") ?? "";
  if (event === "ping") return res.json({ ok: true, pong: true });
  if (event !== "push") return res.json({ ok: true, ignored: event });

  // GitHub sends the payload either as the JSON body (content type
  // application/json) or as a `payload` form field (application/x-www-form-
  // urlencoded, the GitHub default). Support both so either setting works.
  let payload: unknown = req.body;
  if (payload && typeof (payload as { payload?: unknown }).payload === "string") {
    try {
      payload = JSON.parse((payload as { payload: string }).payload);
    } catch {
      logAudit("WEBHOOK_ERROR", "Could not parse form-encoded webhook payload.");
      return res.json({ ok: true, accepted: false });
    }
  }

  try {
    // Respond fast so GitHub doesn't time out; process in the background —
    // inside the resolved tenant's context so it uses THEIR repos/credentials.
    res.json({ ok: true, accepted: true });
    runWithTenant({ tenantId }, () => handlePush(payload))
      .then((r) => {
        if (r.handled) runWithTenant({ tenantId }, () => logAudit("WEBHOOK_HANDLED", r.message));
      })
      .catch((e) => runWithTenant({ tenantId }, () => logAudit("WEBHOOK_ERROR", `Push handling failed: ${(e as Error).message}`)));
  } catch (e) {
    logAudit("WEBHOOK_ERROR", `Push handling failed: ${(e as Error).message}`);
  }
});

// ---- GitHub connect (PAT) — creates/updates a named account ----
real.post("/api/github/connect", async (req, res) => {
  const pat = req.body?.pat as string;
  const name = (req.body?.name as string) || "";
  if (!pat) return res.status(400).json({ error: "PAT required." });
  try {
    const octokit = makeClient(pat).octokit;
    const me = await octokit.users.getAuthenticated();
    const list = await listReposForToken(pat);
    // Register (or refresh) this identity as its own account and scope its repos
    // to it — so multiple accounts don't blend into one list.
    const acct = upsertPatAccount({ name, login: me.data.login, pat });
    setAccountRepos(acct.id, list.map((r) => toConnected(r, acct.id)));
    logAudit("GITHUB_CONNECTED", `Connected "${acct.name}" as ${me.data.login} (${list.length} repos visible).`);
    res.json({ login: me.data.login, repos: getConfig().repos, accountId: acct.id });
  } catch (e) {
    res.status(401).json({ error: `GitHub rejected the token: ${(e as Error).message}` });
  }
});

// ---- GitHub accounts: list / rename / enable-disable / remove ----
real.get("/api/github/accounts", (_req, res) => res.json(publicConfig()));

real.patch("/api/github/accounts/:id", (req, res) => {
  const { name, enabled } = req.body ?? {};
  let ok = false;
  if (typeof name === "string") ok = renameAccount(req.params.id, name) || ok;
  if (typeof enabled === "boolean") ok = setAccountEnabled(req.params.id, enabled) || ok;
  if (!ok) return res.status(404).json({ error: "account not found" });
  logAudit("GITHUB_ACCOUNT_UPDATED", `Account ${req.params.id} updated${typeof enabled === "boolean" ? ` (${enabled ? "enabled" : "disabled"})` : ""}.`);
  res.json(publicConfig());
});

real.delete("/api/github/accounts/:id", (req, res) => {
  const ok = removeAccount(req.params.id);
  if (!ok) return res.status(404).json({ error: "account not found" });
  logAudit("GITHUB_ACCOUNT_REMOVED", `Removed GitHub account ${req.params.id} and its repositories.`);
  res.json(publicConfig());
});

// ---- GitHub App: one-click creation via Manifest flow ----
// Returns the manifest + the GitHub URL to POST it to. The browser submits a
// form to GitHub; GitHub creates the app and redirects to /app/callback below.
real.get("/api/github/app/manifest", (req, res) => {
  const host = req.get("host") ?? "";
  const backend = `${req.protocol}://${host}`;
  const name = String(req.query.name || "KeelCat").slice(0, 34);
  // GitHub rejects a manifest whose webhook URL isn't reachable on the public
  // internet — so only include the webhook when we're NOT on localhost.
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const manifest: Record<string, unknown> = {
    name,
    url: "https://github.com/keelcat",
    redirect_url: `${backend}/api/github/app/callback`,
    public: false,
    default_permissions: { contents: "write", pull_requests: "write", metadata: "read" },
  };
  if (!isLocal) {
    manifest.hook_attributes = { url: `${backend}/api/webhook/github`, active: true };
    manifest.default_events = ["push"];
  }
  res.json({ manifest, action: "https://github.com/settings/apps/new" });
});

// GitHub redirects here after the user confirms app creation. We exchange the
// temporary code for the app's credentials and save them automatically.
real.get("/api/github/app/callback", async (req, res) => {
  const code = String(req.query.code ?? "");
  const state = String(req.query.state ?? "");
  const front = /^https?:\/\//.test(state) ? state : process.env.FRONTEND_URL || "http://localhost:5173";
  if (!code) return res.status(400).send("Missing manifest code.");
  try {
    const app = await convertAppManifest(code);
    setGitHubConfig({ mode: "app", appId: String(app.id), appSlug: app.slug });
    setSecret({ githubAppPrivateKey: app.pem });
    if (app.webhook_secret) setSecret({ githubWebhookSecret: app.webhook_secret });
    logAudit("GITHUB_APP_CREATED", `GitHub App "${app.slug}" created and connected.`);
    res.redirect(`${front}/?app=created&slug=${encodeURIComponent(app.slug)}#connect`);
  } catch (e) {
    res.redirect(`${front}/?app=error&msg=${encodeURIComponent((e as Error).message)}#connect`);
  }
});

// ---- GitHub App ----
real.post("/api/github/app/installations", async (req, res) => {
  const appId = (req.body?.appId as string) || getConfig().github.appId;
  const privateKey = (req.body?.privateKey as string) || getSecrets().githubAppPrivateKey;
  if (!appId || !privateKey) return res.status(400).json({ error: "appId and privateKey required." });
  try {
    if (req.body?.privateKey) setSecret({ githubAppPrivateKey: req.body.privateKey });
    setGitHubConfig({ mode: "app", appId });
    const installs = await listAppInstallations(appId, privateKey);
    res.json({ installations: installs });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

real.post("/api/github/app/repos", async (req, res) => {
  const appId = (req.body?.appId as string) || getConfig().github.appId;
  const privateKey = getSecrets().githubAppPrivateKey;
  const installationId = (req.body?.installationId as string) || getConfig().github.installationId;
  const name = (req.body?.name as string) || "";
  const account = (req.body?.account as string) || "";
  const appSlug = getConfig().github.appSlug;
  if (!appId || !privateKey || !installationId)
    return res.status(400).json({ error: "appId, privateKey, installationId required." });
  try {
    setGitHubConfig({ mode: "app", appId, installationId });
    const octokit = await installationOctokit(appId, privateKey, installationId);
    const list = await listReposForInstallation(octokit);
    // Register this installation as its own account and scope its repos to it.
    const acct = upsertAppAccount({ name, appId, installationId, appSlug, privateKey, login: account || undefined });
    setAccountRepos(acct.id, list.map((r) => toConnected(r, acct.id)));
    res.json({ repos: getConfig().repos, accountId: acct.id });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ---- Repo selection ----
real.post("/api/repos/select", (req, res) => {
  const { id, selected } = req.body ?? {};
  if (!id) return res.status(400).json({ error: "id required." });
  setRepoSelected(id, Boolean(selected));
  res.json(getConfig().repos);
});
real.post("/api/repos/select-all", (req, res) => {
  const selected = Boolean(req.body?.selected);
  setRepos(getConfig().repos.map((r) => ({ ...r, selected })));
  res.json(getConfig().repos);
});

// ---- Changelog parsing ----
real.post("/api/changelog/parse", async (req, res) => {
  const text = (req.body?.text as string) ?? "";
  if (!text.trim()) return res.status(400).json({ error: "Changelog text required." });
  try {
    // parseChangelog uses the LLM when available and falls back to a
    // deterministic parser otherwise, so this works even with no LLM key.
    const changes = await parseChangelog(text);
    logAudit("CHANGELOG_PARSED", `Parsed ${changes.length} change(s) from changelog.`);
    res.json({ changes });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---- Run ----
real.post("/api/run", async (req, res) => {
  const changes = (req.body?.changes as ChangeSpec[]) ?? [];
  const changelogText = req.body?.changelogText as string | undefined;
  if (!Array.isArray(changes) || changes.length === 0) return res.status(400).json({ error: "changes required." });
  // Free-plan gate: block once the free run allowance is used up.
  if (!canRun()) {
    const b = getBilling();
    return res.status(402).json({
      error: `You've used all ${b.freeLimit} free runs. Upgrade to premium to keep going.`,
      upgrade: true,
      billing: b,
    });
  }
  const run = addRun({
    source: changelogText ? "CHANGELOG" : "MANUAL",
    changelogText,
    changeCount: changes.length,
    reposScanned: 0,
    reposAffected: 0,
    prsOpened: 0,
    status: "RUNNING",
  });
  try {
    const out = await runChanges(changes, changelogText ? "CHANGELOG" : "MANUAL");
    // Count this run against the free allowance only after it succeeds.
    incrementRuns();
    updateRun(run.id, {
      status: "DONE",
      reposScanned: out.reposScanned,
      reposAffected: out.reposAffected,
      prsOpened: out.prsOpened,
      changes: out.changes as any,
      results: summarizeRunResults(out),
    });
    res.json({ runId: run.id, ...out, billing: getBilling() });
  } catch (e) {
    updateRun(run.id, { status: "ERROR", error: (e as Error).message });
    res.status(500).json({ error: (e as Error).message });
  }
});

// Persist one repo's client-run outcome into its lastResult, so the (polling)
// Repositories view reflects it — same shape a server run writes.
function persistClientRepoResult(r: any): void {
  if (!r?.id) return;
  const impacts = [
    ...new Set((r.perChange ?? []).filter((pc: any) => pc.status !== "CLEAN").map((pc: any) => pc.impact)),
  ] as string[];
  const prStatus: "RAISED" | "NOT_RAISED" | "CLEAN" | "ERROR" = r.error
    ? "ERROR"
    : r.pr
    ? "RAISED"
    : r.affected
    ? "NOT_RAISED"
    : "CLEAN";
  setRepoResult(r.id, {
    affected: Boolean(r.affected),
    filesChanged: Number(r.filesChanged ?? 0),
    fixCount: Number(r.fixCount ?? 0),
    unresolved: Number(r.unresolved ?? 0),
    prNumber: r.pr?.number,
    prUrl: r.pr?.url,
    branch: r.pr?.branch,
    prStatus,
    impacts,
    needsAttention: Boolean(r.affected && !r.pr),
    error: r.error,
  });
}

// ---- Client-side run (runs on the visitor's machine) ----
// The heavy pipeline (fetch → fix → verify → open PR) runs in the browser on the
// visitor's CPU. The server only (1) mints short-lived, repo-scoped tokens and
// marks the repos "raising", (2) accepts per-repo results as each finishes (so
// the Repositories view flips RAISING→RAISED live), and (3) records the finished
// run for history + billing. Parse stays server-side.
//
// ⚠️ Token exposure: App-installation accounts get a ~1h installation token
// (short-lived, install-scoped). PAT accounts get their PAT (long-lived) — that
// token reaches the browser, so prefer GitHub App connections for public use.
real.post("/api/run/token", async (_req, res) => {
  const repos = getSelectedRepos();
  if (repos.length === 0) return res.status(400).json({ error: "No repositories selected. Pick repos in Repositories first." });
  // Same free-plan gate as the server run: block once the allowance is used up.
  if (!canRun()) {
    const b = getBilling();
    return res.status(402).json({
      error: `You've used all ${b.freeLimit} free runs. Upgrade to premium to keep going.`,
      upgrade: true,
      billing: b,
    });
  }
  const { verifyFixes, completenessCheck, autoOpenPr } = getConfig().settings;

  // Mint one token per connected account (dedup so we don't re-mint for repos
  // that share an account).
  const tokenCache = new Map<string, string>();
  const out: { id: string; fullName: string; owner: string; repo: string; defaultBranch: string; token: string }[] = [];
  const errors: { fullName: string; error: string }[] = [];
  for (const repo of repos) {
    const key = repo.accountId ?? "__default__";
    try {
      let token = tokenCache.get(key);
      if (!token) {
        token = await tokenForRepo(repo);
        tokenCache.set(key, token);
      }
      out.push({ id: repo.id, fullName: repo.fullName, owner: repo.owner, repo: repo.repo, defaultBranch: repo.defaultBranch, token });
      // Show the repo as "raising…" (amber, blinking) in the Repositories view
      // for the duration of the run — same as a server run does at start.
      markRepoRunning(repo.id);
    } catch (e) {
      errors.push({ fullName: repo.fullName, error: (e as Error).message });
    }
  }
  if (out.length === 0) {
    return res.status(400).json({ error: `Could not authorize any selected repo: ${errors.map((e) => e.error).join("; ")}` });
  }
  logAudit("RUN_TOKEN_ISSUED", `Issued short-lived run tokens for ${out.length} repo(s) [client-side run].`);
  res.json({ repos: out, settings: { verifyFixes, completenessCheck, autoOpenPr }, errors });
});

// Report ONE repo's result mid-run so the Repositories view flips it live
// (RAISING → RAISED / needs review / clean) as the browser finishes each repo.
real.post("/api/run/repo", (req, res) => {
  const r = req.body;
  if (!r?.id) return res.status(400).json({ error: "repo result required." });
  persistClientRepoResult(r);
  res.json({ ok: true });
});

// Record a finished client-side run: log it to history and count it against the
// free allowance, exactly like a server run would.
real.post("/api/run/record", (req, res) => {
  const out = req.body ?? {};
  const changes = (out.changes as ChangeSpec[]) ?? [];
  if (!Array.isArray(out.repos)) return res.status(400).json({ error: "run output required." });
  const reposScanned = Number(out.reposScanned ?? 0);
  const reposAffected = Number(out.reposAffected ?? 0);
  const prsOpened = Number(out.prsOpened ?? 0);

  // Persist each repo's outcome (backstop; most were already reported live via
  // /api/run/repo as each finished).
  for (const r of out.repos as any[]) persistClientRepoResult(r);
  const run = addRun({
    source: out.changelogText ? "CHANGELOG" : "MANUAL",
    changelogText: out.changelogText,
    changeCount: changes.length,
    reposScanned,
    reposAffected,
    prsOpened,
    status: "RUNNING",
  });
  // Count this run against the free allowance (the browser did the work).
  incrementRuns();
  updateRun(run.id, {
    status: "DONE",
    reposScanned,
    reposAffected,
    prsOpened,
    changes: changes as any,
    results: summarizeRunResults(out as any),
  });
  logAudit("RUN_COMPLETED", `${reposAffected}/${reposScanned} affected, ${prsOpened} PR(s) opened. [CLIENT]`);
  res.json({ runId: run.id, billing: getBilling() });
});

real.get("/api/runs", (_req, res) => res.json(getConfig().runs));
real.get("/api/activity", (_req, res) => res.json(getConfig().audit));

// ---- Log export (Excel-compatible CSV) ----
// GET /api/logs/export?type=audit|runs|prs&from=ISO&to=ISO&runId=...&q=...
real.get("/api/logs/export", (req, res) => {
  const type = String(req.query.type ?? "audit").toLowerCase();
  const from = req.query.from ? new Date(String(req.query.from)).getTime() : -Infinity;
  const to = req.query.to ? new Date(String(req.query.to)).getTime() : Infinity;
  const runId = req.query.runId ? String(req.query.runId) : "";
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const inRange = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= from && t <= to;
  };

  const { runs, audit } = getConfig();
  let rows: string[][];
  let filename: string;

  if (type === "runs") {
    filename = "keelcat-changelogs";
    rows = [["changelog_id", "timestamp", "source", "source_name", "status", "changes", "repos_scanned", "repos_affected", "prs_opened", "impacts"]];
    for (const r of runs) {
      if (!inRange(r.at)) continue;
      if (runId && r.id !== runId) continue;
      const impacts = [...new Set((r.results ?? []).flatMap((x) => x.impacts))].join(" ");
      const changeList = (r.changes ?? []).map((c) => `${c.symbol} (${c.impact})`).join("; ");
      const row = [r.id, r.at, r.source, r.sourceName ?? "", r.status, changeList || String(r.changeCount), String(r.reposScanned), String(r.reposAffected), String(r.prsOpened), impacts];
      if (q && !row.join(" ").toLowerCase().includes(q)) continue;
      rows.push(row);
    }
  } else if (type === "prs") {
    filename = "keelcat-prs";
    rows = [["changelog_id", "timestamp", "source", "repo", "pr_status", "pr_number", "pr_url", "impacts", "files_changed", "unresolved", "tests"]];
    for (const r of runs) {
      if (!inRange(r.at)) continue;
      if (runId && r.id !== runId) continue;
      for (const res2 of r.results ?? []) {
        const tests = res2.tests ? (res2.tests.ran ? `${res2.tests.ok ? "PASS" : "FAIL"}: ${res2.tests.summary}` : `not run: ${res2.tests.summary}`) : "";
        const row = [r.id, r.at, r.source, res2.fullName, res2.prStatus, res2.prNumber ? String(res2.prNumber) : "", res2.prUrl ?? "", res2.impacts.join(" "), String(res2.filesChanged), String(res2.unresolved), tests];
        if (q && !row.join(" ").toLowerCase().includes(q)) continue;
        rows.push(row);
      }
    }
  } else {
    filename = "keelcat-activity";
    rows = [["log_id", "timestamp", "kind", "message"]];
    for (const e of audit) {
      if (!inRange(e.at)) continue;
      const row = [e.id, e.at, e.kind, e.message];
      if (q && !row.join(" ").toLowerCase().includes(q)) continue;
      rows.push(row);
    }
  }

  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}-${new Date().toISOString().slice(0, 10)}.csv"`);
  // BOM so Excel opens UTF-8 correctly.
  res.send("\uFEFF" + csv);
});

function csvCell(v: string): string {
  const s = v ?? "";
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---- Test repos ----
real.get("/api/testkit/changelog", (_req, res) => res.json({ changelog: SAMPLE_CHANGELOG }));
real.post("/api/testkit/create", async (_req, res) => {
  try {
    const created = await createTestRepos();
    res.json({ created, repos: getConfig().repos });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

function toConnected(
  r: {
    id: string;
    owner: string;
    repo: string;
    fullName: string;
    defaultBranch: string;
    private: boolean;
    language: string | null;
  },
  accountId?: string
): ConnectedRepo {
  return {
    id: r.id,
    accountId,
    owner: r.owner,
    repo: r.repo,
    fullName: r.fullName,
    defaultBranch: r.defaultBranch,
    private: r.private,
    languages: r.language ? [r.language.toUpperCase()] : [],
    selected: false,
  };
}
