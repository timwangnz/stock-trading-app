#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# railway-env-sync.sh
# Syncs all required environment variables from your local .env
# to Railway. Run this any time you update .env.
#
# Usage:
#   chmod +x railway-env-sync.sh
#   ./railway-env-sync.sh
# ──────────────────────────────────────────────────────────────────

set -e

# Helper to read a value from .env
env_val() {
  grep "^${1}=" .env 2>/dev/null | cut -d= -f2-
}

echo "🔄 Syncing environment variables to Railway..."

railway variables set \
  NODE_ENV=production \
  APP_URL="$(env_val APP_URL)" \
  POLYGON_API_KEY="$(env_val POLYGON_API_KEY)" \
  ANTHROPIC_API_KEY="$(env_val ANTHROPIC_API_KEY)" \
  JWT_SECRET="$(env_val JWT_SECRET)" \
  GOOGLE_CLIENT_ID="$(env_val GOOGLE_CLIENT_ID)" \
  GOOGLE_CLIENT_SECRET="$(env_val GOOGLE_CLIENT_SECRET)" \
  VITE_GOOGLE_CLIENT_ID="$(env_val VITE_GOOGLE_CLIENT_ID)" \
  RESEND_API_KEY="$(env_val RESEND_API_KEY)" \
  EMAIL_FROM="$(env_val EMAIL_FROM)" \
  SNAPSHOT_SECRET="$(env_val SNAPSHOT_SECRET)" \
  LLM_ENCRYPTION_KEY="$(env_val LLM_ENCRYPTION_KEY)"

echo ""
echo "✅ Done! Variables set:"
echo "   NODE_ENV, APP_URL, POLYGON_API_KEY, ANTHROPIC_API_KEY,"
echo "   JWT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,"
echo "   VITE_GOOGLE_CLIENT_ID, RESEND_API_KEY, EMAIL_FROM,"
echo "   SNAPSHOT_SECRET, LLM_ENCRYPTION_KEY"
echo ""
echo "⚠️  DATABASE_URL is managed separately as a Railway reference:"
echo "   \${{Postgres.DATABASE_URL}}"
echo ""
echo "🚀 Redeploying..."
railway up
