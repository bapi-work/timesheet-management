#!/bin/sh
# nginx won't start without a certificate, and Let's Encrypt can't verify the domain until nginx is up.
# Creates a temporary self-signed certificate if none exists. scripts/setup-ssl.sh replaces it with a real one.

set -e

SSL_DIR=/etc/nginx/ssl

if [ -f "$SSL_DIR/fullchain.pem" ] && [ -f "$SSL_DIR/privkey.pem" ]; then
  exit 0
fi

echo "No certificate found, creating a temporary self-signed one. Run scripts/setup-ssl.sh to get a real certificate."
openssl req -x509 -nodes -newkey rsa:2048 -days 30 -subj "/CN=temporary-certificate" \
  -keyout "$SSL_DIR/privkey.pem" -out "$SSL_DIR/fullchain.pem" 2>&1 | grep -vE '^[.+*-]*$' || true
chmod 644 "$SSL_DIR/fullchain.pem"
chmod 600 "$SSL_DIR/privkey.pem"
