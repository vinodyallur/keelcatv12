import { describe, it, expect } from "vitest";
import { cleanSalesLead } from "./sales-leads.js";

const valid = { name: "Asha Rao", email: "asha@acme.in", phone: "+91 98765 43210", licenses: 25 };

describe("cleanSalesLead", () => {
  it("accepts a complete form and trims fields", () => {
    const r = cleanSalesLead({ ...valid, name: "  Asha Rao ", company: " Acme ", message: "" });
    expect(r).toEqual({ lead: { name: "Asha Rao", email: "asha@acme.in", phone: "+91 98765 43210", licenses: 25, company: "Acme" } });
  });

  it("accepts licenses sent as a numeric string", () => {
    expect(cleanSalesLead({ ...valid, licenses: "40" })).toEqual({ lead: { ...valid, licenses: 40 } });
  });

  it.each([
    ["missing name", { ...valid, name: " " }],
    ["bad email", { ...valid, email: "asha@acme" }],
    ["email with mailto params", { ...valid, email: "a@b.co?cc=x@y.co" }],
    ["too few phone digits", { ...valid, phone: "12345" }],
    ["letters in phone", { ...valid, phone: "+91 abc 43210" }],
    ["zero licenses", { ...valid, licenses: 0 }],
    ["fractional licenses", { ...valid, licenses: 2.5 }],
    ["too many licenses", { ...valid, licenses: 100_001 }],
    ["overlong message", { ...valid, message: "x".repeat(2001) }],
    ["no body", undefined],
  ])("rejects %s", (_label, body) => {
    expect(cleanSalesLead(body)).toHaveProperty("error");
  });
});
