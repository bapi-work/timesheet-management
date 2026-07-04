#!/bin/bash
# Backup: PostgreSQL dump + uploaded files + .env → timestamped tar.gz
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_NAME="timesheet_backup_${TIMESTAMP}"
WORK_DIR="/tmp/${BACKUP_NAME}"

POSTGRES_USER="${POSTGRES_USER:-timesheet}"
POSTGRES_DB="${POSTGRES_DB:-timesheet_db}"

echo "=== Timesheet Management Backup ==="
echo "Timestamp : $TIMESTAMP"
echo "Output    : $BACKUP_DIR/${BACKUP_NAME}.tar.gz"
echo ""

mkdir -p "$BACKUP_DIR" "$WORK_DIR"

# 1. Database dump
echo "[1/3] Dumping PostgreSQL database..."
docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-password \
  > "$WORK_DIR/database.sql"
echo "      Done ($(wc -c < "$WORK_DIR/database.sql" | tr -d ' ') bytes)"

# 2. Uploaded files
echo "[2/3] Copying uploaded files..."
if [ -d "$PROJECT_DIR/backend/uploads" ]; then
  cp -r "$PROJECT_DIR/backend/uploads" "$WORK_DIR/uploads"
  FILE_COUNT=$(find "$WORK_DIR/uploads" -type f | wc -l)
  echo "      Done ($FILE_COUNT files)"
else
  mkdir -p "$WORK_DIR/uploads"
  echo "      No uploads directory found — creating empty placeholder"
fi

# 3. Config / environment
echo "[3/3] Copying configuration..."
mkdir -p "$WORK_DIR/config"
[ -f "$PROJECT_DIR/.env" ] && cp "$PROJECT_DIR/.env" "$WORK_DIR/config/.env"
cp "$PROJECT_DIR/docker-compose.yml" "$WORK_DIR/config/docker-compose.yml"
cp "$PROJECT_DIR/nginx/nginx.conf"   "$WORK_DIR/config/nginx.conf"
[ -f "$PROJECT_DIR/nginx/nginx-ssl.conf" ] && \
  cp "$PROJECT_DIR/nginx/nginx-ssl.conf" "$WORK_DIR/config/nginx-ssl.conf"

# Manifest
cat > "$WORK_DIR/MANIFEST.txt" <<EOF
Timesheet Management Backup
============================
Created    : $(date -u +"%Y-%m-%dT%H:%M:%SZ")
Hostname   : $(hostname)
Database   : $POSTGRES_DB
App version: $(grep '"version"' "$PROJECT_DIR/backend/package.json" | head -1 | awk -F'"' '{print $4}' 2>/dev/null || echo "unknown")
Contents   :
  database.sql        — full PostgreSQL dump (pg_dump plain format)
  uploads/            — user-uploaded files (receipts, leave documents)
  config/.env         — environment variables (keep this file secret)
  config/docker-compose.yml
  config/nginx.conf
EOF

# Create tar.gz
echo ""
echo "Packaging..."
tar -czf "$BACKUP_DIR/${BACKUP_NAME}.tar.gz" -C /tmp "$BACKUP_NAME"
rm -rf "$WORK_DIR"

SIZE=$(du -sh "$BACKUP_DIR/${BACKUP_NAME}.tar.gz" | cut -f1)
echo ""
echo "=== Backup complete ==="
echo "File : $BACKUP_DIR/${BACKUP_NAME}.tar.gz"
echo "Size : $SIZE"
echo ""

# Keep only the 10 most recent backups
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/timesheet_backup_*.tar.gz 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt 10 ]; then
  echo "Rotating old backups (keeping latest 10)..."
  ls -1t "$BACKUP_DIR"/timesheet_backup_*.tar.gz | tail -n +11 | xargs rm -f
fi
