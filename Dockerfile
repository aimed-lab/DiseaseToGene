# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build frontend
COPY . .
RUN npm run build

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Install only production dependencies + tsx (needed to run server.ts)
COPY package*.json ./
RUN npm ci --omit=dev && npm install tsx

# Copy built frontend from builder
COPY --from=builder /app/dist ./dist

# Copy server source files
COPY server.ts ./
COPY tsconfig.json ./
COPY supabase.ts ./

# Copy any other files server.ts imports at runtime
COPY vite.config.ts ./

EXPOSE 3000

ENV NODE_ENV=production

CMD ["npx", "tsx", "server.ts"]
