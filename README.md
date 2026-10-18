# KeelCat

**Your APIs change. Your code keeps up.**

KeelCat is a "Dependabot for the APIs your code calls". It watches API provider
changelogs, detects breaking changes (renamed fields, removed methods, deprecated
endpoints), finds every affected call site across your repositories, applies a
scoped fix, verifies it, and opens a reviewable GitHub pull request. A human always
reviews: KeelCat never merges on its own.

Live product: [keelcat.in](https://keelcat.in)

## How it works

1. **Watch**: poll provider changelogs and receive GitHub webhooks; unchanged change sets are deduplicated.
2. **Understand**: parse the changelog into a structured change set (deterministic parser first, LLM only when needed).
3. **Find**: scan connected repositories for affected call sites (TypeScript, JavaScript, Python, Java, C/C++, Go, Ruby).
4. **Fix**: apply deterministic transforms, with LLM assistance for harder cases.
5. **Verify**: syntax and completeness checks before anything is proposed.
6. **PR**: one idempotent, reviewable pull request per repository.

## Features

- Multiple GitHub accounts (GitHub App or token) with per-repository selection
- Runs execute in the visitor's browser by default; the LLM key stays on the server
- Multi-tenant workspaces with GitHub, Google, or guest sign-in
- Run history, per-repository status, security scanning, email/Slack notifications
- Configurable LLM provider (OpenAI-compatible, Gemini, OpenRouter, Ollama)
- Razorpay billing with a free-run limit and an owner-only admin console

## Tech stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS
- **Backend**: Node.js, Express, TypeScript (`server/`)
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

Optional: copy `.env.example` to `server/.env` and set an LLM key, OAuth clients,
or billing keys. Without OAuth or `APP_PASSWORD` the app runs open, so use it only
for local testing.

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
