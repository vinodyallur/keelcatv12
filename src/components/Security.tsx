import { useEffect, useState } from "react";
import { api, type SecurityScan, type PrScan, type Severity, type RepoSecurityResult, type Finding } from "../api";
import { Panel, SectionHead, Chip, Spinner, Empty } from "./ui";

const SEV: Record<Severity, { text: string; dot: string; label: string }> = {
  CRITICAL: { text: "text-rose", dot: "bg-rose", label: "Critical" },
  HIGH: { text: "text-amber", dot: "bg-amber", label: "High" },
  MEDIUM: { text: "text-sky", dot: "bg-sky", label: "Medium" },
  LOW: { text: "text-content-muted", dot: "bg-content-faint", label: "Low" },
};

function StatusChip({ status }: { status: "CLEAN" | "WARN" | "THREAT" }) {
  if (status === "THREAT") return <Chip tone="rose">threats</Chip>;
  if (status === "WARN") return <Chip tone="amber">warnings</Chip>;
  return <Chip tone="emerald">clean</Chip>;
}

function SevBar({ s }: { s: { critical: number; high: number; medium: number; low: number } }) {
  const items: [Severity, number][] = [
    ["CRITICAL", s.critical],
    ["HIGH", s.high],
    ["MEDIUM", s.medium],
    ["LOW", s.low],
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(([k, n]) =>
        n > 0 ? (
          <span key={k} className={`flex items-center gap-1.5 text-[11px] ${SEV[k].text}`}>
            <span className={`h-2 w-2 rounded-full ${SEV[k].dot}`} />
            {n} {SEV[k].label.toLowerCase()}
          </span>
        ) : null
      )}
    </div>
  );
}

function FindingList({ findings }: { findings: Finding[] }) {
  return (
    <div className="max-h-72 divide-y divide-line overflow-y-auto">
      {findings.map((f, i) => (
        <div key={i} className="flex items-start gap-3 px-5 py-2.5">
          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${SEV[f.severity].dot}`} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-[12px] font-medium ${SEV[f.severity].text}`}>{f.title}</span>
              <span className="font-mono text-[11px] text-content-faint">{f.filePath}:{f.line}</span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-content-muted">{f.snippet}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Security() {
  const [scan, setScan] = useState<SecurityScan | null>(null);
  const [prScan, setPrScan] = useState<PrScan | null>(null);
  const [busy, setBusy] = useState(false);
  const [prBusy, setPrBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api.security.status().then((s) => s && setScan(s)).catch(() => {});
    api.security.prs().then((s) => s && setPrScan(s)).catch(() => {});
  }, []);

  async function runScan() {
    setBusy(true);
    setError(null);
    try {
      setScan(await api.security.scan());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function runPrScan() {
    setPrBusy(true);
    setError(null);
    try {
      setPrScan(await api.security.scanPrs(true));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPrBusy(false);
    }
  }

  const t = scan?.totals;

  return (
    <div className="animate-fade-up space-y-6">
      <SectionHead
        eyebrow="Security"
        title="Threat scanner"
        desc="Static scan across every selected repo for leaked secrets, remote-code-execution sinks, obfuscated payloads, and supply-chain tricks. It also reviews open pull requests and comments a report on risky ones."
        right={
          <div className="flex gap-2">
            <button className="btn-outline" onClick={runPrScan} disabled={prBusy}>
              {prBusy ? <Spinner label="Scanning PRs…" /> : "Scan open PRs"}
            </button>
            <button className="btn-accent" onClick={runScan} disabled={busy}>
              {busy ? <Spinner label="Scanning…" /> : "Scan all repos"}
            </button>
          </div>
        }
      />

      {error && <Panel className="border-rose/30 bg-rose-soft p-4 text-[13px] text-rose">{error}</Panel>}

      {/* Totals */}
      {t && (
        <Panel className="flex flex-wrap items-center justify-between gap-6 p-6">
          <div className="flex items-baseline gap-3">
            <span className={`text-4xl font-bold tnum ${t.status === "THREAT" ? "text-rose" : t.status === "WARN" ? "text-amber" : "text-emerald"}`}>{t.total}</span>
            <div className="text-[13px] text-content-muted">
              <div className="font-medium text-content">finding(s) across {scan?.repos.length ?? 0} repo(s)</div>
              <div className="text-content-faint">last scan {scan ? new Date(scan.at).toLocaleString() : "—"}</div>
            </div>
          </div>
          <SevBar s={t} />
        </Panel>
      )}

      {/* Repo dashboard */}
      {!scan ? (
        <Empty icon="🛡️" label="No scan yet. Click “Scan all repos” to check your fleet for threats." />
      ) : (
        <div className="space-y-3">
          {scan.repos.map((r: RepoSecurityResult) => (
            <Panel key={r.id} className={`overflow-hidden ${r.summary.status === "THREAT" ? "ring-1 ring-inset ring-rose/30" : ""}`}>
              <button className="flex w-full items-center justify-between gap-3 p-5 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <div className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${r.error ? "bg-rose" : r.summary.status === "THREAT" ? "bg-rose" : r.summary.status === "WARN" ? "bg-amber" : "bg-emerald"}`} />
                  <span className="font-mono text-[13px] text-content">{r.fullName}</span>
                  {r.error ? <Chip tone="rose">error</Chip> : <StatusChip status={r.summary.status} />}
                </div>
                <div className="flex items-center gap-3">
                  <SevBar s={r.summary} />
                  <span className="text-[12px] text-content-faint">{r.scannedFiles} files</span>
                </div>
              </button>
              {open === r.id && (
                <div className="border-t border-line">
                  {r.error ? (
                    <div className="px-5 py-3 text-[13px] text-rose">{r.error}</div>
                  ) : r.findings.length === 0 ? (
                    <div className="px-5 py-3 text-[13px] text-emerald">No threats found. This repo is clean.</div>
                  ) : (
                    <FindingList findings={r.findings} />
                  )}
                </div>
              )}
            </Panel>
          ))}
        </div>
      )}

      {/* PR scan */}
      <div>
        <div className="mb-3 mt-2 text-[13px] font-semibold text-content">Open pull requests</div>
        {!prScan ? (
          <Empty label="No PR scan yet. Click “Scan open PRs” to review every open PR (yours or anyone else's)." />
        ) : prScan.prs.length === 0 ? (
          <Empty label="No open pull requests on the selected repos." />
        ) : (
          <div className="space-y-3">
            {prScan.prs.map((p) => (
              <Panel key={`${p.repo}#${p.number}`} className={`p-5 ${p.summary.status === "THREAT" ? "ring-1 ring-inset ring-rose/30" : ""}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${p.summary.status === "THREAT" ? "bg-rose" : p.summary.status === "WARN" ? "bg-amber" : "bg-emerald"}`} />
                    <a href={p.url} target="_blank" rel="noreferrer" className="font-mono text-[13px] text-content hover:text-accent">{p.repo} #{p.number}</a>
                    <span className="text-[12px] text-content-faint">by {p.author}</span>
                    {p.commented && <Chip tone="accent">commented</Chip>}
                  </div>
                  <SevBar s={p.summary} />
                </div>
                <div className="mt-1 text-[12px] text-content-muted">{p.title}</div>
                {p.findings.length > 0 && (
                  <div className="mt-3 border-t border-line pt-1">
                    <FindingList findings={p.findings} />
                  </div>
                )}
              </Panel>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
