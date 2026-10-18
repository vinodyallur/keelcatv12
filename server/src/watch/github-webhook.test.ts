import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifySignature, isChangelogPath, extractChangedPaths } from "./github-webhook.js";

function sign(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifySignature", () => {
  const secret = "s3cr3t";
  const body = JSON.stringify({ hello: "world" });

  it("accepts a correct signature", () => {
    expect(verifySignature(secret, body, sign(secret, body))).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifySignature(secret, body + "x", sign(secret, body))).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(verifySignature(secret, body, sign("other", body))).toBe(false);
  });

  it("rejects missing signature or secret", () => {
    expect(verifySignature(secret, body, undefined)).toBe(false);
    expect(verifySignature("", body, sign(secret, body))).toBe(false);
  });

  it("rejects a malformed signature without length leak", () => {
    expect(verifySignature(secret, body, "sha256=abc")).toBe(false);
  });
});

describe("isChangelogPath", () => {
  it("matches common changelog file names", () => {
    for (const p of ["CHANGELOG.md", "docs/CHANGELOG.md", "CHANGES.txt", "HISTORY.rst", "RELEASE_NOTES.md", "changelog.markdown"]) {
      expect(isChangelogPath(p)).toBe(true);
    }
  });

  it("ignores unrelated files", () => {
    for (const p of ["src/index.ts", "README.md", "package.json", "docs/guide.md"]) {
      expect(isChangelogPath(p)).toBe(false);
    }
  });
});

describe("extractChangedPaths", () => {
  it("collects added and modified paths across commits and head_commit", () => {
    const payload = {
      commits: [
        { added: ["a.ts"], modified: ["CHANGELOG.md"], removed: ["old.ts"] },
        { added: [], modified: ["b.ts"] },
      ],
      head_commit: { added: ["c.ts"], modified: ["CHANGELOG.md"] },
    };
    const paths = extractChangedPaths(payload).sort();
    expect(paths).toEqual(["CHANGELOG.md", "a.ts", "b.ts", "c.ts"]);
  });

  it("handles a payload with no commits", () => {
    expect(extractChangedPaths({})).toEqual([]);
  });
});
