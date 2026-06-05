# Timesheet Management System - Production Deployment Guide

## Overview

This guide covers deploying the Timesheet Management System to production on various cloud platforms. The application supports multiple database and storage configurations to meet different enterprise requirements.

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Deployment Architecture Options](#deployment-architecture-options)
3. [AWS Deployment](#aws-deployment)
4. [Azure Deployment](#azure-deployment)
5. [Google Cloud Deployment](#google-cloud-deployment)
6. [Email/SMTP Configuration](#emailsmtp-configuration)
7. [Database Configuration](#database-configuration)
8. [Volume Storage Setup](#volume-storage-setup)
9. [Security Considerations](#security-considerations)
10. [Monitoring & Logging](#monitoring--logging)

---

## Pre-Deployment Checklist

- [ ] All environment variables configured (see [ENVIRONMENT.md](./ENVIRONMENT.md))
- [ ] JWT secrets generated (min 32 characters)
- [ ] Database migrations tested (`npm run db:migrate`)
- [ ] Email/SMTP credentials verified
- [ ] SSL/TLS certificates obtained
- [ ] Rate limiting configured appropriately
- [ ] Backup strategy documented
- [ ] Monitoring and alerting configured
- [ ] Load testing completed
- [ ] Security audit completed

---

## Deployment Architecture Options

### Option 1: Fully Managed Services (Recommended for Enterprise)
- **Database**: Managed PostgreSQL (RDS/Cloud SQL/Postgres)
- **Cache**: Managed Redis (ElastiCache/Memorystore/Redis)
- **File Storage**: Cloud Object Storage (S3/Blob Storage/Cloud Storage)
- **Container Orchestration**: Kubernetes (EKS/AKS/GKE)

**Advantages:**
- Automatic backups
- Built-in high availability
- Managed updates
- Easier scaling
- Enterprise SLA support

### Option 2: Self-Managed with Persistent Volumes
- **Database**: PostgreSQL on Kubernetes PV
- **Cache**: Redis on Kubernetes PV
- **File Storage**: Persistent volumes (EBS/Managed Disks/Persistent Disks)
- **Container Orchestration**: Kubernetes

**Advantages:**
- Lower per-unit costs at scale
- Full control
- Suitable for stable workloads

### Option 3: Hybrid Approach (Balanced)
- **Database**: Managed PostgreSQL
- **Cache**: Self-managed Redis on VMs
- **File Storage**: Cloud Object Storage
- **Container Orchestration**: Kubernetes

**Advantages:**
- Balance of cost and management overhead
- Most critical component (DB) is managed

---

## AWS Deployment

### Architecture: ECS/EKS with RDS, ElastiCache, S3

#### Step 1: Database Setup (RDS)

```bash
# Create RDS PostgreSQL instance
aws rds create-db-instance \
  --db-instance-identifier timesheet-db-prod \
  --db-instance-class db.t3.medium \
  --engine postgres \
  --engine-version 16.1 \
  --master-username timesheet_admin \
  --master-user-password <STRONG_PASSWORD> \
  --allocated-storage 100 \
  --storage-type gp3 \
  --backup-retention-period 30 \
  --multi-az \
  --publicly-accessible false \
  --region us-east-1
```

**Configuration for Production:**
- Instance Type: `db.t3.medium` (minimum for production)
- Storage: 100GB gp3 (auto-scaling enabled)
- Backup Retention: 30 days
- Multi-AZ: Enabled
- Encryption: At rest and in transit
- Enhanced Monitoring: Enabled

#### Step 2: Redis Setup (ElastiCache)

```bash
# Create ElastiCache Redis cluster
aws elasticache create-replication-group \
  --replication-group-description "Timesheet Redis Cache" \
  --replication-group-id timesheet-redis-prod \
  --engine redis \
  --engine-version 7.0 \
  --cache-node-type cache.t3.medium \
  --num-cache-clusters 2 \
  --automatic-failover-enabled \
  --multi-az-enabled \
  --at-rest-encryption-enabled \
  --transit-encryption-enabled
```

**Configuration:**
- Node Type: `cache.t3.medium` (minimum for production)
- Multi-AZ: Enabled
- Automatic Failover: Enabled
- Encryption: At rest and in transit
- Backup enabled: Yes (daily snapshots)

#### Step 3: S3 Bucket for File Uploads

```bash
# Create S3 bucket for uploads
aws s3api create-bucket \
  --bucket timesheet-uploads-prod \
  --region us-east-1 \
  --acl private

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket timesheet-uploads-prod \
  --versioning-configuration Status=Enabled

# Enable encryption
aws s3api put-bucket-encryption \
  --bucket timesheet-uploads-prod \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      }
    }]
  }'

# Block public access
aws s3api put-public-access-block \
  --bucket timesheet-uploads-prod \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

#### Step 4: ECS Deployment

**Create ECS Cluster:**
```bash
aws ecs create-cluster --cluster-name timesheet-prod
```

**Push Docker images to ECR:**
```bash
# Create ECR repositories
aws ecr create-repository --repository-name timesheet-backend
aws ecr create-repository --repository-name timesheet-frontend

# Tag and push images
docker tag timesheet-backend:latest 123456789.dkr.ecr.us-east-1.amazonaws.com/timesheet-backend:latest
docker push 123456789.dkr.ecr.us-east-1.amazonaws.com/timesheet-backend:latest

docker tag timesheet-frontend:latest 123456789.dkr.ecr.us-east-1.amazonaws.com/timesheet-frontend:latest
docker push 123456789.dkr.ecr.us-east-1.amazonaws.com/timesheet-frontend:latest
```

**Create ECS Task Definition:**
See [aws-ecs-task-definition.json](./deployment/aws/ecs-task-definition.json)

**Deploy to ECS:**
```bash
aws ecs register-task-definition --cli-input-json file://ecs-task-definition.json
aws ecs create-service \
  --cluster timesheet-prod \
  --service-name timesheet-service \
  --task-definition timesheet:1 \
  --desired-count 2 \
  --load-balancers targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=backend,containerPort=4000
```

#### Step 5: Load Balancer & Auto Scaling

```bash
# Create Application Load Balancer
aws elbv2 create-load-balancer \
  --name timesheet-alb-prod \
  --type application \
  --subnets subnet-12345 subnet-67890 \
  --security-groups sg-12345

# Setup auto-scaling
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/timesheet-prod/timesheet-service \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 \
  --max-capacity 10

aws application-autoscaling put-scaling-policy \
  --policy-name cpu-scaling \
  --service-namespace ecs \
  --resource-id service/timesheet-prod/timesheet-service \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration "TargetValue=70.0,PredefinedMetricSpecification={PredefinedMetricType=ECSServiceAverageCPUUtilization},ScaleOutCooldown=300,ScaleInCooldown=900"
```

### AWS Cost Estimation (Monthly)

| Service | Instance Type | Quantity | Est. Cost |
|---------|---------------|----------|-----------|
| RDS PostgreSQL | db.t3.medium | 1 (Multi-AZ) | ~$200 |
| ElastiCache Redis | cache.t3.medium | 2 (HA) | ~$150 |
| ECS Fargate | 2 vCPU, 4GB RAM | 2-10 tasks | ~$200-800 |
| S3 Storage | Standard | 1TB | ~$23 |
| Data Transfer | Outbound | ~10GB | ~$90 |
| ALB | Hourly + LCU | 1 | ~$50 |
| **Total** | | | **~$700-1,300** |

---

## Azure Deployment

### Architecture: AKS with Azure Database for PostgreSQL, Azure Cache for Redis, Azure Blob Storage

#### Step 1: Create Resource Group

```bash
az group create \
  --name timesheet-prod \
  --location eastus
```

#### Step 2: Database Setup (Azure Database for PostgreSQL)

```bash
# Create PostgreSQL server
az postgres server create \
  --resource-group timesheet-prod \
  --name timesheet-db-prod \
  --location eastus \
  --admin-user timesheet_admin \
  --admin-password <STRONG_PASSWORD> \
  --sku-name B_Gen5_2 \
  --storage-size 102400 \
  --backup-retention 35 \
  --geo-redundant-backup Enabled \
  --enable-log-backups true

# Configure firewall
az postgres server firewall-rule create \
  --resource-group timesheet-prod \
  --server-name timesheet-db-prod \
  --name AllowAppServers \
  --start-ip-address 10.0.0.0 \
  --end-ip-address 10.255.255.255

# Enable SSL
az postgres server update \
  --resource-group timesheet-prod \
  --name timesheet-db-prod \
  --ssl-enforcement ENABLED
```

**Configuration:**
- Tier: General Purpose (burstable for dev/test)
- vCore: 2
- Storage: 100GB
- Backup: 35 days
- Geo-redundancy: Enabled

#### Step 3: Redis Setup (Azure Cache for Redis)

```bash
# Create Redis cache
az redis create \
  --resource-group timesheet-prod \
  --name timesheet-redis-prod \
  --location eastus \
  --sku Premium \
  --vm-size p1 \
  --minimum-tls-version 1.2 \
  --enable-non-ssl-port false

# Setup firewall rules
az redis firewall-rules create \
  --resource-group timesheet-prod \
  --name timesheet-redis-prod \
  --rule-name AllowAppNetworks \
  --start-ip 10.0.0.0 \
  --end-ip 10.255.255.255
```

#### Step 4: Storage Account (Blob Storage)

```bash
# Create storage account
az storage account create \
  --resource-group timesheet-prod \
  --name timesheetuploads \
  --location eastus \
  --sku Standard_GRS \
  --encryption-services blob \
  --https-only true

# Create container
az storage container create \
  --account-name timesheetuploads \
  --name uploads \
  --public-access off

# Enable soft delete
az storage blob service-properties update \
  --account-name timesheetuploads \
  --enable-soft-delete true \
  --delete-retention-days 30
```

#### Step 5: AKS Cluster

```bash
# Create AKS cluster
az aks create \
  --resource-group timesheet-prod \
  --name timesheet-aks \
  --node-count 2 \
  --vm-set-type VirtualMachineScaleSets \
  --load-balancer-sku standard \
  --network-plugin azure \
  --network-policy azure \
  --enable-managed-identity \
  --zones 1 2 3 \
  --node-vm-size Standard_B2s \
  --enable-cluster-autoscaling \
  --min-count 2 \
  --max-count 10 \
  --enable-log-analytics-workspace \
  --workspace-resource-id /subscriptions/<SUB_ID>/resourcegroups/<RG>/providers/microsoft.operationalinsights/workspaces/<WORKSPACE>

# Get credentials
az aks get-credentials \
  --resource-group timesheet-prod \
  --name timesheet-aks
```

#### Step 6: Deploy to AKS

See [kubernetes-deployment.yaml](./deployment/azure/kubernetes-deployment.yaml)

```bash
kubectl apply -f deployment/azure/namespace.yaml
kubectl apply -f deployment/azure/secrets.yaml
kubectl apply -f deployment/azure/configmap.yaml
kubectl apply -f deployment/azure/deployment.yaml
kubectl apply -f deployment/azure/service.yaml
kubectl apply -f deployment/azure/ingress.yaml
```

### Azure Cost Estimation (Monthly)

| Service | Configuration | Est. Cost |
|---------|---------------|-----------|
| App Service Plan | Premium v2 P1V2 | ~$200 |
| PostgreSQL | GP, 2 vCore | ~$150 |
| Redis | Premium p1 | ~$200 |
| Blob Storage | 100GB Standard GRS | ~$10 |
| Data Transfer | 50GB outbound | ~$40 |
| Application Insights | | ~$50 |
| **Total** | | **~$650** |

---

## Google Cloud Deployment

### Architecture: GKE with Cloud SQL, Memorystore, Cloud Storage

#### Step 1: Create Project & Enable APIs

```bash
gcloud projects create timesheet-prod
gcloud config set project timesheet-prod

# Enable required APIs
gcloud services enable \
  container.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  storage.googleapis.com \
  compute.googleapis.com \
  monitoring.googleapis.com \
  logging.googleapis.com
```

#### Step 2: Cloud SQL (PostgreSQL)

```bash
# Create Cloud SQL instance
gcloud sql instances create timesheet-db-prod \
  --database-version POSTGRES_16 \
  --tier db-custom-2-8192 \
  --storage-size 100GB \
  --storage-auto-increase \
  --storage-auto-increase-limit 500 \
  --region us-central1 \
  --availability-type REGIONAL \
  --backup-start-time 03:00 \
  --enable-bin-log \
  --retained-backups-count 30 \
  --transaction-log-retention-days 7 \
  --maintenance-window-day SUN \
  --maintenance-window-hour 03 \
  --require-ssl

# Create database
gcloud sql databases create timesheet_db \
  --instance timesheet-db-prod

# Create user
gcloud sql users create timesheet_admin \
  --instance timesheet-db-prod \
  --password <STRONG_PASSWORD>

# Get connection string
gcloud sql instances describe timesheet-db-prod \
  --format='get(connectionName)'
```

#### Step 3: Memorystore for Redis

```bash
# Create Redis instance
gcloud redis instances create timesheet-redis-prod \
  --size=2 \
  --region us-central1 \
  --tier premium \
  --redis-version 7.0 \
  --auth-enabled \
  --transit-encryption-mode SERVER_AUTHENTICATION

# Get connection details
gcloud redis instances describe timesheet-redis-prod \
  --region us-central1
```

#### Step 4: Cloud Storage

```bash
# Create bucket
gsutil mb -c STANDARD -l us-central1 -b on gs://timesheet-uploads-prod

# Configure versioning
gsutil versioning set on gs://timesheet-uploads-prod

# Configure lifecycle policy
cat > lifecycle.json <<EOF
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {"numNewerVersions": 5}
      }
    ]
  }
}
EOF

gsutil lifecycle set lifecycle.json gs://timesheet-uploads-prod

# Set permissions
gsutil iam ch serviceAccount:app@timesheet-prod.iam.gserviceaccount.com:roles/storage.objectAdmin gs://timesheet-uploads-prod
```

#### Step 5: GKE Cluster

```bash
# Create GKE cluster
gcloud container clusters create timesheet-prod \
  --zone us-central1-a \
  --num-nodes 2 \
  --machine-type n1-standard-2 \
  --enable-autoscaling \
  --min-nodes 2 \
  --max-nodes 10 \
  --enable-autorepair \
  --enable-autoupgrade \
  --enable-ip-alias \
  --enable-stackdriver-kubernetes \
  --addons HorizontalPodAutoscaling,HttpLoadBalancing \
  --workload-pool timesheet-prod.svc.id.goog

# Get credentials
gcloud container clusters get-credentials timesheet-prod \
  --zone us-central1-a
```

#### Step 6: Deploy Applications

```bash
kubectl apply -f deployment/gcp/namespace.yaml
kubectl apply -f deployment/gcp/secrets.yaml
kubectl apply -f deployment/gcp/configmap.yaml
kubectl apply -f deployment/gcp/deployment.yaml
kubectl apply -f deployment/gcp/service.yaml
kubectl apply -f deployment/gcp/ingress.yaml
```

### GCP Cost Estimation (Monthly)

| Service | Configuration | Est. Cost |
|---------|---------------|-----------|
| Cloud SQL | db-custom-2-8GB | ~$120 |
| Memorystore Redis | Premium 2GB | ~$150 |
| GKE Nodes | 2-10 n1-standard-2 | ~$200-800 |
| Cloud Storage | 100GB | ~$5 |
| Data Transfer | 50GB outbound | ~$40 |
| Cloud Monitoring | | ~$50 |
| **Total** | | **~$565-1,165** |

---

## Email/SMTP Configuration

### Gmail (Free tier)

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password  # Use 16-char app-specific password
SMTP_FROM=noreply@yourcompany.com
```

**Setup Instructions:**
1. Enable 2-factor authentication on Gmail
2. Generate app-specific password at https://myaccount.google.com/apppasswords
3. Use the 16-character password in SMTP_PASS

### SendGrid

```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=SG.your-api-key-here
SMTP_FROM=noreply@yourcompany.com
```

### Amazon SES

```env
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password
SMTP_FROM=verified-email@yourcompany.com
```

**Setup:**
1. Verify domain in SES Console
2. Create SMTP credentials
3. Request production access (moves out of sandbox)

### Azure Communication Services

```env
SMTP_HOST=smtp.communication.azure.com
SMTP_PORT=587
SMTP_USER=<connection-string-based>
SMTP_PASS=<auth-token>
SMTP_FROM=your-email@azure-communication.com
```

### Mailgun

```env
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@<your-domain>
SMTP_PASS=your-mailgun-password
SMTP_FROM=noreply@<your-domain>
```

### Email Templates & Features

The application includes the following email notifications:

1. **Timesheet Approval Notifications**
   - Sent when manager approves timesheet
   - Template: `timesheetApprovedTemplate()`

2. **Timesheet Rejection Notifications**
   - Sent when manager rejects timesheet
   - Includes rejection reason
   - Template: `timesheetRejectedTemplate()`

3. **Pending Approval Reminders**
   - Notifies manager of pending timesheets
   - Template: `approvalPendingTemplate()`

4. **Leave Request Notifications**
   - Approval/rejection of leave requests

5. **Payroll Notifications**
   - Payment processing confirmations

All email sending is handled through the queue system (Bull) for reliability and retry logic.

---

## Database Configuration

### PostgreSQL Connection Options

#### Option 1: Direct Connection (For Internal DB)
```env
DATABASE_URL=postgresql://user:password@localhost:5432/timesheet_db
```

#### Option 2: Managed Database Services

**AWS RDS:**
```env
DATABASE_URL=postgresql://user:password@timesheet-db-prod.c123456.us-east-1.rds.amazonaws.com:5432/timesheet_db
```

**Azure:**
```env
DATABASE_URL=postgresql://user@server:password@timesheet-db-prod.postgres.database.azure.com:5432/timesheet_db
```

**GCP Cloud SQL:**
```env
DATABASE_URL=postgresql://user:password@/timesheet_db?host=/cloudsql/project:region:instance
```

### Database Scaling Considerations

| Load | Recommended Instance | Storage | Connections |
|------|---------------------|---------|------------|
| < 50 employees | db.t3.micro | 20GB | 100 |
| 50-200 employees | db.t3.small | 50GB | 200 |
| 200-500 employees | db.t3.medium | 100GB | 500 |
| 500+ employees | db.t3.large | 250GB | 1000 |

### Migration Strategy

1. **Pre-Migration Backup:**
```bash
pg_dump -h old-host -U user timesheet_db > backup.sql
```

2. **Schema Migration:**
```bash
npx prisma migrate deploy --skip-generate
```

3. **Data Migration:**
```bash
psql -h new-host -U user timesheet_db < backup.sql
```

4. **Verification:**
```bash
npx prisma db execute --stdin < verification.sql
```

---

## Volume Storage Setup

### Persistent Volume Configuration (Kubernetes)

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: timesheet-uploads-pv
spec:
  capacity:
    storage: 100Gi
  accessModes:
    - ReadWriteMany
  storageClassName: fast-ssd
  hostPath:
    path: /data/uploads
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: timesheet-uploads-pvc
  namespace: timesheet
spec:
  accessModes:
    - ReadWriteMany
  storageClassName: fast-ssd
  resources:
    requests:
      storage: 100Gi
```

### Cloud Storage Mounting

**AWS EBS:**
```bash
# Create EBS volume
aws ec2 create-volume \
  --size 100 \
  --volume-type gp3 \
  --availability-zone us-east-1a

# Attach to instance
aws ec2 attach-volume \
  --volume-id vol-12345 \
  --instance-id i-12345 \
  --device /dev/sdf
```

**Azure Managed Disks:**
```bash
az disk create \
  --resource-group timesheet-prod \
  --name timesheet-uploads-disk \
  --size-gb 100 \
  --sku Premium_LRS
```

**GCP Persistent Disks:**
```bash
gcloud compute disks create timesheet-uploads-disk \
  --size 100GB \
  --zone us-central1-a \
  --type pd-ssd
```

### Backup Strategy

1. **Automated Daily Backups:**
   - Schedule: 2:00 AM UTC
   - Retention: 30 days
   - Location: Geo-redundant storage

2. **Weekly Full Backups:**
   - Schedule: Sunday 1:00 AM UTC
   - Retention: 12 weeks
   - Location: Different region

3. **Disaster Recovery:**
   - RTO (Recovery Time Objective): 4 hours
   - RPO (Recovery Point Objective): 1 hour

---

## Security Considerations

### TLS/SSL Certificates

```bash
# Generate self-signed certificate (for testing)
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout ssl/private.key \
  -out ssl/certificate.crt \
  -subj "/C=US/ST=State/L=City/O=Org/CN=yourdomain.com"

# Or use Let's Encrypt with certbot
certbot certonly --manual \
  --preferred-challenges dns \
  --email your@email.com \
  -d yourdomain.com
```

### Network Security

1. **Firewall Rules:**
   - Only allow traffic from load balancer to app servers
   - Database accessible only from app servers
   - Redis accessible only from app servers

2. **VPC Configuration:**
   - Application in public subnet (behind ALB)
   - Database in private subnet
   - Redis in private subnet

3. **Secrets Management:**
   - Use cloud-native secret managers:
     - AWS Secrets Manager
     - Azure Key Vault
     - GCP Secret Manager
   - Never commit secrets to repository
   - Rotate secrets every 90 days

### Rate Limiting

Current configuration (from app.ts):
```
- General API: 500 requests per 15 minutes
- Auth endpoints: 20 requests per 15 minutes
```

Adjust based on usage patterns in production.

### Authentication & Authorization

- JWT tokens expire after 15 minutes
- Refresh tokens expire after 7 days
- Implement session invalidation on logout
- Store refresh tokens securely (HttpOnly cookies)

---

## Monitoring & Logging

### Application Logging

The application uses Winston for logging:
- **Production**: JSON format, file-based + console
- **Development**: Pretty-print format, console only

Log files:
- `logs/error.log` - Errors only
- `logs/combined.log` - All logs

### Cloud Monitoring

**AWS CloudWatch:**
```bash
# CloudWatch Logs Insights query
fields @timestamp, @message, @duration
| stats count() by @message
| sort @timestamp desc
```

**Azure Monitor:**
```bash
# KQL query for Application Insights
requests
| summarize count() by resultCode
| render barchart
```

**GCP Cloud Logging:**
```bash
resource.type="k8s_container"
resource.labels.namespace_name="timesheet"
severity>=ERROR
```

### Key Metrics to Monitor

1. **API Performance:**
   - Response time (p50, p95, p99)
   - Request rate
   - Error rate

2. **Database:**
   - Connection pool usage
   - Query performance
   - Replication lag (if applicable)

3. **Infrastructure:**
   - CPU utilization
   - Memory usage
   - Disk I/O
   - Network throughput

4. **Business Metrics:**
   - Active users
   - Timesheet submissions per day
   - Approval queue size
   - Email delivery success rate

### Alerting Rules

Configure alerts for:
- Error rate > 1%
- Response time p99 > 5 seconds
- Database connection pool > 80%
- Disk usage > 80%
- Memory usage > 85%
- Pod restart count > 3 in 1 hour

---

## Troubleshooting

### Common Issues

#### Database Connection Fails
```bash
# Test connection
psql "postgresql://user:pass@host:5432/db"

# Check logs
docker logs timesheet-postgres

# Verify firewall rules allow connection
aws ec2 describe-security-groups
```

#### Email Not Sending
```bash
# Check SMTP credentials
telnet smtp.gmail.com 587

# Review logs
tail -f logs/combined.log | grep -i email

# Test with curl
curl --url "smtp://smtp.gmail.com" --user "$SMTP_USER:$SMTP_PASS"
```

#### Redis Connection Issues
```bash
# Test Redis connection
redis-cli -h localhost -p 6379 -a password ping

# Check Redis memory
redis-cli info memory

# Monitor connections
redis-cli info clients
```

#### High Memory Usage
- Check for memory leaks in application
- Optimize database queries
- Increase Node.js heap size:
  ```bash
  node --max-old-space-size=4096 dist/index.js
  ```

---

## Maintenance

### Regular Tasks

**Daily:**
- Monitor error logs
- Check system health metrics
- Verify email delivery

**Weekly:**
- Review performance metrics
- Update dependencies for security patches
- Test backup restoration

**Monthly:**
- Full security audit
- Database maintenance (VACUUM, ANALYZE)
- Clean up old logs
- Review cost optimization

**Quarterly:**
- Disaster recovery drill
- Update documentation
- Security penetration testing

---

## Support & Escalation

For deployment issues:
1. Check logs first
2. Verify environment configuration
3. Test individual components
4. Review cloud provider console for service health
5. Contact support with logs and configuration (excluding secrets)

---

## Additional Resources

- [Prisma Documentation](https://www.prisma.io/docs/)
- [Express.js Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [Node.js Production Guide](https://nodejs.org/en/docs/guides/nodejs-docker-webapp/)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Kubernetes Best Practices](https://kubernetes.io/docs/concepts/configuration/overview/)

