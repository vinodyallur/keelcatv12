// Browser GitHub client for the client-side run pipeline. Uses the plain REST
// API over fetch (no Octokit) so the bundle stays lean and every call runs on
// the visitor's machine with a short-lived token minted by our server.
//
// Mirrors server/src/integrations/github.ts (fetchRepoFiles + openFixPr). The
// GitHub REST API is CORS-enabled, so these calls work directly from a browser
// tab. Idempotent per branch name, exactly like the server path.

import { isScannable } from "./languages";
import type { FileToScan } from "./apply-change";

const API = "https://api.github.com";

function headers(token: string, json = false): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

async function gh<T = any>(
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: headers(token, body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try {
      msg = (JSON.parse(text) as { message?: string }).message ?? msg;
    } catch {
      /* keep raw text */
    }
    const err = new Error(`GitHub ${method} ${path} → ${res.status}: ${msg}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** Decode a GitHub base64 blob (UTF-8 safe) in the browser. */
function decodeBase64Utf8(b64: string): string {
  const clean = b64.replace(/\s/g, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

/** Run an async mapper over items with bounded concurrency. */
async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface RepoRef {
  owner: string;
  repo: string;
}

/** Resolve the default branch when a base is not provided. */
export async function resolveBase(token: string, ref: RepoRef, base?: string): Promise<string> {
  if (base) return base;
  const data = await gh<{ default_branch: string }>(token, "GET", `/repos/${ref.owner}/${ref.repo}`);
  return data.default_branch;
}

const IGNORED = /(^|\/)(node_modules|\.git|dist|build|vendor|target|out|\.venv|__pycache__)(\/|$)/;
const MAX_FILES = 400;
const MAX_BYTES = 400 * 1024;

/**
 * Fetch all scannable source files from a repo branch via the git tree API.
 * Returns their paths + decoded contents. Same caps as the server path.
 */
export async function fetchRepoFiles(token: string, ref: RepoRef, branch: string): Promise<FileToScan[]> {
  const { owner, repo } = ref;
  const branchData = await gh<{ commit: { commit: { tree: { sha: string } } } }>(
    token,
    "GET",
    `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`
  );
  const treeSha = branchData.commit.commit.tree.sha;
  const tree = await gh<{ tree: { path?: string; type?: string; sha?: string; size?: number }[] }>(
    token,
    "GET",
    `/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=true`
  );

  const scannable = tree.tree.filter(
    (n) => n.type === "blob" && n.path && isScannable(n.path) && !IGNORED.test(n.path)
  );

  const picked = scannable
    .slice(0, MAX_FILES)
    .filter((n) => n.path && n.sha && !(typeof n.size === "number" && n.size > MAX_BYTES));

  return mapPool(picked, 6, async (node) => {
    const blob = await gh<{ content: string; encoding: string }>(
      token,
      "GET",
      `/repos/${owner}/${repo}/git/blobs/${node.sha}`
    );
    const content = blob.encoding === "base64" ? decodeBase64Utf8(blob.content) : blob.content;
    return { filePath: node.path as string, content };
  });
}

/**
 * Create (or reset) a branch from base, commit the updated files, and open a PR.
 * Idempotent per branch name: if the branch/PR already exists it is updated.
 * Never merges.
 */
export async function openFixPr(
  token: string,
  ref: RepoRef,
  branch: string,
  base: string,
  updatedFiles: Record<string, string>,
  title: string,
  body: string
): Promise<{ url: string; number: number; branch: string }> {
  const { owner, repo } = ref;

  // Latest commit + tree on base
  const baseRef = await gh<{ object: { sha: string } }>(token, "GET", `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`);
  const baseSha = baseRef.object.sha;
  const baseCommit = await gh<{ tree: { sha: string } }>(token, "GET", `/repos/${owner}/${repo}/git/commits/${baseSha}`);

  // Create blobs for each updated file (raw UTF-8, same as the server path).
  const treeItems = [];
  for (const [path, content] of Object.entries(updatedFiles)) {
    const blob = await gh<{ sha: string }>(token, "POST", `/repos/${owner}/${repo}/git/blobs`, {
      content,
      encoding: "utf-8",
    });
    treeItems.push({ path, mode: "100644" as const, type: "blob" as const, sha: blob.sha });
  }

  const newTree = await gh<{ sha: string }>(token, "POST", `/repos/${owner}/${repo}/git/trees`, {
    base_tree: baseCommit.tree.sha,
    tree: treeItems,
  });

  const commit = await gh<{ sha: string }>(token, "POST", `/repos/${owner}/${repo}/git/commits`, {
    message: title,
    tree: newTree.sha,
    parents: [baseSha],
  });

  // Create or force-update the branch ref.
  try {
    await gh(token, "POST", `/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
  } catch {
    await gh(token, "PATCH", `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      sha: commit.sha,
      force: true,
    });
  }

  // Open the PR, or update the existing one for this branch.
  try {
    const pr = await gh<{ html_url: string; number: number }>(token, "POST", `/repos/${owner}/${repo}/pulls`, {
      head: branch,
      base,
      title,
      body,
    });
    return { url: pr.html_url, number: pr.number, branch };
  } catch (e) {
    const existing = await gh<{ html_url: string; number: number }[]>(
      token,
      "GET",
      `/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open`
    );
    if (existing.length > 0) {
      const pr = existing[0];
      await gh(token, "PATCH", `/repos/${owner}/${repo}/pulls/${pr.number}`, { body });
      return { url: pr.html_url, number: pr.number, branch };
    }
    throw e;
  }
}
