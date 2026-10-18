import { useEffect, useMemo, useState } from "react";
import { api, type ConnectedRepo, type ChangeImpact, type RunRecord, type RunTestResult } from "../api";
import { Panel, SectionHead, Chip, LangBadge, Empty, ImpactChip } from "./ui";

type PrState = "RAISING" | "RAISED" | "NOT_RAISED" | "CLEAN" | "ERROR";

interface RepoRow {
  fullName: string;
  isPrivate?: boolean;
  languages: string[];
  defaultBranch?: string;
  impacts: string[];
  prState: PrState;
  prNumber?: number;
  prUrl?: string;
  tests?: RunTestResult;
  affected: boolean;
  unresolved: number;
  filesChanged: number;
  needsAttention?: boolean;
  at?: string;
  error?: string;
}

export default function Repositories() {
  const [repos, setRepos] = useState<ConnectedRepo[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [changelog, setChangelog] = useState(""); // "" = live (latest per repo)
  const [live, setLive] = useState(true);

  async function refresh() {
    try {
      const [c, r] = await Promise.all([api.config.get(), api.runs()]);
      setRepos(c.repos);
      setRuns(r);
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    refresh();
    if (!live) return;
    const id = window.setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [live]);

  // Repo metadata (private/langs/branch) keyed by full name, for joining onto run results.
  const meta = useMemo(() => {
    const m = new Map<string, ConnectedRepo>();
    for (const r of repos) m.set(r.fullName, r);
    return m;
  }, [repos]);

  const rows = useMemo<RepoRow[]>(() => {
    if (changelog) {
      const run = runs.find((x) => x.id === changelog);
      if (!run?.results) return [];
      // Show every repo this changelog touched (not just active ones) so past
      // runs can be fully inspected — impacts, PR status, and test results.
      return run.results.map((res) => {
        const rm = meta.get(res.fullName);
        const prState: PrState =
          res.prStatus === "RAISED" ? "RAISED" : res.error || res.prStatus === "ERROR" ? "ERROR" : res.affected ? "NOT_RAISED" : "CLEAN";
        return {
          fullName: res.fullName,
          isPrivate: rm?.private,
          languages: rm?.languages ?? [],
          defaultBranch: rm?.defaultBranch,
          impacts: res.impacts ?? [],
          prState,
          prNumber: res.prNumber,
          prUrl: res.prUrl,
          tests: res.tests,
          affected: res.affected,
          unresolved: res.unresolved,
          filesChanged: res.filesChanged,
          needsAttention: prState === "NOT_RAISED",
          at: run.at,
          error: res.error,
        };
      });
    }

    // Live view: latest per-repo state from config, only active repos.
    return repos
      .filter((r) => {
        const lr = r.lastResult;
        return lr && (lr.affected || lr.prStatus === "RAISING" || lr.prStatus === "RAISED" || Boolean(lr.error));
      })
      .map((r) => {
        const lr = r.lastResult!;
        const prState = (lr.prStatus as PrState) ?? (lr.error ? "ERROR" : lr.affected ? "NOT_RAISED" : "CLEAN");
        return {
          fullName: r.fullName,
          isPrivate: r.private,
          languages: r.languages,
          defaultBranch: r.defaultBranch,
          impacts: lr.impacts ?? [],
          prState,
          prNumber: lr.prNumber,
          prUrl: lr.prUrl,
          tests: lr.tests,
          affected: lr.affected,
          unresolved: lr.unresolved,
          filesChanged: lr.filesChanged,
          needsAttention: lr.needsAttention,
          at: r.lastRunAt,
          error: lr.error,
        };
      })
      .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  }, [changelog, runs, repos, meta]);

  return (
    <div className="animate-fade-up">
      <SectionHead
        eyebrow="Repositories"
        title="Active repositories"
        desc="Live view of the repos KeelCat is changing right now — impact detected, PR status, and test results — updating in real time. Filter by a specific changelog to see exactly what it touched."
        right={
          <label className="flex items-center gap-1.5 text-[12px] text-content-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald animate-pulse" : "bg-content-faint"}`} />
            <button className="btn-ghost text-[12px]" onClick={() => setLive((v) => !v)}>{live ? "live" : "paused"}</button>
          </label>
        }
      />

      <Panel className="mb-5 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px]">
            <label className="mb-1.5 block text-[12px] font-medium text-content">Filter by changelog</label>
            <select className="field py-1.5 text-[12px]" value={changelog} onChange={(e) => setChangelog(e.target.value)}>
              <option value="">Live — latest activity</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {new Date(r.at).toLocaleString()} · {r.source.toLowerCase()} · {r.changeCount} change(s) ({r.id.slice(-6)})
                </option>
              ))}
            </select>
          </div>
          <div className="text-[12px] text-content-faint">{rows.length} active repo{rows.length === 1 ? "" : "s"}</div>
        </div>
      </Panel>

      {rows.length === 0 ? (
        <Empty
          icon="⊚"
          label={
            changelog
              ? "This changelog didn't affect any repositories."
              : "No active repositories yet. When a changelog runs, affected repos appear here live. Select repos in Connect and post a changelog."
          }
        />
      ) : (
        <Panel className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-[0.14em] text-content-faint">
                  <Th className="w-[26%]">Repository</Th>
                  <Th className="w-[22%]">Status</Th>
                  <Th className="w-[15%]">PR status</Th>
                  <Th className="w-[12%]">Pull request</Th>
                  <Th className="w-[11%]">Tests</Th>
                  <Th className="w-[14%]">Updated</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Row key={row.fullName} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

function Row({ row }: { row: RepoRow }) {
  const impacts = row.impacts as ChangeImpact[];
  return (
    <tr className="border-b border-line/60 align-top transition-colors hover:bg-white/[0.02]">
      <Td>
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-[13px] text-content">{row.fullName}</span>
          <Chip tone={row.isPrivate ? "neutral" : "sky"}>{row.isPrivate ? "private" : "public"}</Chip>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-content-faint">
          {row.languages.length ? row.languages.map((l) => <LangBadge key={l} lang={l} />) : <span>—</span>}
          {row.defaultBranch && <span>· {row.defaultBranch}</span>}
        </div>
      </Td>

      <Td>
        {row.error ? (
          <Chip tone="rose">error</Chip>
        ) : impacts.length ? (
          <div className="flex flex-wrap gap-1.5">{impacts.map((im) => <ImpactChip key={im} impact={im} />)}</div>
        ) : row.affected ? (
          <Chip tone="amber">affected</Chip>
        ) : (
          <Chip tone="emerald">no changes</Chip>
        )}
        {row.unresolved > 0 && <div className="mt-1 text-[11px] text-amber">{row.unresolved} to review</div>}
      </Td>

      <Td><PrStatus row={row} /></Td>

      <Td>
        {row.prUrl ? (
          <a href={row.prUrl} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-accent hover:underline">PR #{row.prNumber} ↗</a>
        ) : (
          <span className="text-[12px] text-content-faint">—</span>
        )}
      </Td>

      <Td><Tests tests={row.tests} /></Td>

      <Td>
        <span className="text-[11px] text-content-faint">{row.at ? new Date(row.at).toLocaleTimeString() : "—"}</span>
      </Td>
    </tr>
  );
}

function PrStatus({ row }: { row: RepoRow }) {
  switch (row.prState) {
    case "RAISING":
      return (
        <span className="inline-flex items-center gap-1.5 text-[12px] text-amber">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber" /> raising…
        </span>
      );
    case "RAISED":
      return <Chip tone="emerald">✓ raised</Chip>;
    case "ERROR":
      return <Chip tone="rose">error</Chip>;
    case "CLEAN":
      return <Chip tone="neutral">no PR needed</Chip>;
    default:
      return <Chip tone="amber">{row.needsAttention ? "needs review" : "not raised"}</Chip>;
  }
}

function Tests({ tests: t }: { tests?: RunTestResult }) {
  if (!t) return <span className="text-[12px] text-content-faint">—</span>;
  if (!t.ran) return <span className="text-[11px] text-content-faint" title={t.summary}>skipped</span>;
  const label = t.total != null ? `${t.passed ?? 0}/${t.total}` : t.ok ? "pass" : "fail";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-semibold ring-1 ring-inset ${
        t.ok ? "bg-emerald-soft text-emerald ring-emerald/30" : "bg-rose-soft text-rose ring-rose/30"
      }`}
      title={t.command ? `${t.summary} · ${t.command}` : t.summary}
    >
      {t.ok ? "✓" : "✕"} {label}
    </span>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-5 py-3 font-semibold ${className}`}>{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-5 py-4">{children}</td>;
}
