# ─────────────────────────────────────────────────────────────────
# Stage 1 — Build the React frontend
# ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install ALL deps (including devDependencies needed for Vite build)
COPY package*.json ./
RUN npm ci

# Copy source and build
# (Google Client ID and other API keys are no longer baked in at build time —
#  they are configured by the admin in App Settings after first boot.)
COPY . .
RUN npm run build
# Output: /app/dist


# ─────────────────────────────────────────────────────────────────
# Stage 2 — Production image (Express only, no build tools)
# ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# postgresql-client provides psql — needed for auto-restore on startup
RUN apk add --no-cache postgresql-client

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy server source and entrypoint
COPY server/ ./server/
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

# Copy React build output from Stage 1
COPY --from=builder /app/dist ./dist

# Cloud Run injects PORT at runtime; fall back to 8080
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

# Entrypoint runs DB setup (safe to re-run) then starts the server
ENTRYPOINT ["./docker-entrypoint.sh"]
