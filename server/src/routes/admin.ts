// Owner-only admin API. Guarded by isAdminLogin — the session must be a GitHub
// login listed in OWNER_GITHUB_LOGIN / ADMIN_LOGINS. Lets the owner toggle the
// billing paywall, tune the free limit + price, and manage tenant workspaces.

import { Router, type Request, type Response, type NextFunction } from "express";
import { listTenantIds, setPlan, deleteTenant, tenantAdminSummary } from "../config/store.js";
import { getAdminSettings, setAdminSettings, isAdminLogin } from "../config/admin.js";
import { runWithTenant, currentContext, OWNER_TENANT } from "../auth/context.js";

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
