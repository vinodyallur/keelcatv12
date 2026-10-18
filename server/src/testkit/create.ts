// Create the sample test repos on the connected GitHub account (PAT mode) and
// register them as connected + selected repos so they're immediately runnable.

import { Octokit } from "@octokit/rest";
import { SAMPLE_REPOS } from "./samples.js";
import { makeClient } from "../integrations/github.js";
import { getAnyPatAccount, upsertRepos, logAudit, type ConnectedRepo } from "../config/store.js";
import { languageOf } from "../core/languages.js";

export interface CreatedRepo {
  name: string;
  fullName: string;
  url: string;
  created: boolean;
  error?: string;
}

async function commitFiles(octokit: Octokit, owner: string, repo: string, branch: string, files: Record<string, string>) {
  const baseRef = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
  const baseSha = baseRef.data.object.sha;
  const baseCommit = await octokit.git.getCommit({ owner, repo, commit_sha: baseSha });
  const tree = [];
  for (const [path, content] of Object.entries(files)) {
    const blob = await octokit.git.createBlob({ owner, repo, content, encoding: "utf-8" });
    tree.push({ path, mode: "100644" as const, type: "blob" as const, sha: blob.data.sha });
  }
  const newTree = await octokit.git.createTree({ owner, repo, base_tree: baseCommit.data.tree.sha, tree });
  const commit = await octokit.git.createCommit({
    owner,
    repo,
    message: "chore: seed sample app that uses demo-pay v1",
    tree: newTree.data.sha,
    parents: [baseSha],
  });
  await octokit.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: commit.data.sha });
}

export async function createTestRepos(): Promise<CreatedRepo[]> {
  const acct = getAnyPatAccount();
  if (!acct) throw new Error("Connect a GitHub account with a Personal Access Token first (Connect page).");
  const { octokit } = makeClient(acct.pat);
  const accountId = acct.account.id;
  const me = await octokit.users.getAuthenticated();
  const owner = me.data.login;

  const results: CreatedRepo[] = [];
  const connected: ConnectedRepo[] = [];

  for (const sample of SAMPLE_REPOS) {
    const fullName = `${owner}/${sample.name}`;
    try {
      let created = false;
      try {
        await octokit.repos.get({ owner, repo: sample.name });
      } catch {
        await octokit.repos.createForAuthenticatedUser({
          name: sample.name,
          description: sample.description,
          auto_init: true,
          private: false,
        });
        created = true;
        await new Promise((r) => setTimeout(r, 1500));
      }
      const info = await octokit.repos.get({ owner, repo: sample.name });
      const branch = info.data.default_branch;
      await commitFiles(octokit, owner, sample.name, branch, sample.files);

      const languages = [...new Set(Object.keys(sample.files).map((f) => languageOf(f)).filter((l) => l !== "OTHER"))];
      connected.push({
        id: fullName,
        accountId,
        owner,
        repo: sample.name,
        fullName,
        defaultBranch: branch,
        private: info.data.private,
        languages,
        selected: true,
      });
      results.push({ name: sample.name, fullName, url: `https://github.com/${fullName}`, created });
    } catch (e) {
      results.push({ name: sample.name, fullName, url: `https://github.com/${fullName}`, created: false, error: (e as Error).message });
    }
  }

  if (connected.length) upsertRepos(connected);
  logAudit("TEST_REPOS_CREATED", `Created/seeded ${results.filter((r) => !r.error).length} test repo(s).`);
  return results;
}
