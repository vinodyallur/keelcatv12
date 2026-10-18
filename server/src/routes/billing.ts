// Razorpay billing — upgrade a workspace to premium after the free run limit.
//
// Flow (client-driven, instant UI):
//   1) client calls POST /api/billing/order {plan} -> we create a Razorpay order
//      (with the tenant id + plan stashed in the order's `notes`)
//   2) client opens Razorpay Checkout with that order id
//   3) on success Checkout returns { order_id, payment_id, signature }
//   4) client calls POST /api/billing/verify -> we verify the signature and,
//      if valid, mark this tenant premium.
//
// Reliability backstop (server-to-server):
//   POST /api/billing/webhook  <- Razorpay calls this directly when a payment is
//   captured, independent of the user's browser. If the browser never came back
//   (tab closed, network dropped), the webhook still upgrades the workspace by
//   reading the tenant id out of the order `notes`.
//
// Setup: create a Razorpay account, grab API keys (Test or Live), then set
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
//   PREMIUM_PRICE_MONTHLY_INR  (optional, defaults to 999)
//   PREMIUM_PRICE_ANNUAL_INR   (optional, defaults to 9990 — ~2 months free)
//   RAZORPAY_WEBHOOK_SECRET    (optional but recommended — the webhook secret you
//                               set in the Razorpay dashboard for this endpoint)

import { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getBilling, setPremium, logAudit, type BillingInterval } from "../config/store.js";
import { currentTenantId, currentContext, runWithTenant } from "../auth/context.js";

export const billingRouter = Router();

const KEY_ID = process.env.RAZORPAY_KEY_ID?.trim();
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET?.trim();
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
const CURRENCY = "INR";

// Per-interval prices in rupees. Monthly keeps the historical default (999);
// annual defaults to ~2 months free.
const PRICE_MONTHLY_INR = Number(
  process.env.PREMIUM_PRICE_MONTHLY_INR ?? process.env.PREMIUM_PRICE_INR ?? 999,
);
const PRICE_ANNUAL_INR = Number(process.env.PREMIUM_PRICE_ANNUAL_INR ?? PRICE_MONTHLY_INR * 10);

function priceFor(interval: BillingInterval): number {
  return interval === "annual" ? PRICE_ANNUAL_INR : PRICE_MONTHLY_INR;
}

function normalizeInterval(v: unknown): BillingInterval {
  return v === "annual" ? "annual" : "monthly";
}

export function billingConfigured(): boolean {
  return Boolean(KEY_ID && KEY_SECRET);
}

// GET /api/billing — current plan/usage + checkout info for the UI.
billingRouter.get("/api/billing", (_req, res) => {
  res.json({
    ...getBilling(),
    configured: billingConfigured(),
    currency: CURRENCY,
    prices: { monthly: PRICE_MONTHLY_INR, annual: PRICE_ANNUAL_INR },
    // Back-compat: existing UI reads a single `priceInr` (monthly).
    priceInr: PRICE_MONTHLY_INR,
    keyId: KEY_ID ?? null, // publishable — safe to expose to the browser
  });
});

