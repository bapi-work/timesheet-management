# TimeTrack Pro — Enterprise Timesheet Management

A full-stack timesheet management system for 500+ employees.

## Quick Start

```bash
# 1. Copy env file
cp .env.example .env
# Edit .env with your settings

# 2. Start all services
docker compose up -d --build

# 3. Get the first-run admin login (migrations run automatically on startup)
docker compose logs backend | grep -A6 "FIRST-RUN ADMIN"

# 4. Open the app
open http://localhost:3001
```

## First Login

On first startup with an empty database the backend creates one System Admin:

- **Email:** `INITIAL_ADMIN_EMAIL` (default `admin@timesheet.local`)
- **Password:** `INITIAL_ADMIN_PASSWORD`, or if blank, generated and printed once:
  `docker compose logs backend | grep -A6 "FIRST-RUN ADMIN"`

You must change the password at first sign-in.

Demo data for local development only: `cd backend && npm run db:seed`. It is refused in production.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Nginx (Port 80)                   │
└──────────────┬────────────────────┬─────────────────┘
               │                    │
   ┌───────────▼──────┐   ┌────────▼──────────┐
   │  Frontend (React) │   │  Backend (Express) │
   │  Vite + Tailwind  │   │  TypeScript + Prisma│
   │  Port 3000        │   │  Port 4000         │
   └───────────────────┘   └────────┬──────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
         ┌──────────▼──┐  ┌────────▼────┐  ┌──────▼──────┐
         │  PostgreSQL  │  │    Redis    │  │  Bull Queue │
         │  Port 5432   │  │  Port 6379  │  │  (in Redis) │
         └─────────────┘  └─────────────┘  └─────────────┘
```

## Features

### Core
- ✅ Weekly/biweekly/monthly timesheet entry
- ✅ Project & task allocation per entry
- ✅ Billable vs non-billable hours
- ✅ Copy from previous week
- ✅ Draft → Submit → Approve/Reject → Locked workflow
- ✅ Bulk approve/reject

### Attendance
- ✅ Clock in / clock out
- ✅ Work hours calculation
- ✅ Attendance history

### Leave
- ✅ Leave requests (Annual, Sick, Maternity, etc.)
- ✅ Leave balance tracking
- ✅ Holiday calendar

### Management
- ✅ Employee profiles & RBAC
- ✅ Department & team hierarchy
- ✅ Project/task management with budgets
- ✅ Resource allocation

### Reporting & Analytics
- ✅ Employee utilization reports
- ✅ Project effort reports
- ✅ Overtime analysis
- ✅ Missing timesheet reports
- ✅ Export to Excel, CSV, PDF
- ✅ Visual analytics & charts
- ✅ KPI dashboard

### Payroll
- ✅ Payroll period management
- ✅ Process & lock timesheets
- ✅ Excel export for payroll systems

### Security
- ✅ JWT + refresh token authentication
- ✅ TOTP-based MFA
- ✅ Role-based access control (8 roles)
- ✅ Audit logging
- ✅ Rate limiting

### Notifications
- ✅ Real-time (WebSocket)
- ✅ Email notifications
- ✅ Background job queues (Bull + Redis)
- ✅ Weekly reminder cron job

### Admin
- ✅ Organization settings
- ✅ Bulk employee import/export (Excel)
- ✅ Holiday management
- ✅ Audit log viewer

## User Roles

| Role | Access |
|------|--------|
| `EMPLOYEE` | Own timesheets, attendance, leave |
| `TEAM_LEAD` | Team visibility, approval |
| `PROJECT_MANAGER` | Projects, resources, reports |
| `DEPARTMENT_MANAGER` | Department reports, approvals |
| `HR_ADMIN` | All employees, leave, reports |
| `PAYROLL_ADMIN` | Payroll processing |
| `SYSTEM_ADMIN` | Full access |
| `EXECUTIVE` | Read-only analytics |

## API

Base URL: `http://localhost:4000/api`

