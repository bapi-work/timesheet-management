# Digital Ocean Deployment Guide

## Overview

This guide covers two deployment architectures on Digital Ocean:

| Architecture | Database | Best For |
|---|---|---|
| **Option A — Managed Services** | DO Managed PostgreSQL + Managed Redis | Production, HA, automated backups |
| **Option B — Single Droplet (Local DB)** | PostgreSQL + Redis on same Droplet | Dev/Staging, cost-optimised, small teams |

---

## Prerequisites

```bash
# Install doctl CLI
curl -sL https://github.com/digitalocean/doctl/releases/download/v1.104.0/doctl-1.104.0-linux-amd64.tar.gz | tar -xzv
sudo mv doctl /usr/local/bin
doctl auth init   # enter your DO API token
```

---

## Option A — Managed Services (Production Recommended)

### Architecture
```
Internet → DO Load Balancer
              ↓
         App Platform / Droplet (Backend + Frontend)
              ↓
     DO Managed PostgreSQL  +  DO Managed Redis
              ↓
         DO Spaces (S3-compatible object storage)
```

### Step 1: Create Managed PostgreSQL

```bash
# Create PostgreSQL 16 cluster (1-node for dev, 2+ nodes for HA)
doctl databases create timesheet-db \
  --engine pg \
  --version 16 \
  --size db-s-1vcpu-1gb \
  --region nyc1 \
  --num-nodes 1

# Get connection details
doctl databases get timesheet-db --format ID,Host,Port,Name
doctl databases user list timesheet-db
doctl databases password reset timesheet-db doadmin

# Create application database and user
doctl databases db create timesheet-db timesheet_db
```

Save the connection string:
```
postgresql://doadmin:<password>@<host>:25060/timesheet_db?sslmode=require
```

### Step 2: Create Managed Redis

```bash
doctl databases create timesheet-redis \
  --engine redis \
  --version 7 \
  --size db-s-1vcpu-1gb \
  --region nyc1 \
  --num-nodes 1

doctl databases get timesheet-redis --format Host,Port,Password
```

Save the connection string:
```
rediss://default:<password>@<host>:25061
```

### Step 3: Create DO Spaces (Object Storage)

```bash
# Create a Space (S3-compatible bucket)
doctl compute region list  # choose region
# Create via DO Console: Spaces → Create Space
# Name: timesheet-uploads
# Region: nyc3 (choose nearest)
# Enable CDN: optional
```

Generate Spaces access keys in DO Console → API → Spaces access keys.

### Step 4: Deploy Application

#### Option A1 — DO App Platform (fully managed, zero-ops)

```bash
# Create app spec file
cat > app-spec.yaml << 'EOF'
name: timesheet-management
region: nyc

services:
  - name: backend
    github:
      repo: your-org/timesheet-management
      branch: main
      deploy_on_push: true
    source_dir: backend
    dockerfile_path: backend/Dockerfile
    http_port: 4000
    instance_count: 1
    instance_size_slug: professional-xs
    envs:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        value: "${timesheet-db.DATABASE_URL}"
        type: SECRET
      - key: REDIS_URL
        value: "rediss://default:${REDIS_PASSWORD}@${REDIS_HOST}:25061"
        type: SECRET
      - key: JWT_SECRET
        value: "your-min-32-char-jwt-secret-here"
        type: SECRET
      - key: JWT_REFRESH_SECRET
        value: "your-min-32-char-refresh-secret"
        type: SECRET
      - key: FRONTEND_URL
        value: "https://your-app-domain.com"
      - key: PORT
        value: "4000"
    health_check:
      http_path: /api/health

  - name: frontend
    github:
      repo: your-org/timesheet-management
      branch: main
      deploy_on_push: true
    source_dir: frontend
    dockerfile_path: frontend/Dockerfile
    http_port: 80
    instance_count: 1
    instance_size_slug: professional-xs
    build_args:
      - key: VITE_API_URL
        value: "https://your-app-domain.com/api"
      - key: VITE_WS_URL
        value: "wss://your-app-domain.com"
EOF

doctl apps create --spec app-spec.yaml
doctl apps list
```

#### Option A2 — Droplet with Docker Compose

```bash
# Create Droplet
doctl compute droplet create timesheet-app \
  --image docker-20-04 \
  --size s-2vcpu-4gb \
  --region nyc1 \
  --ssh-keys $(doctl compute ssh-key list --format ID --no-header | tr '\n' ',')

# Get IP
doctl compute droplet get timesheet-app --format PublicIPv4

# SSH in
ssh root@<droplet-ip>
```

