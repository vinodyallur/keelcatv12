import { useEffect, useMemo, useState } from "react";
import { api, type RunRecord, type AuditEntry, type RunRepoResult, type LogExportType } from "../api";
import { Panel, SectionHead, Chip, Empty, ImpactChip } from "./ui";
import type { ChangeImpact } from "../api";

const SOURCE_TONE: Record<string, "accent" | "violet" | "sky" | "amber"> = {
  CHANGELOG: "accent",
  MANUAL: "sky",
  WATCH: "violet",
  GODMODE: "accent",
  WEBHOOK: "amber",
};

export default function Runs() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [live, setLive] = useState(true);

  async function refresh() {
    const [r, a] = await Promise.all([api.runs(), api.activity()]);
    setRuns(r);
    setAudit(a);
  }
  useEffect(() => {
    refresh();
    if (!live) return;
    const id = window.setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [live]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return audit;
    return audit.filter((e) => e.message.toLowerCase().includes(q) || e.kind.toLowerCase().includes(q));
  }, [audit, filter]);

  return (
    <div className="animate-fade-up space-y-6">
      <SectionHead
        eyebrow="History"
        title="Changelogs, PRs & activity"
        desc="Every changelog — from any channel — with its tracking ID, the PRs it opened, and their status. Export any of it to Excel."
        right={
          <label className="flex items-center gap-2 text-[12px] text-content-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald animate-pulse" : "bg-content-faint"}`} />
            <button className="btn-ghost text-[12px]" onClick={() => setLive((v) => !v)}>{live ? "live" : "paused"}</button>
          </label>
        }
      />

      <ExportPanel runs={runs} />

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-3 text-[13px] font-semibold text-content">Changelogs → PRs</div>
          {runs.length === 0 ? (
            <Empty label="No changelogs processed yet." />
          ) : (
            <div className="space-y-2.5">
              {runs.map((r) => <RunCard key={r.id} run={r} />)}
            </div>
          )}
        </div>
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-[13px] font-semibold text-content">Activity log</div>
            <input
              className="field max-w-[180px] py-1.5 text-[12px]"
              placeholder="filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <Panel className="overflow-hidden">
            {filtered.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-[13px] text-content-faint">{audit.length ? "No matching entries." : "No activity yet."}</div>
            ) : (
              <div className="max-h-[560px] divide-y divide-line overflow-y-auto">
                {filtered.map((e) => (
                  <div key={e.id} className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-white/[0.02]">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color(e.kind) }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-content-muted">{e.message}</div>
                      <div className="mt-0.5 text-[11px] text-content-faint">{new Date(e.at).toLocaleString()} · {e.kind.toLowerCase()}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function RunCard({ run }: { run: RunRecord }) {
  const [open, setOpen] = useState(false);
  const results = run.results ?? [];
  const impacts = [...new Set(results.flatMap((x) => x.impacts))] as ChangeImpact[];
  const copyId = () => navigator.clipboard?.writeText(run.id);

  return (
    <Panel className="overflow-hidden">
      <button className="flex w-full items-center justify-between gap-3 p-4 text-left" onClick={() => setOpen((v) => !v)}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={run.status === "DONE" ? "accent" : run.status === "ERROR" ? "rose" : "amber"}>{run.status.toLowerCase()}</Chip>
            <Chip tone={SOURCE_TONE[run.source] ?? "neutral"}>{run.source.toLowerCase()}</Chip>
            <span className="text-[13px] text-content">{run.changeCount} change(s)</span>
            {impacts.map((im) => <ImpactChip key={im} impact={im} />)}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-content-faint">
            <span>{new Date(run.at).toLocaleString()}</span>
            {run.sourceName && <span>· {run.sourceName}</span>}
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="font-mono text-[10px] text-content-faint">id: {run.id}</span>
            <button
              className="rounded border border-line px-1.5 py-0.5 text-[10px] text-content-faint hover:text-content"
              onClick={(e) => { e.stopPropagation(); copyId(); }}
              title="Copy tracking ID"
            >
              copy
            </button>
          </div>
          {run.error && <div className="mt-1 text-[11px] text-rose">{run.error}</div>}
        </div>
        <div className="shrink-0 text-right text-[12px] text-content-muted">
          <div>{run.reposAffected}/{run.reposScanned} affected</div>
          <div className="text-accent">{run.prsOpened} PR(s)</div>
          <div className="mt-1 text-[11px] text-content-faint">{open ? "▲" : "▼"}</div>
        </div>
      </button>

      {open && (
        <div className="border-t border-line">
          {results.length === 0 ? (
            <div className="px-4 py-3 text-[12px] text-content-faint">No per-repo detail recorded for this changelog.</div>
          ) : (
            <div className="divide-y divide-line">
              {results.map((res) => <PrRow key={res.fullName} res={res} />)}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function PrRow({ res }: { res: RunRepoResult }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${res.error ? "bg-rose" : res.affected ? "bg-accent" : "bg-content-faint"}`} />
          <span className="truncate font-mono text-[12px] text-content">{res.fullName}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {(res.impacts as ChangeImpact[]).map((im) => <ImpactChip key={im} impact={im} />)}
          {res.filesChanged > 0 && <span className="text-[11px] text-content-faint">{res.filesChanged} file(s)</span>}
          {res.unresolved > 0 && <span className="text-[11px] text-amber">{res.unresolved} to review</span>}
          {res.tests && res.tests.ran && (
            <Chip tone={res.tests.ok ? "emerald" : "rose"}>{res.tests.ok ? "✓ " : "✕ "}{res.tests.summary}</Chip>
          )}
        </div>
      </div>
      <div className="shrink-0">
        {res.prStatus === "RAISED" && res.prUrl ? (
          <a
            href={res.prUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald/40 bg-emerald-soft px-2.5 py-1.5 text-[12px] font-semibold text-emerald transition-all hover:brightness-110"
          >
            ✓ PR #{res.prNumber} ↗
          </a>
        ) : res.prStatus === "ERROR" ? (
          <Chip tone="rose">error</Chip>
        ) : res.affected ? (
          <Chip tone="amber">no PR</Chip>
        ) : (
          <Chip tone="emerald">clean</Chip>
        )}
      </div>
    </div>
  );
}

