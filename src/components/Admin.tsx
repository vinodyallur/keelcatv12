import { useEffect, useState } from "react";
import { api, type AdminOverview, type AdminSettings, type DefaultLlmView, type SalesLead } from "../api";
import { Panel, SectionHead, Chip, Switch, Spinner } from "./ui";

const META_API_URL = "https://api.meta.ai/v1";
const META_OPENROUTER_URL = "https://openrouter.ai/api/v1";
const META_API = "Meta Model API (dev.meta.ai key), strongest first";
const OPENROUTER = "OpenRouter (sk-or- key)";
const OTHER = "Other";
const AI_PRESETS: Record<string, { group: string; label: string; baseUrl: string; model: string }> = {
  "meta-api-wonder": { group: META_API, label: "Muse Wonder 1.0 (most capable, $4 / $20)", baseUrl: META_API_URL, model: "muse-wonder-1.0" },
  "meta-api-spark-1.3": { group: META_API, label: "Muse Spark 1.3 (recommended, $1.25 / $4.25)", baseUrl: META_API_URL, model: "muse-spark-1.3" },
  "meta-api-spark-1.3-contributor": { group: META_API, label: "Muse Spark 1.3 Contributor ($0.10 / $0.20, Meta may train on prompts)", baseUrl: META_API_URL, model: "muse-spark-1.3-contributor" },
  "meta-api-spark-1.2": { group: META_API, label: "Muse Spark 1.2 ($1.25 / $4.25)", baseUrl: META_API_URL, model: "muse-spark-1.2" },
  "meta-api-spark-1.2-contributor": { group: META_API, label: "Muse Spark 1.2 Contributor ($0.10 / $0.20, Meta may train on prompts)", baseUrl: META_API_URL, model: "muse-spark-1.2-contributor" },
  "meta-api-spark-1.1": { group: META_API, label: "Muse Spark 1.1 (oldest, $1.25 / $4.25)", baseUrl: META_API_URL, model: "muse-spark-1.1" },
  "meta-muse": { group: OPENROUTER, label: "Meta Muse Spark 1.3", baseUrl: META_OPENROUTER_URL, model: "meta/muse-spark-1.3" },
  "meta-muse-contributor": { group: OPENROUTER, label: "Meta Muse Spark 1.3 Contributor (lowest cost)", baseUrl: META_OPENROUTER_URL, model: "meta/muse-spark-1.3-contributor" },
  "meta-muse-open": { group: OPENROUTER, label: "Meta Muse Spark Open (coding)", baseUrl: META_OPENROUTER_URL, model: "meta/muse-spark-open" },
  "meta-muse-wonder": { group: OPENROUTER, label: "Meta Muse Wonder", baseUrl: META_OPENROUTER_URL, model: "meta/muse-wonder" },
  "meta-muse-glimmer": { group: OPENROUTER, label: "Meta Muse Glimmer 30B", baseUrl: META_OPENROUTER_URL, model: "meta/muse-glimmer-30b" },
  "meta-llama-maverick": { group: OPENROUTER, label: "Meta Llama 4 Maverick", baseUrl: META_OPENROUTER_URL, model: "meta-llama/llama-4-maverick" },
  "meta-llama-scout": { group: OPENROUTER, label: "Meta Llama 4 Scout", baseUrl: META_OPENROUTER_URL, model: "meta-llama/llama-4-scout" },
  "meta-llama-3.3-70b": { group: OPENROUTER, label: "Meta Llama 3.3 70B", baseUrl: META_OPENROUTER_URL, model: "meta-llama/llama-3.3-70b-instruct" },
  "meta-llama-3.1-8b": { group: OPENROUTER, label: "Meta Llama 3.1 8B (cheapest)", baseUrl: META_OPENROUTER_URL, model: "meta-llama/llama-3.1-8b-instruct" },
  custom: { group: OTHER, label: "Meta model on another OpenAI-compatible host", baseUrl: "", model: "" },
};

// Save and Test both work with the switch off, so say when nobody gets the default yet.
function offReason(v: DefaultLlmView): string | null {
  if (!v.enabled) return "the default AI is switched off, so nobody uses it yet. Turn on the switch at the top right, then Save.";
  if (!v.forGuests && !v.forUsers) return "Guests and Signed-in users are both off, so nobody uses it yet.";
  return null;
}

function savedStatus(v: DefaultLlmView): { ok: boolean; text: string } {
  const off = offReason(v);
  if (off) return { ok: false, text: `Saved, but ${off}` };
  const who = v.forGuests && v.forUsers ? "Guests and signed-in users" : v.forGuests ? "Guests" : "Signed-in users";
  return { ok: true, text: `Saved and on. ${who} without their own key now use it. Click Test saved settings to check it answers.` };
}

