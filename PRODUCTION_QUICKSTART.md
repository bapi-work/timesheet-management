# Production Deployment Quick Start

## Overview

This guide helps you quickly deploy the Timesheet Management System to production with all features verified and working.

**Estimated Setup Time:**
- AWS: 45-60 minutes
- Azure: 45-60 minutes
- GCP: 45-60 minutes
- Docker Compose (single server): 15-20 minutes

---

## Step 1: Choose Your Deployment Platform

### Option A: Docker Compose (Single Server)
Best for: Small teams, testing, on-premises deployment
- Simplest to set up
- All-in-one server
- Manual backups required
- Limited scalability

**Pros:** Fast deployment, low cost  
**Cons:** Limited HA, single point of failure

### Option B: Kubernetes + Cloud Managed Services (Recommended)
Best for: Production, enterprise, scalability required
- Automatic scaling
- High availability
- Managed backups
- Enterprise SLAs

**Providers:**
- 🟡 **AWS** (ECS/EKS + RDS + ElastiCache)
- 🟡 **Azure** (AKS + Azure Database + Redis)
- 🟡 **GCP** (GKE + Cloud SQL + Memorystore)

**Pros:** Highly available, scalable, managed services  
**Cons:** More complex, higher monthly cost

---

## Step 2: Pre-Deployment Checklist

Before you start, ensure you have:

- [ ] Docker installed (if using Docker Compose)
- [ ] Cloud provider account with billing enabled
- [ ] Cloud CLI tools installed:
  - AWS: `aws configure`
  - Azure: `az login`
  - GCP: `gcloud auth login`
