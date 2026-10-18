// Stateless signed-cookie sessions. No session store / DB needed: the session
// payload is JSON, base64url-encoded, and HMAC-signed with SESSION_SECRET so it
// can't be tampered with. Cookie is httpOnly + SameSite=Lax, and Secure in prod.

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import type { Request, Response } from "express";

export const SESSION_COOKIE = "keelcat_session";
const STATE_COOKIE = "keelcat_oauth_state";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionPayload {
  tid: string; // tenant id
  uid: number; // provider user id (github numeric id; 0 for providers without one)
  login: string; // github login or google email
  name?: string;
  avatar?: string;
  provider?: "github" | "google" | "guest"; // which identity provider authenticated (default github)
  iat: number; // issued-at (ms)
  exp: number; // expiry (ms)
}

/**
 * The signing secret. A stable value MUST be set in production (SESSION_SECRET)
 * or every restart invalidates all sessions. In dev we fall back to a random
 * per-process secret so login still works locally without config.
 */
const SECRET =
  process.env.SESSION_SECRET?.trim() || randomBytes(32).toString("hex");
if (!process.env.SESSION_SECRET) {
  console.warn("[auth] SESSION_SECRET not set — using an ephemeral secret; sessions reset on restart.");
}

const isProd = process.env.NODE_ENV === "production" || process.env.PROD === "1";

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
function sign(data: string): string {
  return b64url(createHmac("sha256", SECRET).update(data).digest());
}

/** Build a signed token string for a payload. */
export function signSession(payload: SessionPayload): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${sign(body)}`;
}

/** Verify + parse a token string; returns null if invalid, tampered, or expired. */
export function verifySession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body).toString("utf8")) as SessionPayload;
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---- Minimal cookie parsing/serialization (no cookie-parser dependency) ----
export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function serializeCookie(name: string, value: string, maxAgeMs: number): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (isProd) parts.push("Secure");
  return parts.join("; ");
}

/** Read + verify the session on a request. */
export function readSession(req: Request): SessionPayload | null {
  return verifySession(parseCookies(req)[SESSION_COOKIE]);
}

/** Issue a session cookie for a freshly authenticated user. */
export function setSession(res: Response, payload: Omit<SessionPayload, "iat" | "exp">) {
  const now = Date.now();
  const full: SessionPayload = { ...payload, iat: now, exp: now + MAX_AGE_MS };
  res.append("Set-Cookie", serializeCookie(SESSION_COOKIE, signSession(full), MAX_AGE_MS));
}

/** Clear the session cookie (logout). */
export function clearSession(res: Response) {
  res.append("Set-Cookie", serializeCookie(SESSION_COOKIE, "", 0));
}

// ---- OAuth state (CSRF protection for the login redirect) ----
export function issueState(res: Response): string {
  const state = randomBytes(16).toString("hex");
  // Short-lived, signed the same way so we can verify it on callback.
  const token = signSession({ tid: state, uid: 0, login: "", iat: Date.now(), exp: Date.now() + 10 * 60 * 1000 });
  res.append("Set-Cookie", serializeCookie(STATE_COOKIE, token, 10 * 60 * 1000));
  return state;
}

export function verifyState(req: Request, state: string | undefined): boolean {
  if (!state) return false;
  const payload = verifySession(parseCookies(req)[STATE_COOKIE]);
  return Boolean(payload && payload.tid === state);
}

export function clearState(res: Response) {
  res.append("Set-Cookie", serializeCookie(STATE_COOKIE, "", 0));
}
