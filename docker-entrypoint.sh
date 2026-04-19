#!/bin/sh
# ─────────────────────────────────────────────────────────────────
# docker-entrypoint.sh
# Runs DB schema setup (safe to re-run) then starts the server.
# ─────────────────────────────────────────────────────────────────

set -e

echo "🔧 Initialising database schema…"
node server/setup-db.js

echo "👤 Checking admin user…"
node server/create-admin.js

echo "🚀 Starting TradeBuddy…"
exec node server/index.js
