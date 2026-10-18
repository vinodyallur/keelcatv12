import { useEffect, useState } from "react";
import { api, type PublicConfig, type ConnectedRepo, type CreatedRepo } from "../api";
import { Panel, SectionHead, Chip, Spinner, LangBadge, Switch } from "./ui";

export default function Connect({ onConfig }: { onConfig?: (c: PublicConfig) => void }) {
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [mode, setMode] = useState<"pat" | "app">("pat");

  // PAT
  const [pat, setPat] = useState("");
  const [accountName, setAccountName] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [login, setLogin] = useState<string | null>(null);

  // App
  const [appId, setAppId] = useState("");
  const [appSlug, setAppSlug] = useState("");
  const [appName, setAppName] = useState("KeelCat");
  const [appMsg, setAppMsg] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [privateKey, setPrivateKey] = useState("");
  const [installations, setInstallations] = useState<{ installationId: string; account: string }[]>([]);
  const [installationId, setInstallationId] = useState("");

  // Instant webhook
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookMsg, setWebhookMsg] = useState<string | null>(null);
  const webhookUrl = `${(import.meta.env.VITE_API_URL ?? window.location.origin).replace(/\/$/, "")}/api/webhook/github`;

  // LLM
  const [llmProvider, setLlmProvider] = useState("on-device");
  const [llmModel, setLlmModel] = useState("gemma (on-device)");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmKey, setLlmKey] = useState("");
  const [llmTest, setLlmTest] = useState<string | null>(null);

  const MODEL_PRESETS: Record<string, { keyHint: string; models: string[]; baseUrl?: string; needsBaseUrl?: boolean; kind: "local" | "cloud" | "none" }> = {
    "on-device": { keyHint: "runs on this phone — no key", models: ["gemma (on-device)"], kind: "local" },
    ollama: { keyHint: "local server — no key needed", models: ["llama3.2", "qwen2.5-coder", "gemma2", "phi3"], baseUrl: "http://127.0.0.1:11434/v1", needsBaseUrl: true, kind: "local" },
    openrouter: { keyHint: "starts with sk-or-…", models: ["google/gemma-4-26b-a4b-it:free", "meta-llama/llama-3.3-70b-instruct:free", "deepseek/deepseek-chat-v3-0324:free"], baseUrl: "https://openrouter.ai/api/v1", kind: "cloud" },
    openai: { keyHint: "starts with sk-…", models: ["gpt-4o-mini", "gpt-4o"], baseUrl: "https://api.openai.com/v1", kind: "cloud" },
    gemini: { keyHint: "starts with AIza…", models: ["gemini-2.0-flash", "gemini-1.5-flash"], baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", kind: "cloud" },
    custom: { keyHint: "any OpenAI-compatible endpoint", models: ["gpt-4o-mini"], needsBaseUrl: true, kind: "cloud" },
    disabled: { keyHint: "no key needed", models: [], kind: "none" },
  };
  const showBaseUrl = ["ollama", "openrouter", "openai", "gemini", "custom"].includes(llmProvider);

  function changeProvider(p: string) {
    setLlmProvider(p);
    const preset = MODEL_PRESETS[p];
    if (preset?.models[0]) setLlmModel(preset.models[0]);
    setLlmBaseUrl(preset?.baseUrl ?? "");
  }

  const [repos, setRepos] = useState<ConnectedRepo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedRepo[] | null>(null);

  function refresh(c: PublicConfig) {
    setCfg(c);
    setRepos(c.repos);
    setMode(c.github.mode);
    setLlmProvider(c.llm.provider);
    setLlmModel(c.llm.model);
    setLlmBaseUrl(c.llm.baseUrl ?? "");
    setAppId(c.github.appId ?? "");
    setInstallationId(c.github.installationId ?? "");
    setAppSlug(c.github.appSlug ?? "");
    onConfig?.(c);
  }

  async function saveAppSlug() {
    try {
      const c = await api.config.setGitHub({ mode: "app", appSlug });
      refresh(c);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveWebhookSecret() {
    setWebhookMsg("saving…");
    try {
      await api.config.setGitHub({ webhookSecret });
      const c = await api.config.get();
      refresh(c);
      setWebhookSecret("");
      setWebhookMsg("✓ secret saved — GitHub push events will now trigger instant runs");
    } catch (e) {
      setWebhookMsg(null);
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    api.config.get().then(refresh).catch(() => {});
    // Handle the return from GitHub's App Manifest flow.
    const p = new URLSearchParams(window.location.search);
    if (p.get("app") === "created") {
      setMode("app");
      setAppMsg(`✓ GitHub App "${p.get("slug") ?? ""}" created and connected. Now install it on your repositories (Step 2 below).`);
    } else if (p.get("app") === "error") {
      setError(`GitHub App creation failed: ${p.get("msg") ?? "unknown error"}`);
    }
    if (p.has("app")) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // One-click: ask the backend for a manifest, then POST it to GitHub. GitHub
  // creates the app and redirects back with the credentials already saved.
  async function createApp() {
    setError(null);
    try {
      const { manifest, action } = await api.github.appManifest(appName || "KeelCat");
      const form = document.createElement("form");
      form.method = "POST";
      form.action = `${action}?state=${encodeURIComponent(window.location.origin)}`;
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "manifest";
      input.value = JSON.stringify(manifest);
      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function connectPat() {
    setConnecting(true);
    setError(null);
    try {
      const r = await api.github.connect(pat, accountName);
      setLogin(r.login);
      setRepos(r.repos);
      const c = await api.config.get();
      refresh(c);
      setPat("");
      setAccountName("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  }

  async function toggleAccount(id: string, enabled: boolean) {
    try {
      refresh(await api.github.accounts.update(id, { enabled }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removeAccount(id: string, name: string) {
    if (!window.confirm(`Remove "${name}"? This disconnects the account and removes its repositories from KeelCat. The token itself is not revoked on GitHub.`)) return;
    try {
      refresh(await api.github.accounts.remove(id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function renameAccount(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      refresh(await api.github.accounts.update(id, { name: trimmed }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function loadInstallations() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.github.appInstallations({ appId, privateKey });
      setInstallations(r.installations);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function loadAppRepos(id: string) {
    setBusy(true);
    setError(null);
    setInstallationId(id);
    try {
      const r = await api.github.appRepos({ installationId: id });
      setRepos(r.repos);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveLlm() {
    setError(null);
    setLlmTest("saving…");
    try {
      await api.config.setLlm({ provider: llmProvider, model: llmModel, baseUrl: llmBaseUrl || undefined, apiKey: llmKey || undefined });
      const t = await api.config.testLlm();
      setLlmTest(`✓ ${t.model} replied: "${t.sample}"`);
      const c = await api.config.get();
      refresh(c);
      setLlmKey("");
    } catch (e) {
      setLlmTest(null);
      setError(`LLM: ${(e as Error).message}`);
    }
  }

  async function toggleRepo(id: string, selected: boolean) {
    const updated = await api.repos.select(id, selected);
    setRepos(updated);
  }
  async function selectAll(selected: boolean) {
    const updated = await api.repos.selectAll(selected);
    setRepos(updated);
  }

  async function createTestRepos() {
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const r = await api.testkit.create();
      setCreated(r.created);
      setRepos(r.repos);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const selectedCount = repos.filter((r) => r.selected).length;

  return (
    <div className="animate-fade-up space-y-6">
      <SectionHead
        eyebrow="Connect"
        title="Connect GitHub & your LLM"
        desc="Use a Personal Access Token for the fastest start, or a GitHub App for a proper multi-repo install. Then pick the repos KeelCat should watch."
      />

      {error && <Panel className="border-rose/30 bg-rose-soft p-4 text-[13px] text-rose">{error}</Panel>}

      {/* GitHub */}
      <Panel className="p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-content">GitHub access</h3>
          <div className="flex rounded-full border border-line bg-black/20 p-1">
            {(["pat", "app"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-full px-4 py-1.5 text-[12px] font-semibold transition-all ${
                  mode === m ? "bg-accent text-canvas" : "text-content-muted hover:text-content"
                }`}
              >
                {m === "pat" ? "Access token" : "GitHub App"}
              </button>
            ))}
          </div>
        </div>

        {mode === "pat" ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-content">Account name <span className="text-content-faint">(to tell connections apart)</span></label>
              <input className="field" placeholder="e.g. Work GitHub, or Alex's account" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
              <label className="mb-1.5 mt-3 block text-[12px] font-medium text-content">Personal access token (classic, <code className="font-mono">repo</code> scope)</label>
              <input type="password" className="field" placeholder="ghp_… or github_pat_…" value={pat} onChange={(e) => setPat(e.target.value)} />
              <button className="btn-accent mt-3" onClick={connectPat} disabled={connecting || !pat}>
                {connecting ? <Spinner label="Connecting…" /> : "Add account & list repos →"}
              </button>
              {login && (
                <div className="mt-3 flex items-center gap-2 text-[12px] text-emerald">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald" /> connected as {login}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-line bg-white/[0.02] p-4 text-[12px] leading-relaxed text-content-muted">
              <div className="mb-1.5 font-semibold text-content">30-second setup</div>
              1. Open <code className="font-mono">github.com/settings/tokens</code><br />
              2. Generate a <b>classic</b> token with the <code className="font-mono">repo</code> scope<br />
              3. Give it a name and paste it here. You can add multiple accounts — each keeps its own repos. Tokens are stored locally only, and you can revoke them anytime.
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            {appMsg && <Panel className="border-emerald/30 bg-emerald-soft p-3 text-[12px] text-emerald">{appMsg}</Panel>}

            {/* Step 1 — create the App (one click) */}
            <div className="rounded-xl border border-line bg-white/[0.02] p-4">
              <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-content">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-soft text-[11px] text-accent">1</span>
                Create the GitHub App
                {cfg?.hasAppKey && <Chip tone="emerald">app connected</Chip>}
              </div>
              <p className="mb-3 text-[12px] leading-relaxed text-content-muted">
                One click creates a GitHub App on your account with the right permissions (Contents + Pull requests)
                and sends its credentials straight back here — no manual App ID or private key to copy. This is the
                B2B way: customers install the app, no personal tokens, scoped and revocable, PRs authored by your bot.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[180px]">
                  <label className="mb-1.5 block text-[12px] font-medium text-content">App name (must be unique on GitHub)</label>
                  <input className="field" placeholder="KeelCat" value={appName} onChange={(e) => setAppName(e.target.value)} />
                </div>
                <button className="btn-accent" onClick={createApp}>Create GitHub App →</button>
              </div>
              <p className="mt-2 text-[11px] text-content-faint">
                You'll be sent to GitHub to confirm, then bounced right back here with everything configured.
              </p>
            </div>

            {/* Step 2 — install the App on repos */}
            <div className="rounded-xl border border-line bg-white/[0.02] p-4">
              <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-content">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-soft text-[11px] text-accent">2</span>
                Install it on your repositories
              </div>
              <p className="mb-3 text-[12px] leading-relaxed text-content-muted">
                Pick which repos the app can open PRs on. {cfg?.github.appSlug ? "" : "Create the app first to enable this."}
              </p>
              <a
                className={`btn-accent ${cfg?.github.appSlug ? "" : "pointer-events-none opacity-40"}`}
                href={cfg?.github.appSlug ? `https://github.com/apps/${encodeURIComponent(cfg.github.appSlug)}/installations/new` : "#"}
                target="_blank"
                rel="noreferrer"
              >
                Install on GitHub →
              </a>
            </div>

            {/* Step 3 — pick the installation */}
            <div className="rounded-xl border border-line bg-white/[0.02] p-4">
              <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold text-content">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-soft text-[11px] text-accent">3</span>
                Load your installed repositories
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn-outline" onClick={loadInstallations} disabled={busy || !cfg?.hasAppKey}>
                  {busy ? <Spinner label="Loading…" /> : "Load installations"}
                </button>
                {installations.length > 0 && (
                  <select className="field max-w-xs" value={installationId} onChange={(e) => loadAppRepos(e.target.value)}>
                    <option value="">Select installation…</option>
                    {installations.map((i) => (
                      <option key={i.installationId} value={i.installationId}>{i.account} (#{i.installationId})</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Advanced: already have an app? */}
            <div className="rounded-xl border border-line bg-white/[0.02] p-4">
              <button className="text-[12px] font-medium text-content-muted hover:text-content" onClick={() => setShowManual((v) => !v)}>
                {showManual ? "▾" : "▸"} Already have a GitHub App? Enter credentials manually
              </button>
              {showManual && (
                <div className="mt-4 space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-[12px] font-medium text-content">App ID</label>
                      <input className="field" placeholder="123456" value={appId} onChange={(e) => setAppId(e.target.value)} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[12px] font-medium text-content">App slug</label>
                      <input className="field" placeholder="keelcat" value={appSlug} onChange={(e) => setAppSlug(e.target.value)} onBlur={saveAppSlug} />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[12px] font-medium text-content">App private key (PEM)</label>
                    <textarea className="field font-mono h-24" placeholder={cfg?.hasAppKey ? "•••••• (saved) — paste to replace" : "-----BEGIN RSA PRIVATE KEY-----"} value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} />
                  </div>
                  <button className="btn-outline" onClick={loadInstallations} disabled={busy || !appId || (!privateKey && !cfg?.hasAppKey)}>
                    {busy ? <Spinner label="Loading…" /> : "Save & load installations"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </Panel>

      {/* Connected accounts */}
      {cfg?.accounts && cfg.accounts.length > 0 && (
        <Panel className="p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-semibold text-content">Connected accounts</h3>
            <span className="text-[12px] text-content-faint">{cfg.accounts.length} connected · {cfg.accounts.filter((a) => a.enabled).length} active</span>
          </div>
          <p className="mt-1 text-[12px] text-content-faint">
            Each account keeps its own repositories. Disable one to skip its repos in runs without disconnecting; remove one to delete it and its repos here.
          </p>
          <div className="mt-4 divide-y divide-line">
            {cfg.accounts.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 py-3">
                <Switch on={a.enabled} onChange={(v) => toggleAccount(a.id, v)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <input
                      className="w-full max-w-[240px] rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[13px] font-medium text-content hover:border-line focus:border-accent focus:outline-none"
                      defaultValue={a.name}
                      onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== a.name && renameAccount(a.id, e.target.value)}
                    />
                    <Chip tone={a.mode === "app" ? "violet" : "sky"}>{a.mode === "app" ? "App" : "PAT"}</Chip>
                    {!a.enabled && <Chip tone="neutral">disabled</Chip>}
                  </div>
                  <div className="mt-0.5 px-1 text-[11px] text-content-faint">
                    {a.login ? `@${a.login} · ` : ""}{a.repoCount} repo{a.repoCount === 1 ? "" : "s"}
                  </div>
                </div>
                <button className="btn-ghost text-[12px] text-rose hover:text-rose" onClick={() => removeAccount(a.id, a.name)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Instant webhook */}
      <Panel className="p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-content">Instant detection (webhook)</h3>
          {cfg?.hasWebhookSecret ? <Chip tone="emerald">secret saved</Chip> : <Chip tone="amber">not set</Chip>}
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-content-faint">
          Add this URL as a <b>push</b> webhook on a provider's changelog repo. The moment they commit a
          breaking change, KeelCat runs and a PR is waiting — no polling delay.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-content">Payload URL</label>
            <div className="flex gap-2">
              <input className="field font-mono text-[11px]" readOnly value={webhookUrl} onFocus={(e) => e.currentTarget.select()} />
              <button className="btn-ghost text-[12px]" onClick={() => navigator.clipboard?.writeText(webhookUrl)}>Copy</button>
            </div>
            <p className="mt-1.5 text-[11px] text-content-faint">Content type: <code className="font-mono">application/json</code> · Event: <code className="font-mono">push</code></p>
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-content">Webhook secret</label>
            <input
              type="password"
              className="field"
              placeholder={cfg?.hasWebhookSecret ? "•••••• (saved) — paste to replace" : "a strong shared secret"}
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
            />
            <div className="mt-2 flex items-center gap-3">
              <button className="btn-outline" onClick={saveWebhookSecret} disabled={!webhookSecret}>Save secret</button>
              {webhookMsg && <span className="text-[12px] text-content-muted">{webhookMsg}</span>}
            </div>
          </div>
        </div>
      </Panel>

      {/* LLM */}
      <Panel className="p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-content">LLM (for reading changelogs)</h3>
          {cfg?.hasLlmKey ? <Chip tone="emerald">key saved</Chip> : <Chip tone="amber">no key yet</Chip>}
        </div>
        <p className="mt-1 text-[12px] text-content-faint">
          Turns a human changelog into a precise change list. Switch between a <b>local</b> LLM
          (on-device, or Ollama on your machine — private, no key) and a <b>cloud</b> LLM
          (OpenRouter/OpenAI/Gemini). Deterministic parsing always works as a fallback.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Chip tone={MODEL_PRESETS[llmProvider]?.kind === "cloud" ? "sky" : "accent"}>
            {MODEL_PRESETS[llmProvider]?.kind === "cloud" ? "☁ cloud" : MODEL_PRESETS[llmProvider]?.kind === "local" ? "⌂ local" : "○ off"}
          </Chip>
          <span className="text-[11px] text-content-faint">
            {llmProvider === "on-device" ? "Model runs on the phone's CPU." : llmProvider === "ollama" ? "Runs on your computer via Ollama." : llmProvider === "disabled" ? "No LLM — pattern-based parsing only." : "Runs in the cloud."}
          </span>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-content">Provider</label>
            <select className="field" value={llmProvider} onChange={(e) => changeProvider(e.target.value)}>
              <optgroup label="Local (private, on-device / your machine)">
                <option value="on-device">On-device (phone)</option>
                <option value="ollama">Ollama (local server)</option>
              </optgroup>
              <optgroup label="Cloud">
                <option value="openrouter">OpenRouter</option>
                <option value="openai">OpenAI</option>
                <option value="gemini">Google Gemini</option>
                <option value="custom">Custom (OpenAI-compatible)</option>
              </optgroup>
              <option value="disabled">Disabled (manual changes only)</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-content">Model</label>
            <input className="field" value={llmModel} onChange={(e) => setLlmModel(e.target.value)} placeholder="pick a preset →" />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-content">
              API key <span className="text-content-faint">({MODEL_PRESETS[llmProvider]?.keyHint})</span>
            </label>
            <input type="password" className="field" value={llmKey} onChange={(e) => setLlmKey(e.target.value)}
              disabled={llmProvider === "on-device" || llmProvider === "ollama" || llmProvider === "disabled"}
              placeholder={cfg?.hasLlmKey ? "•••••• (saved)" : "paste key"} />
          </div>
        </div>
        {showBaseUrl && (
          <div className="mt-4">
            <label className="mb-1.5 block text-[12px] font-medium text-content">
              Base URL <span className="text-content-faint">(OpenAI-compatible endpoint)</span>
            </label>
            <input className="field font-mono text-[12px]" value={llmBaseUrl} onChange={(e) => setLlmBaseUrl(e.target.value)}
              placeholder="http://127.0.0.1:11434/v1" />
            {llmProvider === "ollama" && (
              <p className="mt-1.5 text-[11px] text-content-faint">
                Run Ollama on your computer, then expose it to the phone with <code className="font-mono">adb reverse tcp:11434 tcp:11434</code> and use <code className="font-mono">http://127.0.0.1:11434/v1</code>.
              </p>
            )}
          </div>
        )}
        {MODEL_PRESETS[llmProvider]?.models.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-content-faint">models:</span>
            {MODEL_PRESETS[llmProvider].models.map((m) => (
              <button
                key={m}
                onClick={() => setLlmModel(m)}
                className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] transition-all ${
                  llmModel === m ? "border-accent/50 bg-accent-soft text-accent" : "border-line bg-white/[0.02] text-content-muted hover:text-content"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center gap-3">
          <button className="btn-outline" onClick={saveLlm}>Save & test</button>
          {llmTest && <span className="text-[12px] text-content-muted">{llmTest}</span>}
        </div>
      </Panel>

      {/* Repo picker */}
      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
          <div>
            <h3 className="text-[15px] font-semibold text-content">Repositories</h3>
            <p className="mt-0.5 text-[12px] text-content-faint">{repos.length} visible · {selectedCount} selected for runs</p>
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost text-[12px]" onClick={() => selectAll(true)} disabled={!repos.length}>Select all</button>
            <button className="btn-ghost text-[12px]" onClick={() => selectAll(false)} disabled={!repos.length}>Clear</button>
            <button className="btn-outline" onClick={createTestRepos} disabled={busy || !cfg?.hasPat}>
              {busy ? <Spinner label="Creating…" /> : "Create test repos (all languages)"}
            </button>
          </div>
        </div>

        {created && (
          <div className="border-b border-line bg-white/[0.02] p-4 text-[12px]">
            <div className="mb-1.5 font-semibold text-content">Test repos</div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {created.map((c) => (
                <div key={c.name} className="flex items-center justify-between gap-2">
                  <a href={c.url} target="_blank" rel="noreferrer" className="font-mono text-content-muted hover:text-accent">{c.fullName}</a>
                  {c.error ? <Chip tone="rose">error</Chip> : <Chip tone={c.created ? "accent" : "neutral"}>{c.created ? "created" : "seeded"}</Chip>}
                </div>
              ))}
            </div>
          </div>
        )}

        {repos.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-content-faint">Connect above to list your repositories.</div>
        ) : (
          <div className="max-h-[420px] divide-y divide-line overflow-y-auto">
            {repos.map((r) => (
              <label key={r.id} className="flex cursor-pointer items-center gap-3 px-5 py-3 transition-colors hover:bg-white/[0.02]">
                <Switch on={r.selected} onChange={(v) => toggleRepo(r.id, v)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-content">{r.fullName}</span>
                    {r.private && <Chip tone="neutral">private</Chip>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-content-faint">
                    {cfg?.accounts && cfg.accounts.length > 1 && r.accountId && (
                      <Chip tone="neutral">{cfg.accounts.find((a) => a.id === r.accountId)?.name ?? "account"}</Chip>
                    )}
                    {r.languages.map((l) => <LangBadge key={l} lang={l} />)}
                    <span>· {r.defaultBranch}</span>
                    {r.lastResult?.prUrl && (
                      <a href={r.lastResult.prUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">PR #{r.lastResult.prNumber}</a>
                    )}
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
