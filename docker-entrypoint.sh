#!/bin/sh
# ─────────────────────────────────────────────────────────────────
# docker-entrypoint.sh
# Runs DB schema setup (safe to re-run) then starts the server.
# ─────────────────────────────────────────────────────────────────

set -e

echo "🔧 Initialising database schema…"
node server/setup-db.js

# ── Auto-restore from backup if DB is empty ───────────────────────
# This handles the case where the Mac Mini had a disk failure and
# the Docker volume was lost. On first boot after recovery, if the
# users table is empty and a backup exists, restore automatically.
#
# On Railway / cloud deployments (DATABASE_URL is set), we skip the
# backup-restore entirely — backups only apply to the local Docker
# install where a physical disk failure is possible.

if [ -n "$DATABASE_URL" ]; then
  echo "☁️  Cloud deployment detected — skipping backup-restore check."
elif [ -n "$DB_HOST" ]; then
  USER_COUNT=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM users;" 2>/dev/null | tr -d ' \n' || echo "0")

  if [ "$USER_COUNT" = "0" ]; then
    LATEST_BACKUP=$(ls -t /backups/backup-*.sql 2>/dev/null | head -1)
    if [ -n "$LATEST_BACKUP" ]; then
      echo "⚠️  Empty database detected. Restoring from backup: $LATEST_BACKUP"
      PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" < "$LATEST_BACKUP"
      echo "✅ Database restored successfully!"
    else
      echo "ℹ️  No backup found — starting with empty database."
    fi
  else
    echo "✅ Database has $USER_COUNT user(s) — no restore needed."
  fi
fi

echo "👤 Checking admin user…"
node server/create-admin.js

echo "🚀 Starting TradeBuddy…"
exec node server/index.js
