# syntax=docker/dockerfile:1

# =============================================================================
# Scatter Web — Next.js 16 (standalone output), React 19
# Build context MUST be the repo root:
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=http://localhost:4000 \
#     -t scatter-web .
#
# NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time, so they
# are passed as build args (not runtime env).
#
# Monorepo standalone layout note: because @scatter/protocol is a workspace dep,
# `next build` nests the standalone server under apps/web/server.js with the
# pnpm node_modules at the standalone root. The static + public assets are NOT
# copied into standalone automatically, so we overlay them manually.
# =============================================================================

ARG NODE_VERSION=24-bookworm-slim
ARG PNPM_VERSION=10.33.2

FROM node:${NODE_VERSION} AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

# -----------------------------------------------------------------------------
# Builder: install workspace, run `next build` (output: 'standalone').
# -----------------------------------------------------------------------------
FROM base AS builder

# NEXT_PUBLIC_* are baked at build time — surface them as build args.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_WEB_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_WEB_URL=${NEXT_PUBLIC_WEB_URL}
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Whole workspace: web imports @scatter/protocol from SOURCE (.ts), so the
# protocol package src/ must be present for `next build` to trace it.
COPY . .

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install

RUN pnpm --filter web build

# -----------------------------------------------------------------------------
# Runtime: minimal image serving the standalone server, non-root.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# Standalone bundle (self-contained server + traced node_modules). The trace
# root is the repo, so the tree is rooted here and the entrypoint is at
# apps/web/server.js.
COPY --from=builder --chown=node:node /repo/apps/web/.next/standalone ./
# Static assets + public are not auto-copied into standalone; place them where
# apps/web/server.js expects them (relative to the nested app dir).
COPY --from=builder --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /repo/apps/web/public ./apps/web/public

USER node

EXPOSE 3000

# server.js honours PORT / HOSTNAME env vars. Receiving SIGTERM directly (PID 1)
# lets Next shut down cleanly.
CMD ["node", "apps/web/server.js"]