- [ ] kubectl installed (for Kubernetes)
- [ ] Helm installed (for Kubernetes)
- [ ] Domain name registered
- [ ] SSL certificate ready (or ability to use Let's Encrypt)
- [ ] Email service account created (SendGrid/AWS SES/etc)

---

## Step 3: Generate Security Secrets

```bash
# Generate JWT secret (copy the output)
node -e "console.log('JWT_SECRET=', require('crypto').randomBytes(32).toString('hex'))"

# Generate JWT refresh secret
node -e "console.log('JWT_REFRESH_SECRET=', require('crypto').randomBytes(32).toString('hex'))"

# Generate strong password
openssl rand -base64 32
```

---

## Step 4: Configure Environment

### For Docker Compose:
```bash
cp .env.example .env

# Edit .env and update:
# - DATABASE_URL (if using external database)
# - REDIS_URL (if using external Redis)
# - JWT_SECRET and JWT_REFRESH_SECRET (use values from Step 3)
# - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
# - FRONTEND_URL and API URLs
# - NODE_ENV=production

nano .env  # or use your editor
```

### For Kubernetes:
Create a production .env file, then:
```bash
# Store secrets in cloud secret manager
# AWS Secrets Manager
aws secretsmanager create-secret --name timesheet/prod --secret-string file://prod.env

# Azure Key Vault
az keyvault secret set --vault-name timesheet-kv --name prod-config --file prod.env

# GCP Secret Manager
gcloud secrets create timesheet-prod --data-file=prod.env
```

---

## Step 5: Deploy Application

### Docker Compose Deployment

```bash
# Start all services
docker compose up -d --build

# Run database migrations
docker compose exec backend npx prisma migrate deploy

# Seed initial data (optional)
docker compose exec backend npx ts-node prisma/seed.ts

# Verify health
curl http://localhost:4000/api/health
curl http://localhost:3000
```

### Kubernetes Deployment

**AWS ECS:**
```bash
# Follow: deployment/aws/ECS-DEPLOYMENT.md
cd deployment/aws
# 1. Push images to ECR
# 2. Create task definition
# 3. Create ECS service
# 4. Configure load balancer
```

**Azure AKS:**
```bash
# Follow: deployment/azure/AKS-DEPLOYMENT.md
cd deployment/azure
# 1. Create resource group
# 2. Create AKS cluster
# 3. Deploy Kubernetes manifests
# 4. Configure ingress controller
```

**GCP GKE:**
```bash
# Follow: deployment/gcp/GKE-DEPLOYMENT.md
cd deployment/gcp
# 1. Create GKE cluster
# 2. Configure Cloud SQL
# 3. Deploy Kubernetes manifests
# 4. Configure Cloud Load Balancer
```

---

## Step 6: Configure Database

### Option A: Internal Database (Docker Compose)
Already included in docker-compose.yml

### Option B: Managed Database

**AWS RDS:**
```bash
aws rds create-db-instance \
  --db-instance-identifier timesheet-db-prod \
  --engine postgres \
  --db-instance-class db.t3.medium \
  --allocated-storage 100 \
  --master-username timesheet_admin \
  --master-user-password <PASSWORD>
```

**Azure Database for PostgreSQL:**
```bash
az postgres server create \
  --resource-group timesheet-prod \
  --name timesheet-db-prod \
  --sku-name B_Gen5_2 \
  --storage-size 102400
```

**GCP Cloud SQL:**
```bash
gcloud sql instances create timesheet-db-prod \
  --database-version POSTGRES_16 \
  --tier db-custom-2-8192 \
  --storage-size 100GB
```

---

## Step 7: Configure Email/SMTP

### Best Email Providers by Scenario

**Small Team (< 100 users):**
- Gmail (free, 500 recipients/day)
- SendGrid (free tier: 100 emails/day)

**Growing Team (100-1000 users):**
- SendGrid ($14.95/month, 55,000 emails/month)
- AWS SES ($0.10 per 1000 emails)

**Enterprise (1000+ users):**
- SendGrid (higher tiers)
- AWS SES (lowest cost at scale)
- Dedicated mail servers

### SendGrid Setup (Recommended)

```bash
# 1. Create SendGrid account: https://sendgrid.com
# 2. Get API key from dashboard
# 3. Update .env:

SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=SG.your-api-key-here
SMTP_FROM=noreply@yourdomain.com

# 4. Test email sending:
curl -X POST http://localhost:4000/api/test/email \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"to": "your-email@example.com"}'
```

---

## Step 8: Verify All Features

### Test User Login
```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@acme.com",
    "password": "Admin@123"
  }'
```

### Test Timesheet Submission
1. Log in as employee
2. Create timesheet entry
3. Submit for approval
4. Verify manager gets notification email

### Test Approval Workflow
1. Log in as manager
2. Go to approvals
3. Approve or reject timesheet
4. Verify employee gets notification email

### Test All Major Features
- ✅ Dashboard loads
- ✅ Create/edit/delete timesheets
- ✅ Submit timesheets
- ✅ Approval workflow
- ✅ Leave requests
- ✅ Payroll processing
- ✅ Reports generation
- ✅ Analytics dashboard
- ✅ User management
- ✅ Email notifications
- ✅ WebSocket real-time updates

See [TESTING_GUIDE.md](./TESTING_GUIDE.md) for comprehensive testing instructions.

---

## Step 9: Configure SSL/TLS

### Let's Encrypt (Free)

**Docker Compose:**
```bash
# Install certbot
sudo apt-get install certbot python3-certbot-nginx

# Get certificate
sudo certbot certonly --standalone -d yourdomain.com

# Update nginx config with certificate path
# Copy certs to nginx/ssl folder
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem ./nginx/ssl/
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem ./nginx/ssl/
```

**Kubernetes with cert-manager:**
```bash
# Already included in kubernetes/ingress-storage.yaml
# Automatically provisions and renews certificates
```

---

## Step 10: Setup Monitoring & Alerts

### Docker Compose
```bash
# Install monitoring stack
docker run -d \
  --name prometheus \
  -p 9090:9090 \
  -v ./prometheus.yml:/etc/prometheus/prometheus.yml \
  prom/prometheus

docker run -d \
  --name grafana \
  -p 3001:3000 \
  grafana/grafana
```

### Kubernetes
Monitoring automatically configured with:
- CloudWatch (AWS)
- Application Insights (Azure)
- Cloud Monitoring (GCP)

Configure alerts in cloud console for:
- CPU > 80%
- Memory > 85%
- Error rate > 1%
- Response time > 5 seconds

---

## Step 11: Setup Backups

### Database Backup

**Docker Compose:**
```bash
# Manual backup
pg_dump -h localhost -U timesheet timesheet_db > backup-$(date +%Y%m%d).sql

# Automated daily backup (cron)
0 2 * * * pg_dump -h localhost -U timesheet timesheet_db > /backups/backup-$(date +\%Y\%m\%d).sql
```

**Managed Services:**
- AWS RDS: Automatic daily backups (30-day retention)
- Azure Database: Automatic daily backups (35-day retention)
- GCP Cloud SQL: Automatic daily backups (30-day retention)

### File Backup

**Docker Compose:**
```bash
# Backup uploads directory
tar -czf uploads-backup-$(date +%Y%m%d).tar.gz ./backend/uploads/
```

**Cloud Storage:**
- AWS S3: Versioning + lifecycle policies
- Azure Blob: Versioning + soft delete
- GCP Cloud Storage: Versioning + lifecycle policies

---

## Step 12: Production Security Checklist

Before going live, complete [PRODUCTION_CHECKLIST.md](./PRODUCTION_CHECKLIST.md):

**Critical Items:**
- [ ] Strong JWT secrets generated
- [ ] Database password strong and secure
- [ ] SSL/TLS certificates valid
- [ ] Rate limiting configured
- [ ] Firewall rules configured
- [ ] Security headers enabled
- [ ] Audit logging enabled
- [ ] Backups tested
- [ ] Monitoring configured
- [ ] Incident response plan documented

---

## Step 13: Go Live

### Pre-Launch
1. ✅ All tests passing
2. ✅ Performance verified (< 500ms response time)
3. ✅ Backups tested
4. ✅ Monitoring active
5. ✅ Team trained on system
6. ✅ Documentation reviewed
7. ✅ Security audit completed

### Launch Steps
1. Point domain DNS to your deployment
2. Monitor error logs for first hour
3. Have support team on standby
4. Send announcement to users
5. Monitor metrics closely for first day

### Post-Launch
1. Collect user feedback
2. Monitor performance metrics
3. Verify all features working
4. Plan optimization if needed

---

## Troubleshooting

### Application Won't Start
```bash
# Check logs
docker compose logs -f backend
# or
kubectl logs -f deployment/timesheet-backend -n timesheet

# Verify environment variables
echo $DATABASE_URL
echo $JWT_SECRET
```

### Database Connection Fails
```bash
# Test connection
psql "postgresql://user:pass@host:5432/db"

# Check firewall rules allow connection
# Check database service is running
```

### Email Not Sending
```bash
# Check SMTP configuration
# Test with curl
curl --url "smtp://smtp.sendgrid.net" \
  --user "apikey:$SMTP_PASS"

# Check logs
grep -i email logs/combined.log
```

### Performance Issues
```bash
# Check database query performance
EXPLAIN ANALYZE SELECT ...

# Check Redis performance
redis-cli INFO stats

# Check container resource usage
docker stats
# or
kubectl top pods -n timesheet
```

---

## Next Steps

1. **Schedule Maintenance Windows**
   - Database backups: Daily 2 AM UTC
   - Software updates: Monthly
   - Security patches: As needed

2. **Plan Capacity**
   - Monitor growth over time
   - Plan for 2x current load
   - Test scaling procedures

3. **Continuous Improvement**
   - Gather user feedback
   - Optimize slow features
   - Reduce operational overhead

---

## Support Resources

- **Deployment Issues:** [DEPLOYMENT.md](./DEPLOYMENT.md)
- **Configuration:** [ENVIRONMENT.md](./ENVIRONMENT.md)
- **Security:** [PRODUCTION_CHECKLIST.md](./PRODUCTION_CHECKLIST.md)
- **Testing:** [TESTING_GUIDE.md](./TESTING_GUIDE.md)
- **AWS:** [ECS-DEPLOYMENT.md](./deployment/aws/ECS-DEPLOYMENT.md)
- **Azure:** [AKS-DEPLOYMENT.md](./deployment/azure/AKS-DEPLOYMENT.md)
- **GCP:** [GKE-DEPLOYMENT.md](./deployment/gcp/GKE-DEPLOYMENT.md)

---

## Quick Reference Commands

```bash
# Docker Compose
docker compose up -d --build
docker compose down
docker compose logs -f

# Kubernetes
kubectl apply -f deployment/kubernetes/
kubectl get pods -n timesheet
kubectl logs -f deployment/timesheet-backend -n timesheet
kubectl describe pod <pod-name> -n timesheet

# Database
npx prisma migrate deploy
npx prisma studio
npx prisma db seed

# Testing
npm test
npm run build
npm run lint

# Health Check
curl http://localhost:4000/api/health
```

---

**Last Updated:** June 2024
**Version:** 1.0.0

