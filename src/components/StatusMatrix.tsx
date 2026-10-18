import type { RunOutput, ChangeStatus, RepoRunResult } from "../api";

const STATUS: Record<ChangeStatus, { dot: string; ring: string; label: string; text: string }> = {
  FIXED: { dot: "bg-emerald", ring: "ring-emerald/40", label: "Fixed", text: "text-emerald" },
  REVIEW: { dot: "bg-amber", ring: "ring-amber/40", label: "Needs review", text: "text-amber" },
  INFO: { dot: "bg-sky", ring: "ring-sky/40", label: "Informational", text: "text-sky" },
  CLEAN: { dot: "bg-content-faint/50", ring: "ring-line", label: "Not affected", text: "text-content-faint" },
  ERROR: { dot: "bg-rose", ring: "ring-rose/40", label: "Error", text: "text-rose" },
};

const ORDER: ChangeStatus[] = ["FIXED", "REVIEW", "INFO", "ERROR", "CLEAN"];

function Cell({ status, title }: { status: ChangeStatus; title: string }) {
  const s = STATUS[status];
  return (
    <div className="group/cell relative flex items-center justify-center">
      <span className={`h-3.5 w-3.5 rounded-full ${s.dot} ring-2 ring-inset ${s.ring} transition-transform duration-150 group-hover/cell:scale-125`} />
      <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-canvas/95 px-2.5 py-1.5 text-[11px] shadow-xl backdrop-blur group-hover/cell:block">
        <span className={`font-medium ${s.text}`}>{s.label}</span>
        <span className="text-content-faint"> · {title}</span>
      </div>
    </div>
  );
}

function RepoStatusPill({ r }: { r: RepoRunResult }) {
  if (r.error) return <span className="chip bg-rose-soft text-rose ring-1 ring-inset ring-rose/30">error</span>;
  if (r.pr) return <span className="chip bg-emerald-soft text-emerald ring-1 ring-inset ring-emerald/30">PR opened</span>;
  if (r.unresolved > 0) return <span className="chip bg-amber-soft text-amber ring-1 ring-inset ring-amber/30">{r.unresolved} to review</span>;
  if (r.affected) return <span className="chip bg-accent-soft text-accent ring-1 ring-inset ring-accent/30">{r.filesChanged} fixed</span>;
  return <span className="chip bg-white/[0.05] text-content-faint ring-1 ring-inset ring-line">clean</span>;
}

export default function StatusMatrix({ result }: { result: RunOutput }) {
  const changes = result.changes;
  if (result.repos.length === 0 || changes.length === 0) return null;

  // Tally counts for the legend.
  const counts: Record<ChangeStatus, number> = { FIXED: 0, REVIEW: 0, INFO: 0, CLEAN: 0, ERROR: 0 };
  for (const repo of result.repos) for (const pc of repo.perChange) counts[pc.status]++;

  return (
    <div className="panel overflow-hidden animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
        <div>
          <div className="text-[14px] font-semibold text-content">Impact matrix</div>
          <div className="mt-0.5 text-[12px] text-content-faint">Every repository against every change. Hover a dot for detail.</div>
        </div>
        <div className="flex flex-wrap gap-3">
          {ORDER.map((k) => (
            <div key={k} className="flex items-center gap-1.5 text-[11px] text-content-muted">
              <span className={`h-2.5 w-2.5 rounded-full ${STATUS[k].dot}`} />
              {STATUS[k].label}
              {counts[k] > 0 && <span className="text-content-faint">· {counts[k]}</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className="sticky left-0 z-10 bg-surface px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-content-faint">
                Repository
              </th>
              {changes.map((c, i) => (
                <th key={i} className="px-2 py-3 text-center align-bottom">
                  <div className="mx-auto max-w-[92px] truncate font-mono text-[11px] text-content-muted" title={`${c.symbol} — ${c.impact}`}>
                    {c.symbol || "—"}
                  </div>
                </th>
              ))}
              <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-content-faint">Status</th>
            </tr>
          </thead>
          <tbody>
            {result.repos.map((repo, ri) => (
              <tr
                key={repo.id}
                className="border-b border-line/60 transition-colors hover:bg-white/[0.02]"
                style={{ animation: `fade-up 0.4s cubic-bezier(0.16,1,0.3,1) both`, animationDelay: `${ri * 40}ms` }}
              >
                <td className="sticky left-0 z-10 bg-surface px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12.5px] text-content">{repo.fullName}</span>
                  </div>
                </td>
                {changes.map((_, ci) => {
                  const pc = repo.perChange[ci];
                  return (
                    <td key={ci} className="px-2 py-3">
                      <Cell status={pc?.status ?? "CLEAN"} title={pc?.note ? `${pc.symbol}: ${pc.note}` : pc?.symbol ?? ""} />
                    </td>
                  );
                })}
                <td className="px-5 py-3 text-right">
                  {repo.pr ? (
                    <a href={repo.pr.url} target="_blank" rel="noreferrer" className="text-[12px] text-accent hover:underline">
                      PR #{repo.pr.number} ↗
                    </a>
                  ) : (
                    <RepoStatusPill r={repo} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
