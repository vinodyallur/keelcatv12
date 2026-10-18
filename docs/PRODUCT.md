# KeelCat — Product Overview

**Dependabot for the APIs your code calls.**

Version 1.0 · Product & Technical Overview

---

## 1. Executive Summary

Modern software is built on other people's APIs. A typical product talks to Stripe for payments, Twilio for messaging, OpenAI or Anthropic for AI, and a dozen internal services. Every one of those APIs changes over time. A field gets renamed, a method is removed, an endpoint is deprecated. When that happens, the code that depends on it silently rots and eventually breaks — often in production, often at the worst possible moment.

**KeelCat is the system that keeps your code working when the APIs it depends on change.**

It continuously watches the changelogs of the API providers you use. The moment a breaking change ships, KeelCat reads it, finds every repository and every line of code across all your languages that is affected, rewrites that code to match the new API, verifies the change in an isolated sandbox, and opens a reviewable pull request on each affected repository. A human always reviews and merges — KeelCat never merges on its own.

The result: a breaking API change goes from a multi-hour fire drill to a pull request you approve in about a minute.

KeelCat maintains the API **interface** your code calls. It does not touch your keys, secrets, or credentials.

---

## 2. The Problem

### 2.1 APIs change, and it is expensive

Every team that builds on third-party or internal APIs pays a recurring, unplanned tax:

- **Breaking changes arrive without warning you act on.** Providers publish changelogs, but nobody on your team is reading every provider's changelog every day.
- **The failure mode is production.** You usually discover a breaking change when something stops working for a customer, not when it is announced.
- **The fix is manual and tedious.** An engineer has to find every call site, across every repository and every language, understand the new API shape, and rewrite each one by hand.
- **It scales badly.** The more APIs you depend on and the more repositories you own, the worse it gets. A single provider change can touch dozens of repos.

Industry analysis puts unmanaged API changes behind roughly 40% of integration failures, costing teams an average of 15 to 20 hours of emergency engineering per incident. (Figures from 2026 API-change management analysis; rephrased for licensing compliance.)

### 2.2 The problem is getting worse, fast

Traditional providers like Stripe and Twilio invested heavily in backward compatibility and long deprecation windows measured in months or years. The new generation of AI and LLM APIs does not. Models and endpoints are deprecated on roughly 90-day cycles. As more of the software world builds on top of fast-moving AI APIs, the frequency and cost of breaking changes climbs sharply.

### 2.3 Why existing tools do not solve it

- **Dependabot, Renovate, and Snyk** manage dependency *version numbers* and flag known vulnerabilities. They bump a version and open a PR, but they do not read a provider's changelog or rewrite your code to match a changed API surface.
- **Sourcegraph Batch Changes, Moderne (OpenRewrite), Grit, and Codemod** perform large-scale code transformations, but they are manually driven. An engineer still has to author the migration recipe and decide when to run it. They are tools for the person already doing a migration — not an autonomous watcher that starts the work for you.

Nobody closes the full loop from "a provider shipped a breaking change" to "here is a verified pull request that fixes it." That is the gap KeelCat fills.

---

## 3. Who This Is For

- **Engineering teams that integrate paid third-party APIs** — payments, comms, AI, data providers.
- **Companies with many repositories and multiple languages**, where a single API change fans out across the codebase.
- **Teams that depend on internal APIs** with no backward-compatibility guarantees — the highest-value case, because internal services break more often than Stripe ever will.
- **Platform and developer-experience teams** responsible for keeping a large codebase healthy.

---

## 4. What KeelCat Does

KeelCat turns an API changelog into reviewed pull requests, automatically. The core promise is simple:

> Your APIs change. Your code keeps up.

At a high level, KeelCat:

1. **Watches** the changelogs of the API providers you register, and accepts changelogs pushed to it via webhook.
2. **Understands** each change — what was renamed, removed, deprecated, or altered — using a deterministic parser first and an LLM only for ambiguous cases.
3. **Finds** every affected repository and call site across all your connected languages.
4. **Fixes** the code to match the new API surface.
5. **Verifies** the fix, and runs it in an isolated sandbox where applicable.
6. **Opens a pull request** on each affected repository for a human to review.
7. **Reports** what it did through a live dashboard, email, and Slack — and never merges on its own.

It also runs a **security pass** over the code it touches, flagging issues in the same workflow.

---

## 5. How It Works (End to End)

### 5.1 Connect

You connect KeelCat to your GitHub organization using a GitHub App (or a personal access token for quick trials). You choose which repositories it is allowed to watch and open PRs against.

