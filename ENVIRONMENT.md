# Environment Configuration Guide

## Overview

This document provides comprehensive guidance on configuring the Timesheet Management System for different environments (development, staging, production).

## Environment Files

### .env File Structure

```env
# ============================================
# DATABASE CONFIGURATION
# ============================================
DATABASE_URL=postgresql://user:password@host:5432/database

# ============================================
# REDIS CONFIGURATION
# ============================================
REDIS_URL=redis://:password@host:6379

# ============================================
# JWT & SECURITY
# ============================================
JWT_SECRET=your-secret-key-min-32-chars
JWT_REFRESH_SECRET=your-refresh-secret-min-32-chars
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# ============================================
# EMAIL/SMTP CONFIGURATION
# ============================================
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@yourcompany.com

# ============================================
# APPLICATION
# ============================================
NODE_ENV=development
PORT=4000
FRONTEND_URL=http://localhost:3000
VITE_API_URL=http://localhost:4000/api
VITE_WS_URL=ws://localhost:4000

# ============================================
# OPTIONAL: SSO PROVIDERS
# ============================================
AZURE_AD_TENANT_ID=
AZURE_AD_CLIENT_ID=
AZURE_AD_CLIENT_SECRET=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# ============================================
# OPTIONAL: FILE STORAGE
# ============================================
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET_NAME=timesheet-uploads

# ============================================
# OPTIONAL: MONITORING & LOGGING
# ============================================
LOG_LEVEL=debug
SENTRY_DSN=
NEW_RELIC_LICENSE_KEY=
```

## Environment-Specific Configurations

### Development Environment

```env
# .env.development
NODE_ENV=development
PORT=4000
FRONTEND_URL=http://localhost:3000
VITE_API_URL=http://localhost:4000/api
VITE_WS_URL=ws://localhost:4000

# Local database
DATABASE_URL=postgresql://timesheet:timesheetpass@localhost:5433/timesheet_db

# Local Redis
REDIS_URL=redis://:redispass@localhost:6380

# Development secrets (for local testing only)
JWT_SECRET=dev-secret-key-this-is-not-secure-change-in-production-12345
JWT_REFRESH_SECRET=dev-refresh-secret-not-secure-change-prod-12345
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Mock email (won't send real emails)
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=test
SMTP_PASS=test
SMTP_FROM=dev@localhost

LOG_LEVEL=debug
```

**Running with Development Config:**
```bash
npm run dev
```

### Staging Environment

```env
# .env.staging
NODE_ENV=staging
PORT=4000
FRONTEND_URL=https://staging.yourcompany.com
VITE_API_URL=https://staging.yourcompany.com/api
VITE_WS_URL=wss://staging.yourcompany.com

# Managed database (e.g., AWS RDS)
DATABASE_URL=postgresql://staging_user:${STAGING_DB_PASSWORD}@staging-db.region.rds.amazonaws.com:5432/timesheet_db

# Managed Redis
REDIS_URL=redis://:${STAGING_REDIS_PASSWORD}@staging-redis.region.cache.amazonaws.com:6379

# Strong secrets (use AWS Secrets Manager)
JWT_SECRET=${STAGING_JWT_SECRET}
JWT_REFRESH_SECRET=${STAGING_JWT_REFRESH_SECRET}
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# SendGrid for staging
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=${SENDGRID_API_KEY}
SMTP_FROM=staging@yourcompany.com

LOG_LEVEL=info

# Optional: Error tracking
SENTRY_DSN=${SENTRY_STAGING_DSN}
```

### Production Environment

