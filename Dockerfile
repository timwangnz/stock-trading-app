# ─────────────────────────────────────────────────────────────────
# Stage 1 — Build the React frontend
# ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install ALL deps (including devDependencies needed for Vite build)
COPY package*.json ./
RUN npm ci

# Declare build-time variables (Railway passes env vars as build args)
# These get baked into the Vite bundle at build time.
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

# Copy source and build
COPY . .
RUN npm run build
# Output: /app/dist


# ─────────────────────────────────────────────────────────────────
# Stage 2 — Production image (Express only, no build tools)
# ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

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
