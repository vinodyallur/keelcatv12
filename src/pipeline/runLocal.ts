// Orchestrates a full client-side run:
//   1. ask the server for short-lived, repo-scoped tokens (+ run settings)
//   2. run the whole fetch → fix → verify → open-PR pipeline in THIS browser
//   3. tell the server to record the finished run (history + billing)
//
// The changelog parse happens earlier and server-side (keeps the LLM key off the
// client). Everything here runs on the visitor's machine — their repo code never
// passes through our servers.

import { api, type ChangeSpec, type RunOutput, type RepoRunResult, type BillingInfo } from "../api";
import { runChangesLocal, type RepoToken } from "./run";

export interface LocalRunResult extends RunOutput {
  runId?: string;
  billing?: BillingInfo;
  /** Repos the server could not authorize (token mint failed) — informational. */
  tokenErrors?: { fullName: string; error: string }[];
}

export interface LocalRunHooks {
  /** Fired once the repo list (with tokens) is known, before any repo runs. */
  onStart?: (total: number) => void;
  onRepoStart?: (repo: RepoToken) => void;
  onRepoDone?: (r: RepoRunResult) => void;
}

/**
 * Run the given changes across the selected repos, entirely in the browser.
 * Throws on a 402 (out of free runs) exactly like the server run path, so the
 * existing upgrade-prompt handling still works.
 */
export async function runLocal(
  changes: ChangeSpec[],
  changelogText?: string,
  hooks?: LocalRunHooks
): Promise<LocalRunResult> {
  // 1. Short-lived tokens + settings from the server (also enforces the paywall).
  const tok = await api.runToken();
  hooks?.onStart?.(tok.repos.length);

  // 2. The heavy pipeline, on the visitor's CPU.
  const out = await runChangesLocal(changes, tok.repos, {
    settings: tok.settings,
    onRepoStart: hooks?.onRepoStart,
    onRepoDone: (r) => {
      hooks?.onRepoDone?.(r);
      // Report this repo immediately so the Repositories view flips it from
      // "raising…" to its final status live, without waiting for the whole run.
      void api.runRepoResult(r).catch(() => {});
    },
  });

  // 3. Record it so the Runs history + free-run counter stay accurate. Best
  // effort — a failed record shouldn't lose the run the user just watched.
  let runId: string | undefined;
  let billing: BillingInfo | undefined;
  try {
    const rec = await api.runRecord({ ...out, changelogText });
    runId = rec.runId;
    billing = rec.billing;
  } catch {
    /* recording is non-critical; the PRs are already open */
  }

  return { ...out, runId, billing, tokenErrors: tok.errors };
}
