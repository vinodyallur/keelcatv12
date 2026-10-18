// Global (not per-tenant) admin settings + admin identity.
//
// Persisted to data/admin.json so it survives restarts and is shared across all
// tenants. Controls the billing paywall globally and holds the free-run limit
// and price. Only the owner (OWNER_GITHUB_LOGIN, signed in with GitHub) may read
// or change these — enforced in routes/admin.ts.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const ADMIN_FILE = join(DATA_DIR, "admin.json");

export interface AdminSettings {
  billingEnabled: boolean; // false = paywall off, everyone gets unlimited runs
  freeRunLimit: number; // free runs before an upgrade is required
  priceInr: number; // Razorpay charge amount (rupees) for premium
  allowServerRun: boolean; // false = machine-only (no toggle); true = let users pick machine/server
}

function defaults(): AdminSettings {
  return {
    billingEnabled: true,
    freeRunLimit: Number(process.env.FREE_RUN_LIMIT ?? 10),
    priceInr: Number(process.env.PREMIUM_PRICE_INR ?? 999),
    // Runs happen on the visitor's machine by default. The owner can flip this
    // on to expose the machine/server choice in the UI.
    allowServerRun: false,
  };
}

let settings: AdminSettings = load();

function load(): AdminSettings {
  try {
    if (existsSync(ADMIN_FILE)) return { ...defaults(), ...JSON.parse(readFileSync(ADMIN_FILE, "utf8")) };
  } catch {
    /* ignore */
  }
  return defaults();
}

function persist() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(ADMIN_FILE, JSON.stringify(settings, null, 2), "utf8");
  } catch {
    /* best effort */
  }
}

export function getAdminSettings(): AdminSettings {
  return settings;
}

export function setAdminSettings(patch: Partial<AdminSettings>): AdminSettings {
  settings = {
    billingEnabled: typeof patch.billingEnabled === "boolean" ? patch.billingEnabled : settings.billingEnabled,
    freeRunLimit: Number.isFinite(patch.freeRunLimit as number) ? Math.max(0, Math.floor(patch.freeRunLimit as number)) : settings.freeRunLimit,
    priceInr: Number.isFinite(patch.priceInr as number) ? Math.max(1, Math.floor(patch.priceInr as number)) : settings.priceInr,
    allowServerRun: typeof patch.allowServerRun === "boolean" ? patch.allowServerRun : settings.allowServerRun,
  };
  persist();
  return settings;
}

/**
 * Admins are GitHub logins listed in OWNER_GITHUB_LOGIN (and optional
 * ADMIN_LOGINS, comma-separated). Must be authenticated via GitHub — a guest
 * who merely types the owner's name as their display name is NOT an admin.
 */
export function isAdminLogin(login?: string, provider?: string): boolean {
  if (provider !== "github" || !login) return false;
  const owners = [process.env.OWNER_GITHUB_LOGIN, ...(process.env.ADMIN_LOGINS?.split(",") ?? [])]
    .map((s) => s?.trim().toLowerCase())
    .filter(Boolean);
  return owners.includes(login.toLowerCase());
}
