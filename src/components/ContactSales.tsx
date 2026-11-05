import { useState, type ChangeEvent, type FormEvent } from "react";
import { api } from "../api";

/** Enterprise "Contact sales" form, styled like the Upgrade modal. */
export default function ContactSales({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", licenses: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const update = (key: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.sales.contact({ ...form, licenses: Number(form.licenses) });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="panel relative max-h-[90vh] w-full max-w-md overflow-y-auto p-8">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-content-muted transition-all hover:text-content hover:border-line-strong"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-4 w-4">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">Enterprise</div>
        <h2 className="mt-2 text-[24px] font-bold tracking-tighter2 text-content">Contact sales</h2>

        {sent ? (
          <>
            <p className="mt-2 text-[14px] leading-relaxed text-content-muted">
              Thanks, {form.name.trim().split(/\s+/)[0]}. We've got your request for {Number(form.licenses).toLocaleString("en-IN")}{" "}
              license{Number(form.licenses) === 1 ? "" : "s"} and will reach out at <span className="text-content">{form.email.trim()}</span>.
            </p>
            <button onClick={onClose} className="btn-outline mt-6 w-full">Close</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="mt-2 text-[14px] leading-relaxed text-content-muted">
              Tell us about your team and we'll get back to you with volume pricing.
            </p>

            <div className="mt-5 space-y-3">
              <label className="block">
                <span className="text-[12px] font-medium text-content-muted">Full name</span>
                <input className="field mt-1" required maxLength={100} autoComplete="name" value={form.name} onChange={update("name")} />
              </label>
              <label className="block">
                <span className="text-[12px] font-medium text-content-muted">Work email</span>
                <input className="field mt-1" type="email" required maxLength={254} autoComplete="email" placeholder="you@company.com" value={form.email} onChange={update("email")} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[12px] font-medium text-content-muted">Phone number</span>
                  <input className="field mt-1" type="tel" required maxLength={25} autoComplete="tel" placeholder="+91 98765 43210" value={form.phone} onChange={update("phone")} />
                </label>
                <label className="block">
                  <span className="text-[12px] font-medium text-content-muted">Licenses needed</span>
                  <input className="field mt-1" type="number" required min={1} max={100000} step={1} inputMode="numeric" placeholder="e.g. 25" value={form.licenses} onChange={update("licenses")} />
                </label>
              </div>
              <label className="block">
                <span className="text-[12px] font-medium text-content-muted">Company <span className="text-content-faint">(optional)</span></span>
                <input className="field mt-1" maxLength={120} autoComplete="organization" value={form.company} onChange={update("company")} />
              </label>
              <label className="block">
                <span className="text-[12px] font-medium text-content-muted">Anything else? <span className="text-content-faint">(optional)</span></span>
                <textarea className="field mt-1 h-20 resize-none" maxLength={2000} placeholder="Internal APIs, SSO, timeline…" value={form.message} onChange={update("message")} />
              </label>
            </div>

            {error && <p className="mt-4 text-[12px] text-rose">{error}</p>}

            <button type="submit" disabled={busy} className="btn-accent mt-6 w-full disabled:opacity-50">
              {busy ? "Sending…" : "Send to sales"}
            </button>
            <p className="mt-3 text-center text-[11px] text-content-faint">We only use these details to reply to your request.</p>
          </form>
        )}
      </div>
    </div>
  );
}
