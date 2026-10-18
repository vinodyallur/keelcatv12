// Ephemeral test sandbox: clone the target repo into a temp dir, apply the
// generated fix on top, detect the project's own test command, install deps,
// and run the tests — so a PR can carry real proof ("214/214 tests pass").
//
// This runs third-party code on the host and is therefore OPT-IN (settings.
// runTests) and off by default. Real isolation belongs in a container/CI; this
// is a best-effort local runner with hard timeouts that NEVER blocks a PR:
// any failure to run is reported as "not run", not as a test failure.

import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import type { RunTestResult } from "../config/store.js";

const pExecFile = promisify(execFile);
const pExec = promisify(exec);

// owner/repo come from GitHub but are still validated before going into a URL.
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export interface SandboxOptions {
  owner: string;
  repo: string;
  branch: string;
  token: string;
  updatedFiles: Record<string, string>;
  cloneTimeoutMs?: number;
  installTimeoutMs?: number;
  testTimeoutMs?: number;
}

interface TestPlan {
  ecosystem: "node" | "python";
  install?: string;
  test: string;
}

export async function runRepoTests(opts: SandboxOptions): Promise<RunTestResult> {
  const { owner, repo, branch, updatedFiles } = opts;
  const token = opts.token.trim();
  const cloneTimeoutMs = opts.cloneTimeoutMs ?? 90_000;
  const installTimeoutMs = opts.installTimeoutMs ?? 150_000;
  const testTimeoutMs = opts.testTimeoutMs ?? 150_000;

  if (!SAFE_SEGMENT.test(owner) || !SAFE_SEGMENT.test(repo) || !SAFE_SEGMENT.test(branch)) {
    return { ran: false, summary: "Sandbox skipped: repo/branch failed name validation." };
  }

  let dir: string | null = null;
  const started = Date.now();
  try {
    dir = await mkdtemp(join(tmpdir(), "keelcat-test-"));

    // Clone (shallow, single branch). Token is passed as a CLI arg, not shell-interpolated.
    const url = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
    await pExecFile("git", ["clone", "--depth", "1", "--single-branch", "--branch", branch, url, dir], {
      timeout: cloneTimeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    });

    // Apply the generated fix on top of the checkout.
    for (const [rel, content] of Object.entries(updatedFiles)) {
      const p = join(dir, rel);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, content, "utf8");
    }

    const plan = await detectTestPlan(dir);
    if (!plan) {
      return { ran: false, summary: "No test command detected (no runnable package.json test script or Python tests)." };
    }

    if (plan.install) {
      try {
        await pExec(plan.install, { cwd: dir, timeout: installTimeoutMs, maxBuffer: 32 * 1024 * 1024 });
      } catch (e) {
        return { ran: false, command: plan.test, summary: `Dependency install failed: ${short((e as Error).message)}` };
      }
    }

    let output = "";
    let exitCode = 0;
    try {
      const r = await pExec(plan.test, { cwd: dir, timeout: testTimeoutMs, maxBuffer: 32 * 1024 * 1024 });
      output = `${r.stdout}\n${r.stderr}`;
    } catch (e) {
      const err = e as { code?: number; killed?: boolean; stdout?: string; stderr?: string; message?: string };
      if (err.killed) {
        return { ran: false, command: plan.test, summary: `Tests timed out after ${Math.round(testTimeoutMs / 1000)}s.` };
      }
      exitCode = typeof err.code === "number" ? err.code : 1;
      output = `${err.stdout ?? ""}\n${err.stderr ?? ""}\n${err.message ?? ""}`;
    }

    const parsed = parseTestOutput(output, plan.ecosystem);
    const ok = exitCode === 0 && (parsed.failed ?? 0) === 0;
    const durationMs = Date.now() - started;

    let summary: string;
    if (parsed.total != null) {
      summary = ok
        ? `${parsed.passed ?? parsed.total}/${parsed.total} tests pass`
        : `${parsed.failed ?? "some"} of ${parsed.total} tests failing`;
    } else {
      summary = ok ? "test suite passed" : "test suite failed";
    }

    return {
      ran: true,
      ok,
      passed: parsed.passed,
      failed: parsed.failed,
      total: parsed.total,
      command: plan.test,
      durationMs,
      summary,
    };
  } catch (e) {
    return { ran: false, summary: `Could not run tests: ${short((e as Error).message)}` };
  } finally {
    if (dir) rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function detectTestPlan(dir: string): Promise<TestPlan | null> {
  // Node / JS / TS
  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
      const testScript: string | undefined = pkg.scripts?.test;
      if (testScript && !/no test specified/i.test(testScript)) {
        const hasDeps =
          (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) ||
          (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0);
        const pm = existsSync(join(dir, "pnpm-lock.yaml"))
          ? "pnpm"
          : existsSync(join(dir, "yarn.lock"))
          ? "yarn"
          : "npm";
        // Skip the install entirely when the project has no dependencies
        // (e.g. suites built on Node's built-in test runner) — faster + offline-safe.
        const install = !hasDeps
          ? undefined
          : pm === "pnpm"
          ? "pnpm install --prod=false"
          : pm === "yarn"
          ? "yarn install --frozen-lockfile || yarn install"
          : "npm install --no-audit --no-fund";
        const test = pm === "npm" ? "npm test --silent" : `${pm} test`;
        return { ecosystem: "node", install, test };
      }
    } catch {
      /* malformed package.json — fall through */
    }
  }

  // Python
  const hasPy =
    existsSync(join(dir, "pytest.ini")) ||
    existsSync(join(dir, "pyproject.toml")) ||
    existsSync(join(dir, "setup.cfg")) ||
    existsSync(join(dir, "tox.ini")) ||
    existsSync(join(dir, "tests")) ||
    existsSync(join(dir, "test"));
  if (hasPy) {
    const usesPytest = existsSync(join(dir, "pytest.ini")) || existsSync(join(dir, "pyproject.toml")) || existsSync(join(dir, "tox.ini"));
    if (usesPytest) {
      const install = existsSync(join(dir, "requirements.txt")) ? "pip install -r requirements.txt" : undefined;
      return { ecosystem: "python", install, test: "python -m pytest -q" };
    }
    // Fall back to stdlib unittest — always available, no pip install needed.
    return { ecosystem: "python", test: "python -m unittest" };
  }

  return null;
}

