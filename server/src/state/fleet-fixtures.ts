// Synthetic multi-repo "fleet" used for the fan-out demo.
// Each fixture is a small, realistic app. Some use the demo-pay SDK in ways
// that break under v2 (source -> payment_method), some only hit deprecated
// symbols, and some don't touch the provider at all. This lets us show the
// real product story: "one API change, found the 3 of 6 repos that break."

import type { FileToScan } from "../core/scanner.js";

export interface FleetFixture {
  repositoryId: string;
  fullName: string;
  languages: string[];
  dependsOn: string[];
  files: FileToScan[];
}

export const FLEET_FIXTURES: FleetFixture[] = [
  {
    repositoryId: "checkout-service",
    fullName: "acme/checkout-service",
    languages: ["TYPESCRIPT"],
    dependsOn: ["demo-pay"],
    files: [
      {
        filePath: "src/charge.ts",
        content: `import demoPay from "demo-pay";

export async function charge(amount: number) {
  return demoPay.charges.create({
    amount,
    currency: "usd",
    source: "tok_visa",
    description: "checkout",
  });
}
`,
      },
    ],
  },
  {
    repositoryId: "billing-worker",
    fullName: "acme/billing-worker",
    languages: ["TYPESCRIPT"],
    dependsOn: ["demo-pay"],
    files: [
      {
        filePath: "src/billing.ts",
        content: `import { charges, customers } from "demo-pay";

export async function bill(email: string, amount: number) {
  const customer = await customers.create({ email });
  return charges.create({
    amount,
    currency: "eur",
    source: "tok_mc",
    description: "monthly-plan",
    metadata: { customerId: customer.id },
  });
}
`,
      },
    ],
  },
  {
    repositoryId: "mobile-api",
    fullName: "acme/mobile-api",
    languages: ["JAVASCRIPT"],
    dependsOn: ["demo-pay"],
    files: [
      {
        filePath: "index.js",
        content: `const demoPay = require("demo-pay");

async function signup(email) {
  // Only touches a deprecated symbol — worth a heads-up, not a breaking fix.
  return demoPay.customers.create({ email });
}

module.exports = { signup };
`,
      },
    ],
  },
  {
    repositoryId: "analytics-dashboard",
    fullName: "acme/analytics-dashboard",
    languages: ["TYPESCRIPT"],
    dependsOn: [],
    files: [
      {
        filePath: "src/report.ts",
        content: `interface Row { value: number }

export function total(rows: Row[]): number {
  return rows.map((r) => r.value).reduce((a, b) => a + b, 0);
}
`,
      },
    ],
  },
  {
    repositoryId: "internal-tools",
    fullName: "acme/internal-tools",
    languages: ["TYPESCRIPT"],
    dependsOn: ["demo-pay"],
    files: [
      {
        filePath: "src/refund.ts",
        content: `import demoPay from "demo-pay";

// Uses refunds.create, which is unchanged across v1 -> v2. Should stay clean.
export function refund(charge: string) {
  return demoPay.refunds.create({ charge });
}
`,
      },
    ],
  },
  {
    repositoryId: "legacy-monolith",
    fullName: "acme/legacy-monolith",
    languages: ["JAVASCRIPT"],
    dependsOn: ["demo-pay"],
    files: [
      {
        filePath: "src/orders.js",
        content: `const demoPay = require("demo-pay");

async function placeOrder(amount) {
  return demoPay.charges.create({
    amount,
    currency: "usd",
    source: "tok_order",
  });
}

module.exports = { placeOrder };
`,
      },
      {
        filePath: "src/subscriptions.js",
        content: `const demoPay = require("demo-pay");

async function subscribe(amount) {
  return demoPay.charges.create({
    amount,
    currency: "usd",
    source: "tok_sub",
    description: "recurring",
  });
}

module.exports = { subscribe };
`,
      },
    ],
  },
];

export function fixtureFiles(repositoryId: string): FileToScan[] {
  return FLEET_FIXTURES.find((f) => f.repositoryId === repositoryId)?.files ?? [];
}
