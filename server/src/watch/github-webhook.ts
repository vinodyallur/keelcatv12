// Instant, webhook-driven changelog detection.
//
// A GitHub webhook (push event) fires the moment a provider commits to their
// changelog. We verify the signature, pull the new content of any changed
// changelog file, and route it through the exact same ingestion path as God
// Mode polling and the manual webhook — so a PR is waiting seconds after the
// provider ships a breaking change. No polling interval involved.

import { createHmac, timingSafeEqual } from "node:crypto";
import { resolveOctokit } from "../pipeline/run.js";
import { logAudit, getWebhookSecret, listTenantIds } from "../config/store.js";
import { runWithTenant } from "../auth/context.js";
import { ingestChangelog } from "./auto.js";
import type { RunOutput } from "../pipeline/run.js";

/**
 * Verify GitHub's `x-hub-signature-256` header against the raw request body.
 * Constant-time comparison; returns false for any malformed/missing input.
 */
export function verifySignature(secret: string, rawBody: Buffer | string, signature?: string): boolean {
  if (!secret || !signature) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Route an inbound GitHub webhook to the tenant it belongs to.
 *
 * GitHub signs the body with the per-webhook Secret. Each tenant stores their
 * own secret, so we try every tenant's secret against the signature and return
 * the first that verifies. This is how a multi-tenant deploy knows whose repos
 * and credentials to use — without it, every webhook would fall back to the
 * owner workspace.
 */
export function resolveWebhookTenant(rawBody: Buffer | string, signature?: string): string | null {
  if (!signature) return null;
  for (const tid of listTenantIds()) {
    const secret = runWithTenant({ tenantId: tid }, () => getWebhookSecret());
    if (secret && verifySignature(secret, rawBody, signature)) return tid;
  }
  return null;
}

/** Whether ANY tenant has a webhook secret configured (for clearer error messaging). */
export function anyWebhookSecretConfigured(): boolean {
  return listTenantIds().some((tid) => runWithTenant({ tenantId: tid }, () => Boolean(getWebhookSecret())));
}

/** True for files that look like a changelog / release notes. */
export function isChangelogPath(path: string): boolean {
  const base = path.split("/").pop()?.toLowerCase() ?? "";
  if (/^(changelog|changes|history|releases?|release[-_.]notes|news)\.(md|markdown|txt|rst)$/.test(base)) return true;
  if (/changelog/.test(base)) return true;
  return false;
}

/** Collect every added/modified path across a push payload's commits. */
export function extractChangedPaths(payload: any): string[] {
  const commits: any[] = Array.isArray(payload?.commits) ? payload.commits : [];
  const head = payload?.head_commit;
  const all = head ? [...commits, head] : commits;
  const paths = new Set<string>();
  for (const c of all) {
    for (const p of c?.added ?? []) paths.add(p);
    for (const p of c?.modified ?? []) paths.add(p);
  }
  return [...paths];
}

export interface PushHandleResult {
  handled: boolean;
  message: string;
  changelogFiles?: string[];
  out?: RunOutput;
}

/**
 * Handle a verified `push` event: find changed changelog files, fetch their new
 * content at the pushed commit, and ingest. Uses the configured GitHub client
 * (PAT or App) — the same one that opens PRs.
 */
export async function handlePush(payload: any): Promise<PushHandleResult> {
  const repo = payload?.repository;
  const fullName: string = repo?.full_name ?? "unknown/unknown";
  const owner: string = repo?.owner?.login ?? repo?.owner?.name ?? "";
  const name: string = repo?.name ?? "";
  const afterSha: string = payload?.after ?? payload?.head_commit?.id ?? "";

  const changelogFiles = extractChangedPaths(payload).filter(isChangelogPath);
  if (changelogFiles.length === 0) {
    return { handled: false, message: `No changelog files changed in push to ${fullName}.` };
  }
  if (!owner || !name || !afterSha) {
    return { handled: false, message: "Push payload missing repository/commit info." };
  }

  logAudit("WEBHOOK_PUSH", `Push to ${fullName} touched ${changelogFiles.join(", ")} — fetching new content.`);

  const octokit = await resolveOctokit();
  const parts: string[] = [];
  for (const path of changelogFiles) {
    try {
      const res = await octokit.repos.getContent({ owner, repo: name, path, ref: afterSha });
      const data: any = res.data;
      if (data && typeof data.content === "string") {
        parts.push(Buffer.from(data.content, data.encoding as BufferEncoding).toString("utf8"));
      }
    } catch (e) {
      logAudit("WEBHOOK_FETCH_ERROR", `Could not fetch ${path} from ${fullName}: ${(e as Error).message}`);
    }
  }

  const text = parts.join("\n\n").trim();
  if (!text) return { handled: false, message: "Changelog files changed but content could not be read.", changelogFiles };

  const ingest = await ingestChangelog({ text, trigger: "WEBHOOK", sourceName: fullName });
  return {
    handled: ingest.ran,
    message: ingest.ran ? `Ran pipeline from ${fullName} changelog.` : (ingest.message ?? "No actionable changes."),
    changelogFiles,
    out: ingest.out,
  };
}
