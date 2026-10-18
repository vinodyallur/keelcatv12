// Sample repositories in every supported language, each using a fake "demo-pay"
// API in a way that a changelog can break. Used to create REAL test repos on the
// connected GitHub account so the whole flow can be exercised end to end.
//
// Coverage:
//   TS / JS / Python  -> PARAM_RENAME  (source -> payment_method)  [named args]
//   Java / C / C++     -> SYMBOL_RENAME (createCharge -> createPayment) [positional]
//   All                -> customers.create deprecation (notify/flag)

export interface SampleRepo {
  name: string;
  description: string;
  language: string;
  files: Record<string, string>;
}

export const SAMPLE_CHANGELOG = `demo-pay API — 2024-06 release notes

Breaking changes:
- charges.create: the "source" parameter has been renamed to "payment_method".
- The "createCharge" method has been renamed to "createPayment".

Deprecations:
- customers.create is deprecated and will be removed in a future release.`;

export const SAMPLE_REPOS: SampleRepo[] = [
  {
    name: "keelcat-test-ts",
    description: "KeelCat test repo (TypeScript) — charges.create source param",
    language: "TypeScript",
    files: {
      "package.json": JSON.stringify({ name: "keelcat-test-ts", version: "1.0.0", private: true }, null, 2) + "\n",
      "src/checkout.ts": `import { PayClient } from "demo-pay";

const client = new PayClient();

export async function checkout(amount: number) {
  const customer = await client.customers.create({ email: "a@b.com" });
  return client.charges.create({
    amount,
    currency: "usd",
    source: "tok_visa",
    metadata: { customerId: customer.id },
  });
}
`,
    },
  },
  {
    name: "keelcat-test-js",
    description: "KeelCat test repo (JavaScript) — charges.create source param",
    language: "JavaScript",
    files: {
      "package.json":
        JSON.stringify(
          { name: "keelcat-test-js", version: "1.0.0", private: true, scripts: { test: "node --test" } },
          null,
          2
        ) + "\n",
      // Local, dependency-free stand-in for the demo-pay SDK so the app is runnable + testable.
      "demo-pay.js": `class PayClient {
  constructor() {
    this.charges = { create: (opts) => ({ id: "ch_1", ...opts }) };
    this.customers = { create: (opts) => ({ id: "cus_1", ...opts }) };
  }
}
module.exports = { PayClient };
`,
      "index.js": `const { PayClient } = require("./demo-pay");

const client = new PayClient();

async function pay(amount) {
  return client.charges.create({
    amount,
    currency: "usd",
    source: "tok_visa",
  });
}

module.exports = { pay };
`,
      // Tests encode the NEW API (payment_method). A fresh repo fails here;
      // after KeelCat migrates the code, they pass — proof the fix works.
      "test/pay.test.js": `const test = require("node:test");
const assert = require("node:assert");
const { pay } = require("../index.js");

test("charge uses the current payment_method field", async () => {
  const charge = await pay(1000);
  assert.strictEqual(charge.payment_method, "tok_visa");
});

test("the old 'source' field is no longer sent", async () => {
  const charge = await pay(1000);
  assert.strictEqual(charge.source, undefined);
});

test("amount is passed through", async () => {
  const charge = await pay(2500);
  assert.strictEqual(charge.amount, 2500);
});

test("currency is usd", async () => {
  const charge = await pay(1000);
  assert.strictEqual(charge.currency, "usd");
});
`,
    },
  },
  {
    name: "keelcat-test-python",
    description: "KeelCat test repo (Python) — charges.create source kwarg",
    language: "Python",
    files: {
      // Local, dependency-free stand-in for the demo-pay SDK.
      "demo_pay.py": `class _Charges:
    def create(self, **kwargs):
        return dict(id="ch_1", **kwargs)


class _Customers:
    def create(self, **kwargs):
        return dict(id="cus_1", **kwargs)


class PayClient:
    def __init__(self):
        self.charges = _Charges()
        self.customers = _Customers()
`,
      "billing.py": `import demo_pay

client = demo_pay.PayClient()


def bill(amount):
    customer = client.customers.create(email="a@b.com")
    return client.charges.create(
        amount=amount,
        currency="usd",
        source="tok_visa",
    )
`,
      // stdlib unittest — runs with just Python, no pip install needed.
      "test_billing.py": `import unittest
from billing import bill


class TestBilling(unittest.TestCase):
    def test_uses_payment_method(self):
        self.assertEqual(bill(1000).get("payment_method"), "tok_visa")

    def test_old_source_removed(self):
        self.assertIsNone(bill(1000).get("source"))

    def test_amount(self):
        self.assertEqual(bill(2500)["amount"], 2500)

    def test_currency(self):
        self.assertEqual(bill(1000)["currency"], "usd")


if __name__ == "__main__":
    unittest.main()
`,
    },
  },
  {
    name: "keelcat-test-fail",
    description: "KeelCat test repo (JavaScript) — intentionally FAILING test to demo the red path + human-intervention alert",
    language: "JavaScript",
    files: {
      "package.json":
        JSON.stringify(
          { name: "keelcat-test-fail", version: "1.0.0", private: true, scripts: { test: "node --test" } },
          null,
          2
        ) + "\n",
      "demo-pay.js": `class PayClient {
  constructor() {
    this.charges = { create: (opts) => ({ id: "ch_1", ...opts }) };
    this.customers = { create: (opts) => ({ id: "cus_1", ...opts }) };
  }
}
module.exports = { PayClient };
`,
      "index.js": `const { PayClient } = require("./demo-pay");

const client = new PayClient();

async function pay(amount) {
  // NOTE: this app forgets to set receipt_email — the test below expects it,
  // so even after KeelCat migrates source -> payment_method, one test fails.
  return client.charges.create({
    amount,
    currency: "usd",
    source: "tok_visa",
  });
}

module.exports = { pay };
`,
      "test/pay.test.js": `const test = require("node:test");
const assert = require("node:assert");
const { pay } = require("../index.js");

test("charge uses the current payment_method field", async () => {
  const charge = await pay(1000);
  assert.strictEqual(charge.payment_method, "tok_visa");
});

test("amount is passed through", async () => {
  const charge = await pay(1000);
  assert.strictEqual(charge.amount, 1000);
});

// This one FAILS on purpose: the app never sets receipt_email, so the fix
// alone doesn't make the suite green — a human needs to finish the change.
test("charge includes a receipt_email", async () => {
  const charge = await pay(1000);
  assert.strictEqual(charge.receipt_email, "customer@example.com");
});
`,
    },
  },
  {
    name: "keelcat-test-java",
    description: "KeelCat test repo (Java) — createCharge method rename",
    language: "Java",
    files: {
      "src/Main.java": `public class Main {
    public static void main(String[] args) {
        PayClient client = new PayClient();
        client.createCharge(1000, "usd", "tok_visa");
    }
}
`,
    },
  },
  {
    name: "keelcat-test-c",
    description: "KeelCat test repo (C) — createCharge function rename",
    language: "C",
    files: {
      "main.c": `#include "demo_pay.h"

int main(void) {
    createCharge(1000, "usd", "tok_visa");
    return 0;
}
`,
    },
  },
  {
    name: "keelcat-test-cpp",
    description: "KeelCat test repo (C++) — createCharge method rename",
    language: "C++",
    files: {
      "main.cpp": `#include "demo_pay.h"

int main() {
    PayClient client;
    client.createCharge(1000, "usd", "tok_visa");
    return 0;
}
`,
    },
  },
];
