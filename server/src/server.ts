// Load .env FIRST, before any other module reads process.env at import time
// (auth/session/billing all capture env vars when they're first imported).
import "dotenv/config";
import express from "express";
import cors from "cors";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runPipeline, readRepoFiles } from "./pipeline/orchestrator.js";
import type { OpenAPISpec } from "./core/types.js";
import { makeClient, resolveBase, fetchRepoFiles, openFixPr, type RepoRef } from "./integrations/github.js";
import {
  getSettings,
  updateSettings,
  getRepos,
  getProviders,
  toggleRepo,
  toggleProvider,
  getAudit,
  getNotifications,
  markNotificationsRead,
  logAudit,
  getSpecs,
  getSpec,
  updateCurrentSpec,
  resetSpec,
} from "./state/store.js";
import { clearStaleRunning, listTenantIds } from "./config/store.js";
import { runFleetScan, getLastFleetScan, setLastScanCache } from "./pipeline/fleet.js";
import { startWatch, stopWatch, syncWatchWithSettings, getWatchStatus } from "./watch/scheduler.js";
import { syncAuto } from "./watch/auto.js";
import { authRouter, oauthConfigured } from "./routes/auth.js";
import { billingRouter } from "./routes/billing.js";
import { adminRouter } from "./routes/admin.js";
import { readSession } from "./auth/session.js";
import { runWithTenant, OWNER_TENANT } from "./auth/context.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_DIR = join(__dirname, "demo");

function loadSpec(name: string): OpenAPISpec {
  return JSON.parse(readFileSync(join(DEMO_DIR, "specs", name), "utf8"));
}

import { real } from "./routes/real.js";

const app = express();
// Reflect the request origin and allow credentials so the session cookie works
// across the dev split origin (SPA :5173 → API :8787). In prod the SPA is served
// same-origin so this is a no-op.
app.use(cors({ origin: true, credentials: true }));
// Capture the raw body so webhook signatures (x-hub-signature-256) can be
// verified against the exact bytes GitHub signed. We register the same capture
// on BOTH parsers because GitHub webhooks default to
// application/x-www-form-urlencoded — without the urlencoded parser its raw
// body would be lost and every signature check would fail with a 401.
const captureRawBody = (req: express.Request, _res: express.Response, buf: Buffer) => {
  (req as unknown as { rawBody?: Buffer }).rawBody = buf;
};
app.use(express.json({ limit: "4mb", verify: captureRawBody }));
app.use(express.urlencoded({ extended: false, limit: "4mb", verify: captureRawBody }));

// ---- Authentication + tenant isolation ----
// "Log in with GitHub" routes are always mounted (and always exempt from the
// gate below) so visitors can authenticate.
app.use(authRouter);

// Paths that never require auth: health check and the GitHub webhook (which
// authenticates via its own HMAC signature), plus the auth routes themselves.
function isPublicPath(path: string): boolean {
  return (
    path === "/api/health" ||
    path.startsWith("/api/webhook") ||
    path === "/api/billing/webhook" ||
    path.startsWith("/api/auth")
  );
}

const APP_PASSWORD = process.env.APP_PASSWORD;

// The gate. Three modes, in priority order:
//  1) OAuth configured  -> real per-user sessions + isolated tenants (SaaS mode).
//  2) APP_PASSWORD set   -> shared HTTP Basic gate, single OWNER workspace (interim).
//  3) neither            -> fully open, single OWNER workspace (trusted demo only).
app.use((req, res, next) => {
  if (isPublicPath(req.path)) return next();

  // Mode 1: multi-tenant sessions.
  if (oauthConfigured()) {
    const session = readSession(req);
    if (session) {
      // Run the rest of this request inside the user's tenant context so every
      // store call transparently reads/writes only their data.
      return runWithTenant(
        { tenantId: session.tid, userId: session.uid, login: session.login, provider: session.provider },
        () => next()
      );
    }
    // Not logged in: block the API, but let non-API routes through so the SPA
    // can load and render its "Sign in with GitHub" screen.
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "not authenticated" });
    return next();
  }

  // Mode 2: shared password gate (no per-user isolation; everything is OWNER).
  if (APP_PASSWORD) {
    const hdr = req.headers.authorization ?? "";
    const [scheme, encoded] = hdr.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = Buffer.from(encoded, "base64").toString();
      const pass = decoded.slice(decoded.indexOf(":") + 1);
      if (pass === APP_PASSWORD) return runWithTenant({ tenantId: OWNER_TENANT }, () => next());
    }
    res.set("WWW-Authenticate", 'Basic realm="KeelCat"');
    return res.status(401).send("Authentication required");
  }

  // Mode 3: open demo.
  return runWithTenant({ tenantId: OWNER_TENANT }, () => next());
});

