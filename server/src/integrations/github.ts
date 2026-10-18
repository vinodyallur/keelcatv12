import { Octokit } from "@octokit/rest";
import { App } from "@octokit/app";
import type { FileToScan } from "../core/scanner.js";
import { isScannable } from "../core/languages.js";

export interface RepoRef {
  owner: string;
  repo: string;
  base?: string; // base branch; defaults to the repo's default branch
}

export interface GitHubClient {
  octokit: Octokit;
}

export function makeClient(token: string): GitHubClient {
  return { octokit: new Octokit({ auth: token.trim() }) };
}

export interface RepoListItem {
  id: string; // owner/repo
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  language: string | null;
  updatedAt: string;
}

/** List repos accessible to a PAT (most recently pushed first). */
export async function listReposForToken(token: string, perPage = 100): Promise<RepoListItem[]> {
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.repos.listForAuthenticatedUser({
    per_page: perPage,
    sort: "pushed",
    affiliation: "owner,collaborator,organization_member",
  });
  return data.map(mapRepo);
}

function mapRepo(r: any): RepoListItem {
  return {
    id: r.full_name,
    owner: r.owner.login,
    repo: r.name,
    fullName: r.full_name,
    defaultBranch: r.default_branch,
    private: r.private,
    language: r.language ?? null,
    updatedAt: r.pushed_at ?? r.updated_at,
  };
}

// ---- GitHub App mode ----

export interface AppClient {
  app: App;
}

export function makeAppClient(appId: string, privateKey: string): AppClient {
  return { app: new App({ appId, privateKey }) };
}

/**
 * Exchange a temporary GitHub App Manifest code for the created app's
 * credentials (id, slug, private key PEM, webhook secret). This is what makes
 * one-click app creation possible — no manual App ID / PEM entry needed.
 * The conversions endpoint requires no auth.
 */
export async function convertAppManifest(code: string): Promise<{
  id: number;
  slug: string;
  pem: string;
  webhook_secret?: string;
  html_url?: string;
}> {
  const octokit = new Octokit();
  const res = await octokit.request("POST /app-manifests/{code}/conversions", { code });
  const d = res.data as any;
  return { id: d.id, slug: d.slug, pem: d.pem, webhook_secret: d.webhook_secret, html_url: d.html_url };
}

export async function listAppInstallations(appId: string, privateKey: string) {
  const { app } = makeAppClient(appId, privateKey);
  const installations = await app.octokit.request("GET /app/installations", { per_page: 100 });
  return installations.data.map((i: any) => ({
    installationId: String(i.id),
    account: i.account?.login ?? "unknown",
    type: i.account?.type ?? "User",
  }));
}

export async function installationOctokit(appId: string, privateKey: string, installationId: string): Promise<Octokit> {
  // IMPORTANT: build a @octokit/rest client (has .repos/.pulls/.git) from an
  // installation token. app.getInstallationOctokit() returns a core Octokit
  // WITHOUT the REST endpoint methods, which breaks fetching files / opening PRs.
  const token = await getInstallationToken(appId, privateKey, installationId);
  return new Octokit({ auth: token });
}

/** Mint a short-lived installation access token (for git clone in the sandbox). */
export async function getInstallationToken(appId: string, privateKey: string, installationId: string): Promise<string> {
  const { app } = makeAppClient(appId, privateKey);
  const res = await app.octokit.request("POST /app/installations/{installation_id}/access_tokens", {
    installation_id: Number(installationId),
  });
  return (res.data as { token: string }).token;
}

export async function listReposForInstallation(octokit: Octokit): Promise<RepoListItem[]> {
  const { data } = await octokit.request("GET /installation/repositories", { per_page: 100 });
  return data.repositories.map(mapRepo);
}

/** Resolve the default branch if base is not provided. */
export async function resolveBase(client: GitHubClient, ref: RepoRef): Promise<string> {
  if (ref.base) return ref.base;
  const { data } = await client.octokit.repos.get({ owner: ref.owner, repo: ref.repo });
  return data.default_branch;
}

