import { useEffect, useState } from "react";
import { api, type PublicConfig, type WatchSource } from "../api";
import type { Skin } from "../App";
import { Panel, SectionHead, Switch, Chip, Spinner } from "./ui";

const INTERVALS = [1, 2, 5, 15, 30, 60];

export default function SettingsPage({
  onConfig,
  skin,
  onSkin,
}: {
  onConfig?: (c: PublicConfig) => void;
  skin?: Skin;
  onSkin?: (s: Skin) => void;
}) {
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [saved, setSaved] = useState(false);

  function apply(c: PublicConfig) {
    setCfg(c);
    onConfig?.(c);
  }
  useEffect(() => {
    api.config.get().then(apply).catch(() => {});
  }, []);

  function flash() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  }

  async function patch(p: Partial<PublicConfig["settings"]>) {
    if (!cfg) return;
    setCfg({ ...cfg, settings: { ...cfg.settings, ...p } });
    const updated = await api.config.setSettings(p);
    apply(updated);
    flash();
  }

  async function setGodMode(v: boolean) {
    if (!cfg) return;
    setCfg({ ...cfg, settings: { ...cfg.settings, godMode: v } });
    const updated = await api.auto.setGodMode(v);
    apply(updated);
    flash();
  }

  if (!cfg) return <Panel className="flex h-40 items-center justify-center text-sm text-content-faint">Loading…</Panel>;

  return (
    <div className="animate-fade-up space-y-6">
      <SectionHead
        eyebrow="Control"
        title="Settings"
        desc="Full control over how KeelCat behaves — automation, reliability, and where it sends notifications."
        right={saved ? <Chip tone="emerald">saved</Chip> : undefined}
      />

      {/* Appearance */}
      {skin && onSkin && <AppearancePanel skin={skin} onSkin={onSkin} />}

      {/* God Mode */}
      <GodModePanel cfg={cfg} setGodMode={setGodMode} patch={patch} />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Pull requests */}
        <Panel className="p-6">
          <h3 className="text-[14px] font-semibold text-content">Pull requests</h3>
          <Row label="Auto-open pull requests" desc="Open a PR automatically when fixes are generated. Off = dry run (diffs only).">
            <Switch on={cfg.settings.autoOpenPr} onChange={(v) => patch({ autoOpenPr: v })} />
          </Row>
        </Panel>

        {/* Reliability */}
        <Panel className="p-6">
          <h3 className="text-[14px] font-semibold text-content">Reliability</h3>
          <Row label="Verify every edit" desc="Syntax-check each changed file. Broken edits are skipped so no bad PR is ever opened.">
            <Switch on={cfg.settings.verifyFixes} onChange={(v) => patch({ verifyFixes: v })} />
          </Row>
          <Row label="Completeness check" desc="After fixing, confirm nothing from the changelog is left behind (no leftover old API usages).">
            <Switch on={cfg.settings.completenessCheck} onChange={(v) => patch({ completenessCheck: v })} />
          </Row>
          <Row label="Run tests on the fix" desc="Clone each repo in an ephemeral sandbox, apply the fix, run its own test suite, and put the pass/fail result in the PR. Runs third-party code locally — off by default.">
            <Switch on={cfg.settings.runTests} onChange={(v) => patch({ runTests: v })} />
          </Row>
          <Row label="Watch PRs for threats" desc="On the schedule, scan open pull requests (yours or anyone's) and comment a security report on risky ones.">
            <Switch on={cfg.settings.securityWatch} onChange={(v) => patch({ securityWatch: v })} />
          </Row>
        </Panel>

        {/* Automatic watching */}
        <Panel className="p-6">
          <h3 className="text-[14px] font-semibold text-content">Scheduled watching</h3>
          <Row label="Enable watching" desc="On a timer, check your watched changelog URLs (Providers + God Mode sources) and run only when one actually changes. It never re-runs on its own without a change.">
            <Switch on={cfg.settings.watchEnabled} onChange={(v) => patch({ watchEnabled: v })} />
          </Row>
          <div className="mt-4">
            <div className="mb-2 text-[13px] font-medium text-content">Interval</div>
            <div className="flex flex-wrap gap-2">
              {INTERVALS.map((m) => (
                <button
                  key={m}
                  onClick={() => patch({ intervalMinutes: m })}
                  className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-all ${
                    cfg.settings.intervalMinutes === m
                      ? "border-accent/50 bg-accent-soft text-accent"
                      : "border-line bg-white/[0.02] text-content-muted hover:text-content"
                  }`}
                >
                  {m < 60 ? `${m}m` : `${m / 60}h`}
                </button>
              ))}
            </div>
          </div>
        </Panel>

        {/* Current config */}
        <Panel className="p-6">
          <h3 className="text-[14px] font-semibold text-content">Current configuration</h3>
          <div className="mt-4 grid gap-3 text-[13px]">
            <ConfigItem label="GitHub" value={cfg.github.mode === "pat" ? "Access token" : "GitHub App"} ok={cfg.hasPat || cfg.hasAppKey} />
            <ConfigItem label="LLM" value={`${cfg.llm.provider} · ${cfg.llm.model}`} ok={cfg.hasLlmKey} />
            <ConfigItem label="Repos selected" value={String(cfg.repos.filter((r) => r.selected).length)} ok={cfg.repos.some((r) => r.selected)} />
          </div>
        </Panel>
      </div>

      <EmailPanel cfg={cfg} onSaved={apply} />
      <SlackPanel cfg={cfg} onSaved={apply} />
    </div>
  );
}

function AppearancePanel({ skin, onSkin }: { skin: Skin; onSkin: (s: Skin) => void }) {
  return (
    <Panel className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold text-content">Appearance</h3>
          <p className="mt-1 text-[12px] text-content-faint">
            Choose how controls and surfaces feel. Applies instantly, and works in both light and dark.
            Your choice is remembered as the default.
          </p>
        </div>
        <Chip tone={skin === "skeuo" ? "accent" : "neutral"}>{skin === "skeuo" ? "Neumorphic" : "Modern"}</Chip>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <SkinCard
          active={skin === "modern"}
          onClick={() => onSkin("modern")}
          title="Modern"
          desc="Flat, minimal, accent pill buttons. The default KeelCat look."
          preview={
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center rounded-full px-3.5 py-1.5 text-[12px] font-semibold"
                style={{ background: "rgb(168,255,83)", color: "#06070a" }}
              >
                Primary
              </span>
              <span className="inline-flex items-center rounded-full border border-line px-3.5 py-1.5 text-[12px] font-semibold text-content-muted">
                Secondary
              </span>
            </div>
          }
        />
        <SkinCard
          active={skin === "skeuo"}
          onClick={() => onSkin("skeuo")}
          title="Neumorphic"
          desc="Retro soft-UI. One tactile material — controls extrude out and press in. No borders."
          previewBg="#d8d5cd"
          preview={
            <div className="flex items-center gap-3">
              <span
                className="inline-flex items-center px-3.5 py-1.5 text-[12px] font-semibold"
                style={{
                  borderRadius: 12,
                  background: "#d8d5cd",
                  color: "#0f4020",
                  border: "1px solid rgba(0,0,0,.26)",
                  boxShadow: "4px 4px 9px rgba(168,163,152,1), -4px -4px 9px rgba(255,255,252,1)",
                }}
              >
                Primary
              </span>
              <span
                className="inline-flex items-center px-3.5 py-1.5 text-[12px] font-semibold"
                style={{
                  borderRadius: 12,
                  background: "#d8d5cd",
                  color: "#4a443c",
                  boxShadow: "inset 3px 3px 7px rgba(168,163,152,1), inset -3px -3px 7px rgba(255,255,252,1)",
                }}
              >
                Pressed
              </span>
            </div>
          }
        />
      </div>
    </Panel>
  );
}

function SkinCard({
  active,
  onClick,
  title,
  desc,
  preview,
  previewBg,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
  preview: React.ReactNode;
  previewBg?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative overflow-hidden rounded-2xl border p-5 text-left transition-all duration-200 ${
        active
          ? "border-accent/60 ring-1 ring-inset ring-accent/40 bg-accent-soft"
          : "border-line bg-white/[0.02] hover:border-line-strong hover:bg-white/[0.04]"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="text-[14px] font-semibold text-content">{title}</div>
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] ${
            active ? "border-accent bg-accent text-canvas" : "border-line-strong text-transparent"
          }`}
        >
          ✓
        </span>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-content-muted">{desc}</p>
      <div
        className={`mt-4 flex h-16 items-center rounded-xl px-3 ${previewBg ? "" : "border border-line bg-canvas/40"}`}
        style={previewBg ? { background: previewBg } : undefined}
      >
        {preview}
      </div>
    </button>
  );
}

