import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { serialize, deserialize, tryDeserialize } from "../change-record-codec.js";
import { diff } from "../spec-differ.js";
import { classify, migrationFor } from "../classifier.js";
import { scanJsTs } from "../scanner.js";
import { generateFix, applyEdits } from "../fix-generator.js";
import type { ChangeRecord, OpenAPISpec, ApiSymbol } from "../types.js";

// ---- Arbitraries ----

const migrationArb = fc.record({
  operation: fc.constantFrom(
    "PARAM_RENAME",
    "PARAM_REMOVED",
    "PARAM_REQUIRED",
    "SYMBOL_RENAME",
    "METHOD_MOVED"
  ) as fc.Arbitrary<ChangeRecord["migration"] extends infer M ? any : never>,
  from: fc.string(),
  to: fc.option(fc.string(), { nil: undefined }),
});

const changeRecordArb: fc.Arbitrary<ChangeRecord> = fc.record({
  changeRecordId: fc.string({ minLength: 1 }),
  providerId: fc.string({ minLength: 1 }),
  symbol: fc.string({ minLength: 1 }),
  changeType: fc.constantFrom("BREAKING", "DEPRECATION", "NEW_FEATURE"),
  sourceVersion: fc.string(),
  detectedAt: fc.date().map((d) => d.toISOString()),
  sourceKind: fc.constantFrom("OPENAPI", "SDK_RELEASE"),
  summary: fc.string(),
  migration: fc.option(migrationArb, { nil: undefined }),
}) as fc.Arbitrary<ChangeRecord>;

describe("ChangeRecordCodec", () => {
  // Feature: self-maintaining-apis, Property 6: Change Record serialization round-trip
  it("Property 6: serialize -> deserialize is identity for all valid records", () => {
    fc.assert(
      fc.property(changeRecordArb, (record) => {
        const back = deserialize(serialize(record));
        expect(back).toEqual(normalize(record));
      }),
      { numRuns: 300 }
    );
  });

  // Feature: self-maintaining-apis, Property 7: Invalid records fail deserialization safely
  it("Property 7: invalid payloads return an error and never throw", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const r = tryDeserialize(s);
        // must not throw (implicit); either a valid record or an error object
        expect(r).toBeDefined();
        if (typeof r === "object" && r !== null && "ok" in r) {
          expect((r as any).ok).toBe(false);
        }
      }),
      { numRuns: 300 }
    );
  });

  it("rejects schema-invalid objects", () => {
    expect(tryDeserialize(JSON.stringify({ changeRecordId: 1 }))).toMatchObject({ ok: false });
    expect(tryDeserialize(JSON.stringify({ ...validRecordObj(), changeType: "NOPE" }))).toMatchObject({ ok: false });
  });
});

function normalize(r: ChangeRecord): ChangeRecord {
  // deserialize drops migration.to when undefined; mirror that for comparison
  const out: ChangeRecord = { ...r };
  if (r.migration) {
    out.migration = {
      operation: r.migration.operation,
      from: r.migration.from,
      ...(r.migration.to !== undefined ? { to: r.migration.to } : {}),
    };
  }
  return out;
}

function validRecordObj() {
  return {
    changeRecordId: "c1",
    providerId: "demo",
    symbol: "x.y",
    changeType: "BREAKING",
    sourceVersion: "1",
    detectedAt: new Date().toISOString(),
    sourceKind: "OPENAPI",
    summary: "s",
  };
}

// ---- Spec differ + classifier ----

const symbolArb: fc.Arbitrary<ApiSymbol> = fc.record({
  name: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
  requiredParams: fc.uniqueArray(fc.string({ minLength: 1 }), { maxLength: 4 }),
  optionalParams: fc.uniqueArray(fc.string({ minLength: 1 }), { maxLength: 4 }),
  deprecated: fc.boolean(),
});

