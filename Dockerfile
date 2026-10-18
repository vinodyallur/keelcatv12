# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────
# Stage 1 — build the dashboard (Vite/React) into /web/dist
# ─────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS web
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Production build → same-origin API calls (VITE_API_URL unset ⇒ BASE="")
RUN npm run build

# ─────────────────────────────────────────────────────────────
# Stage 2 — runtime: Node engine that serves API + the built SPA
# ─────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

# git      → repo clone + test sandbox
# python3  → running Python repo test suites in the sandbox
# tini     → correct PID 1 / signal handling for graceful shutdown
RUN apt-get update \
  && apt-get install -y --no-install-recommends git python3 ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server

# Install server deps first for better layer caching.
# --include=dev keeps tsx (the TS runner) available at runtime.
COPY server/package.json server/package-lock.json ./
RUN npm ci --include=dev && npm cache clean --force

# Server source (includes demo/spec assets that are read at runtime).
COPY server/ ./

# The built dashboard where server.ts expects it (…/server/../../dist ⇒ /app/dist).
COPY --from=web /web/dist /app/dist

# Persisted config/secrets/state live here — mount a volume at this path.
RUN mkdir -p /app/server/data

ENV NODE_ENV=production
ENV PORT=8080
ENV PUBLIC_DIR=/app/dist

EXPOSE 8080

# Lightweight healthcheck so the orchestrator knows when we're live.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start"]