On the Droplet:
```bash
# Clone repo
git clone https://github.com/your-org/timesheet-management.git
cd timesheet-management

# Create production .env
cat > .env << 'EOF'
NODE_ENV=production
POSTGRES_USER=timesheet
POSTGRES_PASSWORD=<strong-password>
POSTGRES_DB=timesheet_db

# Use managed DB (Option A) — comment out postgres service in docker-compose.yml
DATABASE_URL=postgresql://doadmin:<password>@<managed-db-host>:25060/timesheet_db?sslmode=require

# Use managed Redis (Option A) — comment out redis service in docker-compose.yml
REDIS_URL=rediss://default:<password>@<managed-redis-host>:25061

JWT_SECRET=<min-32-char-random-secret>
JWT_REFRESH_SECRET=<min-32-char-random-secret>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=<sendgrid-api-key>
SMTP_FROM=noreply@yourdomain.com

FRONTEND_URL=https://yourdomain.com
VITE_API_URL=https://yourdomain.com/api
VITE_WS_URL=wss://yourdomain.com
EOF

# Build and start (skip postgres/redis — using managed services)
docker compose up -d --build backend frontend nginx

# Run database migrations
docker compose exec backend npx prisma migrate deploy
docker compose exec backend npx prisma db seed
```

---

## Option B — Single Droplet with Local DB (Dev / Small Teams)

### Architecture
```
Internet → Droplet
           ├── NGINX (port 80/443)
           ├── Backend (port 4000)
           ├── Frontend (port 3001)
           ├── PostgreSQL (port 5432, internal only)
           └── Redis (port 6379, internal only)
```

### Step 1: Create Droplet

```bash
doctl compute droplet create timesheet-all-in-one \
  --image docker-20-04 \
  --size s-2vcpu-4gb \
  --region nyc1 \
  --ssh-keys $(doctl compute ssh-key list --format ID --no-header | tr '\n' ',')

export DROPLET_IP=$(doctl compute droplet get timesheet-all-in-one --format PublicIPv4 --no-header)
echo "Droplet IP: $DROPLET_IP"
```

### Step 2: Configure Firewall

```bash
# Create firewall — expose only 22, 80, 443
doctl compute firewall create \
  --name timesheet-fw \
  --inbound-rules "protocol:tcp,ports:22,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:80,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:443,address:0.0.0.0/0,address:::/0" \
  --outbound-rules "protocol:tcp,ports:all,address:0.0.0.0/0 protocol:udp,ports:all,address:0.0.0.0/0" \
  --droplet-ids $(doctl compute droplet get timesheet-all-in-one --format ID --no-header)
```

### Step 3: Deploy Application

```bash
ssh root@$DROPLET_IP

# Install Docker (already installed with docker image)
git clone https://github.com/your-org/timesheet-management.git
cd timesheet-management

cat > .env << 'EOF'
NODE_ENV=production
POSTGRES_USER=timesheet
POSTGRES_PASSWORD=<strong-random-password>
POSTGRES_DB=timesheet_db
DATABASE_URL=postgresql://timesheet:<password>@postgres:5432/timesheet_db
REDIS_URL=redis://:redispass@redis:6379
REDIS_PASSWORD=<strong-random-password>
JWT_SECRET=<min-32-char-random-string>
JWT_REFRESH_SECRET=<min-32-char-random-string>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=<sendgrid-key>
SMTP_FROM=noreply@yourdomain.com
FRONTEND_URL=https://yourdomain.com
VITE_API_URL=https://yourdomain.com/api
VITE_WS_URL=wss://yourdomain.com
EOF

# Start all services (includes local postgres + redis)
docker compose up -d --build

# Run migrations and seed
docker compose exec backend npx prisma migrate deploy
docker compose exec backend npx prisma db seed
```

---

## SSL/TLS with Let's Encrypt (Both Options)

```bash
# Install Certbot on Droplet
apt install -y certbot

# Stop nginx temporarily
docker compose stop nginx

# Obtain certificate
certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com

# Certificates saved to:
# /etc/letsencrypt/live/yourdomain.com/fullchain.pem
# /etc/letsencrypt/live/yourdomain.com/privkey.pem

# Update nginx.conf — uncomment the HTTPS server block and set paths:
# ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
# ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
# Also uncomment: return 301 https://$host$request_uri; in HTTP block

# Mount certs in docker-compose.yml (nginx service):
# volumes:
#   - /etc/letsencrypt:/etc/letsencrypt:ro

docker compose up -d nginx

# Auto-renewal cron
echo "0 0 1 * * certbot renew --pre-hook 'docker compose -f /root/timesheet-management/docker-compose.yml stop nginx' --post-hook 'docker compose -f /root/timesheet-management/docker-compose.yml start nginx'" | crontab -
```

---

## DO Load Balancer (Managed Option, Multiple Droplets)

