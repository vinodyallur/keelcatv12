// Resolve authenticated GitHub clients per connected account / repo.
// KeelCat supports many GitHub identities at once (multiple PATs and/or App
// installations), so every repo must be accessed with the credential of the
// account it was listed from — not one global token.

import { Octokit } from "@octokit/rest";
import { makeClient, installationOctokit, getInstallationToken } from "./github.js";
import {
  getAccount,
  getAccountPat,
  getAccountAppKey,
  getDefaultAccount,
  type ConnectedRepo,
  type GitHubAccount,
} from "../config/store.js";

/** Build an authenticated Octokit for a specific account. */
export async function octokitForAccount(account: GitHubAccount): Promise<Octokit> {
  if (account.mode === "app") {
    const key = getAccountAppKey(account.id);
    if (!account.appId || !key || !account.installationId) {
      throw new Error(`GitHub App account "${account.name}" is not fully configured.`);
    }
    return installationOctokit(account.appId, key, account.installationId);
  }
  const pat = getAccountPat(account.id);
  if (!pat) throw new Error(`No token stored for account "${account.name}".`);
  return makeClient(pat).octokit;
}

/** Mint a raw token for a specific account (for git clone in the sandbox). */
export async function tokenForAccount(account: GitHubAccount): Promise<string> {
  if (account.mode === "app") {
    const key = getAccountAppKey(account.id);
    if (!account.appId || !key || !account.installationId) {
      throw new Error(`GitHub App account "${account.name}" is not fully configured.`);
    }
    return getInstallationToken(account.appId, key, account.installationId);
  }
  const pat = getAccountPat(account.id);
  if (!pat) throw new Error(`No token stored for account "${account.name}".`);
  return pat;
}

function accountForRepo(repo: ConnectedRepo): GitHubAccount {
  const acct = repo.accountId ? getAccount(repo.accountId) : undefined;
  const resolved = acct ?? getDefaultAccount();
  if (!resolved) throw new Error("No GitHub account connected. Add one in Connect.");
  return resolved;
}

/** Octokit authenticated as the account that owns this repo. */
export async function octokitForRepo(repo: ConnectedRepo): Promise<Octokit> {
  return octokitForAccount(accountForRepo(repo));
}

/** Raw token for the account that owns this repo (for the test sandbox). */
export async function tokenForRepo(repo: ConnectedRepo): Promise<string> {
  return tokenForAccount(accountForRepo(repo));
}

/**
 * Any-valid-token Octokit, used for reading public provider changelogs where the
 * specific identity doesn't matter. Uses the first enabled account.
 */
export async function defaultOctokit(): Promise<Octokit> {
  const acct = getDefaultAccount();
  if (!acct) throw new Error("No GitHub account connected. Add one in Connect.");
  return octokitForAccount(acct);
}
