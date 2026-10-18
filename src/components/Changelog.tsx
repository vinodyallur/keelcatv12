import { useEffect, useState, useSyncExternalStore } from "react";
import { api, type ChangeSpec, type RunOutput, type ChangeKind, type ChangeImpact, type PublicConfig } from "../api";
import { Panel, SectionHead, Chip, Spinner, DiffView, LangBadge, Empty, ProgressBar } from "./ui";
import StatusMatrix from "./StatusMatrix";
import Upgrade from "./Upgrade";
import { runStore } from "../pipeline/runStore";

const KINDS: ChangeKind[] = [
  "PARAM_RENAME",
  "SYMBOL_RENAME",
  "PARAM_REMOVED",
  "PARAM_ADDED_REQUIRED",
  "SYMBOL_REMOVED",
  "SYMBOL_DEPRECATED",
  "SYMBOL_ADDED",
  "OTHER",
];

const LS = {
  text: "apisteward.changelog.text",
  changes: "apisteward.changelog.changes",
  runMode: "apisteward.changelog.runmode",
};
function lsLoad<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function Changelog({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  // Persist the draft so switching nav tabs (which unmounts this view) doesn't
  // wipe what you typed / parsed / ran. Survives reloads too.
  const [text, setText] = useState<string>(() => localStorage.getItem(LS.text) ?? "");
  const [changes, setChanges] = useState<ChangeSpec[]>(() => lsLoad<ChangeSpec[]>(LS.changes, []));
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null); // parse-time errors
  const [showUpgrade, setShowUpgrade] = useState(false);
  // Where the run pipeline executes: "local" = the visitor's browser/CPU
  // (default — repo code never touches our servers), "server" = the cloud box.
  const [runMode, setRunMode] = useState<"local" | "server">(
    () => (localStorage.getItem(LS.runMode) as "local" | "server") ?? "local"
  );

  // Run state lives in a module store so it survives leaving/returning to this
  // view mid-run (the component unmounts on nav; the run keeps going).
  const rs = useSyncExternalStore(runStore.subscribe, runStore.getSnapshot);
  const { running, progress, result } = rs;

  useEffect(() => {
    api.config.get().then(setCfg).catch(() => {});
  }, []);

  // Save draft on every change.
  useEffect(() => {
    localStorage.setItem(LS.text, text);
  }, [text]);
  useEffect(() => {
    localStorage.setItem(LS.changes, JSON.stringify(changes));
  }, [changes]);
  useEffect(() => {
    localStorage.setItem(LS.runMode, runMode);
  }, [runMode]);
  // A finished run (result appears) → refresh config so the usage counter updates.
  useEffect(() => {
    if (result) api.config.get().then(setCfg).catch(() => {});
  }, [result]);
  // A run blocked by the free-run limit → surface the upgrade modal.
  useEffect(() => {
    if (rs.upgrade) setShowUpgrade(true);
  }, [rs.upgrade]);

  function clearDraft() {
    setText("");
    setChanges([]);
    runStore.clearResult();
    setError(null);
  }

  const selectedRepos = cfg?.repos.filter((r) => r.selected).length ?? 0;

  async function loadSample() {
    const r = await api.changelog.sample();
    setText(r.changelog);
  }

  async function parse() {
    setParsing(true);
    setError(null);
    runStore.clearResult();
    try {
      const r = await api.changelog.parse(text);
      setChanges(r.changes);
      if (r.changes.length === 0) setError("No actionable changes detected in that text.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setParsing(false);
    }
  }

  function addManual() {
    setChanges((c) => [
      ...c,
      { symbol: "", kind: "PARAM_RENAME", from: "", to: "", impact: "BREAKING", description: "" },
    ]);
  }
  function updateChange(i: number, patch: Partial<ChangeSpec>) {
    setChanges((c) => c.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function removeChange(i: number) {
    setChanges((c) => c.filter((_, idx) => idx !== i));
  }

  const billing = cfg?.billing;
  const outOfRuns = billing?.plan === "free" && (billing?.remaining ?? 1) <= 0;
  // Website runs on-machine by default. The owner can expose the machine/server
  // choice via the admin console (allowServerRun); until then it's always local.
  const canChooseServer = Boolean(cfg?.allowServerRun);
  const effectiveMode: "local" | "server" = canChooseServer ? runMode : "local";

  function run() {
    // Client-side gate: if the free allowance is used up, prompt upgrade
    // instead of firing a run the server will reject anyway.
    if (outOfRuns) {
      setShowUpgrade(true);
      return;
    }
    setError(null);
    const valid = changes.filter((c) => c.symbol.trim());
    // Hand the run to the store so it survives navigating away mid-run. The
    // config refresh and upgrade prompt are driven by effects on rs.
    void runStore.start(effectiveMode, valid, text || undefined);
  }

  return (
    <div className="animate-fade-up space-y-6">
      <SectionHead
        eyebrow="Changelog → Pull requests"
        title="Post an API change. Get the PRs."
        desc="Paste a changelog or announcement. KeelCat reads it, finds every affected repo across all your languages, rewrites the code, and opens a pull request on each. It never merges."
        right={
          <div className="flex items-center gap-2 text-[12px] text-content-faint">
            <Chip tone={selectedRepos ? "accent" : "amber"}>{selectedRepos} repo{selectedRepos === 1 ? "" : "s"} selected</Chip>
          </div>
        }
      />

      {(error || rs.error) && <Panel className="border-rose/30 bg-rose-soft p-4 text-[13px] text-rose">{error || rs.error}</Panel>}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Input */}
        <Panel className="p-5">
          <div className="mb-2 flex items-center justify-between">
            <label className="text-[13px] font-semibold text-content">Changelog / API change</label>
            <div className="flex items-center gap-1">
              <button className="btn-ghost text-[12px]" onClick={loadSample}>Load sample</button>
              {(text || changes.length > 0) && (
                <button className="btn-ghost text-[12px] text-content-faint" onClick={clearDraft}>Clear</button>
              )}
            </div>
          </div>
          <textarea
            className="field h-64 font-mono leading-relaxed"
            placeholder={`e.g.\n- charges.create: renamed "source" to "payment_method"\n- createCharge() is now createPayment()\n- customers.create is deprecated`}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-3 flex items-center gap-2">
            <button className="btn-accent" onClick={parse} disabled={parsing || !text.trim()}>
              {parsing ? <Spinner label="Reading…" /> : cfg?.hasLlmKey ? "Parse with LLM →" : "Parse →"}
            </button>
            <button className="btn-outline" onClick={addManual}>Add change manually</button>
          </div>
          {!cfg?.hasLlmKey && (
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-content-faint">
              <span>No LLM key set — using basic parsing. Set an LLM key for more accurate results.</span>
              {onNavigate && (
                <button onClick={() => onNavigate("connect")} className="shrink-0 font-medium text-accent hover:underline">
                  Set LLM key →
                </button>
              )}
            </p>
          )}
        </Panel>

        {/* Parsed changes */}
        <Panel className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <label className="text-[13px] font-semibold text-content">Detected changes</label>
            <span className="text-[12px] text-content-faint">{changes.length}</span>
          </div>
          {changes.length === 0 ? (
            <div className="flex h-56 items-center justify-center text-center text-[13px] text-content-faint">
              Parsed changes appear here. Review and edit before running.
            </div>
          ) : (
            <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
              {changes.map((c, i) => (
                <div key={i} className="rounded-xl border border-line bg-white/[0.02] p-3">
                  <div className="flex items-center gap-2">
                    <input
                      className="field py-1 font-mono text-[12px]"
                      placeholder="symbol e.g. charges.create"
                      value={c.symbol}
                      onChange={(e) => updateChange(i, { symbol: e.target.value })}
                    />
                    <button className="btn-ghost px-2 py-1 text-[12px]" onClick={() => removeChange(i)}>✕</button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <select className="field py-1 text-[12px]" value={c.kind} onChange={(e) => updateChange(i, { kind: e.target.value as ChangeKind })}>
                      {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <select className="field py-1 text-[12px]" value={c.impact} onChange={(e) => updateChange(i, { impact: e.target.value as ChangeImpact })}>
                      <option value="BREAKING">BREAKING</option>
                      <option value="DEPRECATION">DEPRECATION</option>
                      <option value="NEW_FEATURE">NEW_FEATURE</option>
                    </select>
                    <input className="field py-1 font-mono text-[12px]" placeholder="from" value={c.from ?? ""} onChange={(e) => updateChange(i, { from: e.target.value })} />
                    <input className="field py-1 font-mono text-[12px]" placeholder="to" value={c.to ?? ""} onChange={(e) => updateChange(i, { to: e.target.value })} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {canChooseServer ? (
            <>
              {/* Where does the run execute? Local = the visitor's own CPU. */}
              <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl border border-line bg-white/[0.02] p-1">
                <button
                  type="button"
                  onClick={() => setRunMode("local")}
                  className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${runMode === "local" ? "bg-accent text-canvas" : "text-content-muted hover:text-content"}`}
                >
                  ⚡ On my machine
                </button>
                <button
                  type="button"
                  onClick={() => setRunMode("server")}
                  className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${runMode === "server" ? "bg-accent text-canvas" : "text-content-muted hover:text-content"}`}
                >
                  ☁ On the server
                </button>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-content-faint">
                {runMode === "local"
                  ? "Runs in your browser on your CPU with a short-lived token — your repo code never touches our servers. The test sandbox is skipped locally."
                  : "Runs on KeelCat's cloud (uses our compute; needed for the test sandbox)."}
              </p>
            </>
          ) : (
            <p className="mt-4 text-[11px] leading-relaxed text-content-faint">
              Runs in your browser, on your machine — your repo code never touches our servers.
            </p>
          )}
          <button className="btn-accent mt-3 w-full" onClick={run} disabled={running || changes.length === 0 || selectedRepos === 0}>
            {running ? (
              <Spinner label={effectiveMode === "local" ? "Running on your machine…" : "Running across repos…"} />
            ) : outOfRuns ? (
              "Upgrade to run →"
            ) : (
              `Fix ${selectedRepos} repo${selectedRepos === 1 ? "" : "s"} & open PRs →`
            )}
          </button>
          {running && (
            <div className="mt-3">
              {effectiveMode === "local" && progress && progress.total > 0 ? (
                <ProgressBar
                  percent={(progress.done / progress.total) * 100}
                  label={
                    progress.current
                      ? `Processing ${progress.current}… (${progress.done}/${progress.total})`
                      : `${progress.done}/${progress.total} repos done`
                  }
                />
              ) : (
                <ProgressBar indeterminate label={effectiveMode === "local" ? "Preparing run…" : "Running on the server…"} />
              )}
            </div>
          )}
          {selectedRepos === 0 && <p className="mt-2 text-center text-[11px] text-amber">Select repos in Connect first.</p>}
          {billing && billing.plan === "free" && (
            <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] text-content-faint">
              <span>Free plan · {billing.runsUsed}/{billing.freeLimit} runs used</span>
              <button onClick={() => setShowUpgrade(true)} className="font-medium text-accent hover:underline">
                Upgrade
              </button>
            </p>
          )}
          {billing && billing.plan === "premium" && (
            <p className="mt-2 text-center text-[11px] text-emerald">Premium · unlimited runs</p>
          )}
        </Panel>
      </div>

      {/* Results */}
      {result && <Results result={result} />}

      {showUpgrade && (
        <Upgrade
          onClose={() => {
            setShowUpgrade(false);
            runStore.dismissUpgrade();
          }}
          onDone={() => {
            setShowUpgrade(false);
            runStore.dismissUpgrade();
            api.config.get().then(setCfg).catch(() => {});
          }}
        />
      )}
    </div>
  );
}

function Results({ result }: { result: RunOutput }) {
  const [open, setOpen] = useState<string | null>(result.repos.find((r) => r.pr)?.id ?? null);
  return (
    <div className="space-y-4 animate-fade-up">
      <Panel className="flex flex-wrap items-center justify-between gap-6 p-6">
        <div className="flex items-baseline gap-3">
          <span className="text-4xl font-bold text-accent tnum">{result.prsOpened}</span>
          <div className="text-[13px] text-content-muted">
            <div className="font-medium text-content">pull request(s) opened</div>
            <div className="text-content-faint">{result.reposAffected}/{result.reposScanned} repos affected</div>
          </div>
        </div>
        <div className="flex gap-6 text-center">
          <Stat label="Changes" value={result.changes.length} />
          <Stat label="Repos scanned" value={result.reposScanned} />
          <Stat label="Affected" value={result.reposAffected} tone="text-rose" />
        </div>
      </Panel>

      <StatusMatrix result={result} />

      {result.repos.length === 0 ? (
        <Empty label="No repos were scanned. Select repos in Connect." />
      ) : (
        <div className="space-y-3">
          {result.repos.map((r) => (
            <Panel key={r.id} className={`overflow-hidden ${r.affected ? "ring-1 ring-inset ring-accent/20" : ""}`}>
              <button className="flex w-full items-center justify-between gap-3 p-5 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <div className="flex items-center gap-3">
                  <span className={`h-2 w-2 rounded-full ${r.error ? "bg-rose" : r.affected ? "bg-accent" : "bg-content-faint"}`} />
                  <span className="font-mono text-[13px] text-content">{r.fullName}</span>
                  {r.error && <Chip tone="rose">error</Chip>}
                </div>
                <div className="flex items-center gap-2 text-[12px] text-content-faint">
                  {r.filesChanged > 0 && <span>{r.filesChanged} file(s)</span>}
                  {r.filesChanged > 0 && (r.verified ? <Chip tone="emerald">verified</Chip> : <Chip tone="amber">check</Chip>)}
                  {r.unresolved > 0 && <span className="text-amber">{r.unresolved} to review</span>}
                  {r.pr ? (
                    <a href={r.pr.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">PR #{r.pr.number} ↗</a>
                  ) : r.affected ? (
                    <Chip tone="amber">no PR</Chip>
                  ) : (
                    <Chip tone="emerald">clean</Chip>
                  )}
                </div>
              </button>
              {open === r.id && (
                <div className="border-t border-line">
                  {r.error && <div className="px-5 py-3 text-[13px] text-rose">{r.error}</div>}
                  {r.diffs.map((d) => (
                    <div key={d.filePath}>
                      <div className="flex items-center gap-2 border-t border-line bg-white/[0.02] px-5 py-2 font-mono text-[12px] text-content-muted">
                        <LangBadge lang={d.language.toUpperCase()} /> {d.filePath}
                      </div>
                      <div className="max-h-64 overflow-y-auto p-4"><DiffView before={d.before} after={d.after} /></div>
                    </div>
                  ))}
                  {r.flagged.length > 0 && (
                    <div className="border-t border-line px-5 py-3 text-[12px]">
                      <div className="mb-1 font-semibold text-amber">Needs manual attention</div>
                      {r.flagged.map((f) => (
                        <div key={f.filePath} className="text-content-muted">• {f.filePath}{f.note ? ` — ${f.note}` : ""}</div>
                      ))}
                    </div>
                  )}
                  {!r.error && r.diffs.length === 0 && r.flagged.length === 0 && (
                    <div className="px-5 py-3 text-[13px] text-content-faint">No affected code found in this repo.</div>
                  )}
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <div className={`text-2xl font-bold tabular-nums ${tone ?? "text-content"}`}>{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-content-faint">{label}</div>
    </div>
  );
}