### 5.2 Register providers and changelog sources

On the Providers page you register the APIs you depend on — a name, the SDK package, and a changelog URL (a raw text or markdown file). You can also add arbitrary "watched changelog URLs" in settings. KeelCat automatically converts GitHub `blob` URLs to their raw form so it reads the actual content, not a dynamic web page.

### 5.3 Detect a change

KeelCat detects changes two ways:

- **Scheduled watching:** on a configurable interval it fetches each watched changelog, normalizes it, and compares the parsed change-set against the stored baseline. It only proceeds when the change-set actually differs — cosmetic or dynamic diffs never trigger a run.
- **Webhook:** any system can POST a changelog to KeelCat's webhook (wired to a GitHub Action, an email forwarder, or an automation tool). GitHub webhook payloads are signature-verified.

Crucially, de-duplication happens **before** any LLM call. KeelCat uses a fast deterministic parser to fingerprint the change-set and decide whether anything is genuinely new. The more expensive LLM parsing is only spent on real, new changes.

### 5.4 Understand the change

The changelog is parsed into a structured **change-set**: a list of typed changes such as *renamed field*, *removed method*, *deprecated endpoint*, each with the symbol involved and its before/after form. A deterministic parser handles the common, well-formed cases; the LLM is a fallback for prose-heavy or ambiguous entries.

### 5.5 Find affected code

For each change, KeelCat scans your connected repositories to find every call site that uses the affected symbol, across all supported languages.

### 5.6 Fix the code

KeelCat applies the fix using a hybrid engine:

- **Deterministic transforms** handle the common, mechanical cases — renames and signature changes — precisely and predictably.
- **An LLM fallback** handles the harder cases, such as removals and structural changes, where judgment is needed.

This "deterministic first, LLM only when necessary" design keeps fixes accurate and predictable, and keeps token cost and latency low.

### 5.7 Verify

After fixing, KeelCat runs a verification step to confirm the change is coherent and that no old API usage was left behind (a completeness check). Where applicable, it runs the code in an **ephemeral sandbox** to catch obvious breakage before a PR is opened. The sandbox executes untrusted code in isolation and is kept off shared public hosts.

### 5.8 Open a pull request

For each affected repository, KeelCat opens a pull request with the fix and a clear description of the change it is responding to. Branch names are deterministic — derived from a hash of the change-set — so re-running the same changelog **reuses and updates the same PR** instead of piling up duplicates. **KeelCat never auto-merges.** A human always reviews.

### 5.9 Report

Everything is visible on a live dashboard: which changelogs were processed, which repositories were touched, which PRs were opened, and their status. KeelCat sends one consolidated notification per run by email and Slack, and stays silent on no-op runs so it never spams you. Every changelog and PR can be exported to a spreadsheet.

---

## 6. Key Features

- **Automatic changelog watching** — polling plus webhook, with change-detection so it only acts on real changes.
- **Multi-language code fixing** — finds and rewrites call sites across all connected repositories and languages.
- **Hybrid fix engine** — deterministic transforms for common cases, LLM fallback for the hard ones.
- **Verification and sandboxing** — confirms fixes and runs them in isolation before opening PRs.
- **Idempotent pull requests** — one PR per change-set; re-runs update rather than duplicate.
- **Reviewable by design** — never auto-merges; a human is always in the loop.
- **Security pass** — flags security issues in the code it touches.
- **Full audit trail** — every changelog, run, and PR is recorded and exportable to Excel.
- **Notifications without noise** — consolidated email and Slack, silent on no-op runs.
- **God Mode** — fully automatic operation: watch, detect, fix, and PR with no button presses.

---

## 7. Product Surface

KeelCat is a web application with a clean, professional dashboard. The main areas are:

- **Connect** — link GitHub (App or token) and choose repositories.
- **Providers** — the registry of APIs KeelCat knows about, with changelog URLs and watch toggles.
- **Changelog** — post or inspect a changelog and see what it will do.
- **Repositories** — a live view of the repos KeelCat is changing right now, with impact detected, PR status, and test results, filterable by changelog.
- **Runs** — full history of changelogs from every channel, the PRs each opened, and their status, with spreadsheet export.
- **Security** — findings from the security pass.
- **Settings** — watching interval, verification and completeness checks, notifications, appearance, and the webhook endpoint.

The interface supports light and dark themes and two visual skins (a modern flat style and a neumorphic soft-UI style).

---

## 8. Architecture and Technology