if (oauthConfigured()) console.log("[apisteward] auth: GitHub OAuth (multi-tenant) enabled");
else if (APP_PASSWORD) console.log("[apisteward] auth: shared password gate (single workspace)");
else console.log("[apisteward] auth: OPEN (no login configured — trusted demo only)");

// Real production API (GitHub connect, changelog runs, real PRs).
app.use(real);
// Billing (Razorpay upgrade + usage) — tenant-scoped, behind the auth gate.
app.use(billingRouter);
// Owner-only admin API.
app.use(adminRouter);

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/providers", (_req, res) => res.json(getProviders()));
app.get("/api/repos", (_req, res) => res.json(getRepos()));

// ---- Settings (full UI control) ----
app.get("/api/settings", (_req, res) => res.json(getSettings()));
app.put("/api/settings", (req, res) => {
  const updated = updateSettings(req.body ?? {});
  // Keep the scheduler aligned with any watch/interval change.
  syncWatchWithSettings();
  res.json({ settings: updated, watch: getWatchStatus() });
});

// ---- Toggle repos / providers ----
app.post("/api/repos/:id/toggle", (req, res) => {
  const repo = toggleRepo(req.params.id, req.body?.enabled);
  if (!repo) return res.status(404).json({ error: "repo not found" });
  res.json(repo);
});
app.post("/api/providers/:id/toggle", (req, res) => {
  const p = toggleProvider(req.params.id, req.body?.enabled);
  if (!p) return res.status(404).json({ error: "provider not found" });
  res.json(p);
});

// ---- API Studio: editable provider spec ----
app.get("/api/specs", (_req, res) => res.json(getSpecs()));
app.get("/api/specs/:providerId", (req, res) => {
  const s = getSpec(req.params.providerId);
  if (!s) return res.status(404).json({ error: "provider spec not found" });
  res.json(s);
});
app.put("/api/specs/:providerId", (req, res) => {
  const spec = req.body?.current ?? req.body;
  if (!spec || !Array.isArray(spec.symbols)) return res.status(400).json({ error: "current spec with symbols[] required" });
  const updated = updateCurrentSpec(req.params.providerId, spec);
  if (!updated) return res.status(404).json({ error: "provider spec not found" });
  res.json(updated);
});
app.post("/api/specs/:providerId/reset", (req, res) => {
  const updated = resetSpec(req.params.providerId);
  if (!updated) return res.status(404).json({ error: "provider spec not found" });
  res.json(updated);
});