function ExportPanel({ runs }: { runs: RunRecord[] }) {
  const [type, setType] = useState<LogExportType>("prs");
  const [runId, setRunId] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setErr(null);
    try {
      await api.logs.download({ type, runId: runId || undefined, q: q || undefined });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-content">Export</label>
          <select className="field py-1.5 text-[12px]" value={type} onChange={(e) => setType(e.target.value as LogExportType)}>
            <option value="prs">PRs (per repo)</option>
            <option value="runs">Changelogs</option>
            <option value="audit">Activity log</option>
          </select>
        </div>
        <div className="min-w-[220px]">
          <label className="mb-1.5 block text-[12px] font-medium text-content">Changelog</label>
          <select className="field py-1.5 text-[12px]" value={runId} onChange={(e) => setRunId(e.target.value)}>
            <option value="">All changelogs</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>{new Date(r.at).toLocaleString()} · {r.source.toLowerCase()} ({r.id.slice(-6)})</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[140px]">
          <label className="mb-1.5 block text-[12px] font-medium text-content">Contains</label>
          <input className="field py-1.5 text-[12px]" placeholder="text filter…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn-accent" onClick={download} disabled={busy}>
          {busy ? "Exporting…" : "Export to Excel (CSV) ↓"}
        </button>
      </div>
      {err && <div className="mt-2 text-[12px] text-rose">{err}</div>}
    </Panel>
  );
}

function color(kind: string): string {
  if (kind === "PR_OPENED") return "#a8ff53";
  if (kind.includes("ERROR")) return "#ff6b81";
  if (kind.startsWith("TESTS")) return "#4ee0a2";
  if (kind.startsWith("RUN")) return "#a78bfa";
  if (kind.startsWith("GODMODE") || kind.startsWith("AUTO") || kind.startsWith("WATCH") || kind.startsWith("WEBHOOK")) return "#ffc35c";
  if (kind.startsWith("EMAIL") || kind.startsWith("SLACK")) return "#4ee0a2";
  if (kind.includes("CONNECT") || kind.includes("CREATED") || kind.includes("PROVIDER")) return "#5eb3ff";
  return "#5f6672";
}