// POST /api/billing/order — create a Razorpay order for the upgrade.
// Body: { plan?: "monthly" | "annual" }
billingRouter.post("/api/billing/order", async (req, res) => {
  if (!billingConfigured()) return res.status(503).json({ error: "Payments are not configured on this server." });
  // Guests can't buy premium: their workspace is tied to a throwaway browser
  // cookie, so a purchase would be lost. Require a real account first.
  if (currentContext()?.provider === "guest") {
    return res.status(403).json({ error: "Please sign in with GitHub or Google before upgrading — guest workspaces are temporary.", signInRequired: true });
  }
  const billing = getBilling();
  if (billing.plan === "premium") return res.status(400).json({ error: "This workspace is already on premium." });
  const interval = normalizeInterval(req.body?.plan);
  const amountPaise = Math.round(priceFor(interval) * 100); // Razorpay works in paise
  if (!Number.isFinite(amountPaise) || amountPaise < 100) {
    // Razorpay's floor is 100 paise (₹1). A misconfigured price shouldn't reach the API.
    return res.status(400).json({ error: "Configured price is below the minimum chargeable amount (₹1)." });
  }
  const tenantId = currentTenantId();
  try {
    const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
    const r = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
      body: JSON.stringify({
        amount: amountPaise,
        currency: CURRENCY,
        receipt: `keelcat_${Date.now()}`,
        payment_capture: 1,
        // notes travel with the order and come back on the webhook — this is how
        // the browser-less webhook knows which tenant/plan to upgrade.
        notes: { product: "KeelCat Premium", tenantId, interval },
      }),
    });
    const order = (await r.json()) as { id?: string; amount?: number; error?: { description?: string } };
    if (!r.ok || !order.id) {
      // Surface an auth misconfiguration distinctly (bad/expired API keys).
      if (r.status === 401) {
        return res.status(401).json({ error: order.error?.description ?? "Razorpay rejected the API credentials (check RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)." });
      }
      return res.status(502).json({ error: order.error?.description ?? "Could not create payment order." });
    }
    res.json({ orderId: order.id, amount: order.amount, currency: CURRENCY, keyId: KEY_ID, interval });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// POST /api/billing/verify — verify the payment signature; upgrade on success.
// Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan? }
billingRouter.post("/api/billing/verify", (req, res) => {
  if (!billingConfigured()) return res.status(503).json({ error: "Payments are not configured." });
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body ?? {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: "Missing payment fields." });
  }
  // Razorpay signs `${order_id}|${payment_id}` with the key secret (HMAC-SHA256).
  const expected = createHmac("sha256", KEY_SECRET!).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(razorpay_signature));
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    logAudit("BILLING_VERIFY_FAILED", `Payment signature mismatch for order ${razorpay_order_id}.`);
    return res.status(400).json({ error: "Payment verification failed." });
  }
  const interval = normalizeInterval(req.body?.plan);
  setPremium(interval);
  logAudit("BILLING_UPGRADED", `Workspace upgraded to premium (${interval}, order ${razorpay_order_id}).`);
  res.json({ ok: true, billing: getBilling() });
});

// POST /api/billing/webhook — Razorpay server-to-server event. Public path
// (no session); authenticated by the webhook signature. Upgrades the tenant
// named in the order `notes`, so a paid workspace is upgraded even if the
// user's browser never returned to call /verify.
//
// Configure in Razorpay dashboard: Settings → Webhooks → add this URL, set a
// secret (RAZORPAY_WEBHOOK_SECRET), and subscribe to `payment.captured` and/or
// `order.paid`.
billingRouter.post("/api/billing/webhook", (req, res) => {
  if (!WEBHOOK_SECRET) {
    // Without a secret we can't trust the payload — accept quietly so Razorpay
    // doesn't retry forever, but do nothing.
    logAudit("BILLING_WEBHOOK_SKIPPED", "Received a billing webhook but RAZORPAY_WEBHOOK_SECRET is not set.");
    return res.status(200).json({ ok: true, skipped: "no webhook secret configured" });
  }
  const signature = req.headers["x-razorpay-signature"] as string | undefined;
  const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!signature || !raw) {
    logAudit("BILLING_WEBHOOK_REJECTED", "Missing signature or body on billing webhook.");
    return res.status(400).json({ error: "missing signature or body" });
  }
  const expected = createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    logAudit("BILLING_WEBHOOK_REJECTED", "Invalid signature on billing webhook.");
    return res.status(400).json({ error: "invalid signature" });
  }

  const event = req.body?.event as string | undefined;
  if (event !== "payment.captured" && event !== "order.paid") {
    return res.status(200).json({ ok: true, ignored: event ?? "unknown" });
  }

  // notes live on the entity; shape differs slightly between the two events.
  const entity =
    req.body?.payload?.payment?.entity ?? req.body?.payload?.order?.entity ?? {};
  const notes = entity.notes ?? {};
  const tenantId: string | undefined = notes.tenantId;
  const interval = normalizeInterval(notes.interval);
  const orderId: string = entity.order_id ?? entity.id ?? "unknown";

  if (!tenantId) {
    logAudit("BILLING_WEBHOOK_ORPHAN", `Billing webhook ${event} for order ${orderId} had no tenantId in notes.`);
    return res.status(200).json({ ok: true, note: "no tenantId in order notes" });
  }

  // Upgrade the correct workspace, outside any session context.
  runWithTenant({ tenantId }, () => {
    if (getBilling().plan !== "premium") {
      setPremium(interval);
      logAudit("BILLING_UPGRADED", `Workspace upgraded to premium via webhook (${interval}, order ${orderId}).`);
    }
  });
  res.status(200).json({ ok: true });
});