// ---- Multi-repo fan-out ----
app.post("/api/fleet/scan", (_req, res) => {
  try {
    const result = runFleetScan("MANUAL");
    setLastScanCache(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});
app.get("/api/fleet/status", (_req, res) => res.json(getLastFleetScan()));

// ---- Scheduled watching ----
app.get("/api/watch/status", (_req, res) => res.json(getWatchStatus()));
app.post("/api/watch/toggle", (req, res) => {
  const enabled = req.body?.enabled;
  const status = enabled === false ? stopWatch() : enabled === true ? startWatch() : getWatchStatus().running ? stopWatch() : startWatch();
  // Persist the intent in settings so it survives restarts.
  updateSettings({ watchEnabled: status.running });
  res.json(status);
});

// ---- Activity log + notifications ----
app.get("/api/audit", (req, res) => res.json(getAudit(Number(req.query.limit ?? 100))));
app.get("/api/notifications", (req, res) => res.json(getNotifications(Number(req.query.limit ?? 100))));
app.post("/api/notifications/read", (_req, res) => {
  markNotificationsRead();
  res.json({ ok: true });
});

/**
 * Run the real pipeline: diff v1 -> v2 of the demo API against the sample repo,
 * returning genuine detected changes, affected usages, fixes, and notifications.
 */
app.post("/api/run", (_req, res) => {
  try {
    const prev = loadSpec("demo-api.v1.json");
    const curr = loadSpec("demo-api.v2.json");
    const files = readRepoFiles(join(DEMO_DIR, "sample-repo"));
    const result = runPipeline(prev, curr, files, "sample-checkout-app", curr.providerId);

    // Build a per-file before/after diff for the UI.
    const before = new Map(files.map((f) => [f.filePath, f.content]));
    const diffs = Object.entries(result.updatedFiles).map(([path, after]) => ({
      filePath: path,
      before: before.get(path) ?? "",
      after,
    }));

    res.json({
      provider: { id: curr.providerId, from: prev.version, to: curr.version },
      scannedFiles: files.length,
      changeRecords: result.changeRecords,
      usagesByRecord: result.usagesByRecord,
      edits: result.edits,
      unresolved: result.unresolved,
      diffs,
      notifications: result.notifications,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/**
 * Verify a GitHub token and repo are reachable. Token is used in-memory only,
 * never stored or logged.
 */
app.post("/api/github/verify", async (req, res) => {
  const { token, owner, repo } = req.body ?? {};
  if (!token || !owner || !repo) return res.status(400).json({ error: "token, owner, repo required" });
  try {
    const client = makeClient(token);
    const info = await client.octokit.repos.get({ owner, repo });
    const me = await client.octokit.users.getAuthenticated();
    res.json({
      ok: true,
      login: me.data.login,
      fullName: info.data.full_name,
      defaultBranch: info.data.default_branch,
      private: info.data.private,
    });
  } catch (e) {
    res.status(401).json({ error: `GitHub rejected the request: ${(e as Error).message}` });
  }
});

/**
 * ONE-CLICK real demo: create the repo (if missing), seed the sample app,
 * then detect + fix + open a real PR. Body: { token, repo? }
 * Owner is resolved from the authenticated user, so the caller only needs a token.
 */
app.post("/api/github/autodemo", async (req, res) => {
  const { token } = req.body ?? {};
  const repoName = (req.body?.repo as string) || "keelcat-demo";
  if (!token) return res.status(400).json({ error: "token required" });
  try {
    const client = makeClient(token);
    const me = await client.octokit.users.getAuthenticated();
    const owner = me.data.login;
    const ref: RepoRef = { owner, repo: repoName };

    // 1) Create the repo if it doesn't exist (auto_init gives it a default branch).
    let created = false;
    try {
      await client.octokit.repos.get({ owner, repo: repoName });
    } catch {
      await client.octokit.repos.createForAuthenticatedUser({
        name: repoName,
        description: "KeelCat demo — self-maintaining API migration",
        auto_init: true,
        private: false,
      });
      created = true;
      // Give GitHub a moment to initialize the default branch.
      await new Promise((r) => setTimeout(r, 1500));
    }

    const baseBranch = await resolveBase(client, ref);

    // 2) Seed the sample app (old API) onto the default branch.
    const sampleFiles = readRepoFiles(join(DEMO_DIR, "sample-repo"));
    const seedMap: Record<string, string> = {};
    for (const f of sampleFiles) seedMap[f.filePath] = f.content;
    await commitToBranch(client, ref, baseBranch, seedMap, "chore: seed sample checkout app (uses demo-pay v1)");

    // 3) Detect + fix + open a real PR.
    const prev = loadSpec("demo-api.v1.json");
    const curr = loadSpec("demo-api.v2.json");
    const files = await fetchRepoFiles(client, ref, baseBranch);
    const result = runPipeline(prev, curr, files, `${owner}/${repoName}`, curr.providerId);
    const before = new Map(files.map((f) => [f.filePath, f.content]));
    const diffs = Object.entries(result.updatedFiles).map(([path, after]) => ({
      filePath: path,
      before: before.get(path) ?? "",
      after,
    }));

    const breaking = result.changeRecords.find((c) => c.changeType === "BREAKING");
    const branch = `keelcat/${breaking?.migration?.from ?? "fix"}-to-${breaking?.migration?.to ?? "update"}`;
    const title = breaking
      ? `fix(${curr.providerId}): migrate ${breaking.symbol} (${breaking.migration?.from} → ${breaking.migration?.to})`
      : `chore(${curr.providerId}): API changes detected`;
    const body = buildPrBody(curr.providerId, result, diffs);

    let pr: { url: string; number: number; branch: string } | null = null;
    if (Object.keys(result.updatedFiles).length > 0) {
      pr = await openFixPr(client, ref, branch, baseBranch, result.updatedFiles, title, body);
    }

    res.json({
      created,
      owner,
      repo: `${owner}/${repoName}`,
      repoUrl: `https://github.com/${owner}/${repoName}`,
      baseBranch,
      scannedFiles: files.length,
      changeRecords: result.changeRecords,
      usagesByRecord: result.usagesByRecord,
      edits: result.edits,
      unresolved: result.unresolved,
      diffs,
      notifications: result.notifications,
      pr,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

/**
 * Seed the sample checkout app (which uses the OLD demo-pay API) into the
 * connected repo's default branch, so there is real, detectable code to fix.
 * Body: { token, owner, repo }
 */
app.post("/api/github/seed", async (req, res) => {
  const { token, owner, repo } = req.body ?? {};
  if (!token || !owner || !repo) return res.status(400).json({ error: "token, owner, repo required" });
  const ref: RepoRef = { owner, repo };
  try {
    const client = makeClient(token);
    const baseBranch = await resolveBase(client, ref);
    const sampleFiles = readRepoFiles(join(DEMO_DIR, "sample-repo"));
    const fileMap: Record<string, string> = {};
    for (const f of sampleFiles) fileMap[f.filePath] = f.content;
    // Commit the sample files straight onto the default branch.
    await commitToBranch(client, ref, baseBranch, fileMap, "chore: seed sample checkout app (uses demo-pay v1)");
    res.json({ ok: true, baseBranch, files: Object.keys(fileMap) });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

async function commitToBranch(
  client: ReturnType<typeof makeClient>,
  ref: RepoRef,
  branch: string,
  files: Record<string, string>,
  message: string
) {
  const { octokit } = client;
  const { owner, repo } = ref;
  const baseRef = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
  const baseSha = baseRef.data.object.sha;
  const baseCommit = await octokit.git.getCommit({ owner, repo, commit_sha: baseSha });
  const treeItems = [];
  for (const [path, content] of Object.entries(files)) {
    const blob = await octokit.git.createBlob({ owner, repo, content, encoding: "utf-8" });
    treeItems.push({ path, mode: "100644" as const, type: "blob" as const, sha: blob.data.sha });
  }
  const newTree = await octokit.git.createTree({ owner, repo, base_tree: baseCommit.data.tree.sha, tree: treeItems });
  const commit = await octokit.git.createCommit({ owner, repo, message, tree: newTree.data.sha, parents: [baseSha] });
  await octokit.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: commit.data.sha });
}

/**
 * REAL end-to-end run against a GitHub repo:
 * fetch files -> diff demo API v1->v2 -> scan -> fix -> open a real PR.
 * Body: { token, owner, repo, base?, dryRun? }
 */
app.post("/api/github/run", async (req, res) => {
  const { token, owner, repo, base, dryRun } = req.body ?? {};
  if (!token || !owner || !repo) return res.status(400).json({ error: "token, owner, repo required" });
  const ref: RepoRef = { owner, repo, base };
  try {
    const prev = loadSpec("demo-api.v1.json");
    const curr = loadSpec("demo-api.v2.json");
    const client = makeClient(token);
    const baseBranch = await resolveBase(client, ref);
    const files = await fetchRepoFiles(client, ref, baseBranch);

    const result = runPipeline(prev, curr, files, `${owner}/${repo}`, curr.providerId);

    const before = new Map(files.map((f) => [f.filePath, f.content]));
    const diffs = Object.entries(result.updatedFiles).map(([path, after]) => ({
      filePath: path,
      before: before.get(path) ?? "",
      after,
    }));

    const breaking = result.changeRecords.find((c) => c.changeType === "BREAKING");
    const branch = `keelcat/${breaking?.migration?.from ?? "fix"}-to-${breaking?.migration?.to ?? "update"}`;
    const title = breaking
      ? `fix(${curr.providerId}): migrate ${breaking.symbol} (${breaking.migration?.from} → ${breaking.migration?.to})`
      : `chore(${curr.providerId}): API changes detected`;
    const body = buildPrBody(curr.providerId, result, diffs);

    let pr: { url: string; number: number; branch: string } | null = null;
    if (!dryRun && Object.keys(result.updatedFiles).length > 0) {
      pr = await openFixPr(client, ref, branch, baseBranch, result.updatedFiles, title, body);
    }

    res.json({
      repo: `${owner}/${repo}`,
      baseBranch,
      scannedFiles: files.length,
      changeRecords: result.changeRecords,
      usagesByRecord: result.usagesByRecord,
      edits: result.edits,
      unresolved: result.unresolved,
      diffs,
      notifications: result.notifications,
      pr,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

function buildPrBody(
  providerId: string,
  result: { changeRecords: any[]; unresolved: any[]; updatedFiles: Record<string, string> },
  diffs: { filePath: string }[]
): string {
  const breaking = result.changeRecords.filter((c) => c.changeType === "BREAKING");
  const lines = [
    `## 🤖 KeelCat — automated API migration`,
    ``,
    `Detected a breaking change in **${providerId}** and applied the fix.`,
    ``,
    `### Changes`,
    ...result.changeRecords.map((c) => `- \`${c.changeType}\` **${c.symbol}** — ${c.summary}`),
    ``,
    `### Files updated`,
    ...diffs.map((d) => `- \`${d.filePath}\``),
  ];
  if (result.unresolved.length) {
    lines.push(``, `### ⚠️ Needs manual attention`);
    for (const u of result.unresolved) lines.push(`- \`${u.location.filePath}:${u.location.line}\` — ${u.symbol}`);
  }
  lines.push(``, `---`, `_Opened for review by KeelCat. Nothing is merged automatically._`);
  return lines.join("\n");
}

// ---- Serve the built dashboard (single-service hosting) ----
// In production the API and the SPA are served from one origin, so the browser
// calls /api/* on the same host (no CORS, one URL, one container).
const PUBLIC_DIR = process.env.PUBLIC_DIR || join(__dirname, "..", "..", "dist");
if (existsSync(PUBLIC_DIR)) {
  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      setHeaders(res, filePath) {
        // Vite fingerprints asset filenames, so they can be cached forever.
        if (/[\\/]assets[\\/]/.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    })
  );
  // SPA fallback: any non-API GET returns index.html so client routing works.
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(join(PUBLIC_DIR, "index.html"));
  });
  console.log(`[apisteward] serving dashboard from ${PUBLIC_DIR}`);
}

const PORT = Number(process.env.PORT ?? 8787);
app.listen(PORT, () => {
  console.log(`KeelCat engine API listening on http://localhost:${PORT}`);
  // Per-tenant startup housekeeping: clear any repo left "raising…" by a run
  // interrupted by a restart, and log the boot into each tenant's audit trail.
  for (const tid of listTenantIds()) {
    runWithTenant({ tenantId: tid }, () => {
      const cleared = clearStaleRunning();
      if (cleared) logAudit("ENGINE_STARTED", `Cleared ${cleared} interrupted repo run(s) stuck in "raising".`);
      logAudit("ENGINE_STARTED", "KeelCat engine started.");
    });
  }
  // Legacy scheduler (state/store) — harmless no-op on empty legacy state.
  syncWatchWithSettings();
  // Resume automatic watching / God Mode across every tenant that enabled it.
  syncAuto();
});
