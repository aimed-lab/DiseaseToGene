# syntax=docker/dockerfile:1

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies from the lockfile (reproducible). Copied separately from the
# source so this layer is cached until the dependencies themselves change.
COPY package.json package-lock.json ./
RUN npm ci

# Build the frontend (Vite → dist/) and bundle the server (esbuild → dist-server/).
COPY . .
RUN npm run build

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:20-alpine AS production

LABEL org.opencontainers.image.title="Disease2Target" \
      org.opencontainers.image.description="Evidence-weighted drug target prioritization" \
      org.opencontainers.image.source="https://github.com/aimed-lab/DiseaseToGene"

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# Only the build artifacts ship. The server is bundled by esbuild, so production
# needs no node_modules, no Vite and no tsx — the image has no install step and
# nothing to resolve at boot.
#
# NOTE: oracleService.ts is deliberately NOT bundled (it would drag the native
# oracledb driver in), so this image is READ-ONLY: reads work over ORDS/HTTPS,
# while write endpoints (harvest/save/delete) fail with a missing-module error.
# Run harvests from the CLI or a dev server that can reach Oracle directly.
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/dist-server ./dist-server

# Reference compendia (DepMap, expression, gnomAD constraint, tissue specificity).
# These are read from ./data at RUNTIME by the drill-down endpoints, and the loader
# swallows a missing file into a 503 {notLoaded:true} — so leaving them out makes the
# panels silently empty rather than failing loudly. ~17 MB.
COPY --from=builder --chown=node:node /app/data ./data

# Drop privileges — the node:alpine images ship an unprivileged `node` user.
USER node

EXPOSE 3000

# Liveness only: /api/health touches no database, so a DB blip won't kill a
# container that is otherwise serving correctly.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" > /dev/null 2>&1 || exit 1

CMD ["node", "dist-server/server.cjs"]
