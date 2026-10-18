// Security pipeline: run the static scanner across every selected repo, and
// across open pull requests (yours or anyone else's). Repo scans build the
// dashboard; PR scans post an advisory review comment so risky PRs get flagged
// before they're merged. Read-only against GitHub except for the PR comment.

import { fetchRepoFiles, resolveBase, type RepoRef } from "../integrations/github.js";
import { octokitForRepo } from "../integrations/credentials.js";
import { getSelectedRepos, logAudit } from "../config/store.js";
import { scanFiles, scanPatch, summarize, type Finding, type ScanSummary } from "../core/security-scan.js";

export interface RepoSecurityResult {
  id: string;
  fullName: string;
  scannedFiles: number;
  summary: ScanSummary;
  findings: Finding[];
  error?: string;
}

export interface SecurityScan {
  at: string;
  repos: RepoSecurityResult[];
  totals: ScanSummary;
}

export interface PrSecurityResult {
  repo: string;
  number: number;
  title: string;
  author: string;
  url: string;
  headSha: string;
  summary: ScanSummary;
  findings: Finding[];
  commented: boolean;
  error?: string;
}

export interface PrScan {
  at: string;
  prs: PrSecurityResult[];
  totals: ScanSummary;
}

let lastRepoScan: SecurityScan | null = null;
let lastPrScan: PrScan | null = null;
const reportedPrs = new Set<string>(); // `${repo}#${number}@${headSha}`

export function getLastSecurityScan(): SecurityScan | null {
  return lastRepoScan;
}
export function getLastPrScan(): PrScan | null {
  return lastPrScan;
}

function combine(all: Finding[]): ScanSummary {
  return summarize(all);
}

/** Scan every selected repo's default branch for threats. */
export async function scanAllRepos(): Promise<SecurityScan> {
  const repos = getSelectedRepos();
  logAudit("SECURITY_SCAN_STARTED", `Scanning ${repos.length} repo(s) for threats.`);

  const results: RepoSecurityResult[] = [];
  for (const repo of repos) {
    const ref: RepoRef = { owner: repo.owner, repo: repo.repo };
    try {
      const octokit = await octokitForRepo(repo);
      const base = await resolveBase({ octokit }, ref);
      const files = await fetchRepoFiles({ octokit }, ref, base);
      const findings = scanFiles(files);
      results.push({ id: repo.id, fullName: repo.fullName, scannedFiles: files.length, summary: summarize(findings), findings });
      if (summarize(findings).status === "THREAT")
        logAudit("SECURITY_THREAT", `${repo.fullName}: ${findings.length} finding(s) — ${summarize(findings).critical} critical, ${summarize(findings).high} high.`);
    } catch (e) {
      results.push({ id: repo.id, fullName: repo.fullName, scannedFiles: 0, summary: summarize([]), findings: [], error: (e as Error).message });
    }
  }

  const scan: SecurityScan = { at: new Date().toISOString(), repos: results, totals: combine(results.flatMap((r) => r.findings)) };
  lastRepoScan = scan;
  logAudit("SECURITY_SCAN_COMPLETED", `Threat scan complete: ${scan.totals.total} finding(s) across ${repos.length} repo(s).`);
  return scan;
}

/**
 * Scan open pull requests on all selected repos. For any PR with findings we
 * post ONE advisory comment (once per head commit) so re-scans don't spam.
 */
export async function scanPullRequests(postComments = true): Promise<PrScan> {
  const repos = getSelectedRepos();
  const results: PrSecurityResult[] = [];

  for (const repo of repos) {
    try {
      const octokit = await octokitForRepo(repo);
      const prs = await octokit.pulls.list({ owner: repo.owner, repo: repo.repo, state: "open", per_page: 30 });
      for (const pr of prs.data) {
        const res: PrSecurityResult = {
          repo: repo.fullName,
          number: pr.number,
          title: pr.title,
          author: pr.user?.login ?? "unknown",
          url: pr.html_url,
          headSha: pr.head.sha,
          summary: summarize([]),
          findings: [],
          commented: false,
        };
        try {
          const files = await octokit.pulls.listFiles({ owner: repo.owner, repo: repo.repo, pull_number: pr.number, per_page: 100 });
          const findings: Finding[] = [];
          for (const f of files.data) {
            if (f.patch && f.filename) findings.push(...scanPatch(f.filename, f.patch));
          }
          res.findings = findings;
          res.summary = summarize(findings);

          const key = `${repo.fullName}#${pr.number}@${pr.head.sha}`;
          if (postComments && findings.length > 0 && !reportedPrs.has(key)) {
            await octokit.issues.createComment({
              owner: repo.owner,
              repo: repo.repo,
              issue_number: pr.number,
              body: renderPrComment(res),
            });
            reportedPrs.add(key);
            res.commented = true;
            logAudit("SECURITY_PR_FLAGGED", `Flagged PR #${pr.number} on ${repo.fullName} — ${findings.length} finding(s).`);
          }
        } catch (e) {
          res.error = (e as Error).message;
        }
        results.push(res);
      }
    } catch (e) {
      logAudit("SECURITY_PR_ERROR", `${repo.fullName}: ${(e as Error).message}`);
    }
  }

  const scan: PrScan = { at: new Date().toISOString(), prs: results, totals: combine(results.flatMap((r) => r.findings)) };
  lastPrScan = scan;
  return scan;
}

function renderPrComment(res: PrSecurityResult): string {
  const bySev = (s: string) => res.findings.filter((f) => f.severity === s);
  const lines = [
    "## 🛡️ KeelCat security review",
    "",
    `Automated scan of this PR's changes found **${res.findings.length}** potential issue(s): ` +
      `${res.summary.critical} critical · ${res.summary.high} high · ${res.summary.medium} medium · ${res.summary.low} low.`,
    "",
  ];
  for (const sev of ["CRITICAL", "HIGH", "MEDIUM", "LOW"]) {
    const items = bySev(sev);
    if (!items.length) continue;
    lines.push(`### ${sev}`);
    for (const f of items.slice(0, 20)) lines.push(`- \`${f.filePath}:${f.line}\` — **${f.title}** \`${f.snippet}\``);
    lines.push("");
  }
  lines.push("---", "_Advisory only. Reported by KeelCat — please review before merging._");
  return lines.join("\n");
}