```env
# .env.production
NODE_ENV=production
PORT=4000
FRONTEND_URL=https://timesheet.yourcompany.com
VITE_API_URL=https://timesheet.yourcompany.com/api
VITE_WS_URL=wss://timesheet.yourcompany.com

# Managed database with encryption
DATABASE_URL=postgresql://prod_user:${PROD_DB_PASSWORD}@prod-db.region.rds.amazonaws.com:5432/timesheet_db

# Managed Redis with encryption
REDIS_URL=redis://:${PROD_REDIS_PASSWORD}@prod-redis.region.cache.amazonaws.com:6379

# Highly secure secrets (use AWS Secrets Manager, Azure Key Vault, etc.)
JWT_SECRET=${PROD_JWT_SECRET}  # Min 32 chars, cryptographically secure
JWT_REFRESH_SECRET=${PROD_JWT_REFRESH_SECRET}
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Production email service (e.g., AWS SES, SendGrid)
SMTP_HOST=email-smtp.region.amazonaws.com
SMTP_PORT=587
SMTP_USER=${PROD_SMTP_USER}
SMTP_PASS=${PROD_SMTP_PASSWORD}
SMTP_FROM=noreply@yourcompany.com

LOG_LEVEL=info

# Monitoring & Error tracking
SENTRY_DSN=${PROD_SENTRY_DSN}
NEW_RELIC_LICENSE_KEY=${PROD_NEW_RELIC_KEY}

# Optional: File storage
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=${PROD_AWS_ACCESS_KEY}
AWS_SECRET_ACCESS_KEY=${PROD_AWS_SECRET_KEY}
S3_BUCKET_NAME=timesheet-uploads-prod

# Optional: SSO (if using Azure AD or Google OAuth)
AZURE_AD_TENANT_ID=${AZURE_PROD_TENANT_ID}
AZURE_AD_CLIENT_ID=${AZURE_PROD_CLIENT_ID}
AZURE_AD_CLIENT_SECRET=${AZURE_PROD_CLIENT_SECRET}

GOOGLE_CLIENT_ID=${GOOGLE_PROD_CLIENT_ID}
GOOGLE_CLIENT_SECRET=${GOOGLE_PROD_CLIENT_SECRET}
```

## Database Configuration Details

### PostgreSQL Connection String Format

```
postgresql://[user[:password]@][host][:port][/dbname][?param1=value1&param2=value2...]
```

**Examples:**

```env
# Local development
DATABASE_URL=postgresql://timesheet:timesheetpass@localhost:5432/timesheet_db

# AWS RDS
DATABASE_URL=postgresql://admin:password123@timesheet-db.c123456.us-east-1.rds.amazonaws.com:5432/timesheet_db

# Azure Database for PostgreSQL
DATABASE_URL=postgresql://admin@servername:password@servername.postgres.database.azure.com:5432/timesheet_db?ssl=true

# GCP Cloud SQL
DATABASE_URL=postgresql://postgres:password@/timesheet_db?host=/cloudsql/project:region:instance

# With SSL/TLS
DATABASE_URL=postgresql://user:password@host:5432/db?sslmode=require&sslcert=/path/to/cert.pem

# Connection pooling
DATABASE_URL=postgresql://user:password@host:5432/db?schema=public&connection_limit=20
```

### Redis Connection String Format

```
redis[s]://[username[:password]@]host[:port][/database]
```

**Examples:**

```env
# Local development
REDIS_URL=redis://:redispass@localhost:6379

# AWS ElastiCache
REDIS_URL=redis://:password@timesheet-redis.123456.cache.amazonaws.com:6379

# Azure Cache for Redis
REDIS_URL=redis://default:password@timesheet.redis.cache.windows.net:6379?tls=true

# GCP Memorystore
REDIS_URL=redis://:password@10.0.0.3:6379

# With TLS
REDIS_URL=rediss://password@host:6380
```

## Email Configuration

### SMTP Providers