| Resource | Endpoints |
|----------|-----------|
| Auth | POST /auth/login, /auth/refresh, /auth/logout |
| Users | CRUD /users |
| Timesheets | CRUD /timesheets, submit, copy-previous |
| Approvals | /approvals/pending, approve, reject, bulk-approve |
| Projects | CRUD /projects, members, tasks, utilization |
| Attendance | clock-in, clock-out, history |
| Leave | balance, requests, approve/reject, holidays |
| Reports | utilization, project-effort, overtime, missing, export |
| Analytics | dashboard, trends |
| Payroll | periods, process |
| Admin | org settings, import/export, holidays, audit-logs |
| Notifications | list, read, read-all |

## Development

```bash
# Backend only
cd backend && npm install
npm run db:generate
npm run dev

# Frontend only
cd frontend && npm install
npm run dev
```

## Environment Variables

See `.env.example` for all required variables.

Comprehensive guide: [ENVIRONMENT.md](./ENVIRONMENT.md)

---

## 📚 Documentation

### Getting Started
- [Quick Start Guide](./README.md#quick-start)
- [Local Development Setup](#development)
- [Default Test Credentials](#default-credentials)

### Deployment & Production
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Comprehensive production deployment guide
  - Cloud provider comparison (AWS, Azure, GCP)
  - Database configuration (Internal, RDS, Cloud SQL, Managed DB)
  - Volume storage setup
  - Email/SMTP configuration
  - Security considerations
  - Monitoring & logging

- **[ENVIRONMENT.md](./ENVIRONMENT.md)** - Environment configuration guide
  - Development, Staging, Production configs
  - Database connection strings
  - Email provider setup (Gmail, SendGrid, AWS SES, Azure)
  - JWT & security secrets
  - Feature flags

- **[PRODUCTION_CHECKLIST.md](./PRODUCTION_CHECKLIST.md)** - Pre & post-deployment verification
  - Security checklist
  - Performance verification
  - Compliance & governance
  - Monitoring setup
  - Cost optimization

- **[TESTING_GUIDE.md](./TESTING_GUIDE.md)** - Testing & verification
  - Unit & integration tests
  - API endpoint testing
  - Load testing
  - Security testing
  - Browser compatibility

### Cloud Deployment Guides
- **[AWS ECS Deployment](./deployment/aws/ECS-DEPLOYMENT.md)**
  - RDS PostgreSQL setup
  - ElastiCache Redis
  - S3 bucket configuration
  - ECS task definitions
  - CloudWatch monitoring

- **[Azure AKS Deployment](./deployment/azure/AKS-DEPLOYMENT.md)**
  - Azure Database for PostgreSQL
  - Azure Cache for Redis
  - AKS cluster setup
  - Application Insights
  - Key Vault integration

- **[GCP GKE Deployment](./deployment/gcp/GKE-DEPLOYMENT.md)**
  - Cloud SQL (PostgreSQL)
  - Memorystore (Redis)
  - GKE cluster configuration
  - Cloud Storage setup
  - Workload Identity

### Kubernetes Manifests
All Kubernetes deployment files are in [deployment/kubernetes/](./deployment/kubernetes/):
- `namespace.yaml` - Namespace setup
- `secrets-configmap.yaml` - Configuration & secrets
- `backend-deployment.yaml` - Backend service with HPA & monitoring
- `frontend-deployment.yaml` - Frontend service
- `ingress-storage.yaml` - Ingress & persistent storage
- `monitoring.yaml` - Prometheus alerts & monitoring

---

## 🚀 Quick Production Deployment

### 1. Choose Your Cloud Provider
| Provider | Best For | Recommended |
|----------|----------|-------------|
| **AWS** | Large scale, complex infrastructure | ⭐⭐⭐ |
| **Azure** | Microsoft ecosystem integration | ⭐⭐⭐ |
| **GCP** | Data analytics, AI/ML workloads | ⭐⭐ |

### 2. Configure Environment
```bash
# Copy .env.example to .env
cp .env.example .env

# Update with your production values
# - Database credentials
# - JWT secrets (min 32 chars, use: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
# - Email/SMTP settings
# - Cloud provider credentials
```

### 3. Deploy
Choose your platform:
- **Docker Compose**: Local development or single-server deployment
  ```bash
  docker compose up -d --build
  ```

- **Kubernetes (Recommended for production)**:
  ```bash
  # Configure secrets first!
  kubectl apply -f deployment/kubernetes/namespace.yaml
  kubectl apply -f deployment/kubernetes/secrets-configmap.yaml
  kubectl apply -f deployment/kubernetes/backend-deployment.yaml
  kubectl apply -f deployment/kubernetes/frontend-deployment.yaml
  ```

### 4. Database & Email Setup

**Choose Database Type:**
- Internal: PostgreSQL in Kubernetes (use when you need full control)
- Managed: RDS/Cloud SQL/Azure DB (recommended for production)

**Configure Email:**
- Gmail (development/small scale)
- SendGrid (production-ready, no IP restrictions)
- AWS SES (if using AWS)
- Azure Communication Services (if using Azure)

See [Email Configuration](./DEPLOYMENT.md#emailsmtp-configuration) for detailed setup.

### 5. Verify Production Readiness
Use the [PRODUCTION_CHECKLIST.md](./PRODUCTION_CHECKLIST.md) to ensure:
- ✅ Security hardened
- ✅ Monitoring configured
- ✅ Backups tested
- ✅ SSL/TLS certificates valid
- ✅ Rate limiting configured
- ✅ Email sending verified

---

## 📊 Architecture Overview

### Development (Docker Compose)
```
┌─────────────────────────────────────────────────────┐
│                    Nginx (Port 80)                   │
└──────────────┬────────────────────┬─────────────────┘
               │                    │
   ┌───────────▼──────┐   ┌────────▼──────────┐
   │  Frontend (React) │   │  Backend (Express) │
   │  Vite + Tailwind  │   │  TypeScript + Prisma│
   │  Port 3000        │   │  Port 4000         │
   └───────────────────┘   └────────┬──────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
         ┌──────────▼──┐  ┌────────▼────┐  ┌──────▼──────┐
         │  PostgreSQL  │  │    Redis    │  │  Bull Queue │
         │  Port 5432   │  │  Port 6379  │  │  (in Redis) │
         └─────────────┘  └─────────────┘  └─────────────┘
```

### Production (Kubernetes with Managed Services)
```
┌──────────────────────────────────────────────────────┐
│  Cloud Load Balancer (AWS ALB / Azure LB / GCP LB)   │
└────────────────┬─────────────────────────────────────┘
                 │
         ┌───────▼───────┐
         │  Kubernetes   │
         │  Ingress      │
         └───────┬───────┘
                 │
    ┌────────────┴───────────┐
    │                        │
┌───▼────────────┐  ┌────────▼──────┐
│ Frontend Pods  │  │ Backend Pods   │
│  (Nginx x 2-5) │  │ (Node.js x 2-10)
└────────────────┘  └────────┬───────┘
                             │
         ┌───────────────────┼────────────────┐
         │                   │                │
    ┌────▼──────┐  ┌────────▼────┐  ┌──────▼──────┐
    │ Managed   │  │  Managed    │  │Cloud Object │
    │PostgreSQL │  │  Redis      │  │  Storage    │
    └───────────┘  └─────────────┘  └─────────────┘
```

---

## 💾 Database & Storage

### Database Options
| Type | Best For | Setup Time | Management |
|------|----------|-----------|-----------|
| **PostgreSQL (Internal)** | Dev/testing, small deployments | 5 min | Full control, backup yourself |
| **AWS RDS** | AWS deployments | 10 min | Managed, automatic backups |
| **Azure Database** | Azure deployments | 10 min | Managed, automatic backups |
| **GCP Cloud SQL** | GCP deployments | 10 min | Managed, automatic backups |

### File Storage Options
| Type | Best For | Setup Time | Cost |
|------|----------|-----------|------|
| **Kubernetes PVC** | Dev/testing | 5 min | Minimal |
| **AWS S3** | Cloud-native, large files | 5 min | Pay per GB |
| **Azure Blob** | Azure deployments | 5 min | Pay per GB |
| **GCP Cloud Storage** | GCP deployments | 5 min | Pay per GB |

---

## 📧 Email & Notifications

### Notification Types
- ✅ Timesheet submission confirmations
- ✅ Approval/rejection notifications
- ✅ Leave request updates
- ✅ Payroll processing confirmations
- ✅ Weekly reminder emails

### Email Providers (Recommended Order)
1. **SendGrid** - Production-ready, excellent deliverability
2. **AWS SES** - Good for AWS deployments, cost-effective
3. **Azure Communication Services** - For Azure deployments
4. **Gmail** - Development/testing only (has daily limits)

### Setup Guide
See [Email Configuration](./DEPLOYMENT.md#emailsmtp-configuration) for step-by-step setup.

---

## 🔐 Security

### Built-In Security Features
- ✅ JWT authentication with refresh tokens
- ✅ TOTP-based MFA support
- ✅ Rate limiting on all endpoints
- ✅ CORS protection
- ✅ CSRF protection
- ✅ SQL injection prevention (Prisma ORM)
- ✅ XSS protection (Helmet headers)
- ✅ Audit logging for sensitive operations
- ✅ Password hashing (bcryptjs)
- ✅ Session management

### Production Security Checklist
Before deploying to production, complete the [PRODUCTION_CHECKLIST.md](./PRODUCTION_CHECKLIST.md):
- [ ] Generate strong JWT secrets
- [ ] Configure SSL/TLS certificates
- [ ] Set up firewalls & security groups
- [ ] Enable encryption at rest
- [ ] Enable encryption in transit
- [ ] Configure rate limiting
- [ ] Set up audit logging
- [ ] Review RBAC permissions
- [ ] Test backup/restore
- [ ] Setup monitoring & alerting

---

## 📈 Monitoring & Logging

### Application Logging
- **Development**: Pretty-printed logs to console
- **Production**: JSON logs to file + Cloud logging service

### Metrics to Monitor
- API response times (p50, p95, p99)
- Error rates and types
- Database connection pool usage
- Redis memory usage
- CPU and memory utilization
- Active user sessions
- Email delivery success rate

### Cloud Monitoring Platforms
- **AWS**: CloudWatch (included)
- **Azure**: Application Insights (included)
- **GCP**: Cloud Monitoring (included)

See [Monitoring Setup](./DEPLOYMENT.md#monitoring--logging) for detailed configuration.

---

## 🆘 Support & Troubleshooting

### Common Issues

**Database Connection Failed**
```bash
# Verify connection string in .env
# Check database service is running
# Verify firewall rules allow connection
psql "postgresql://user:pass@host:5432/db"
```

**Email Not Sending**
```bash
# Check SMTP credentials
# Verify SMTP_FROM matches verified sender
# Check logs: tail -f logs/combined.log | grep -i email
```

**Redis Connection Error**
```bash
# Verify REDIS_URL in .env
# Check Redis service running
redis-cli -h localhost -p 6379 -a password ping
```

### Getting Help
1. Check relevant documentation:
   - Development issues → [Quick Start](#quick-start) & [Development](#development)
   - Deployment issues → [DEPLOYMENT.md](./DEPLOYMENT.md)
   - Configuration issues → [ENVIRONMENT.md](./ENVIRONMENT.md)
   - Testing issues → [TESTING_GUIDE.md](./TESTING_GUIDE.md)

2. Review logs:
   ```bash
   # Docker Compose
   docker compose logs -f backend
   
   # Kubernetes
   kubectl logs -f deployment/timesheet-backend -n timesheet
   ```

3. Check application health:
   ```bash
   curl http://localhost:4000/api/health
   ```

---

## 📝 License

Proprietary - Timesheet Management System

---

## 🔄 Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | Jan 2024 | Initial release |

---

## 📞 Contact & Support

For deployment and production support, refer to:
- Technical Documentation: See files listed above
- Cloud Provider Documentation:
  - [AWS Documentation](https://docs.aws.amazon.com/)
  - [Azure Documentation](https://docs.microsoft.com/azure/)
  - [Google Cloud Documentation](https://cloud.google.com/docs)
- Node.js & Express: [Node.js Docs](https://nodejs.org/docs/)
- Kubernetes: [Kubernetes Docs](https://kubernetes.io/docs/)
