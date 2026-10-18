import { useEffect, useState } from "react";
import { api, type BillingInfo } from "../api";

interface RazorpayInstance {
  open: () => void;
  on: (event: string, handler: (resp: unknown) => void) => void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

/** Load the Razorpay Checkout script once, on demand. */
function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

/**
 * Upgrade modal. Fetches billing info, then runs the Razorpay Checkout flow:
 * create order → open checkout → verify signature → mark premium. `onDone` is
 * called after a successful upgrade so the parent can refresh config.
 */
export default function Upgrade({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [plan, setPlan] = useState<"monthly" | "annual">("annual");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    api.billing.get().then(setInfo).catch((e) => setError((e as Error).message));
    // Guests must sign in before they can buy — a guest workspace is temporary.
    api.auth.config().then((a) => setIsGuest(a.user?.provider === "guest")).catch(() => {});
  }, []);

  async function upgrade() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await loadRazorpay();
      if (!ok) throw new Error("Couldn't load the payment window. Check your connection and try again.");
      const order = await api.billing.order(plan);
      const rzp = new window.Razorpay!({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: "KeelCat",
        description: `KeelCat Premium — ${plan === "annual" ? "annual" : "monthly"}, unlimited runs`,
        theme: { color: "#a8ff53" },
        handler: async (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            await api.billing.verify({ ...resp, plan: order.interval });
            onDone();
          } catch (e) {
            setError((e as Error).message || "Payment verification failed.");
            setBusy(false);
          }
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      // Surface a failed payment (declined card, expired, etc.) to the user.
      rzp.on("payment.failed", (resp: unknown) => {
        const desc = (resp as { error?: { description?: string } })?.error?.description;
        setError(desc || "Payment failed. Please try again or use a different method.");
        setBusy(false);
      });
      rzp.open();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const monthlyInr = info?.prices?.monthly ?? info?.priceInr ?? 0;
  const annualInr = info?.prices?.annual ?? monthlyInr * 10;
  const selectedInr = plan === "annual" ? annualInr : monthlyInr;
  const price = info ? `₹${selectedInr.toLocaleString("en-IN")}` : "…";
  // Effective per-month cost when paying annually, for the savings hint.
  const annualPerMonth = Math.round(annualInr / 12);
  const annualSavingPct = monthlyInr > 0 ? Math.round((1 - annualInr / (monthlyInr * 12)) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="panel relative w-full max-w-md p-8">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-content-muted transition-all hover:text-content hover:border-line-strong"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-4 w-4">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">Upgrade</div>
        <h2 className="mt-2 text-[24px] font-bold tracking-tighter2 text-content">KeelCat Premium</h2>

        {isGuest ? (
          <>
            <p className="mt-2 text-[14px] leading-relaxed text-content-muted">
              You're browsing as a guest. Guest workspaces are temporary and saved only in this browser —
              sign in with GitHub or Google first so your premium plan (and your repos) stick.
            </p>
            <div className="mt-6 space-y-3">
              <a
                href={api.auth.loginUrl("github")}
                className="inline-flex w-full items-center justify-center gap-2.5 rounded-xl bg-content px-4 py-3 text-[15px] font-semibold text-canvas transition hover:opacity-90"
              >
                <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
                </svg>
                Sign in with GitHub
              </a>
              <a
                href={api.auth.loginUrl("google")}
                className="inline-flex w-full items-center justify-center gap-2.5 rounded-xl border border-line bg-surface px-4 py-3 text-[15px] font-semibold text-content transition hover:border-line-strong"
              >
                <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
                  <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
                  <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 009 18z" />
                  <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 010-3.44V4.95H.96a9 9 0 000 8.1l3.01-2.33z" />
                  <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.42 0 9 0A9 9 0 00.96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
                </svg>
                Sign in with Google
              </a>
            </div>
            <p className="mt-4 text-center text-[11px] text-content-faint">Your free-run progress carries into your account.</p>
          </>
        ) : (
        <>
        <p className="mt-2 text-[14px] leading-relaxed text-content-muted">
          {info && info.plan === "free" ? (
            <>You've used {info.runsUsed} of {info.freeLimit} free runs. Upgrade for unlimited runs.</>
          ) : (
            <>Unlock unlimited runs across all your repos.</>
          )}
        </p>

        {/* Interval toggle */}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setPlan("monthly")}
            className={`rounded-xl border p-3 text-left transition-all ${
              plan === "monthly" ? "border-accent bg-accent-soft" : "border-line bg-white/[0.02] hover:border-line-strong"
            }`}
          >
            <div className="text-[12px] font-semibold uppercase tracking-wide text-content-muted">Monthly</div>
            <div className="mt-1 text-[18px] font-bold text-content">₹{monthlyInr.toLocaleString("en-IN")}<span className="text-[12px] font-normal text-content-muted"> /mo</span></div>
          </button>
          <button
            type="button"
            onClick={() => setPlan("annual")}
            className={`relative rounded-xl border p-3 text-left transition-all ${
              plan === "annual" ? "border-accent bg-accent-soft" : "border-line bg-white/[0.02] hover:border-line-strong"
            }`}
          >
            {annualSavingPct > 0 && (
              <span className="absolute right-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-canvas">
                SAVE {annualSavingPct}%
              </span>
            )}
            <div className="text-[12px] font-semibold uppercase tracking-wide text-content-muted">Annual</div>
            <div className="mt-1 text-[18px] font-bold text-content">₹{annualPerMonth.toLocaleString("en-IN")}<span className="text-[12px] font-normal text-content-muted"> /mo</span></div>
          </button>
        </div>

        <div className="mt-3 rounded-xl border border-line bg-white/[0.02] p-5">
          <div className="flex items-baseline gap-1">
            <span className="text-[32px] font-bold text-content">{price}</span>
            <span className="text-[13px] text-content-muted">{plan === "annual" ? "/ year" : "/ month"}</span>
          </div>
          {plan === "annual" && (
            <p className="mt-1 text-[12px] text-content-faint">Billed once a year · ₹{annualPerMonth.toLocaleString("en-IN")}/mo effective</p>
          )}
          <ul className="mt-4 space-y-2 text-[13px] text-content-muted">
            <li>✓ Unlimited runs and pull requests</li>
            <li>✓ All connected repos and accounts</li>
            <li>✓ Scheduled watching &amp; God Mode</li>
            <li>✓ Security scanning</li>
          </ul>
        </div>

        {error && <p className="mt-4 text-[12px] text-rose">{error}</p>}
        {info && !info.configured && (
          <p className="mt-4 text-[12px] text-amber">Payments aren't configured on this server yet.</p>
        )}

        <button
          onClick={upgrade}
          disabled={busy || !info?.configured}
          className="btn-accent mt-6 w-full disabled:opacity-50"
        >
          {busy ? "Opening secure checkout…" : `Upgrade for ${price}${plan === "annual" ? "/yr" : "/mo"}`}
        </button>
        <p className="mt-3 text-center text-[11px] text-content-faint">Secure payment via Razorpay. Cancel anytime.</p>
        </>
        )}
      </div>
    </div>
  );
}
