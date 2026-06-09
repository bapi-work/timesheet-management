#!/bin/bash
# SSL Certificate Setup Script for ts-dev.digile.com
# Run this ONCE on the production server after the app is running on port 80.
# Usage: bash scripts/setup-ssl.sh your@email.com ts-dev.digile.com

set -e

EMAIL="${1:-bapiwrk@gmail.com}"
DOMAIN="${2:-ts-dev.digile.com}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Setting up SSL for $DOMAIN"

# 1. Install certbot if not present
if ! command -v certbot &>/dev/null; then
  echo "==> Installing certbot..."
  apt-get update -qq
  apt-get install -y certbot
fi

# 2. Create webroot directory
mkdir -p /var/www/certbot

# 3. Make sure nginx is running with HTTP config (no SSL yet)
cd "$PROJECT_DIR"
docker compose up -d nginx

echo "==> Requesting certificate via webroot method..."
certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  -d "$DOMAIN" \
  --email "$EMAIL" \
  --agree-tos \
  --non-interactive

# 4. Copy certs to nginx ssl directory
echo "==> Copying certificates..."
mkdir -p "$PROJECT_DIR/nginx/ssl"
cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem "$PROJECT_DIR/nginx/ssl/fullchain.pem"
cp /etc/letsencrypt/live/$DOMAIN/privkey.pem   "$PROJECT_DIR/nginx/ssl/privkey.pem"
chmod 644 "$PROJECT_DIR/nginx/ssl/fullchain.pem"
chmod 600 "$PROJECT_DIR/nginx/ssl/privkey.pem"

# 5. Switch nginx to SSL config
echo "==> Enabling HTTPS nginx config..."
cp "$PROJECT_DIR/nginx/nginx-ssl.conf" "$PROJECT_DIR/nginx/nginx.conf"
docker compose restart nginx

# 6. Install auto-renewal cron (daily at 3am)
CRON_CMD="0 3 * * * certbot renew --quiet && cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem $PROJECT_DIR/nginx/ssl/fullchain.pem && cp /etc/letsencrypt/live/$DOMAIN/privkey.pem $PROJECT_DIR/nginx/ssl/privkey.pem && docker compose -f $PROJECT_DIR/docker-compose.yml restart nginx >> /var/log/certbot-renew.log 2>&1"
( crontab -l 2>/dev/null | grep -v certbot; echo "$CRON_CMD" ) | crontab -

echo ""
echo "✓ SSL setup complete!"
echo "  https://$DOMAIN is now live."
echo "  Auto-renewal cron installed (daily at 3am)."
