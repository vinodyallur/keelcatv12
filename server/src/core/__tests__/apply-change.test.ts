import { describe, it, expect } from "vitest";
import { applyDeterministic, findHits, type FileToScan } from "../apply-change.js";
import type { ChangeSpec } from "../../llm/changelog.js";

const paramRename: ChangeSpec = {
  symbol: "charges.create",
  kind: "PARAM_RENAME",
  from: "source",
  to: "payment_method",
  impact: "BREAKING",
  description: "renamed source to payment_method",
};

const symbolRename: ChangeSpec = {
  symbol: "createCharge",
  kind: "SYMBOL_RENAME",
  from: "createCharge",
  to: "createPayment",
  impact: "BREAKING",
  description: "renamed createCharge to createPayment",
};

describe("apply-change deterministic (multi-language)", () => {
  it("renames an object-literal param key in TypeScript (colon style)", () => {
    const file: FileToScan = {
      filePath: "src/checkout.ts",
      content: `client.charges.create({ amount, currency: "usd", source: "tok_visa" });`,
    };
    const r = applyDeterministic(file, paramRename);
    expect(r.changed).toBe(true);
    expect(r.after).toContain("payment_method:");
    expect(r.after).not.toContain("source:");
    // must not touch the string value "usd"
    expect(r.after).toContain(`currency: "usd"`);
  });

  it("renames a kwarg in Python (equals style)", () => {
    const file: FileToScan = {
      filePath: "billing.py",
      content: `client.charges.create(amount=amount, currency="usd", source="tok_visa")`,
    };
    const r = applyDeterministic(file, paramRename);
    expect(r.changed).toBe(true);
    expect(r.after).toContain("payment_method=");
    expect(r.after).not.toContain("source=");
  });

  it("does NOT change positional-arg languages on a param rename (Java)", () => {
    const file: FileToScan = {
      filePath: "src/Main.java",
      content: `client.createCharge(1000, "usd", "tok_visa");`,
    };
    const r = applyDeterministic(file, paramRename);
    expect(r.changed).toBe(false);
    expect(r.resolved).toBe(true); // nothing to do is a resolved outcome
  });

  it("renames a symbol across C, C++, Java (positional)", () => {
    for (const filePath of ["main.c", "main.cpp", "src/Main.java"]) {
      const file: FileToScan = { filePath, content: `client.createCharge(1000, "usd", "tok_visa");` };
      const r = applyDeterministic(file, symbolRename);
      expect(r.changed).toBe(true);
      expect(r.after).toContain("createPayment(");
      expect(r.after).not.toContain("createCharge(");
    }
  });

  it("does not rename a partial/word-boundary mismatch", () => {
    const file: FileToScan = {
      filePath: "a.js",
      content: `const createChargeLater = 1; foo.createCharge(1);`,
    };
    const r = applyDeterministic(file, symbolRename);
    expect(r.after).toContain("createChargeLater"); // untouched
    expect(r.after).toContain("createPayment(1)");
  });

  it("findHits returns nothing for unrelated files", () => {
    const file: FileToScan = { filePath: "util.ts", content: `export const sum = (a,b) => a+b;` };
    expect(findHits(file, paramRename)).toHaveLength(0);
  });
});
