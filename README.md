# KeelCat

**Your APIs change. Your code keeps up. Powered by Meta Muse Spark.**

Live product: [keelcat.in](https://keelcat.in)

## The problem

Every product depends on third-party APIs: payments, auth, messaging, cloud SDKs.
Providers ship breaking changes all the time. A parameter is renamed, a method is
removed, an endpoint is deprecated, and the only notice is a changelog written for
humans. Dependency bots bump the version number, but nobody rewrites the code that
calls the API, so teams find out when production breaks. Fixing it by hand means
reading the changelog, searching every repository and language for affected call
sites, editing each one and opening reviews. That is hours of repetitive work per
change, multiplied by every repository.

## The solution

KeelCat turns an API changelog into reviewed pull requests. Paste a changelog (or
let KeelCat watch it), and a Meta model reads it and produces a structured change
list. KeelCat finds every affected call site across your repositories, rewrites it,
verifies it, and opens one pull request per repository. A human always reviews:
KeelCat never merges on its own.

## Meta models in the pipeline

Every AI step in KeelCat runs on a Meta model. The default is **Meta Muse Spark 1.3**
(`meta/muse-spark-1.3`) through OpenRouter's OpenAI-compatible API.

| Pipeline step | What the Meta model does | Code |
| --- | --- | --- |
| Understand | Reads changelog prose and returns a structured JSON change list (symbol, kind, from → to, impact) | [`server/src/llm/changelog.ts`](server/src/llm/changelog.ts) |
| Fix | Drafts the code edit for changes that need judgment: removed or newly required parameters, removed symbols | [`server/src/core/apply-change.ts`](server/src/core/apply-change.ts), [`src/pipeline/apply-change.ts`](src/pipeline/apply-change.ts) |
| KeelCat AI (default for guests) | Guests and workspaces without their own key use the admin's shared Meta model, with no setup | [`server/src/config/default-llm.ts`](server/src/config/default-llm.ts) |
| Model client | One OpenAI-compatible client; the default endpoint is OpenRouter | [`server/src/llm/client.ts`](server/src/llm/client.ts) |

Safety around the model: renames and deprecations are applied by deterministic rules
(the model never guesses those), a rule-based parser backs up the model so obvious
changes are never missed, and every edit is verified before a pull request is opened.

## Meta model endpoints

| Endpoint | Base URL | Meta models |
| --- | --- | --- |
| OpenRouter (default) | `https://openrouter.ai/api/v1` | `meta/muse-spark-1.3` (default), `meta/muse-wonder`, `meta-llama/llama-4-maverick`, `meta-llama/llama-4-scout`, `meta-llama/llama-3.3-70b-instruct` |
| Ollama (local, private) | `http://127.0.0.1:11434/v1` | `llama3.3`, `llama3.2`, `llama3.1` |
| Any OpenAI-compatible host serving Meta models (Meta Model API, Fireworks, Baseten, Modal) | the host's `/v1` URL | the host's Meta model ID |

### Configure

- **Your workspace:** Connect → LLM → *Meta Muse / Llama via OpenRouter* → model
  `meta/muse-spark-1.3` → paste your OpenRouter key → *Save & test*.
- **All guests (admin):** Admin → *Default Meta model for users* → *Meta Muse Spark 1.3
  (OpenRouter)* → paste the key → switch on → keep *Guests* on → *Save* → *Test saved settings*.
- **Server environment (fresh install):** set `LLM_API_KEY` to an OpenRouter key; the
  default workspace model is `meta/muse-spark-1.3`.

## How it works

1. **Watch**: poll provider changelogs and receive GitHub webhooks; unchanged change sets are deduplicated.
2. **Understand**: Meta Muse Spark turns the changelog into a structured change set.
3. **Find**: scan connected repositories for affected call sites (TypeScript, JavaScript, Python, Java, C/C++, Go, Ruby).
4. **Fix**: deterministic transforms first; Meta Muse Spark drafts the edits that need judgment.
5. **Verify**: syntax and completeness checks before anything is proposed.
6. **PR**: one idempotent, reviewable pull request per repository.

## Features

- Multiple GitHub accounts (GitHub App or token) with per-repository selection
- Runs execute in the visitor's browser by default; the model key stays on the server
- Multi-tenant workspaces with GitHub, Google, or guest sign-in
- Admin-managed default Meta model for guests and users, with daily usage limits
- Run history, per-repository status, security scanning, email/Slack notifications
- Razorpay billing, an Enterprise contact-sales form, and an owner-only admin console

## Tech stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS
- **Backend**: Node.js, Express, TypeScript (`server/`)
- **AI**: Meta Muse Spark 1.3 and Meta Llama 4 through OpenRouter's OpenAI-compatible API
- **Integrations**: GitHub REST API, GitHub App, webhooks
- **Deployment**: Docker Compose + Caddy (automatic HTTPS) on Google Cloud Compute Engine or AWS
- **Testing**: Vitest, fast-check

## Run locally

Requires Node.js 20+.

```bash
npm install
npm --prefix server install

# Terminal 1: backend on http://localhost:8787
npm --prefix server start

# Terminal 2: dashboard on http://localhost:5173
npm run dev
```

Optional: copy `.env.example` to `server/.env` and set `LLM_API_KEY` (an OpenRouter
key for Meta models), OAuth clients, or billing keys. Without OAuth or `APP_PASSWORD`
the app runs open, so use it only for local testing.

```bash
npm --prefix server test   # backend tests
npm run build              # typecheck + production build
```

## Deploy

See [DEPLOY.md](DEPLOY.md) for Google Cloud Compute Engine and AWS instructions.

## Security

Never commit `.env` files or `server/data/`; they hold tokens, OAuth secrets, and
tenant data and are ignored by `.gitignore`. Keep the test sandbox disabled on
public hosts because it executes third-party code.

## Pitch deck

[KeelCat pitch deck](docs/KeelCat-Pitch-Deck.pptx)
