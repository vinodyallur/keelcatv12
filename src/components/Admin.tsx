import { useEffect, useState } from "react";
import { api, type AdminOverview, type AdminSettings } from "../api";
import { Panel, SectionHead, Chip, Switch, Spinner } from "./ui";

/**
 * Owner-only admin console. Toggle the billing paywall, tune the free limit and
 * price, and manage every tenant workspace (grant/revoke premium, delete).
 */
export default function Admin() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<AdminSettings | null>(null);

  function load() {
    api.admin
      .overview()
      .then((d) => {
        setData(d);
        setDraft(d.settings);
      })
      .catch((e) => setError((e as Error).message));
  }
  useEffect(load, []);

  async function saveSettings() {
    if (!draft) return;
    setSaving(true);
    try {
      const s = await api.admin.setSettings(draft);
      setDraft(s);
      setData((d) => (d ? { ...d, settings: s } : d));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function setPlan(id: string, plan: "free" | "premium") {
    await api.admin.setTenantPlan(id, plan).catch((e) => setError((e as Error).message));
    load();
  }
  async function remove(id: string) {
    if (!confirm("Delete this workspace and all its data? This cannot be undone.")) return;
    await api.admin.deleteTenant(id).catch((e) => setError((e as Error).message));
    load();
  }

  if (error) return <Panel className="border-rose/30 bg-rose-soft p-4 text-[13px] text-rose">{error}</Panel>;
  if (!data || !draft) return <div className="py-20 text-center"><Spinner label="Loading admin…" /></div>;

  return (
    <div className="animate-fade-up space-y-6">
      <SectionHead eyebrow="Admin" title="Admin console" desc="Owner-only controls for billing and workspaces." />

      {/* Billing settings */}
      <Panel className="p-6">
        <div className="text-[15px] font-semibold text-content">Billing</div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[14px] font-medium text-content">Paywall enabled</div>
            <div className="text-[12px] text-content-muted">Off = everyone gets unlimited runs (no upgrade required).</div>
          </div>
          <Switch on={draft.billingEnabled} onChange={(v) => setDraft({ ...draft, billingEnabled: v })} />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
          <div>
            <div className="text-[14px] font-medium text-content">Let users choose where runs execute</div>
            <div className="text-[12px] text-content-muted">
              Off = runs always execute on the visitor's machine (in their browser). On = show the “On my machine / On the server” choice in Changelog.
            </div>
          </div>
          <Switch on={draft.allowServerRun} onChange={(v) => setDraft({ ...draft, allowServerRun: v })} />
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-[12px] font-medium text-content-muted">Free runs before upgrade</span>
            <input
              type="number"
              min={0}
              className="field mt-1"
              value={draft.freeRunLimit}
              onChange={(e) => setDraft({ ...draft, freeRunLimit: Number(e.target.value) })}
            />
          </label>
          <label className="block">
            <span className="text-[12px] font-medium text-content-muted">Premium price (₹ INR, charged via Razorpay)</span>
            <input
              type="number"
              min={1}
              className="field mt-1"
              value={draft.priceInr}
              onChange={(e) => setDraft({ ...draft, priceInr: Number(e.target.value) })}
            />
          </label>
        </div>
        <button className="btn-accent mt-5" onClick={saveSettings} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      </Panel>

      {/* Tenants */}
      <Panel className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[15px] font-semibold text-content">Workspaces</div>
          <Chip tone="neutral">{data.tenantCount} total</Chip>
        </div>
        <div className="space-y-2">
          {data.tenants.map((t) => {
            const label =
              t.accounts.map((a) => a.login).filter(Boolean).join(", ") ||
              (t.isOwner ? "Owner" : t.id.startsWith("guest_") ? "Guest" : t.id);
            return (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white/[0.02] p-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-[13px] text-content">{label}</span>
                    {t.isOwner && <Chip tone="accent">owner</Chip>}
                    <Chip tone={t.plan === "premium" ? "emerald" : "neutral"}>{t.plan}</Chip>
                  </div>
                  <div className="mt-0.5 text-[11px] text-content-faint">
                    {t.id} · {t.runsUsed} runs · {t.repoCount} repo{t.repoCount === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {t.plan === "premium" ? (
                    <button className="btn-ghost text-[12px]" onClick={() => setPlan(t.id, "free")}>Revoke premium</button>
                  ) : (
                    <button className="btn-outline text-[12px]" onClick={() => setPlan(t.id, "premium")}>Grant premium</button>
                  )}
                  {!t.isOwner && (
                    <button className="btn-ghost text-[12px] text-rose" onClick={() => remove(t.id)}>Delete</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
