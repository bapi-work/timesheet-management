#!/bin/bash
# Restore: import a backup tar.gz created by backup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKUP_FILE="${1:-}"

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: $0 <backup-file.tar.gz>"
  echo ""
  echo "Available backups:"
  ls -lht "${PROJECT_DIR}/backups"/timesheet_backup_*.tar.gz 2>/dev/null || echo "  (none found in ${PROJECT_DIR}/backups/)"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: backup file not found: $BACKUP_FILE"
  exit 1
fi

POSTGRES_USER="${POSTGRES_USER:-timesheet}"
POSTGRES_DB="${POSTGRES_DB:-timesheet_db}"

echo "=== Timesheet Management Restore ==="
echo "Backup : $BACKUP_FILE"
echo ""
echo "WARNING: This will OVERWRITE the current database and uploaded files."
read -r -p "Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 0
fi
echo ""

WORK_DIR="/tmp/timesheet_restore_$$"
mkdir -p "$WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT

# Extract
echo "[1/4] Extracting backup..."
tar -xzf "$BACKUP_FILE" -C "$WORK_DIR"

# Find the inner folder
INNER_DIR=$(find "$WORK_DIR" -maxdepth 1 -mindepth 1 -type d | head -1)
if [ -z "$INNER_DIR" ]; then
  echo "Error: unexpected backup structure — no directory found inside archive"
  exit 1
fi

# Show manifest
if [ -f "$INNER_DIR/MANIFEST.txt" ]; then
  echo ""
  cat "$INNER_DIR/MANIFEST.txt"
  echo ""
fi

# 2. Restore database
echo "[2/4] Restoring PostgreSQL database..."
if [ ! -f "$INNER_DIR/database.sql" ]; then
  echo "Error: database.sql not found in backup"
  exit 1
fi

docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T postgres \
  psql -U "$POSTGRES_USER" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$POSTGRES_DB' AND pid <> pg_backend_pid();" \
  > /dev/null 2>&1 || true

docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T postgres \
  psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS ${POSTGRES_DB};" > /dev/null

docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T postgres \
  psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE ${POSTGRES_DB};" > /dev/null

docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  < "$INNER_DIR/database.sql" > /dev/null
echo "      Done"

# 3. Restore uploaded files
echo "[3/4] Restoring uploaded files..."
if [ -d "$INNER_DIR/uploads" ]; then
  rm -rf "$PROJECT_DIR/backend/uploads"
  cp -r "$INNER_DIR/uploads" "$PROJECT_DIR/backend/uploads"
  FILE_COUNT=$(find "$PROJECT_DIR/backend/uploads" -type f | wc -l)
  echo "      Done ($FILE_COUNT files)"
else
  echo "      No uploads folder in backup — skipping"
fi

# 4. Config files — save for manual review, never auto-apply
echo "[4/4] Configuration files..."
if [ -d "$INNER_DIR/config" ]; then
  RESTORE_CONFIG_DIR="$PROJECT_DIR/backups/restored_config_$$"
  mkdir -p "$RESTORE_CONFIG_DIR"
  cp -r "$INNER_DIR/config/." "$RESTORE_CONFIG_DIR/"
  echo "      Saved to: $RESTORE_CONFIG_DIR/"
  echo "      Review and apply manually if needed (not auto-applied to avoid overwriting live settings)"
fi

# Restart backend
echo ""
echo "Restarting backend..."
docker compose -f "$PROJECT_DIR/docker-compose.yml" restart backend > /dev/null
echo "Done."

echo ""
echo "=== Restore complete ==="
echo "The application is now running with the restored data."
