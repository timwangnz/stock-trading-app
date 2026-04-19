#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# TradeBuddy — backup.sh
# Daily database backup to ~/Documents/TradeBuddy-Backups/
# (Documents folder syncs to iCloud automatically if enabled)
#
# Keeps the last 7 days of backups — older ones are deleted.
#
# Scheduled automatically by install.sh (runs at midnight daily).
# You can also run it manually anytime:  bash backup.sh
# ─────────────────────────────────────────────────────────────────

set -e

BACKUP_DIR="$HOME/Documents/TradeBuddy-Backups"
DATE=$(date +%Y-%m-%d)
BACKUP_FILE="$BACKUP_DIR/backup-$DATE.sql"
LOG_FILE="$BACKUP_DIR/backup.log"
KEEP_DAYS=7

mkdir -p "$BACKUP_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "Starting TradeBuddy backup..."

# Find the running db container
DB_CONTAINER=$(docker compose -f "$(dirname "$0")/docker-compose.yml" ps -q db 2>/dev/null)

if [ -z "$DB_CONTAINER" ]; then
  log "ERROR: TradeBuddy database container is not running. Backup skipped."
  exit 1
fi

# Dump the database
docker exec "$DB_CONTAINER" \
  pg_dump -U tradebuddy tradebuddy > "$BACKUP_FILE"

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
log "Backup saved: $BACKUP_FILE ($SIZE)"

# Delete backups older than 7 days
DELETED=$(find "$BACKUP_DIR" -name "backup-*.sql" -mtime +$KEEP_DAYS -print -delete | wc -l | tr -d ' ')
if [ "$DELETED" -gt 0 ]; then
  log "Deleted $DELETED old backup(s) (keeping last $KEEP_DAYS days)"
fi

log "Backup complete. Files in $BACKUP_DIR:"
ls -lh "$BACKUP_DIR"/backup-*.sql 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}' | tee -a "$LOG_FILE"
