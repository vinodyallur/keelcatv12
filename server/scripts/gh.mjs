// Small helper: uses the saved PAT to talk to GitHub. Never prints the token.
import { Octokit } from "@octokit/rest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const secrets = JSON.parse(readFileSync(join(__dirname, "..", "data", "secrets.json"), "utf8"));
const token = process.env.GH_PAT || secrets.githubPat;
if (!token) {
  console.log(JSON.stringify({ error: "no PAT saved" }));
  process.exit(0);
}
const octokit = new Octokit({ auth: token });

const cmd = process.argv[2];

try {
  if (cmd === "whoami") {
    const me = await octokit.users.getAuthenticated();
    const repos = await octokit.repos.listForAuthenticatedUser({ per_page: 100, sort: "pushed", affiliation: "owner" });
    console.log(JSON.stringify({ login: me.data.login, repos: repos.data.map((r) => r.full_name) }, null, 2));
  } else if (cmd === "putfile") {
    // args: owner repo path branch  (content read from CHANGELOG_CONTENT env, message from MSG env)
    const [, , , owner, repo, path, branchArg] = process.argv;
    let branch = branchArg;
    if (!branch || branch === "auto") {
      const info = await octokit.repos.get({ owner, repo });
      branch = info.data.default_branch;
    }
    const content = process.env.CHANGELOG_CONTENT ?? "";
    const message = process.env.MSG ?? "docs: update changelog";
    // Does the file already exist? (need its sha to update)
    let sha;
    try {
      const existing = await octokit.repos.getContent({ owner, repo, path, ref: branch });
      if (!Array.isArray(existing.data)) sha = existing.data.sha;
    } catch {
      /* new file */
    }
    const res = await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
      sha,
    });
    const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
    console.log(JSON.stringify({ ok: true, commit: res.data.commit.sha, htmlUrl: res.data.content?.html_url, rawUrl: raw }, null, 2));
  } else {
    console.log(JSON.stringify({ error: "unknown command" }));
  }
} catch (e) {
  console.log(JSON.stringify({ error: e.message, status: e.status }));
}