- **Frontend:** React, TypeScript, Vite, Tailwind CSS.
- **Backend:** Node.js and Express in TypeScript.
- **Integration:** GitHub App and webhooks for repository access and pull-request creation; signature-verified inbound webhooks.
- **Fix engine:** deterministic transforms with an LLM fallback, routed through OpenRouter so the underlying model can be swapped freely.
- **Verification:** a dedicated verify step plus an ephemeral sandbox runner.
- **Deployment:** packaged as a Docker container behind the Caddy web server with automatic HTTPS, running on AWS. Persistent state is stored on a mounted volume.

The pipeline is organized as clear stages: fetch, parse, find, fix, verify, sandbox, and open PR. Notifications and the audit log are separate, consolidated concerns.

---

## 9. Security and Trust Model

- **KeelCat maintains the API interface your code calls — not your secrets.** It does not manage or store your API keys or credentials.
- **A human always reviews.** KeelCat opens pull requests; it never merges them. Nothing reaches your main branch without a person approving it.
- **Inbound webhooks are signature-verified**, with specific, logged rejection reasons for missing versus invalid signatures.
- **Untrusted code runs only in an isolated, ephemeral sandbox**, which is kept disabled on shared public hosts.
- **Least-privilege repository access** through a GitHub App, scoped to the repositories you choose.

Multi-tenant, per-user isolation with "log in with GitHub" is on the near-term roadmap; the current interim protection is a shared password gate on the hosted instance.

---

## 10. Market and Opportunity

The API management market is approximately 8 to 10 billion US dollars in 2026 and growing at roughly 17 to 25 percent per year, according to multiple 2026 industry reports (Mordor Intelligence, Fortune Business Insights; figures rephrased for licensing compliance). Developer-tools spend sits inside that market, alongside the budget already spent on Dependabot, Snyk, and Sourcegraph.

The tailwind is structural: as more software is built on fast-moving AI APIs that deprecate on roughly 90-day cycles, the frequency and cost of breaking changes rises, and the value of automatically absorbing them rises with it.

---

## 11. Competitive Landscape

| Category | Examples | What they do | What they do not do |
|---|---|---|---|
| Dependency version bots | Dependabot, Renovate, Snyk | Bump version numbers, flag CVEs | Do not read provider changelogs or rewrite your code to match a changed API |
| Batch code transformation | Sourcegraph Batch Changes, Moderne, Grit, Codemod | Large-scale, engineer-authored migrations | Manually triggered; an engineer must author the recipe and decide when to run |
| **KeelCat** | — | **Event-driven: detect a breaking change, fix code, verify, open a PR — autonomously** | Does not require a human to trigger or author the migration |

**Our insight:** the trigger and the packaging matter more than the transform. The painful, valuable moment is the *unplanned* breaking change you did not know shipped. KeelCat is event-driven — it starts from the provider's changelog automatically. And by scoping to "the external APIs you call," we get a tractable, high-signal problem that we can solve autonomously and accurately, rather than trying to transform arbitrary code.

---

## 12. Business Model

KeelCat is sold as SaaS to engineering teams — the same buyer and budget as Dependabot, Snyk, and Sourcegraph.

- **Free tier** for individuals and open-source.
- **Team tier** at roughly 20 to 40 US dollars per developer per month.
- **Enterprise** for organizations with many repositories and private or internal APIs — the highest-value segment, because internal APIs have no backward-compatibility guarantees.

**Bottom-up sizing:** there are millions of professional teams building on paid third-party APIs. At 100,000 paying teams and an average of about 200 US dollars per month, that is roughly 240 million US dollars in annual recurring revenue. Capturing even a low-single-digit share of API-tooling budgets supports a 100-million-dollar-plus revenue business. The wedge is breaking-change auto-fix; the expansion is becoming the system of record for every external dependency your code actually calls.

---

## 13. Roadmap

- **OAuth login and multi-tenancy** — per-tenant data isolation and "log in with GitHub." This is the key unlock for broad public, multi-user use.
- **Broader language and framework coverage** for the fix engine.
- **Deeper provider registry** with first-class, pre-wired changelog sources for popular APIs.
- **Richer verification**, including running a repository's own test suite where available.
- **Team workflow** — reviewers, policies, and reporting.

---

## 14. Summary

Every team that builds on other people's APIs pays a recurring, unplanned tax when those APIs change. Existing tools bump version numbers or help an engineer run a migration they already decided to do. None of them watch for the breaking change and fix your code for you.

KeelCat closes that loop: watch, understand, find, fix, verify, and open a reviewable pull request — automatically, and never merging without a human. Your APIs change. Your code keeps up.
