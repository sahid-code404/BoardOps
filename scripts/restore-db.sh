#!/bin/bash
# BoardOps database restore script
# Usage: bash scripts/restore-db.sh <backup_file.gz>

if [ -z "$1" ]; then
  echo "Usage: bash scripts/restore-db.sh <backup_file.gz>"
  exit 1
fi

BACKUP_FILE="$1"
DB_PATH="/home/z/my-project/db/custom.db"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file not found: $BACKUP_FILE"
  exit 1
fi

# Decompress
TEMP_FILE=$(mktemp /tmp/boardops_restore_XXXXXX.db)
gunzip -c "$BACKUP_FILE" > "$TEMP_FILE"

# Stop the server first!
echo "WARNING: Stop the dev server before proceeding."
echo "Press Enter to continue, Ctrl+C to cancel..."
read

# Backup current DB
cp "$DB_PATH" "${DB_PATH}.pre-restore.$(date +%s)"

# Restore
cp "$TEMP_FILE" "$DB_PATH"
rm "$TEMP_FILE"

echo "[$(date)] Database restored from: $BACKUP_FILE"
echo "You can now restart the dev server."
