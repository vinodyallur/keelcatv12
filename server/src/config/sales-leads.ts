// Enterprise "Contact sales" inquiries for the admin console. They hold personal
// data (name, email, phone), so the file is owner-only and the list is capped.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const FILE = join(DATA_DIR, "sales-leads.json");
const MAX_STORED = 500;
const PER_WORKSPACE_PER_DAY = 5;
const TOTAL_PER_DAY = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SalesLeadInput {
  name: string;
  email: string;
  phone: string;
  company?: string;
  licenses: number;
  message?: string;
}

export interface SalesLead extends SalesLeadInput {
  id: string;
  at: string;
  tenantId: string;
  login?: string;
}

// Strict on purpose: the admin console turns this into a mailto: link.
const EMAIL_RE = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/** Validate a form submission: the cleaned lead, or a message to show the user. */
export function cleanSalesLead(body: unknown): { lead: SalesLeadInput } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const name = str(b.name);
  const email = str(b.email);
  const phone = str(b.phone);
  const company = str(b.company);
  const message = str(b.message);
  const licenses = Number(b.licenses);
  const digits = phone.replace(/\D/g, "").length;

  if (!name || name.length > 100) return { error: "Enter your name (up to 100 characters)." };
  if (email.length > 254 || !EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  if (phone.length > 25 || !/^\+?[\d\s()-]+$/.test(phone) || digits < 7 || digits > 15) {
    return { error: "Enter a valid phone number, for example +91 98765 43210." };
  }
  if (company.length > 120) return { error: "Company name is too long (up to 120 characters)." };
  if (!Number.isInteger(licenses) || licenses < 1 || licenses > 100_000) {
    return { error: "Enter the number of licenses you need (1 to 100,000)." };
  }
  if (message.length > 2000) return { error: "Message is too long (up to 2,000 characters)." };
  return { lead: { name, email, phone, licenses, ...(company && { company }), ...(message && { message }) } };
}

let leads: SalesLead[] | null = null;

function all(): SalesLead[] {
  if (!leads) {
    try {
      leads = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as SalesLead[]) : [];
    } catch {
      leads = [];
    }
  }
  return leads;
}

function persist(list: SalesLead[]) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(list, null, 2), { encoding: "utf8", mode: 0o600 });
  leads = list;
}

// Spam guard (any guest can submit): per-workspace and global caps over 24 hours.
const recentByTenant = new Map<string, number[]>();
let recentTotal: number[] = [];

function underLimit(tenantId: string, now: number): boolean {
  recentTotal = recentTotal.filter((t) => now - t < DAY_MS);
  const mine = (recentByTenant.get(tenantId) ?? []).filter((t) => now - t < DAY_MS);
  if (mine.length) recentByTenant.set(tenantId, mine);
  else recentByTenant.delete(tenantId);
  return mine.length < PER_WORKSPACE_PER_DAY && recentTotal.length < TOTAL_PER_DAY;
}

/** Store a validated inquiry. Returns false when today's limit is reached. */
export function addSalesLead(input: SalesLeadInput, from: { tenantId: string; login?: string }): boolean {
  const now = Date.now();
  if (!underLimit(from.tenantId, now)) return false;
  const lead: SalesLead = {
    ...input,
    id: randomUUID(),
    at: new Date(now).toISOString(),
    tenantId: from.tenantId,
    ...(from.login && { login: from.login }),
  };
  persist([lead, ...all()].slice(0, MAX_STORED));
  recentTotal.push(now);
  recentByTenant.set(from.tenantId, [...(recentByTenant.get(from.tenantId) ?? []), now]);
  return true;
}

/** Newest first. */
export function listSalesLeads(): SalesLead[] {
  return all();
}

export function deleteSalesLead(id: string): boolean {
  const list = all();
  const next = list.filter((l) => l.id !== id);
  if (next.length === list.length) return false;
  persist(next);
  return true;
}
