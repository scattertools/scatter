# syntax=docker/dockerfile:1

# =============================================================================
# Scatter Coordinator — Fastify v5 + better-sqlite3 (native addon)
# Build context MUST be the repo root:
#   docker build -f apps/coordinator/Dockerfile -t scatter-coordinator .
# Debian-slim (NOT alpine) so the native better-sqlite3 binding compiles and
# runs against glibc without musl pain.
# =============================================================================

ARG NODE_VERSION=24-bookworm-slim
ARG PNPM_VERSION=10.33.2

# -----------------------------------------------------------------------------
# Base: pin pnpm via corepack on a slim Node 24 image.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

# -----------------------------------------------------------------------------
# Builder: full toolchain to compile better-sqlite3, install workspace, build.
# -----------------------------------------------------------------------------
FROM base AS builder

# Native build deps for better-sqlite3 (node-gyp -> python3 + make + g++).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Copy the whole workspace (the .dockerignore keeps this lean). Both the
# coordinator and its workspace dep @scatter/protocol are needed.
COPY . .

# Install all workspace deps from the committed lockfile. --frozen-lockfile
# makes the build reproducible and fails fast if pnpm-lock.yaml has drifted
# from the manifests. Native postinstall builds are allow-listed in
# pnpm-workspace.yaml (better-sqlite3 / esbuild / sharp).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile

# Build @scatter/protocol then the coordinator (tsc -> dist/, plain-node JS).
RUN pnpm --filter @scatter/protocol build \
  && pnpm --filter coordinator build

# Produce a self-contained, production-only deployment of the coordinator with
# its compiled native modules under /app (node_modules + package.json).
RUN pnpm --filter coordinator deploy --prod --legacy /app

# -----------------------------------------------------------------------------
# Runtime: slim image, no toolchain, non-root, only dist + prod node_modules.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
# DB lives on a named volume mounted at /data so it survives restarts.
ENV DATABASE_PATH=/data/scatter.db
WORKDIR /app

# Production node_modules (incl. compiled better-sqlite3 binding) + package.json.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
# Compiled application output.
COPY --from=builder /repo/apps/coordinator/dist ./dist

# Create the data dir and run as the unprivileged built-in `node` user.
RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 4000

# Run the plain-node build directly (no experimental flags, no pnpm wrapper) so
# SIGTERM/SIGINT reach the Node process for graceful shutdown.
CMD ["node", "dist/index.js"]