/** Heuristic parse of pass/fail counts from common test runners. */
export function parseTestOutput(output: string, ecosystem: "node" | "python"): { passed?: number; failed?: number; total?: number } {
  const text = output.replace(/\u001b\[[0-9;]*m/g, ""); // strip ANSI colors

  if (ecosystem === "python") {
    // pytest: "5 passed, 1 failed in 0.12s" / "5 passed in 0.1s"
    const passed = num(text.match(/(\d+)\s+passed/i));
    const failed = num(text.match(/(\d+)\s+failed/i));
    const errors = num(text.match(/(\d+)\s+error/i));
    if (passed != null || failed != null) {
      const f = (failed ?? 0) + (errors ?? 0);
      const p = passed ?? 0;
      return { passed: p, failed: f, total: p + f };
    }
    // unittest: "Ran 4 tests in 0.001s" + "OK" / "FAILED (failures=1, errors=0)"
    const ran = num(text.match(/Ran\s+(\d+)\s+tests?/i));
    if (ran != null) {
      const f = (num(text.match(/failures=(\d+)/i)) ?? 0) + (num(text.match(/errors=(\d+)/i)) ?? 0);
      return { passed: Math.max(0, ran - f), failed: f, total: ran };
    }
  }

  // vitest: "Tests  28 passed (28)" or "Tests  1 failed | 27 passed (28)"
  const vitest = text.match(/Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed\s*\((\d+)\)/i);
  if (vitest) {
    const failed = vitest[1] ? Number(vitest[1]) : 0;
    const passed = Number(vitest[2]);
    return { passed, failed, total: Number(vitest[3]) };
  }

  // jest: "Tests: 1 failed, 11 passed, 12 total"
  const jestTotal = num(text.match(/Tests?:.*?(\d+)\s+total/i));
  const jestPassed = num(text.match(/(\d+)\s+passed/i));
  const jestFailed = num(text.match(/(\d+)\s+failed/i));
  if (jestTotal != null || jestPassed != null) {
    const p = jestPassed ?? 0;
    const f = jestFailed ?? 0;
    return { passed: p, failed: f, total: jestTotal ?? p + f };
  }

  // mocha: "12 passing" / "1 failing"
  const mochaPass = num(text.match(/(\d+)\s+passing/i));
  const mochaFail = num(text.match(/(\d+)\s+failing/i));
  if (mochaPass != null || mochaFail != null) {
    const p = mochaPass ?? 0;
    const f = mochaFail ?? 0;
    return { passed: p, failed: f, total: p + f };
  }

  return {};
}

function num(m: RegExpMatchArray | null): number | undefined {
  return m ? Number(m[1]) : undefined;
}

function short(s: string, n = 200): string {
  const one = redactSecrets(s).replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n) + "…" : one;
}

/** Strip any credentials that might appear in command echoes / error output. */
export function redactSecrets(s: string): string {
  return s
    .replace(/x-access-token:[^@\s]+@/gi, "x-access-token:***@")
    .replace(/https:\/\/[^@\s/]+:[^@\s/]+@/gi, "https://***@")
    .replace(/gh[posru]_[A-Za-z0-9]{16,}/g, "***")
    .replace(/github_pat_[A-Za-z0-9_]{16,}/g, "***");
}
