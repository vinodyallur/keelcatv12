// "Log in with GitHub" / "Log in with Google" — OAuth 2.0 web flow.
//
// These OAuth Apps handle IDENTITY only ("who is this visitor?") so each person
// gets their own isolated workspace (tenant). They are separate from the GitHub
// *App* KeelCat uses to open PRs — connecting repos is a later, in-app step.
//
// Setup (one-time):
//  GitHub — https://github.com/settings/developers → New OAuth App
//    Callback: https://<domain>/api/auth/callback
//    env: GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET
//  Google — https://console.cloud.google.com/apis/credentials → Create OAuth client ID
//    Application type: Web application
//    Authorized redirect URI: https://<domain>/api/auth/google/callback
//    env: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET

import { Router, type Request } from "express";
import { randomUUID } from "node:crypto";
import { setSession, clearSession, readSession, issueState, verifyState, clearState } from "../auth/session.js";
import { tenantIdForGitHubUser, tenantIdForGoogleUser } from "../auth/context.js";
import { isAdminLogin } from "../config/admin.js";

export const authRouter = Router();

const GH_ID = process.env.GITHUB_OAUTH_CLIENT_ID?.trim();
const GH_SECRET = process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim();
const GG_ID = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
const GG_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();

export function githubConfigured(): boolean {
  return Boolean(GH_ID && GH_SECRET);
}
export function googleConfigured(): boolean {
  return Boolean(GG_ID && GG_SECRET);
}
/** Guest mode: try-before-you-sign-in. On unless GUEST_MODE=off. */
export function guestEnabled(): boolean {
  return process.env.GUEST_MODE?.trim().toLowerCase() !== "off";
}
/** Whether ANY real login provider is configured (drives the auth gate in server.ts). */
export function oauthConfigured(): boolean {
  return githubConfigured() || googleConfigured();
}

/** Base URL of this deployment (honors Caddy's forwarded proto/host). */
function baseUrl(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host;
  return `${proto}://${host}`;
}

// GET /api/auth/config — which providers are available + who's logged in.
authRouter.get("/api/auth/config", (req, res) => {
  const session = readSession(req);
  res.json({
    enabled: oauthConfigured(),
    github: githubConfigured(),
    google: googleConfigured(),
    guest: guestEnabled(),
    user: session
      ? {
          login: session.login,
          name: session.name,
          avatar: session.avatar,
          id: session.uid,
          provider: session.provider ?? "github",
          admin: isAdminLogin(session.login, session.provider ?? "github"),
        }
      : null,
  });
});

// POST /api/auth/guest — try-before-you-sign-in. Enter a display name; get a
// fresh isolated workspace tied to a random guest id stored in the session
// cookie. No credentials; clearing cookies discards the workspace.
authRouter.post("/api/auth/guest", (req, res) => {
  if (!guestEnabled()) return res.status(403).json({ error: "guest mode is disabled" });
  const raw = (req.body?.name ?? "").toString().trim().slice(0, 40);
  const name = raw || "Guest";
  const tid = `guest_${randomUUID()}`;
  setSession(res, { tid, uid: 0, login: name, name, provider: "guest" });
  res.json({ ok: true });
});

// GET /api/auth/me — current user, or 401.
authRouter.get("/api/auth/me", (req, res) => {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: "not authenticated" });
  res.json({
    login: session.login,
    name: session.name,
    avatar: session.avatar,
    id: session.uid,
    provider: session.provider ?? "github",
    admin: isAdminLogin(session.login, session.provider ?? "github"),
    tenant: session.tid,
  });
});

// ---- GitHub ----------------------------------------------------------------

// GET /api/auth/login — kick off GitHub OAuth (kept at the original path).
authRouter.get("/api/auth/login", (req, res) => {
  if (!githubConfigured()) return res.status(503).send("GitHub login is not configured on this server.");
  const state = issueState(res);
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", GH_ID!);
  url.searchParams.set("redirect_uri", `${baseUrl(req)}/api/auth/callback`);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "true");
  res.redirect(url.toString());
});

// GET /api/auth/callback — GitHub redirects back with ?code&state.
authRouter.get("/api/auth/callback", async (req, res) => {
  if (!githubConfigured()) return res.status(503).send("GitHub login is not configured.");
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  if (!code || !verifyState(req, state)) {
    clearState(res);
    return res.status(400).send("Login failed (bad or expired state). Please try again.");
  }
  clearState(res);
  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_id: GH_ID,
        client_secret: GH_SECRET,
        code,
        redirect_uri: `${baseUrl(req)}/api/auth/callback`,
      }),
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenJson.access_token) return res.status(401).send(`GitHub did not return a token: ${tokenJson.error ?? "unknown error"}`);

    const userRes = await fetch("https://api.github.com/user", {
      headers: { authorization: `Bearer ${tokenJson.access_token}`, accept: "application/vnd.github+json", "user-agent": "keelcat" },
    });
    if (!userRes.ok) return res.status(401).send("Could not read your GitHub profile.");
    const user = (await userRes.json()) as { id: number; login: string; name?: string; avatar_url?: string };

    const tid = tenantIdForGitHubUser(user.id, user.login);
    setSession(res, { tid, uid: user.id, login: user.login, name: user.name ?? user.login, avatar: user.avatar_url, provider: "github" });
    res.redirect("/");
  } catch (e) {
    res.status(500).send(`Login error: ${(e as Error).message}`);
  }
});

// ---- Google ----------------------------------------------------------------

// GET /api/auth/google/login — kick off Google OAuth.
authRouter.get("/api/auth/google/login", (req, res) => {
  if (!googleConfigured()) return res.status(503).send("Google login is not configured on this server.");
  const state = issueState(res);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", GG_ID!);
  url.searchParams.set("redirect_uri", `${baseUrl(req)}/api/auth/google/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  res.redirect(url.toString());
});

// GET /api/auth/google/callback — Google redirects back with ?code&state.
authRouter.get("/api/auth/google/callback", async (req, res) => {
  if (!googleConfigured()) return res.status(503).send("Google login is not configured.");
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  if (!code || !verifyState(req, state)) {
    clearState(res);
    return res.status(400).send("Login failed (bad or expired state). Please try again.");
  }
  clearState(res);
  try {
    // Google's token endpoint expects form-encoded params.
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        code,
        client_id: GG_ID!,
        client_secret: GG_SECRET!,
        redirect_uri: `${baseUrl(req)}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }).toString(),
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string; error_description?: string };
    if (!tokenJson.access_token) {
      return res.status(401).send(`Google did not return a token: ${tokenJson.error_description ?? tokenJson.error ?? "unknown error"}`);
    }

    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { authorization: `Bearer ${tokenJson.access_token}`, accept: "application/json" },
    });
    if (!userRes.ok) return res.status(401).send("Could not read your Google profile.");
    const user = (await userRes.json()) as { id: string; email: string; name?: string; picture?: string; verified_email?: boolean };

    const tid = tenantIdForGoogleUser(user.id, user.email);
    setSession(res, { tid, uid: 0, login: user.email, name: user.name ?? user.email, avatar: user.picture, provider: "google" });
    res.redirect("/");
  } catch (e) {
    res.status(500).send(`Login error: ${(e as Error).message}`);
  }
});

// POST /api/auth/logout — clear the session.
authRouter.post("/api/auth/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});
