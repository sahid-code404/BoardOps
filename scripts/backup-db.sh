#!/bin/bash
# BoardOps database backup script
# Usage: bash scripts/backup-db.sh
# Add to crontab: 0 2 * * * /home/z/my-project/scripts/backup-db.sh

DB_PATH="/home/z/my-project/db/custom.db"
BACKUP_DIR="/home/z/my-project/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/boardops_$TIMESTAMP.db"

mkdir -p "$BACKUP_DIR"

# SQLite backup using .backup command (safe even while DB is in use)
if command -v sqlite3 &> /dev/null; then
  sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"
else
  # Fallback: copy the file
  cp "$DB_PATH" "$BACKUP_FILE"
fi

# Compress
gzip "$BACKUP_FILE"

# Keep only the last 30 days of backups
find "$BACKUP_DIR" -name "boardops_*.db.gz" -mtime +30 -delete

echo "[$(date)] Backup created: $BACKUP_FILE.gz"
