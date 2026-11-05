// Owner-only admin API. Guarded by isAdminLogin — the session must be a GitHub
// login listed in OWNER_GITHUB_LOGIN / ADMIN_LOGINS. Lets the owner toggle the
// billing paywall, tune the free limit + price, and manage tenant workspaces.

import { Router, type Request, type Response, type NextFunction } from "express";
import { listTenantIds, setPlan, deleteTenant, tenantAdminSummary, logAudit } from "../config/store.js";
import { getAdminSettings, setAdminSettings, isAdminLogin } from "../config/admin.js";
import { runWithTenant, currentContext, OWNER_TENANT } from "../auth/context.js";
import { defaultLlmAdminView, setDefaultLlm, clearDefaultLlm, defaultLlmTarget } from "../config/default-llm.js";
import { listSalesLeads, deleteSalesLead } from "../config/sales-leads.js";
import { chatWith } from "../llm/client.js";

export const adminRouter = Router();

function guard(_req: Request, res: Response, next: NextFunction) {
  const ctx = currentContext();
  if (!ctx || !isAdminLogin(ctx.login, ctx.provider)) {
    return res.status(403).json({ error: "Admin access only." });
  }
  next();
}

// GET /api/admin/overview — global settings + every tenant workspace.
adminRouter.get("/api/admin/overview", guard, (_req, res) => {
  const tenants = listTenantIds().map((id) =>
    runWithTenant({ tenantId: id }, () => ({ id, isOwner: id === OWNER_TENANT, ...tenantAdminSummary() }))
  );
  // Show real workspaces first, biggest usage on top.
  tenants.sort((a, b) => b.runsUsed - a.runsUsed);
  res.json({ settings: getAdminSettings(), tenants, tenantCount: tenants.length });
});

// PUT /api/admin/settings — update the global billing settings.
adminRouter.put("/api/admin/settings", guard, (req, res) => {
  res.json(setAdminSettings(req.body ?? {}));
});

// POST /api/admin/tenants/:id/plan — grant/revoke premium for a workspace.
adminRouter.post("/api/admin/tenants/:id/plan", guard, (req, res) => {
  const id = String(req.params.id);
  const plan = req.body?.plan === "premium" ? "premium" : "free";
  runWithTenant({ tenantId: id }, () => setPlan(plan));
  res.json({ ok: true, plan });
});

// DELETE /api/admin/tenants/:id — remove a workspace and its data.
adminRouter.delete("/api/admin/tenants/:id", guard, (req, res) => {
  const id = String(req.params.id);
  if (id === OWNER_TENANT) return res.status(400).json({ error: "Cannot delete the owner workspace." });
  const ok = deleteTenant(id);
  res.json({ ok });
});

// ---- Enterprise "Contact sales" inquiries ----

adminRouter.get("/api/admin/sales-leads", guard, (_req, res) => {
  res.json(listSalesLeads());
});

adminRouter.delete("/api/admin/sales-leads/:id", guard, (req, res) => {
  res.json({ ok: deleteSalesLead(String(req.params.id)) });
});

// ---- Default AI provider shared with chosen workspaces ----

adminRouter.get("/api/admin/default-llm", guard, (_req, res) => {
  res.json(defaultLlmAdminView());
});

adminRouter.put("/api/admin/default-llm", guard, (req, res) => {
  try {
    setDefaultLlm(req.body ?? {});
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }
  logAudit("DEFAULT_AI_UPDATED", "Admin updated the default AI provider settings.");
  res.json(defaultLlmAdminView());
});

adminRouter.delete("/api/admin/default-llm", guard, (_req, res) => {
  clearDefaultLlm();
  logAudit("DEFAULT_AI_REMOVED", "Admin removed the default AI provider and its key.");
  res.json(defaultLlmAdminView());
});

adminRouter.post("/api/admin/default-llm/test", guard, async (_req, res) => {
  const target = defaultLlmTarget();
  if (!target) return res.status(400).json({ error: "Add a base URL, model and API key first." });
  try {
    const out = await chatWith(
      { ...target, shared: false },
      { messages: [{ role: "user", content: "Reply with exactly the word: ok" }], maxTokens: 512 },
    );
    res.json({ ok: true, sample: out.trim().slice(0, 40) });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});