function DefaultAiPanel() {
  const [view, setView] = useState<DefaultLlmView | null>(null);
  const [draft, setDraft] = useState<DefaultLlmView | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function apply(v: DefaultLlmView) {
    setView(v);
    setDraft(v.baseUrl ? v : { ...v, baseUrl: AI_PRESETS[v.provider]?.baseUrl ?? "" });
    setApiKey("");
  }

  useEffect(() => {
    api.admin.defaultLlm.get().then(apply).catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, []);

  async function act(fn: () => Promise<string | { ok: boolean; text: string }>) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg(typeof r === "string" ? { ok: true, text: r } : r);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    act(async () => {
      const { enabled, provider, baseUrl, model, forGuests, forUsers, dailyLimitPerWorkspace, dailyLimitTotal } = draft!;
      const saved = await api.admin.defaultLlm.save({
        enabled, provider, baseUrl, model, forGuests, forUsers, dailyLimitPerWorkspace, dailyLimitTotal,
        apiKey: apiKey || undefined,
      });
      apply(saved);
      return savedStatus(saved);
    });
  const test = () =>
    act(async () => {
      const { sample } = await api.admin.defaultLlm.test();
      const off = offReason(view!);
      return off ? { ok: false, text: `Connected, but ${off}` } : `Connected. The model replied: "${sample}"`;
    });
  const remove = () => {
    if (!confirm("Remove the default AI and delete its key? Workspaces without their own key will use basic parsing.")) return;
    act(async () => {
      apply(await api.admin.defaultLlm.remove());
      return "Removed.";
    });
  };

  if (!view || !draft) {
    return <Panel className="p-6 text-[13px] text-content-muted">{msg ? msg.text : <Spinner label="Loading default AI…" />}</Panel>;
  }

  return (
    <Panel className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <div className="text-[15px] font-semibold text-content">Default Meta model for users</div>
          <div className="mt-1 text-[12px] text-content-muted">
            Workspaces without their own key use this Meta model (KeelCat AI) automatically. Users see only the model name, never its URL or key, and can switch to their own key anytime. Only admins can change it.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Chip tone={view.enabled ? "emerald" : "neutral"}>{view.enabled ? "on" : "off"}</Chip>
          <Switch on={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} />
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="text-[12px] font-medium text-content-muted">Provider</span>
          <select
            className="field mt-1"
            value={draft.provider}
            onChange={(e) => {
              const p = AI_PRESETS[e.target.value];
              setDraft({ ...draft, provider: e.target.value, baseUrl: p?.baseUrl ?? draft.baseUrl, model: p?.model || draft.model });
            }}
          >
            {[META_API, OPENROUTER, OTHER].map((group) => (
              <optgroup key={group} label={group}>
                {Object.entries(AI_PRESETS)
                  .filter(([, p]) => p.group === group)
                  .map(([key, p]) => (
                    <option key={key} value={key}>{p.label}</option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[12px] font-medium text-content-muted">Model</span>
          <input className="field mt-1" value={draft.model} placeholder="auto" onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
        </label>
        <label className="block">
          <span className="text-[12px] font-medium text-content-muted">API key</span>
          <input
            type="password"
            autoComplete="new-password"
            className="field mt-1"
            value={apiKey}
            placeholder={view.hasKey ? `saved, ends in ${view.keyLast4} (paste to replace)` : "paste key"}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
      </div>
      <label className="mt-4 block">
        <span className="text-[12px] font-medium text-content-muted">Base URL (OpenAI-compatible, usually ending in /v1)</span>
        <input
          className="field mt-1 font-mono text-[12px]"
          value={draft.baseUrl}
          placeholder="https://host/v1"
          onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
        />
        {draft.provider === "custom" && (
          <span className="mt-1 block text-[11px] text-content-faint">
            Use the OpenAI-compatible URL of the host serving your Meta model, for example Meta Model API, Fireworks, Baseten or Modal. This server must be able to reach it.
          </span>
        )}
        {AI_PRESETS[draft.provider]?.group === META_API && (
          <span className="mt-1 block text-[11px] text-content-faint">
            Bills your Meta Model API credits. Create a key at dev.meta.ai → API keys. Prices are input / output per 1M tokens; Contributor models are much cheaper, but Meta may use the prompts (users' changelogs and code) to train its models.
          </span>
        )}
      </label>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-white/[0.02] p-3.5">
          <div>
            <div className="text-[13px] font-medium text-content">Guests</div>
            <div className="text-[11px] text-content-faint">Visitors who continue as a guest</div>
          </div>
          <Switch on={draft.forGuests} onChange={(v) => setDraft({ ...draft, forGuests: v })} />
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-white/[0.02] p-3.5">
          <div>
            <div className="text-[13px] font-medium text-content">Signed-in users</div>
            <div className="text-[11px] text-content-faint">GitHub and Google accounts, including yours</div>
          </div>
          <Switch on={draft.forUsers} onChange={(v) => setDraft({ ...draft, forUsers: v })} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-[12px] font-medium text-content-muted">Daily AI calls per workspace (0 = unlimited)</span>
          <input type="number" min={0} className="field mt-1" value={draft.dailyLimitPerWorkspace}
            onChange={(e) => setDraft({ ...draft, dailyLimitPerWorkspace: Number(e.target.value) })} />
        </label>
        <label className="block">
          <span className="text-[12px] font-medium text-content-muted">Daily AI calls in total (0 = unlimited)</span>
          <input type="number" min={0} className="field mt-1" value={draft.dailyLimitTotal}
            onChange={(e) => setDraft({ ...draft, dailyLimitTotal: Number(e.target.value) })} />
        </label>
      </div>
      <p className="mt-2 text-[11px] text-content-faint">
        {view.usedToday} call{view.usedToday === 1 ? "" : "s"} today. Limits protect your key: once reached, users fall back to basic parsing until midnight UTC.
      </p>

      {msg && <p className={`mt-4 text-[12px] ${msg.ok ? "text-emerald" : "text-rose"}`}>{msg.text}</p>}

      <div className="mt-5 flex flex-wrap gap-2">
        <button className="btn-accent" onClick={save} disabled={busy}>{busy ? "Working…" : "Save"}</button>
        <button className="btn-outline" onClick={test} disabled={busy || !view.hasKey}>Test saved settings</button>
        {(view.hasKey || view.baseUrl) && (
          <button className="btn-ghost text-rose" onClick={remove} disabled={busy}>Remove</button>
        )}
      </div>
    </Panel>
  );
}

function SalesLeadsPanel() {
  const [leads, setLeads] = useState<SalesLead[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.admin.salesLeads.list().then(setLeads).catch((e) => setError((e as Error).message));
  }, []);

  async function remove(id: string) {
    if (!confirm("Delete this inquiry? This cannot be undone.")) return;
    try {
      await api.admin.salesLeads.remove(id);
      setLeads((list) => list?.filter((l) => l.id !== id) ?? list);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Panel className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[15px] font-semibold text-content">Sales inquiries</div>
        <Chip tone="neutral">{leads?.length ?? 0} total</Chip>
      </div>
      {error && <p className="mb-3 text-[12px] text-rose">{error}</p>}
      {!leads ? (
        !error && <Spinner label="Loading inquiries…" />
      ) : leads.length === 0 ? (
        <p className="text-[13px] text-content-muted">No inquiries yet. They appear here when someone uses Contact sales on the Pricing page.</p>
      ) : (
        <div className="space-y-2">
          {leads.map((l) => (
            <div key={l.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line bg-white/[0.02] p-3.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-content">{l.name}</span>
                  {l.company && <span className="text-[12px] text-content-muted">· {l.company}</span>}
                  <Chip tone="accent">{l.licenses.toLocaleString("en-IN")} license{l.licenses === 1 ? "" : "s"}</Chip>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-[12px]">
                  <a className="text-accent hover:underline" href={`mailto:${l.email}`}>{l.email}</a>
                  <a className="text-accent hover:underline" href={`tel:${l.phone.replace(/[^\d+]/g, "")}`}>{l.phone}</a>
                </div>
                {l.message && <p className="mt-2 whitespace-pre-wrap break-words text-[12px] text-content-muted">{l.message}</p>}
                <div className="mt-1 text-[11px] text-content-faint">
                  {new Date(l.at).toLocaleString()} · {l.tenantId.startsWith("guest_") ? "guest" : "signed in"}{l.login ? ` as ${l.login}` : ""}
                </div>
              </div>
              <button className="btn-ghost text-[12px] text-rose" onClick={() => remove(l.id)}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

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
      <SectionHead eyebrow="Admin" title="Admin console" desc="Owner-only controls for billing, the default AI, sales inquiries and workspaces." />

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

      <DefaultAiPanel />

      <SalesLeadsPanel />

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
