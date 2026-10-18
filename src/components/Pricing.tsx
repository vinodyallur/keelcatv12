import { useState } from "react";
import { Panel, Chip } from "./ui";
import Upgrade from "./Upgrade";
import { api, type PublicConfig } from "../api";

/**
 * Dedicated in-app pricing page. Two payment rails:
 *   • India        → Razorpay (INR), fully live via the Upgrade modal.
 *   • International → crypto (USD), coming soon (needs a provider + keys).
 * Enterprise is a contact-sales tier. Guests are gated to sign-in inside the
 * Upgrade modal itself.
 */
export default function Pricing({ cfg, onUpgraded }: { cfg: PublicConfig | null; onUpgraded?: () => void }) {
  const [region, setRegion] = useState<"in" | "intl">("in");
  const [interval, setInterval] = useState<"monthly" | "annual">("annual");
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [cryptoNote, setCryptoNote] = useState(false);

  const plan = cfg?.billing?.plan ?? "free";
  const isPremium = plan === "premium";

  // Display prices. INR is what Razorpay actually charges; USD is the
  // international list price (settled in crypto once that rail is live).
  const inr = { monthly: 999, annual: 9990 };
  const usd = { monthly: 15, annual: 144 };
  const priceLabel =
    region === "in"
      ? interval === "annual"
        ? `₹${inr.annual.toLocaleString("en-IN")}`
        : `₹${inr.monthly.toLocaleString("en-IN")}`
      : interval === "annual"
        ? `$${usd.annual}`
        : `$${usd.monthly}`;
  const perLabel = interval === "annual" ? "/ year" : "/ month";
  const effMonthly =
    region === "in"
      ? `₹${Math.round(inr.annual / 12).toLocaleString("en-IN")}/mo`
      : `$${Math.round((usd.annual / 12) * 100) / 100}/mo`;

  function onProCta() {
    if (region === "in") setShowUpgrade(true);
    else setCryptoNote(true);
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* Header */}
      <div className="text-center">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">Pricing</div>
        <h1 className="mt-2 text-[28px] font-bold tracking-tighter2 text-content sm:text-[34px]">Simple, per-developer pricing</h1>
        <p className="mx-auto mt-2 max-w-md text-[14px] text-content-muted">
          Start free. Upgrade when KeelCat is saving your team time. Cancel anytime.
        </p>
      </div>

      {/* Region + interval toggles */}
      <div className="mt-6 flex flex-col items-center gap-3">
        <div className="inline-flex rounded-full border border-line bg-surface p-1 text-[13px]">
          <button
            onClick={() => setRegion("in")}
            className={`rounded-full px-4 py-1.5 font-medium transition ${region === "in" ? "bg-accent text-canvas" : "text-content-muted hover:text-content"}`}
          >
            🇮🇳 India (₹)
          </button>
          <button
            onClick={() => setRegion("intl")}
            className={`rounded-full px-4 py-1.5 font-medium transition ${region === "intl" ? "bg-accent text-canvas" : "text-content-muted hover:text-content"}`}
          >
            🌍 International ($)
          </button>
        </div>
        <div className="inline-flex rounded-full border border-line bg-surface p-1 text-[12px]">
          <button
            onClick={() => setInterval("monthly")}
            className={`rounded-full px-3.5 py-1.5 font-medium transition ${interval === "monthly" ? "bg-content text-canvas" : "text-content-muted hover:text-content"}`}
          >
            Monthly
          </button>
          <button
            onClick={() => setInterval("annual")}
            className={`rounded-full px-3.5 py-1.5 font-medium transition ${interval === "annual" ? "bg-content text-canvas" : "text-content-muted hover:text-content"}`}
          >
            Annual · save 20%
          </button>
        </div>
      </div>

      {/* Tiers */}
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {/* Free */}
        <Panel className="flex flex-col p-6">
          <div className="text-[15px] font-semibold text-content">Free</div>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-[38px] font-bold text-content">{region === "in" ? "₹0" : "$0"}</span>
          </div>
          <p className="mt-1 text-[12px] text-content-faint">{cfg?.billing?.freeLimit ?? 10} runs to try it out.</p>
          <ul className="mt-5 flex-1 space-y-2 text-[13px] text-content-muted">
            <li>✓ {cfg?.billing?.freeLimit ?? 10} pipeline runs</li>
            <li>✓ Detect → fix → reviewable PR</li>
            <li>✓ One connected account</li>
            <li>✓ Community support</li>
          </ul>
          <button disabled className="btn-outline mt-6 w-full opacity-60">
            {plan === "free" ? "Current plan" : "Included"}
          </button>
        </Panel>

        {/* Pro — highlighted */}
        <Panel className="relative flex flex-col p-6 ring-1 ring-inset ring-accent/40">
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1 text-[11px] font-bold text-canvas">MOST POPULAR</span>
          <div className="flex items-center justify-between">
            <div className="text-[15px] font-semibold text-content">Pro</div>
            {isPremium && <Chip tone="accent">Active</Chip>}
          </div>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-[38px] font-bold text-content">{priceLabel}</span>
            <span className="text-[13px] text-content-muted">{perLabel}</span>
          </div>
          <p className="mt-1 text-[12px] text-content-faint">
            {interval === "annual" ? `Billed yearly · ${effMonthly} effective` : "Billed monthly"}
            {region === "in" ? " · via Razorpay" : " · pay with crypto"}
          </p>
          <ul className="mt-5 flex-1 space-y-2 text-[13px] text-content-muted">
            <li>✓ Unlimited runs &amp; pull requests</li>
            <li>✓ All repos and connected accounts</li>
            <li>✓ Scheduled watching &amp; God Mode</li>
            <li>✓ Security scanning</li>
            <li>✓ Priority support</li>
          </ul>
          <button onClick={onProCta} disabled={isPremium} className="btn-accent mt-6 w-full disabled:opacity-50">
            {isPremium ? "You're on Pro" : region === "in" ? "Upgrade" : "Pay with crypto"}
          </button>
        </Panel>

        {/* Enterprise */}
        <Panel className="flex flex-col p-6">
          <div className="text-[15px] font-semibold text-content">Enterprise</div>
          <div className="mt-3 flex items-baseline gap-1">
            <span className="text-[38px] font-bold text-content">Custom</span>
          </div>
          <p className="mt-1 text-[12px] text-content-faint">For teams with many repos or internal APIs.</p>
          <ul className="mt-5 flex-1 space-y-2 text-[13px] text-content-muted">
            <li>✓ Internal / private APIs</li>
            <li>✓ SSO &amp; access policies</li>
            <li>✓ Dedicated support &amp; SLA</li>
            <li>✓ Volume &amp; multi-seat pricing</li>
          </ul>
          <a href="mailto:hello@keelcat.in?subject=KeelCat%20Enterprise" className="btn-outline mt-6 w-full text-center">
            Contact sales
          </a>
        </Panel>
      </div>

      <p className="mt-6 text-center text-[12px] text-content-faint">
        Indian customers pay in ₹ via Razorpay (UPI, cards, netbanking). International customers pay in crypto.
      </p>

      {showUpgrade && (
        <Upgrade
          onClose={() => setShowUpgrade(false)}
          onDone={() => {
            setShowUpgrade(false);
            onUpgraded?.();
          }}
        />
      )}

      {cryptoNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setCryptoNote(false)} />
          <div className="panel relative w-full max-w-md p-8 text-center">
            <h2 className="text-[20px] font-bold tracking-tighter2 text-content">Crypto checkout is coming</h2>
            <p className="mt-3 text-[14px] leading-relaxed text-content-muted">
              International payments in crypto (BTC/ETH/USDC) are being set up. In the meantime, email
              <a href="mailto:hello@keelcat.in?subject=KeelCat%20Pro%20(crypto)" className="text-accent hover:underline"> hello@keelcat.in</a> and
              we'll get you onto Pro.
            </p>
            <button onClick={() => setCryptoNote(false)} className="btn-outline mt-6 w-full">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
