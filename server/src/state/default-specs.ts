// Seed specs for the editable API Studio. `baseline` is the version the fleet's
// code was written against (v1). `current` starts equal to the baseline, so the
// fleet is clean until the user changes something in the Studio — then the diff
// (baseline -> current) drives detection, fixes, and PRs.

import type { OpenAPISpec } from "../core/types.js";

export const BASELINE_SPEC: OpenAPISpec = {
  providerId: "demo-pay",
  version: "2024-01-01",
  symbols: [
    { name: "charges.create", requiredParams: ["amount", "currency", "source"], optionalParams: ["description", "metadata"], deprecated: false },
    { name: "customers.create", requiredParams: ["email"], optionalParams: ["name"], deprecated: false },
    { name: "refunds.create", requiredParams: ["charge"], optionalParams: ["amount"], deprecated: false },
  ],
};

export function cloneSpec(s: OpenAPISpec): OpenAPISpec {
  return JSON.parse(JSON.stringify(s));
}