| Provider | Host | Port | Security | Setup |
|----------|------|------|----------|-------|
| Gmail | smtp.gmail.com | 587 | STARTTLS | [Guide](https://support.google.com/accounts/answer/185833) |
| SendGrid | smtp.sendgrid.net | 587 | STARTTLS | [Guide](https://sendgrid.com/docs/for-developers/sending-email/integrating-with-the-smtp-api/) |
| AWS SES | email-smtp.region.amazonaws.com | 587 | STARTTLS | [Guide](https://docs.aws.amazon.com/ses/latest/dg/send-email-smtp.html) |
| Azure | smtp.communication.azure.com | 587 | STARTTLS | [Guide](https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/email/send-email-smtp) |
| Mailgun | smtp.mailgun.org | 587 | STARTTLS | [Guide](https://documentation.mailgun.com/en/latest/user_manual.html#smtp-relay) |

### Email Templates

The system uses pre-built email templates for:

1. **Timesheet Approval**
   - Sent to: Employee
   - Trigger: Timesheet approved by manager
   - Variables: Employee name, period

2. **Timesheet Rejection**
   - Sent to: Employee
   - Trigger: Timesheet rejected by manager
   - Variables: Employee name, period, rejection reason

3. **Approval Pending**
   - Sent to: Manager
   - Trigger: Timesheet submitted for approval
   - Variables: Manager name, employee name, approval link

4. **Leave Request Update**
   - Sent to: Employee
   - Trigger: Leave request approved/rejected
   - Variables: Employee name, dates, status

5. **Payroll Notification**
   - Sent to: Employee
   - Trigger: Payroll processed
   - Variables: Employee name, payment amount, date

## JWT & Security Secrets

### Generating Strong Secrets

```bash
# Generate JWT secret (minimum 32 characters, cryptographically secure)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Output example:
# a3f8d2e91c4b6a7f9e2d1c5a8b3f6e9d2c4a7b1e5f8d2a9c3e6f1a4b7c0d3e

# Generate multiple secrets for rotation
for i in {1..5}; do
  node -e "console.log('Secret $i:', require('crypto').randomBytes(32).toString('hex'))"
done
```

### Secret Rotation

Secrets should be rotated every 90 days:

1. Generate new secrets
2. Store in secret manager
3. Deploy new version with new secrets
4. Keep old secrets in rotation for 24 hours
5. Disable old secrets

### Storage Best Practices

**Never commit secrets to repository:**

```bash
# .gitignore
.env
.env.local
.env.*.local
```

**Use cloud secret managers:**

- **AWS:** AWS Secrets Manager or AWS Systems Manager Parameter Store
- **Azure:** Azure Key Vault
- **GCP:** Google Cloud Secret Manager

**Kubernetes Secrets:**

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: timesheet-secrets
  namespace: production
type: Opaque
stringData:
  JWT_SECRET: ${JWT_SECRET}
  SMTP_PASS: ${SMTP_PASS}
  DATABASE_PASSWORD: ${DB_PASSWORD}
```

## Validation & Testing

### Environment Configuration Checklist

Before deployment, verify:

- [ ] DATABASE_URL is valid and accessible
- [ ] REDIS_URL is valid and accessible
- [ ] JWT_SECRET is at least 32 characters
- [ ] SMTP credentials are valid
- [ ] FRONTEND_URL matches actual frontend domain
- [ ] LOG_LEVEL is appropriate for environment
- [ ] NODE_ENV is correct (development/staging/production)
- [ ] Optional services (SSO, monitoring) are configured if enabled
- [ ] All secrets are stored securely (not in .env file in production)

### Testing Configuration

```bash
# Test database connection
npx prisma db execute --stdin < test.sql

# Test Redis connection
redis-cli -u ${REDIS_URL} ping

# Test email configuration
npm run test:email

# Validate environment variables
npm run validate:env
```

## Troubleshooting

### Database Connection Issues

**Error:** `connect ECONNREFUSED`
- Verify DATABASE_URL is correct
- Check database service is running
- Verify firewall allows connections
- Check credentials

**Error:** `FATAL: database "db" does not exist`
- Create database: `createdb -U user db`
- Run migrations: `npx prisma migrate deploy`

### Redis Connection Issues

**Error:** `Error: connect ECONNREFUSED`
- Verify REDIS_URL is correct
- Check Redis service is running
- Verify firewall allows connections

**Error:** `ERR invalid password`
- Verify REDIS_URL includes correct password
- Check password has been updated

### Email Issues

**Error:** `Error: Invalid login`
- Verify SMTP_USER and SMTP_PASS are correct
- Check if SMTP service requires authentication change
- Verify SMTP_HOST and SMTP_PORT are correct

**Error:** `Emails not being sent`
- Check LOG_LEVEL, enable debug logging
- Verify SMTP_FROM matches verified sender
- Check email queue status in Redis

## Environment-Specific Features

### Feature Flags

Configure feature availability per environment:

```env
# Feature flags
ENABLE_SSO=true
ENABLE_PAYROLL=true
ENABLE_ANALYTICS=true
ENABLE_EMAIL_NOTIFICATIONS=true
ENABLE_MOBILE_APP=false
```

### Rate Limiting

Adjust based on environment:

```env
# Development: Higher limits
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=1000

# Production: Stricter limits
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=500
```

### Logging Levels

```
development: debug
staging: info
production: info
```

## Migration Between Environments

### Promoting from Staging to Production

1. **Backup staging database:**
   ```bash
   pg_dump "postgresql://user:pass@staging-db:5432/db" > backup.sql
   ```

2. **Verify all tests pass:**
   ```bash
   npm test
   ```

3. **Update production .env:**
   ```bash
   # Use cloud secret manager to update production secrets
   aws secretsmanager update-secret --secret-id prod/timesheet --secret-string '{...}'
   ```

4. **Deploy to production:**
   ```bash
   kubectl apply -f deployment/production/
   ```

5. **Verify health:**
   ```bash
   curl https://yourdomain.com/api/health
   ```

