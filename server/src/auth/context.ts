// Per-request tenant context.
//
// Multi-tenancy hinges on one question every store call must answer: "whose
// data is this?". Rather than thread a tenantId through ~60 store functions and
// every call site in the routes / pipeline / watcher, we stash the current
// tenant in an AsyncLocalStorage. Any code running inside `runWithTenant(...)`
// — including async continuations after `await` — can read it via
// `currentTenantId()`. The store resolves the right per-tenant data from it.

import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantContext {
  tenantId: string;
  /** GitHub numeric user id the session authenticated as (for auditing). */
  userId?: number;
  login?: string;
  provider?: "github" | "google" | "guest";
}

const als = new AsyncLocalStorage<TenantContext>();

/**
 * The tenant used when no session context is present. This is where the legacy
 * single-tenant `data/config.json` is migrated to, so an existing deploy keeps
 * all of its repos/connections, and it's the context used by CLI/demo scripts.
 */
export const OWNER_TENANT = process.env.OWNER_TENANT_ID?.trim() || "owner";

/** Run `fn` (and everything it awaits) with the given tenant in context. */
export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return als.run(ctx, fn);
}

/** The current tenant id, or the owner tenant when there's no active context. */
export function currentTenantId(): string {
  return als.getStore()?.tenantId ?? OWNER_TENANT;
}

/** The full current context, if any (undefined outside a runWithTenant call). */
export function currentContext(): TenantContext | undefined {
  return als.getStore();
}

/** Derive a stable tenant id from a GitHub user id. */
export function tenantIdForGitHubUser(userId: number, login?: string): string {
  // Let a named owner inherit the migrated legacy workspace. Set
  // OWNER_GITHUB_LOGIN to your GitHub login so your existing repos/config carry
  // over on first sign-in instead of starting an empty workspace.
  const ownerLogin = process.env.OWNER_GITHUB_LOGIN?.trim().toLowerCase();
  if (ownerLogin && login && login.toLowerCase() === ownerLogin) return OWNER_TENANT;
  return `gh_${userId}`;
}

/**
 * Derive a stable tenant id from a Google account id (the OpenID `sub`).
 * A Google workspace is distinct from a GitHub one — the same person signing in
 * with Google vs GitHub gets two separate workspaces (account-linking is a
 * later feature). An owner email can be granted the legacy workspace too.
 */
export function tenantIdForGoogleUser(sub: string, email?: string): string {
  const ownerEmail = process.env.OWNER_GOOGLE_EMAIL?.trim().toLowerCase();
  if (ownerEmail && email && email.toLowerCase() === ownerEmail) return OWNER_TENANT;
  return `google_${sub}`;
}
