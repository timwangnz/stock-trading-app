#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# deploy-railway.sh
# One-command Railway deployment for TradeBuddy.
#
# Prerequisites (run once on your machine):
#   npm install -g @railway/cli      # or: brew install railway
#   railway login
#
# Then just run:
#   chmod +x deploy-railway.sh
#   ./deploy-railway.sh
# ──────────────────────────────────────────────────────────────────

set -e

# ── Helpers ───────────────────────────────────────────────────────
info()  { echo -e "\033[34m[railway]\033[0m $*"; }
ok()    { echo -e "\033[32m✔\033[0m $*"; }
ask()   { read -rp "$(echo -e "\033[33m?\033[0m $1: ")" "$2"; }

# ── Check CLI ─────────────────────────────────────────────────────
if ! command -v railway &>/dev/null; then
  echo "Railway CLI not found. Install it first:"
  echo "  npm install -g @railway/cli   (or: brew install railway)"
  exit 1
fi

info "Logged-in user: $(railway whoami 2>/dev/null || echo 'not logged in — run: railway login')"

# ── Project init ──────────────────────────────────────────────────
info "Initialising Railway project…"
railway init

# ── Add PostgreSQL database ───────────────────────────────────────
info "Adding PostgreSQL database…"
railway add -d postgres
ok "PostgreSQL added — DATABASE_URL will be injected automatically"

# ── Environment variables ─────────────────────────────────────────
info "Setting environment variables…"

# Pull values from local .env where possible
source_env() {
  local key=$1
  local val
  val=$(grep "^${key}=" .env 2>/dev/null | cut -d= -f2-)
  echo "$val"
}

JWT_SECRET=$(source_env JWT_SECRET)
POLYGON_API_KEY=$(source_env POLYGON_API_KEY)
ANTHROPIC_API_KEY=$(source_env ANTHROPIC_API_KEY)
GOOGLE_CLIENT_ID=$(source_env GOOGLE_CLIENT_ID)
VITE_GOOGLE_CLIENT_ID=$(source_env VITE_GOOGLE_CLIENT_ID)
SNAPSHOT_SECRET=$(source_env SNAPSHOT_SECRET)

railway variables set \
  NODE_ENV=production \
  JWT_SECRET="$JWT_SECRET" \
  POLYGON_API_KEY="$POLYGON_API_KEY" \
  ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" \
  VITE_GOOGLE_CLIENT_ID="$VITE_GOOGLE_CLIENT_ID" \
  SNAPSHOT_SECRET="$SNAPSHOT_SECRET"

ok "Environment variables set"

# ── Run DB setup against Railway's Postgres ───────────────────────
info "Running database schema setup…"
DATABASE_URL=$(railway variables get DATABASE_URL)
DATABASE_URL="$DATABASE_URL" node server/setup-db.js
ok "Database tables created"

# ── Deploy ────────────────────────────────────────────────────────
info "Deploying app (this may take a minute)…"
railway up --detach

ok "Deployment triggered!"
echo ""
echo "Track progress:  railway logs"
echo "Open app:        railway open"
echo "View variables:  railway variables"
