import { describe, it, expect } from "vitest";
import { parseTestOutput } from "./sandbox.js";

describe("parseTestOutput", () => {
  it("parses vitest summary", () => {
    const out = "\n Test Files  3 passed (3)\n      Tests  28 passed (28)\n";
    expect(parseTestOutput(out, "node")).toEqual({ passed: 28, failed: 0, total: 28 });
  });

  it("parses jest failed + passed + total", () => {
    const out = "Tests: 1 failed, 11 passed, 12 total";
    expect(parseTestOutput(out, "node")).toEqual({ passed: 11, failed: 1, total: 12 });
  });

  it("parses mocha passing/failing", () => {
    expect(parseTestOutput("12 passing\n1 failing", "node")).toEqual({ passed: 12, failed: 1, total: 13 });
  });

  it("parses pytest passed + failed", () => {
    expect(parseTestOutput("5 passed, 1 failed in 0.12s", "python")).toEqual({ passed: 5, failed: 1, total: 6 });
  });

  it("parses pytest all passing", () => {
    expect(parseTestOutput("7 passed in 0.30s", "python")).toEqual({ passed: 7, failed: 0, total: 7 });
  });

  it("parses python unittest OK", () => {
    expect(parseTestOutput("....\nRan 4 tests in 0.001s\n\nOK", "python")).toEqual({ passed: 4, failed: 0, total: 4 });
  });

  it("parses python unittest with failures and errors", () => {
    expect(parseTestOutput("Ran 5 tests in 0.01s\n\nFAILED (failures=1, errors=1)", "python")).toEqual({ passed: 3, failed: 2, total: 5 });
  });

  it("strips ANSI color codes", () => {
    const out = "\u001b[32m10 passed\u001b[0m (10)";
    expect(parseTestOutput(out, "node")).toEqual({ passed: 10, failed: 0, total: 10 });
  });

  it("returns empty object when nothing matches", () => {
    expect(parseTestOutput("no recognizable output", "node")).toEqual({});
  });
});