function GodModePanel({
  cfg,
  setGodMode,
  patch,
}: {
  cfg: PublicConfig;
  setGodMode: (v: boolean) => void;
  patch: (p: Partial<PublicConfig["settings"]>) => Promise<void>;
}) {
  const [sources, setSources] = useState<WatchSource[]>(cfg.watchSources);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [polling, setPolling] = useState(false);
  const on = cfg.settings.godMode;

  useEffect(() => setSources(cfg.watchSources), [cfg.watchSources]);

  async function addSource() {
    if (!name.trim() || !url.trim()) return;
    setSources(await api.watchSources.save({ name: name.trim(), url: url.trim(), enabled: true }));
    setName("");
    setUrl("");
  }
  async function removeSource(id: string) {
    setSources(await api.watchSources.remove(id));
  }
  async function pollNow() {
    setPolling(true);
    try {
      await api.auto.pollNow();
    } finally {
      setPolling(false);
    }
  }

  return (
    <Panel className={`relative overflow-hidden p-6 transition-all ${on ? "ring-1 ring-inset ring-accent/40" : ""}`}>
      {on && <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-accent/10 blur-3xl" />}
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <div className="flex items-center gap-2.5">
            <span className={`text-lg ${on ? "text-accent" : "text-content-faint"}`}>⚡</span>
            <h3 className="text-[15px] font-semibold text-content">God Mode</h3>
            {on && <Chip tone="accent">active</Chip>}
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-content-muted">
            Fully automatic. While it's on, KeelCat checks every watched changelog on its own
            <b className="text-content"> every {cfg.settings.intervalMinutes} minute{cfg.settings.intervalMinutes === 1 ? "" : "s"}</b> (set the interval below).
            When one changes — or a changelog is posted to the webhook — it reads it, finds the affected repos,
            fixes them, and opens PRs. No button presses. The button below just forces an immediate check.
          </p>
        </div>
        <Switch on={on} onChange={setGodMode} />
      </div>

      <div className="relative mt-5 grid gap-4 border-t border-line pt-5 md:grid-cols-2">
        <div>
          <div className="mb-2 text-[13px] font-medium text-content">Watched changelog URLs</div>
          {sources.length === 0 ? (
            <p className="text-[12px] text-content-faint">No extra URLs. Provider changelogs are managed on the Providers page.</p>
          ) : (
            <div className="space-y-2">
              {sources.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white/[0.02] px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-[12px] text-content">{s.name}</div>
                    <div className="truncate font-mono text-[11px] text-content-faint">{s.url}</div>
                  </div>
                  <button className="btn-ghost px-2 py-1 text-[12px] text-rose" onClick={() => removeSource(s.id)}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 space-y-2">
            <input className="field py-2 text-[12px]" placeholder="Name (e.g. Stripe releases)" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="flex gap-2">
              <input className="field py-2 font-mono text-[12px]" placeholder="https://…/CHANGELOG.md" value={url} onChange={(e) => setUrl(e.target.value)} />
              <button className="btn-outline" onClick={addSource} disabled={!name.trim() || !url.trim()}>Add</button>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-2 text-[13px] font-medium text-content">Trigger from anywhere</div>
          <p className="text-[12px] leading-relaxed text-content-muted">
            POST a changelog to the webhook and God Mode runs it instantly — wire it to a GitHub Action, an email
            forwarder, or Zapier.
          </p>
          <code className="mt-2 block overflow-x-auto rounded-lg border border-line bg-black/30 p-3 font-mono text-[11px] text-content-muted">
            POST /api/webhook/changelog<br />
            {`{ "text": "charges.create: renamed source → payment_method" }`}
          </code>
          <div className="mt-3 flex items-center gap-3">
            <button className="btn-outline" onClick={pollNow} disabled={polling}>
              {polling ? <Spinner label="Checking…" /> : "Check watched sources now"}
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-xl border border-line bg-white/[0.02] px-3.5 py-2.5">
            <div>
              <div className="text-[12px] text-content">Auto-open PRs in God Mode</div>
              <div className="text-[11px] text-content-faint">Off = fixes are prepared but not submitted</div>
            </div>
            <Switch on={cfg.settings.autoOpenPr} onChange={(v) => patch({ autoOpenPr: v })} />
          </div>
        </div>
      </div>
    </Panel>
  );
}

function EmailPanel({ cfg, onSaved }: { cfg: PublicConfig; onSaved: (c: PublicConfig) => void }) {
  const e = cfg.settings.email;
  const [form, setForm] = useState({ ...e, pass: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => setForm({ ...e, pass: "" }), [cfg]);

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const c = await api.config.setEmail({ ...form, pass: form.pass || undefined });
      onSaved(c);
      setMsg("Saved.");
      setForm((f) => ({ ...f, pass: "" }));
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await api.config.testEmail();
      setMsg(`Test email sent to ${r.to}.`);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-content">Email notifications</h3>
        <div className="flex items-center gap-3">
          {cfg.hasSmtpPass ? <Chip tone="emerald">password saved</Chip> : <Chip tone="amber">no password</Chip>}
          <Switch on={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} />
        </div>
      </div>
      <p className="mt-1 text-[12px] text-content-faint">Sends a summary email after each run. Works with Gmail app passwords, SendGrid, Mailgun, etc.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label="Send to" value={form.to} onChange={(v) => setForm({ ...form, to: v })} placeholder="you@company.com" />
        <Field label="From" value={form.from} onChange={(v) => setForm({ ...form, from: v })} placeholder="keelcat@company.com" />
        <Field label="SMTP host" value={form.host} onChange={(v) => setForm({ ...form, host: v })} placeholder="smtp.gmail.com" mono />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Port" value={String(form.port)} onChange={(v) => setForm({ ...form, port: Number(v) || 465 })} mono />
          <div className="flex items-end justify-between rounded-xl border border-line bg-white/[0.02] px-3 py-2">
            <span className="text-[12px] text-content">TLS</span>
            <Switch on={form.secure} onChange={(v) => setForm({ ...form, secure: v })} />
          </div>
        </div>
        <Field label="SMTP user" value={form.user} onChange={(v) => setForm({ ...form, user: v })} placeholder="you@gmail.com" mono />
        <Field label={cfg.hasSmtpPass ? "SMTP password (saved — leave blank to keep)" : "SMTP password / app password"} value={form.pass} onChange={(v) => setForm({ ...form, pass: v })} type="password" />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button className="btn-accent" onClick={save} disabled={busy}>{busy ? <Spinner label="Saving…" /> : "Save"}</button>
        <button className="btn-outline" onClick={test} disabled={busy || !form.enabled}>Send test email</button>
        {msg && <span className="text-[12px] text-emerald">{msg}</span>}
        {err && <span className="text-[12px] text-rose">{err}</span>}
      </div>
    </Panel>
  );
}

function SlackPanel({ cfg, onSaved }: { cfg: PublicConfig; onSaved: (c: PublicConfig) => void }) {
  const [enabled, setEnabled] = useState(cfg.settings.slack.enabled);
  const [webhook, setWebhook] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => setEnabled(cfg.settings.slack.enabled), [cfg]);

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const c = await api.config.setSlack({ enabled, webhookUrl: webhook || undefined });
      onSaved(c);
      setMsg("Saved.");
      setWebhook("");
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.config.testSlack();
      setMsg("Test message sent to Slack.");
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-content">Slack notifications</h3>
        <div className="flex items-center gap-3">
          {cfg.hasSlackWebhook ? <Chip tone="emerald">webhook saved</Chip> : <Chip tone="amber">no webhook</Chip>}
          <Switch on={enabled} onChange={setEnabled} />
        </div>
      </div>
      <p className="mt-1 text-[12px] text-content-faint">Posts a run summary to a channel via an incoming webhook.</p>
      <div className="mt-4">
        <Field
          label={cfg.hasSlackWebhook ? "Webhook URL (saved — leave blank to keep)" : "Incoming webhook URL"}
          value={webhook}
          onChange={setWebhook}
          placeholder="https://hooks.slack.com/services/…"
          mono
        />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button className="btn-accent" onClick={save} disabled={busy}>{busy ? <Spinner label="Saving…" /> : "Save"}</button>
        <button className="btn-outline" onClick={test} disabled={busy || !enabled}>Send test message</button>
        {msg && <span className="text-[12px] text-emerald">{msg}</span>}
        {err && <span className="text-[12px] text-rose">{err}</span>}
      </div>
    </Panel>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[12px] font-medium text-content">{label}</label>
      <input type={type} className={`field ${mono ? "font-mono text-[12px]" : ""}`} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-4 border-t border-line pt-4 first:mt-4">
      <div>
        <div className="text-[13px] font-medium text-content">{label}</div>
        {desc && <div className="mt-0.5 text-[12px] text-content-faint">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function ConfigItem({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-line bg-white/[0.02] px-4 py-3">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald" : "bg-amber"}`} />
        <span className="text-[11px] uppercase tracking-[0.14em] text-content-faint">{label}</span>
      </div>
      <div className="truncate font-mono text-[12px] text-content">{value}</div>
    </div>
  );
}