/**
 * Fetch all scannable source files from a repo branch via the git tree API.
 * Returns their paths + decoded contents.
 */
export async function fetchRepoFiles(
  client: GitHubClient,
  ref: RepoRef,
  branch: string
): Promise<FileToScan[]> {
  const { octokit } = client;
  const branchData = await octokit.repos.getBranch({ owner: ref.owner, repo: ref.repo, branch });
  const treeSha = branchData.data.commit.commit.tree.sha;
  const tree = await octokit.git.getTree({
    owner: ref.owner,
    repo: ref.repo,
    tree_sha: treeSha,
    recursive: "true",
  });

  const IGNORED = /(^|\/)(node_modules|\.git|dist|build|vendor|target|out|\.venv|__pycache__)(\/|$)/;
  const scannable = tree.data.tree.filter(
    (n) => n.type === "blob" && n.path && isScannable(n.path) && !IGNORED.test(n.path)
  );

  // Cap to keep runs fast and within rate limits; skip very large files.
  const MAX_FILES = 400;
  const MAX_BYTES = 400 * 1024;
  const files: FileToScan[] = [];
  for (const node of scannable.slice(0, MAX_FILES)) {
    if (!node.path || !node.sha) continue;
    if (typeof node.size === "number" && node.size > MAX_BYTES) continue;
    const blob = await octokit.git.getBlob({ owner: ref.owner, repo: ref.repo, file_sha: node.sha });
    const content = Buffer.from(blob.data.content, blob.data.encoding as BufferEncoding).toString("utf8");
    files.push({ filePath: node.path, content });
  }
  return files;
}

/**
 * Create (or reset) a branch from base, commit the updated files, and open a PR.
 * Idempotent per branch name: if the branch/PR already exists it is updated.
 * Never merges (design R5.4).
 */
export async function openFixPr(
  client: GitHubClient,
  ref: RepoRef,
  branch: string,
  base: string,
  updatedFiles: Record<string, string>,
  title: string,
  body: string
): Promise<{ url: string; number: number; branch: string }> {
  const { octokit } = client;
  const { owner, repo } = ref;

  // Latest commit + tree on base
  const baseRef = await octokit.git.getRef({ owner, repo, ref: `heads/${base}` });
  const baseSha = baseRef.data.object.sha;
  const baseCommit = await octokit.git.getCommit({ owner, repo, commit_sha: baseSha });

  // Create blobs for each updated file
  const treeItems = [];
  for (const [path, content] of Object.entries(updatedFiles)) {
    const blob = await octokit.git.createBlob({ owner, repo, content, encoding: "utf-8" });
    treeItems.push({ path, mode: "100644" as const, type: "blob" as const, sha: blob.data.sha });
  }

  const newTree = await octokit.git.createTree({
    owner,
    repo,
    base_tree: baseCommit.data.tree.sha,
    tree: treeItems,
  });

  const commit = await octokit.git.createCommit({
    owner,
    repo,
    message: title,
    tree: newTree.data.sha,
    parents: [baseSha],
  });

  // Create or update the branch ref
  try {
    await octokit.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: commit.data.sha });
  } catch {
    await octokit.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: commit.data.sha, force: true });
  }

  // Open PR, or return the existing one
  try {
    const pr = await octokit.pulls.create({ owner, repo, head: branch, base, title, body });
    return { url: pr.data.html_url, number: pr.data.number, branch };
  } catch (e) {
    const existing = await octokit.pulls.list({ owner, repo, head: `${owner}:${branch}`, state: "open" });
    if (existing.data.length > 0) {
      const pr = existing.data[0];
      await octokit.pulls.update({ owner, repo, pull_number: pr.number, body });
      return { url: pr.html_url, number: pr.number, branch };
    }
    throw e;
  }
}
