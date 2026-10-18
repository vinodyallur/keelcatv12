// Dispatch ONE consolidated result email/Slack per run to whatever channels are
// enabled. Never sends per-repo messages (that spams inboxes and trips provider
// rate limits). Failures here never break a run — they're logged instead.

import { emailConfigured, sendEmail } from "./email.js";
import { slackConfigured, sendSlack } from "./slack.js";
import { logAudit, getConfig } from "../config/store.js";

export interface NotifyRepo {
  fullName: string;
  affected: boolean;
  filesChanged: number;
  unresolved: number;
  impacts?: string[];
  tests?: { ran: boolean; ok?: boolean; summary: string } | null;
  needsAttention?: boolean;
  attentionReason?: string;
  pr: { number: number; url: string } | null;
  error?: string;
}

export interface NotifySummary {
  trigger: string;
  changeCount: number;
  reposScanned: number;
  reposAffected: number;
  prsOpened: number;
  repos: NotifyRepo[];
}

function subjectFor(s: NotifySummary): string {
  const attention = s.repos.filter((r) => r.needsAttention).length;
  if (attention > 0) return `KeelCat: ${s.prsOpened} PR${plural(s.prsOpened)} opened · ${attention} need${attention === 1 ? "s" : ""} attention`;
  if (s.prsOpened > 0) return `KeelCat: ${s.prsOpened} pull request${plural(s.prsOpened)} opened`;
  if (s.reposAffected > 0) return `KeelCat: ${s.reposAffected} repo${plural(s.reposAffected)} affected`;
  return "KeelCat: run complete — no repositories affected";
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

const C = {
  ink: "#0f1115",
  sub: "#5b6472",
  faint: "#8a93a3",
  line: "#e6e9ee",
  accent: "#2f8f4e",
  amber: "#b7791f",
  rose: "#c53030",
  bg: "#f5f6f8",
  card: "#ffffff",
};

function impactPills(impacts?: string[]): string {
  if (!impacts?.length) return "";
  const map: Record<string, string> = { BREAKING: C.rose, DEPRECATION: C.amber, NEW_FEATURE: C.accent };
  return impacts
    .map((im) => {
      const color = map[im] ?? C.sub;
      const label = im.replace("_", " ").toLowerCase();
      return `<span style="display:inline-block;padding:1px 8px;margin:0 4px 0 0;border-radius:10px;font-size:11px;color:${color};border:1px solid ${color}55;background:${color}11">${label}</span>`;
    })
    .join("");
}

function statusCell(r: NotifyRepo): string {
  if (r.error) return `<span style="color:${C.rose};font-weight:600">Error</span><div style="color:${C.faint};font-size:12px">${escapeHtml(r.error)}</div>`;
  if (r.pr)
    return `<a href="${r.pr.url}" style="color:${C.accent};font-weight:600;text-decoration:none">PR #${r.pr.number} &rarr;</a>${
      r.needsAttention ? `<div style="color:${C.amber};font-size:12px">needs review</div>` : ""
    }`;
  if (r.needsAttention) return `<span style="color:${C.amber};font-weight:600">Needs attention</span>`;
  if (r.affected) return `<span style="color:${C.sub}">${r.filesChanged} file${plural(r.filesChanged)}, no PR</span>`;
  return `<span style="color:${C.accent}">Clean</span>`;
}

function testsCell(r: NotifyRepo): string {
  if (!r.tests) return `<span style="color:${C.faint}">—</span>`;
  if (!r.tests.ran) return `<span style="color:${C.faint}">skipped</span>`;
  const color = r.tests.ok ? C.accent : C.rose;
  return `<span style="color:${color};font-weight:600">${r.tests.ok ? "✓" : "✕"} ${escapeHtml(r.tests.summary)}</span>`;
}

function emailHtml(s: NotifySummary): string {
  const affected = s.repos.filter((r) => r.affected || r.error || r.needsAttention);
  const attention = s.repos.filter((r) => r.needsAttention);

  const rows = affected
    .map(
      (r) => `
      <tr>
        <td class="ast-cell ast-repo" style="padding:12px 16px;border-top:1px solid ${C.line};font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:${C.ink};word-break:break-word">
          ${escapeHtml(r.fullName)}<div style="margin-top:4px">${impactPills(r.impacts)}</div>
        </td>
        <td class="ast-cell" style="padding:12px 16px;border-top:1px solid ${C.line};font-size:13px">${statusCell(r)}</td>
        <td class="ast-cell" style="padding:12px 16px;border-top:1px solid ${C.line};font-size:13px;word-break:break-word">${testsCell(r)}</td>
      </tr>`
    )
    .join("");

  const attentionBlock = attention.length
    ? `
    <div style="margin:0 0 20px;padding:16px 18px;border:1px solid ${C.amber}44;background:${C.amber}0e;border-radius:12px">
      <div style="font-weight:700;color:${C.amber};font-size:14px;margin-bottom:8px">⚠ ${attention.length} repositor${attention.length === 1 ? "y needs" : "ies need"} your attention</div>
      ${attention
        .map(
          (r) =>
            `<div style="font-size:13px;color:${C.ink};margin:6px 0;word-break:break-word"><span style="font-family:ui-monospace,Menlo,monospace">${escapeHtml(r.fullName)}</span> — <span style="color:${C.sub}">${escapeHtml(r.attentionReason ?? "review needed")}</span></div>`
        )
        .join("")}
    </div>`
    : "";

  const table = affected.length
    ? `<table role="presentation" width="100%" style="width:100%;border-collapse:collapse;table-layout:fixed;border:1px solid ${C.line};border-radius:12px;overflow:hidden">
         <tr style="background:${C.bg}">
           <th style="text-align:left;padding:10px 16px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${C.faint};width:44%">Repository</th>
           <th style="text-align:left;padding:10px 16px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${C.faint};width:30%">Pull request</th>
           <th style="text-align:left;padding:10px 16px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${C.faint};width:26%">Tests</th>
         </tr>
         ${rows}
       </table>`
    : `<div style="color:${C.sub};font-size:14px">No repositories were affected by this changelog.</div>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<style>
  body{margin:0;padding:0;background:${C.bg};}
  .ast-stat{display:inline-block;width:24%;box-sizing:border-box;text-align:center;padding:8px 4px;vertical-align:top}
  @media only screen and (max-width:600px){
    .ast-container{width:100%!important;border-radius:0!important}
    .ast-pad{padding:16px!important}
    .ast-head{padding:18px 16px!important}
    .ast-stat{width:48%!important}
    .ast-cell{padding:10px 12px!important;font-size:12px!important}
    .ast-repo{font-size:12px!important}
  }
</style>
</head>
<body>
  <div style="margin:0;padding:16px;background:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <div class="ast-container" style="max-width:640px;width:100%;margin:0 auto;background:${C.card};border:1px solid ${C.line};border-radius:16px;overflow:hidden">
      <div class="ast-head" style="padding:22px 24px;border-bottom:1px solid ${C.line}">
        <div style="font-size:16px;font-weight:800;color:${C.ink};letter-spacing:-0.02em">KeelCat</div>
        <div style="font-size:13px;color:${C.faint};margin-top:2px">Automated API migration report</div>
      </div>

      <div class="ast-pad" style="padding:24px">
        <div style="font-size:0;margin-bottom:16px">
          ${stat(s.prsOpened, "PRs opened", C.accent)}
          ${stat(s.reposAffected, "affected", C.ink)}
          ${stat(s.changeCount, "changes", C.ink)}
          ${stat(s.reposScanned, "scanned", C.sub)}
        </div>

        ${attentionBlock}

        ${table}

        <div style="margin-top:20px;font-size:12px;color:${C.faint}">
          Triggered by <b style="color:${C.sub}">${escapeHtml(s.trigger.toLowerCase())}</b>. Every fix is a reviewable pull request — KeelCat never merges automatically.
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function stat(value: number, label: string, color: string): string {
  return `<div class="ast-stat">
    <div style="font-size:26px;font-weight:800;color:${color};font-variant-numeric:tabular-nums;line-height:1.1">${value}</div>
    <div style="font-size:11px;color:${C.faint};text-transform:uppercase;letter-spacing:0.06em;margin-top:2px">${label}</div>
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function slackText(s: NotifySummary): string {
  const attention = s.repos.filter((r) => r.needsAttention);
  const lines = [
    `*KeelCat run complete* — _${s.trigger.toLowerCase()}_`,
    `${s.changeCount} change${plural(s.changeCount)} · ${s.reposAffected}/${s.reposScanned} affected · ${s.prsOpened} PR${plural(s.prsOpened)} opened`,
  ];
  for (const r of s.repos.filter((x) => x.pr)) {
    const t = r.tests?.ran ? (r.tests.ok ? " ✓ tests" : " ✕ tests") : "";
    lines.push(`• \`${r.fullName}\` — <${r.pr!.url}|PR #${r.pr!.number}>${t}`);
  }
  if (attention.length) {
    lines.push(`\n:warning: *Needs attention (${attention.length}):*`);
    for (const r of attention) lines.push(`• \`${r.fullName}\` — ${r.attentionReason ?? "review needed"}`);
  }
  return lines.join("\n");
}

/** Send ONE consolidated summary to all enabled channels. Best-effort, never throws. */
export async function notifyRun(summary: NotifySummary): Promise<void> {
  // Don't spam on no-op automated runs. Scheduled watching / God Mode polls on a
  // timer; if a poll leads to a run that changed nothing (0 affected, 0 PRs, and
  // nothing needing attention), stay silent. A flapping/dynamic watch-source URL
  // would otherwise email on every single tick. User-initiated runs (MANUAL /
  // CHANGELOG / WEBHOOK) still always report so the user gets confirmation.
  const attentionCount = summary.repos.filter((r) => r.needsAttention).length;
  const nothingHappened = summary.reposAffected === 0 && summary.prsOpened === 0 && attentionCount === 0;
  const automated = summary.trigger === "GODMODE" || summary.trigger === "WATCH";
  if (automated && nothingHappened) {
    logAudit("NOTIFY_SKIPPED", `Scheduled ${summary.trigger.toLowerCase()} run affected no repositories — no report sent.`);
    return;
  }

  const tasks: Promise<void>[] = [];
  const emailOn = emailConfigured();
  const slackOn = slackConfigured();

  if (emailOn) {
    tasks.push(
      sendEmail(subjectFor(summary), emailHtml(summary))
        .then(() => void logAudit("EMAIL_SENT", `Summary email sent (${summary.prsOpened} PR(s), ${summary.repos.filter((r) => r.needsAttention).length} need attention).`))
        .catch((e) => void logAudit("EMAIL_ERROR", `Email failed: ${(e as Error).message}`))
    );
  }
  if (slackOn) {
    tasks.push(
      sendSlack(slackText(summary))
        .then(() => void logAudit("SLACK_SENT", `Summary sent to Slack (${summary.prsOpened} PR(s)).`))
        .catch((e) => void logAudit("SLACK_ERROR", `Slack failed: ${(e as Error).message}`))
    );
  }

  // Never leave the user guessing why no report arrived: if no channel fired,
  // record exactly why in the activity log.
  if (!emailOn && !slackOn) {
    const { email } = getConfig().settings;
    const reason = email.enabled
      ? "Email is enabled but not fully configured — check SMTP host, user, recipient, and that the SMTP password is saved."
      : "No notification channel is set up — enable Email or Slack in Settings.";
    logAudit("NOTIFY_SKIPPED", `No report sent. ${reason}`);
  }

  await Promise.all(tasks);
}
