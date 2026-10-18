// Static security scanner. Pattern-based detection of the things that actually
// hurt: leaked secrets, remote-code-execution sinks, obfuscated payloads, and
// classic supply-chain tricks. Deterministic (no LLM), so it always runs and is
// safe to point at real repositories. Findings are advisory — reported, never
// auto-"fixed" destructively.

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface Finding {
  ruleId: string;
  title: string;
  severity: Severity;
  filePath: string;
  line: number;
  snippet: string;
}

export interface FileToScan {
  filePath: string;
  content: string;
}

interface Rule {
  id: string;
  title: string;
  severity: Severity;
  /** Regex tested per line. */
  pattern: RegExp;
  /** Optional: only apply to files whose path matches. */
  pathPattern?: RegExp;
}

const RULES: Rule[] = [
  // ---- Leaked secrets ----
  { id: "aws-access-key", title: "Hardcoded AWS access key", severity: "CRITICAL", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "aws-secret", title: "Possible AWS secret key", severity: "HIGH", pattern: /aws_secret_access_key\s*[:=]\s*['"][A-Za-z0-9/+=]{30,}['"]/i },
  { id: "private-key", title: "Private key committed in source", severity: "CRITICAL", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: "gh-token", title: "GitHub token", severity: "CRITICAL", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { id: "stripe-key", title: "Stripe live secret key", severity: "CRITICAL", pattern: /\bsk_live_[0-9A-Za-z]{20,}\b/ },
  { id: "slack-token", title: "Slack token", severity: "HIGH", pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { id: "google-api-key", title: "Google API key", severity: "HIGH", pattern: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
  { id: "openai-key", title: "OpenAI/OpenRouter key", severity: "HIGH", pattern: /\bsk-(?:or-)?[A-Za-z0-9]{20,}\b/ },
  { id: "jwt", title: "Hardcoded JWT", severity: "MEDIUM", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { id: "generic-secret", title: "Hardcoded secret/password", severity: "HIGH", pattern: /(?:api[_-]?key|secret|passwd|password|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i },

  // ---- Remote code execution / dangerous sinks ----
  { id: "curl-pipe-shell", title: "Pipe-to-shell install (curl|wget | sh)", severity: "CRITICAL", pattern: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/ },
  { id: "eval-atob", title: "eval() of decoded/obfuscated data", severity: "CRITICAL", pattern: /\beval\s*\(\s*(?:atob|Buffer\.from|decodeURIComponent|unescape)\s*\(/ },
  { id: "js-eval", title: "Use of eval()", severity: "HIGH", pattern: /\beval\s*\(/, pathPattern: /\.(?:js|jsx|ts|tsx|mjs|cjs)$/ },
  { id: "js-function-ctor", title: "Dynamic code via new Function()", severity: "HIGH", pattern: /\bnew\s+Function\s*\(/ },
  { id: "js-child-process", title: "Shell command execution", severity: "MEDIUM", pattern: /\b(?:child_process|execSync|exec\s*\(|spawnSync|spawn\s*\()/ },
  { id: "py-os-system", title: "os.system() shell call", severity: "HIGH", pattern: /\bos\.system\s*\(/ },
  { id: "py-subprocess-shell", title: "subprocess with shell=True", severity: "HIGH", pattern: /subprocess\.(?:call|run|Popen|check_output)\([^)]*shell\s*=\s*True/ },
  { id: "py-eval-exec", title: "Python eval()/exec()", severity: "HIGH", pattern: /\b(?:eval|exec)\s*\(/, pathPattern: /\.py$/ },
  { id: "py-pickle", title: "Insecure pickle.loads()", severity: "MEDIUM", pattern: /\bpickle\.loads?\s*\(/ },
  { id: "java-runtime-exec", title: "Runtime.exec() shell call", severity: "HIGH", pattern: /Runtime\.getRuntime\(\)\.exec\s*\(/ },
  { id: "c-system", title: "system() call", severity: "MEDIUM", pattern: /\bsystem\s*\(/, pathPattern: /\.(?:c|cpp|cc|cxx|h|hpp)$/ },

  // ---- Obfuscation / exfiltration / miners ----
  { id: "obfuscated-hex", title: "Heavily hex-escaped string (obfuscation)", severity: "MEDIUM", pattern: /(?:\\x[0-9a-fA-F]{2}){12,}/ },
  { id: "crypto-miner", title: "Crypto-miner indicator", severity: "HIGH", pattern: /\b(?:coinhive|cryptonight|stratum\+tcp|minexmr|xmrig)\b/i },
  { id: "env-exfil", title: "Environment variables sent over the network", severity: "MEDIUM", pattern: /(?:fetch|axios|https?\.request|requests\.(?:post|get))\s*\([^)]*process\.env|process\.env[^\n]*\b(?:fetch|axios)\b/ },
];

// Supply-chain: package.json install hooks that run code.
const PKG_INSTALL_HOOK = /"(?:pre|post)install"\s*:\s*"(?:[^"]*(?:curl|wget|node\s+-e|eval|bash|sh\s+-c)[^"]*)"/i;

/** Scan a single file's content, returning all findings. */
export function scanFileContent(file: FileToScan): Finding[] {
  const findings: Finding[] = [];
  const lines = file.content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 4000) continue; // skip minified megastrings
    for (const rule of RULES) {
      if (rule.pathPattern && !rule.pathPattern.test(file.filePath)) continue;
      if (rule.pattern.test(line)) {
        findings.push({
          ruleId: rule.id,
          title: rule.title,
          severity: rule.severity,
          filePath: file.filePath,
          line: i + 1,
          snippet: redact(line.trim()).slice(0, 200),
        });
      }
    }
  }

  if (/(?:^|\/)package\.json$/.test(file.filePath)) {
    lines.forEach((line, i) => {
      if (PKG_INSTALL_HOOK.test(line)) {
        findings.push({
          ruleId: "npm-install-hook",
          title: "package.json install hook runs a shell command",
          severity: "HIGH",
          filePath: file.filePath,
          line: i + 1,
          snippet: redact(line.trim()).slice(0, 200),
        });
      }
    });
  }

  return findings;
}

/** Scan many files. */
export function scanFiles(files: FileToScan[]): Finding[] {
  return files.flatMap(scanFileContent);
}

/** Scan raw added lines from a PR patch/diff (lines beginning with '+'). */
export function scanPatch(filePath: string, patch: string): Finding[] {
  const added = patch
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1))
    .join("\n");
  return scanFileContent({ filePath, content: added });
}

export interface ScanSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  status: "CLEAN" | "WARN" | "THREAT";
}

export function summarize(findings: Finding[]): ScanSummary {
  const s: ScanSummary = { total: findings.length, critical: 0, high: 0, medium: 0, low: 0, status: "CLEAN" };
  for (const f of findings) {
    if (f.severity === "CRITICAL") s.critical++;
    else if (f.severity === "HIGH") s.high++;
    else if (f.severity === "MEDIUM") s.medium++;
    else s.low++;
  }
  s.status = s.critical + s.high > 0 ? "THREAT" : s.total > 0 ? "WARN" : "CLEAN";
  return s;
}

/** Never echo full secrets back — mask the tail of anything long. */
function redact(line: string): string {
  return line.replace(/([A-Za-z0-9_\-+/=]{12,})/g, (m) => (m.length > 12 ? m.slice(0, 4) + "…" + m.slice(-2) : m));
}
