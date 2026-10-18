import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runPipeline, readRepoFiles } from "../pipeline/orchestrator.js";
import type { OpenAPISpec } from "../core/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadSpec(name: string): OpenAPISpec {
  return JSON.parse(readFileSync(join(__dirname, "specs", name), "utf8"));
}

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function main() {
  const prev = loadSpec("demo-api.v1.json");
  const curr = loadSpec("demo-api.v2.json");
  const repoRoot = join(__dirname, "sample-repo");
  const files = readRepoFiles(repoRoot);

  console.log(`\n${c.bold}${c.cyan}KeelCat — real pipeline run${c.reset}`);
  console.log(`${c.dim}provider: ${curr.providerId}  ${prev.version} -> ${curr.version}${c.reset}`);
  console.log(`${c.dim}scanned ${files.length} source file(s) in sample-repo${c.reset}\n`);

  const result = runPipeline(prev, curr, files, "sample-checkout-app", curr.providerId);

  console.log(`${c.bold}1) Detected changes${c.reset}`);
  for (const cr of result.changeRecords) {
    const color =
      cr.changeType === "BREAKING" ? c.red : cr.changeType === "DEPRECATION" ? c.yellow : c.green;
    console.log(`   ${color}[${cr.changeType}]${c.reset} ${cr.symbol} — ${cr.summary}`);
  }

  console.log(`\n${c.bold}2) Affected usages found in code${c.reset}`);
  let anyUsage = false;
  for (const cr of result.changeRecords) {
    const usages = result.usagesByRecord[cr.changeRecordId] ?? [];
    for (const u of usages) {
      anyUsage = true;
      console.log(`   ${c.blue}${u.location.filePath}:${u.location.line}${c.reset} → ${cr.symbol}`);
    }
  }
  if (!anyUsage) console.log(`   ${c.dim}(none)${c.reset}`);

  console.log(`\n${c.bold}3) Auto-generated fixes${c.reset}`);
  for (const e of result.edits) {
    console.log(`   ${c.green}✎${c.reset} ${e.filePath}:${e.startLine} → replace with "${e.replacement}"`);
  }
  if (result.unresolved.length) {
    console.log(`   ${c.yellow}⚠ ${result.unresolved.length} usage(s) need manual attention${c.reset}`);
  }

  console.log(`\n${c.bold}4) Updated files (PR content)${c.reset}`);
  for (const [path, content] of Object.entries(result.updatedFiles)) {
    console.log(`   ${c.cyan}── ${path} ──${c.reset}`);
    for (const line of content.split("\n")) {
      if (line.includes("payment_method")) console.log(`   ${c.green}+ ${line}${c.reset}`);
      else console.log(`   ${c.dim}  ${line}${c.reset}`);
    }
  }

  console.log(`\n${c.bold}5) Notifications${c.reset}`);
  for (const n of result.notifications) {
    console.log(`   ${c.dim}[${n.kind}]${c.reset} ${n.message}`);
  }

  console.log(`\n${c.green}${c.bold}✓ Pipeline complete — real detection, real AST scan, real code fix.${c.reset}\n`);
}

main();