```bash
# Create load balancer
doctl compute load-balancer create \
  --name timesheet-lb \
  --region nyc1 \
  --forwarding-rules entry_protocol:https,entry_port:443,target_protocol:http,target_port:80,certificate_id:<cert-id> \
  --health-check protocol:http,port:4000,path:/api/health,check_interval_seconds:10 \
  --droplet-ids <droplet-id1>,<droplet-id2>

# Add TLS certificate (DO-managed Let's Encrypt)
doctl compute certificate create \
  --name timesheet-cert \
  --type lets_encrypt \
  --dns-names yourdomain.com,www.yourdomain.com
```

---

## Automated Backups

### Droplet Backups (Option B)
```bash
# Enable weekly Droplet snapshots (DO charges 20% of Droplet cost)
doctl compute droplet-action enable-backups <droplet-id>

# OR manual snapshot
doctl compute droplet-action snapshot <droplet-id> --snapshot-name "timesheet-$(date +%Y%m%d)"
```

### Database Backups (Option A — Managed)
- DO Managed PostgreSQL automatically takes daily backups (7-day retention)
- Download backup: DO Console → Databases → Backups tab

### Database Backup Script (Option B — Local DB)
```bash
# /root/backup-db.sh
#!/bin/bash
BACKUP_DIR=/root/backups
mkdir -p $BACKUP_DIR
docker compose exec -T postgres pg_dump -U timesheet timesheet_db | gzip > $BACKUP_DIR/db-$(date +%Y%m%d-%H%M).sql.gz
# Keep last 30 backups
ls -t $BACKUP_DIR/*.gz | tail -n +31 | xargs rm -f

# Upload to DO Spaces
s3cmd put $BACKUP_DIR/db-$(date +%Y%m%d)*.gz s3://timesheet-backups/

# Cron: daily at 2am
echo "0 2 * * * /root/backup-db.sh" | crontab -
```

---

## Monitoring with DO Monitoring

```bash
# Install DO Monitoring agent on Droplet
curl -sSL https://repos.insights.digitalocean.com/install.sh | sudo bash

# Create alert — CPU > 80%
doctl monitoring alert create \
  --type v1/insights/droplet/cpu \
  --description "CPU alert" \
  --compare GreaterThan \
  --value 80 \
  --window 5m \
  --entities $(doctl compute droplet get timesheet-app --format ID --no-header) \
  --emails your-email@example.com

# Create alert — Disk > 80%
doctl monitoring alert create \
  --type v1/insights/droplet/disk_utilization_percent \
  --description "Disk alert" \
  --compare GreaterThan \
  --value 80 \
  --window 5m \
  --entities $(doctl compute droplet get timesheet-app --format ID --no-header) \
  --emails your-email@example.com
```

---

## Environment Variables Reference

| Variable | Required | Example |
|---|---|---|
| `DATABASE_URL` | ✅ | `postgresql://user:pass@host:5432/db?sslmode=require` |
| `REDIS_URL` | ✅ | `redis://:pass@host:6379` or `rediss://...` for TLS |
| `JWT_SECRET` | ✅ | 32+ random chars |
| `JWT_REFRESH_SECRET` | ✅ | 32+ random chars |
| `SMTP_HOST` | ✅ | `smtp.sendgrid.net` |
| `SMTP_USER` | ✅ | `apikey` (SendGrid) |
| `SMTP_PASS` | ✅ | SendGrid API key |
| `FRONTEND_URL` | ✅ | `https://yourdomain.com` |
| `VITE_API_URL` | ✅ | `https://yourdomain.com/api` |
| `NODE_ENV` | ✅ | `production` |

Generate secure secrets:
```bash
openssl rand -hex 32   # for JWT_SECRET / JWT_REFRESH_SECRET
openssl rand -hex 24   # for database passwords
```

---

## Cost Estimates (USD/month)

### Option A — Managed (Production)
| Resource | Size | Cost |
|---|---|---|
| Droplet (App) | s-2vcpu-4gb | $24 |
| Managed PostgreSQL | db-s-1vcpu-1gb | $15 |
| Managed Redis | db-s-1vcpu-1gb | $15 |
| Load Balancer | Standard | $12 |
| DO Spaces | 250GB | $5 |
| **Total** | | **~$71/month** |

### Option B — Single Droplet (Dev/Small Teams)
| Resource | Size | Cost |
|---|---|---|
| Droplet (All-in-one) | s-4vcpu-8gb | $48 |
| Droplet Backups | 20% of Droplet | $9.60 |
| DO Spaces | 50GB | $5 |
| **Total** | | **~$63/month** |

---

## Troubleshooting

```bash
# View container logs
docker compose logs -f backend
docker compose logs -f frontend

# Check backend health
curl http://localhost:4000/api/health

# Connect to local database (Option B)
docker compose exec postgres psql -U timesheet -d timesheet_db

# Connect to managed database (Option A)
psql "postgresql://doadmin:<password>@<host>:25060/timesheet_db?sslmode=require"

# Restart services
docker compose restart backend
docker compose up -d --build   # rebuild after code changes

# Check disk space
df -h
docker system prune -f  # clean up unused images
```
