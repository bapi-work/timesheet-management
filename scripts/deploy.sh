#!/bin/bash
# Full deployment script — run on the production server
# Usage: bash scripts/deploy.sh
# First time: bash scripts/deploy.sh --fresh

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

FRESH="${1:-}"

echo "==> Timesheet Management — Deploy"
echo "    Directory: $PROJECT_DIR"

# Create required host directories
mkdir -p backend/uploads/avatars
mkdir -p backend/uploads/receipts
mkdir -p backend/uploads/exports
mkdir -p nginx/ssl
mkdir -p /var/www/certbot
chmod -R 755 backend/uploads

if [ "$FRESH" = "--fresh" ]; then
  echo "==> Fresh install: stopping and removing existing containers..."
  docker compose down --remove-orphans || true
fi

echo "==> Pulling latest images / building..."
docker compose build --no-cache backend frontend

echo "==> Starting services..."
docker compose up -d

echo "==> Waiting for backend to be healthy..."
for i in $(seq 1 30); do
  STATUS=$(docker inspect --format='{{.State.Status}}' timesheet-backend 2>/dev/null || echo "missing")
  if [ "$STATUS" = "running" ]; then
    sleep 3
    if docker exec timesheet-backend sh -c 'wget -qO- http://localhost:4000/api/health' &>/dev/null; then
      echo "    Backend healthy!"
      break
    fi
  fi
  echo "    Waiting... ($i/30)"
  sleep 3
done

echo ""
echo "==> Container status:"
docker compose ps

echo ""
echo "✓ Deploy complete!"
echo "  App running at: http://$(hostname -I | awk '{print $1}')"
echo ""
echo "  To enable SSL, run: bash scripts/setup-ssl.sh"