describe("SpecDiffer + Classifier", () => {
  it("Property 2: adding a brand-new symbol yields exactly one NEW_FEATURE diff", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(symbolArb, { minLength: 1, maxLength: 6, selector: (s) => s.name }),
        symbolArb,
        (base, extra) => {
          fc.pre(!base.some((s) => s.name === extra.name));
          const prev: OpenAPISpec = { providerId: "p", version: "1", symbols: base };
          const curr: OpenAPISpec = { providerId: "p", version: "2", symbols: [...base, extra] };
          const diffs = diff(prev, curr);
          const added = diffs.filter((d) => d.symbol === extra.name);
          expect(added).toHaveLength(1);
          expect(classify(added[0])).toBe("NEW_FEATURE");
        }
      ),
      { numRuns: 200 }
    );
  });

  it("removing a symbol classifies BREAKING", () => {
    const prev: OpenAPISpec = { providerId: "p", version: "1", symbols: [{ name: "a.b", requiredParams: [], optionalParams: [], deprecated: false }] };
    const curr: OpenAPISpec = { providerId: "p", version: "2", symbols: [] };
    const diffs = diff(prev, curr);
    expect(diffs).toHaveLength(1);
    expect(classify(diffs[0])).toBe("BREAKING");
  });

  it("param rename is detected and produces a PARAM_RENAME migration", () => {
    const prev: OpenAPISpec = { providerId: "p", version: "1", symbols: [{ name: "charges.create", requiredParams: ["source", "amount"], optionalParams: [], deprecated: false }] };
    const curr: OpenAPISpec = { providerId: "p", version: "2", symbols: [{ name: "charges.create", requiredParams: ["payment_method", "amount"], optionalParams: [], deprecated: false }] };
    const diffs = diff(prev, curr);
    const renamed = diffs.find((d) => d.kind === "PARAM_RENAMED");
    expect(renamed).toBeDefined();
    expect(classify(renamed!)).toBe("BREAKING");
    expect(migrationFor(renamed!)).toEqual({ operation: "PARAM_RENAME", from: "source", to: "payment_method" });
  });

  it("newly deprecated but present symbol classifies DEPRECATION", () => {
    const prev: OpenAPISpec = { providerId: "p", version: "1", symbols: [{ name: "m.n", requiredParams: [], optionalParams: [], deprecated: false }] };
    const curr: OpenAPISpec = { providerId: "p", version: "2", symbols: [{ name: "m.n", requiredParams: [], optionalParams: [], deprecated: true }] };
    const diffs = diff(prev, curr);
    expect(diffs.some((d) => classify(d) === "DEPRECATION")).toBe(true);
  });
});

// ---- Scanner + fix generator (the real code transformation) ----

const RENAME_RECORD: ChangeRecord = {
  changeRecordId: "c_rename",
  providerId: "demo",
  symbol: "charges.create",
  changeType: "BREAKING",
  sourceVersion: "2",
  detectedAt: new Date().toISOString(),
  sourceKind: "OPENAPI",
  summary: "source -> payment_method",
  migration: { operation: "PARAM_RENAME", from: "source", to: "payment_method" },
};

describe("Scanner + FixGenerator (end-to-end transform)", () => {
  const sample = `import { demo } from "demo-api";
async function pay(token) {
  return demo.charges.create({
    amount: 2000,
    currency: "usd",
    source: token.id,
  });
}
`;

  it("finds the affected param usage via AST", () => {
    const usages = scanJsTs([{ filePath: "src/pay.ts", content: sample }], RENAME_RECORD, "repo1");
    expect(usages).toHaveLength(1);
    expect(usages[0].snippet).toBe("source");
    expect(usages[0].location.filePath).toBe("src/pay.ts");
  });

  it("does not match a same-named local that isn't the SDK call", () => {
    const noise = `const source = 1;\nfunction charges() {}\ncharges.create;\n`;
    const usages = scanJsTs([{ filePath: "n.ts", content: noise }], RENAME_RECORD, "r");
    expect(usages).toHaveLength(0);
  });

  it("with binding resolution, matches the real SDK call but NOT a same-shaped local", () => {
    const src = `import { demo } from "demo-pay";
const fakeApi = { charges: { create: (x) => x } };
demo.charges.create({ source: token });      // real -> should match
const source = 1;
fakeApi.charges.create({ source });          // local  -> must NOT match
`;
    const usages = scanJsTs(
      [{ filePath: "mix.ts", content: src }],
      RENAME_RECORD,
      "r",
      "demo-pay" // SDK package -> enables import-binding resolution
    );
    expect(usages).toHaveLength(1);
    expect(usages[0].location.line).toBe(3); // only the real SDK call
  });

  it("skips files that don't import the SDK at all", () => {
    const src = `const demo = { charges: { create: (x) => x } };\ndemo.charges.create({ source: 1 });\n`;
    const usages = scanJsTs([{ filePath: "no-import.ts", content: src }], RENAME_RECORD, "r", "demo-pay");
    expect(usages).toHaveLength(0);
  });

  it("Property 4: fix partitions usages with no loss and no overlap", () => {
    const usages = scanJsTs([{ filePath: "src/pay.ts", content: sample }], RENAME_RECORD, "repo1");
    const fix = generateFix(RENAME_RECORD, usages);
    const editedIds = new Set(fix.edits.map((e) => e.usageId));
    const unresolvedIds = new Set(fix.unresolved.map((u) => u.usageId));
    const all = new Set(usages.map((u) => u.usageId));
    // no overlap
    for (const id of editedIds) expect(unresolvedIds.has(id)).toBe(false);
    // union equals input
    expect(new Set([...editedIds, ...unresolvedIds])).toEqual(all);
  });

  it("applies the edit and produces correctly migrated code", () => {
    const usages = scanJsTs([{ filePath: "src/pay.ts", content: sample }], RENAME_RECORD, "repo1");
    const fix = generateFix(RENAME_RECORD, usages);
    const files = new Map([["src/pay.ts", sample]]);
    const updated = applyEdits(files, fix.edits);
    const result = updated.get("src/pay.ts")!;
    expect(result).toContain("payment_method: token.id");
    expect(result).not.toContain("source: token.id");
    // untouched lines preserved
    expect(result).toContain('currency: "usd"');
  });
});
