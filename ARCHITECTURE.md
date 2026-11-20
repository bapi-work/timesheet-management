# Timesheet Management System — Architecture Documentation

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Directory Structure](#2-directory-structure)
3. [Infrastructure & Deployment](#3-infrastructure--deployment)
4. [Backend Architecture](#4-backend-architecture)
5. [Database Schema](#5-database-schema)
6. [Authentication & Authorization](#6-authentication--authorization)
7. [Frontend Architecture](#7-frontend-architecture)
8. [Real-time & Async Systems](#8-real-time--async-systems)
9. [Environment Variables](#9-environment-variables)
10. [Key Architectural Patterns](#10-key-architectural-patterns)

---

## 1. System Overview

A production-ready, multi-tenant enterprise timesheet management system supporting the full employee lifecycle: time tracking, approvals, leave management, attendance, expenses, invoicing, payroll, and analytics.

**Core Stack:**

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL 16 + Prisma ORM |
| Cache / Queue | Redis 7 + Bull |
| Real-time | Socket.IO |
| Proxy | Nginx (Docker container) |
| Containerisation | Docker Compose |

---

## 2. Directory Structure

```
timesheet-management/
├── backend/                    # Express API server
│   ├── src/
│   │   ├── app.ts              # Express app (CORS, Helmet, rate limiting)
│   │   ├── index.ts            # Server entry, Socket.IO, queue init
│   │   ├── routes/             # 19 route modules (see §4)
│   │   ├── middleware/         # Auth, error, audit
│   │   ├── services/           # Queue, socket, email
│   │   └── utils/              # JWT, Prisma client, logger
│   ├── prisma/
│   │   ├── schema.prisma       # 37 Prisma models
│   │   └── seed.ts             # Initial data seed
│   ├── db/init.sql             # SQL bootstrap
│   └── Dockerfile              # Multi-stage build
│
├── frontend/                   # React SPA
│   ├── src/
│   │   ├── main.tsx            # React entry point
│   │   ├── App.tsx             # Router + route guards
│   │   ├── pages/              # 25 page components
│   │   ├── components/         # Shared UI components
│   │   ├── store/              # Zustand state (auth)
│   │   ├── lib/                # API client, roles
│   │   ├── context/            # BrandingContext
│   │   └── i18n/locales/       # en, es, fr, de, th, ms
│   └── Dockerfile              # Multi-stage: build → nginx
│
├── nginx/
│   └── nginx.conf              # Reverse proxy + SSL + security headers
│
├── deployment/
│   ├── kubernetes/             # K8s manifests
│   ├── aws/                    # ECS + RDS guide
│   ├── azure/                  # AKS guide
│   ├── gcp/                    # GKE guide
│   └── digitalocean/           # App Platform guide
│
├── docker-compose.yml          # 5-service orchestration
└── .env / .env.example         # Environment configuration
```

---

## 3. Infrastructure & Deployment

### Docker Compose Services

```
┌─────────────────────────────────────────────────────┐
│                    Internet                         │
└────────────────────┬────────────────────────────────┘
                     │ :80 / :443
          ┌──────────▼──────────┐
          │   timesheet-nginx   │  nginx:alpine
          │   Reverse Proxy     │  SSL termination
          └──────┬──────────────┘
                 │               │
        /api/*   │        /      │
   ┌─────────────▼───┐  ┌───────▼──────────┐
   │ timesheet-backend│  │timesheet-frontend│
   │  Express :4000  │  │  nginx :80       │
   └────┬────────────┘  └──────────────────┘
        │         │
   ┌────▼───┐  ┌──▼──────┐
   │postgres│  │  redis  │
   │  :5432 │  │  :6379  │
   └────────┘  └─────────┘
```

| Container | Image | Host Port | Purpose |
|---|---|---|---|
| timesheet-nginx | nginx:alpine | 80, 443 | Reverse proxy, SSL |
| timesheet-backend | custom build | 4000 | REST API + WebSocket |
| timesheet-frontend | custom build | 3001 | Static SPA (nginx) |
| timesheet-postgres | postgres:16-alpine | 5433 | Primary database |
| timesheet-redis | redis:7-alpine | 6380 | Cache + job queues |

### Nginx Routing

```
HTTPS :443
  /api/*         → backend:4000   (REST API)
  /socket.io/*   → backend:4000   (WebSocket upgrade)
  /              → frontend:80    (SPA)

HTTP :80
  /.well-known/acme-challenge/  → certbot webroot
  /*             → 301 redirect to HTTPS
```

Security headers applied at nginx level: `X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy`, `Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy`.

### Dockerfile Strategy

**Backend** — Multi-stage:
1. Builder stage: `npm install`, `prisma generate`, `tsc`
2. Runner stage: slim Node image, Prisma binaries, runs `prisma migrate deploy` then starts server
3. Non-root user `nodejs` for security

**Frontend** — Multi-stage:
1. Builder stage: `npm install`, `vite build` (`VITE_API_URL` defaults to the relative `/api`, so no domain is built in)
2. Runner stage: `nginx:alpine` serves `dist/` as static files

### Cloud Deployment Options

| Platform | Guide |
|---|---|
| Kubernetes | `deployment/kubernetes/` |
| AWS | `deployment/aws/ECS-DEPLOYMENT.md` (ECS + RDS + ElastiCache) |
| Azure | `deployment/azure/AKS-DEPLOYMENT.md` (AKS + PostgreSQL + Redis) |
| GCP | `deployment/gcp/GKE-DEPLOYMENT.md` (GKE + Cloud SQL + Memorystore) |
| DigitalOcean | `deployment/digitalocean/DO-DEPLOYMENT.md` |

---

## 4. Backend Architecture

### Entry Points

- [`backend/src/app.ts`](backend/src/app.ts) — Express app setup: CORS, Helmet, compression, rate limiting, route registration
- [`backend/src/index.ts`](backend/src/index.ts) — HTTP server, Socket.IO attachment, Bull queue initialisation

### Route Modules

| File | Prefix | Description |
|---|---|---|
| `auth.routes.ts` | `/api/auth` | Login, refresh, MFA, SSO |
| `user.routes.ts` | `/api/users` | User management, profile |
| `timesheet.routes.ts` | `/api/timesheets` | Timesheet CRUD, submit, lock |
| `approval.routes.ts` | `/api/approvals` | Approval workflows, delegation |
| `leave.routes.ts` | `/api/leave` | Leave requests, balances, holidays |
| `attendance.routes.ts` | `/api/attendance` | Check-in/check-out |
| `project.routes.ts` | `/api/projects` | Project management |
| `client.routes.ts` | `/api/clients` | Client management |
| `team.routes.ts` | `/api/teams` | Team management |
| `department.routes.ts` | `/api/departments` | Department hierarchy |
| `expense.routes.ts` | `/api/expenses` | Expense claims |
| `invoice.routes.ts` | `/api/invoices` | Invoice management |
| `payroll.routes.ts` | `/api/payroll` | Payroll processing |
| `analytics.routes.ts` | `/api/analytics` | Dashboard analytics |
| `report.routes.ts` | `/api/reports` | Report generation |
| `timer.routes.ts` | `/api/timer` | Active timer tracking |
| `notification.routes.ts` | `/api/notifications` | User notifications |
| `admin.routes.ts` | `/api/admin` | Org settings, branding, imports |
| `backup.routes.ts` | `/api/backup` | Data export/import |

### Middleware

| File | Purpose |
|---|---|
| [`auth.middleware.ts`](backend/src/middleware/auth.middleware.ts) | JWT verification, `authenticate` + `authorize(...roles)` |
| [`error.middleware.ts`](backend/src/middleware/error.middleware.ts) | Global error handler, `AppError` class |
| [`audit.middleware.ts`](backend/src/middleware/audit.middleware.ts) | ISO 27001 A.12.4 audit logging (sanitises sensitive fields) |

### Services & Utilities

| File | Purpose |
|---|---|
| [`services/queue.service.ts`](backend/src/services/queue.service.ts) | Bull queues: email, notifications, reminders |
| [`services/socket.service.ts`](backend/src/services/socket.service.ts) | Socket.IO real-time event emitters |
| [`services/email.service.ts`](backend/src/services/email.service.ts) | Nodemailer SMTP (Gmail, SendGrid, SES, Azure, Mailgun) |
| [`utils/jwt.ts`](backend/src/utils/jwt.ts) | Access/refresh token generation & verification |
| [`utils/prisma.ts`](backend/src/utils/prisma.ts) | Prisma client singleton |
| [`utils/logger.ts`](backend/src/utils/logger.ts) | Winston structured logging |

---

## 5. Database Schema

**37 Prisma models** defined in [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma).

### Core Entities

```
Organization
  └── User (many)
        ├── Department
        ├── Team (via TeamMember)
        ├── Timesheet (many)
        │     └── TimesheetEntry (many)
        ├── LeaveRequest (many)
        ├── LeaveBalance (many)
        ├── Attendance (many)
        ├── Expense (many)
        └── Notification (many)

Project
  ├── Client
  ├── Task (many)
  └── ProjectMember (many)

Invoice
  └── InvoiceItem (many)

PayrollPeriod
  └── PayrollExport (many)
```

### Key Enums

**UserRole:**
```
EMPLOYEE | TEAM_LEAD | PROJECT_MANAGER | DEPARTMENT_MANAGER
HR_ADMIN | PAYROLL_ADMIN | SYSTEM_ADMIN | EXECUTIVE
```

**TimesheetStatus:**
```
DRAFT → SUBMITTED → APPROVED / REJECTED → LOCKED
```

**LeaveStatus:**
```
PENDING → APPROVED / REJECTED / CANCELLED
```

**Other status enums:**
- `AttendanceStatus`: PRESENT, ABSENT, HALF_DAY, ON_LEAVE, HOLIDAY, WEEKEND
- `ProjectStatus`: ACTIVE, ON_HOLD, COMPLETED, CANCELLED, ARCHIVED
- `InvoiceStatus`: DRAFT, SENT, PAID, OVERDUE, CANCELLED
- `ExpenseStatus`: DRAFT, SUBMITTED, APPROVED, REJECTED, REIMBURSED
- `ApprovalStatus`: PENDING, APPROVED, REJECTED, ESCALATED, DELEGATED

---

## 6. Authentication & Authorization

### Authentication Methods

| Method | Implementation |
|---|---|
| Local | Email + bcryptjs password hash |
| MFA | TOTP via speakeasy (Base32 secret) |
| Azure AD SSO | Passport.js Azure AD strategy |
| Google SSO | Passport.js Google OAuth2 strategy |
| IP Whitelisting | Per-user IP restrictions (ISO 27001 A.9.4) |

### Token Strategy

- **Access token:** JWT, 15 minute expiry
- **Refresh token:** JWT, 7 day expiry, stored in DB for rotation
- **Token rotation:** Refresh invalidates old token and issues new pair
- **Account lockout:** 5 failed attempts → 30 minute lockout

### Role Hierarchy & Route Guards

Defined in [`frontend/src/lib/roles.ts`](frontend/src/lib/roles.ts) and [`backend/src/middleware/auth.middleware.ts`](backend/src/middleware/auth.middleware.ts):

| Constant | Roles Included | Used For |
|---|---|---|
| `SYSTEM_ADMIN_ROLES` | SYSTEM_ADMIN | Admin panel, backup, password resets |
| `ADMIN_ROLES` | SYSTEM_ADMIN, HR_ADMIN | Employee management, holidays, audit |
| `SENIOR_MANAGER_ROLES` | SYSTEM_ADMIN, HR_ADMIN, DEPARTMENT_MANAGER, PROJECT_MANAGER | Clients, invoices, teams, employees, reports |
| `MANAGEMENT_ROLES` | + TEAM_LEAD | Approvals page |
| `PAYROLL_ROLES` | SYSTEM_ADMIN, PAYROLL_ADMIN | Payroll processing |
| `ANALYTICS_ROLES` | MANAGEMENT_ROLES + EXECUTIVE + PAYROLL_ADMIN | Analytics, reports |

### Frontend Route Guards

Defined in [`frontend/src/App.tsx`](frontend/src/App.tsx):

```
PrivateRoute        → all authenticated users
AdminRoute          → SYSTEM_ADMIN only
HrRoute             → ADMIN_ROLES
ManagerRoute        → MANAGEMENT_ROLES (includes TEAM_LEAD)
SeniorManagerRoute  → SENIOR_MANAGER_ROLES (excludes TEAM_LEAD)
AnalyticsRoute      → ANALYTICS_ROLES
PayrollRoute        → PAYROLL_ROLES
```

### Security Features

- Rate limiting: 20 req/15 min (auth), 500 req/15 min (general)
- Helmet.js HTTP security headers
- Request sanitisation: password/token fields redacted from audit logs
- 20 MB max upload body size

---

## 7. Frontend Architecture

### Technology Stack

| Concern | Library |
|---|---|
| Framework | React 18.2 |
| Build | Vite 5.2 |
| Routing | React Router 6.22 |
| Styling | Tailwind CSS 3.4 |
| Server state | TanStack React Query 5.29 |
| Client state | Zustand 4.5 |
| HTTP client | Axios |
| Forms | React Hook Form + Zod |
| UI primitives | Headless UI + Heroicons |
| Charts | Chart.js + react-chartjs-2 |
| Dates | date-fns + react-datepicker |
| Real-time | socket.io-client |
| i18n | i18next (6 locales: en, es, fr, de, th, ms) |
| Toasts | react-hot-toast |

### Key Files

| File | Purpose |
|---|---|
| [`src/App.tsx`](frontend/src/App.tsx) | Router definition, all route guards |
| [`src/components/Layout.tsx`](frontend/src/components/Layout.tsx) | Sidebar navigation, role-based nav items |
| [`src/lib/api.ts`](frontend/src/lib/api.ts) | Axios instance, JWT injection, 401 auto-refresh |
| [`src/lib/roles.ts`](frontend/src/lib/roles.ts) | Role constants and `hasRole()` helper |
| [`src/store/auth.store.ts`](frontend/src/store/auth.store.ts) | Zustand auth store (login, logout, token refresh) |
| [`src/context/BrandingContext.tsx`](frontend/src/context/BrandingContext.tsx) | Dynamic org theming (colours, logo, app name) |

### Navigation Structure (by role)

```
All users:
  Dashboard | Current Timesheet | Timesheet History
  Calendar | Leave | Expenses | Projects

Managers (TEAM_LEAD and above):
  + Approvals

Senior Managers (DEPARTMENT_MANAGER, PROJECT_MANAGER, HR_ADMIN, SYSTEM_ADMIN):
  + Clients | Invoices | Employees | Teams | Reports

HR / Admin only:
  + Attendance | Departments | Analytics | Payroll | Admin | Backup
```

### Pages

| Page | Route | Guard |
|---|---|---|
| LoginPage | `/login` | Public |
| DashboardPage | `/dashboard` | Private |
| TimesheetPage | `/timesheets/current`, `/timesheets/:id` | Private |
| TimesheetListPage | `/timesheets` | Private |
| ApprovalsPage | `/approvals` | ManagerRoute |
| LeavePage | `/leave` | Private |
| AttendancePage | `/attendance` | HrRoute |
| CalendarPage | `/calendar` | Private |
| ExpensesPage | `/expenses` | Private |
| ProjectsPage | `/projects` | Private |
| ClientsPage | `/clients` | SeniorManagerRoute |
| InvoicesPage | `/invoices` | SeniorManagerRoute |
| EmployeesPage | `/employees` | SeniorManagerRoute |
| TeamsPage | `/teams` | SeniorManagerRoute |
| DepartmentsPage | `/departments` | HrRoute |
| ReportsPage | `/reports` | SeniorManagerRoute |
| AnalyticsPage | `/analytics` | AnalyticsRoute |
| PayrollPage | `/payroll` | PayrollRoute |
| AdminPage | `/admin` | AdminRoute |
| BackupPage | `/backup` | AdminRoute |
| ProfilePage | `/profile` | Private |
| NotificationsPage | `/notifications` | Private |

---

## 8. Real-time & Async Systems

### Socket.IO

- Server attached to Express HTTP server in `index.ts`
- Client connects via `VITE_WS_URL`
- Used for live notifications, timer updates, approval status changes

### Bull Job Queues (Redis-backed)

| Queue | Triggers | Purpose |
|---|---|---|
| Email queue | Leave approval, rejection, timesheet events | SMTP delivery |
| Notification queue | All approval/status changes | In-app notifications |
| Reminder queue | Scheduled | Timesheet submission reminders |

Jobs are defined in [`backend/src/services/queue.service.ts`](backend/src/services/queue.service.ts).

---

## 9. Environment Variables

### Required

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/db
POSTGRES_USER=timesheet
POSTGRES_PASSWORD=timesheetpass
POSTGRES_DB=timesheet_db

# Redis
REDIS_URL=redis://:password@redis:6379
REDIS_PASSWORD=redispass

# JWT (rotate every 90 days, min 32 chars)
JWT_SECRET=change_me_in_production_super_secret_key
JWT_REFRESH_SECRET=change_me_refresh_secret
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Application
NODE_ENV=production
PORT=4000
DOMAIN=your-domain.com

# Frontend (build-time args)
```

### Email (one provider required for notifications)

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@your-domain.com
```

### Optional

```bash
# SSO
AZURE_AD_TENANT_ID=...
AZURE_AD_CLIENT_ID=...
AZURE_AD_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Cloud storage (for backups/uploads)
AWS_REGION=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... S3_BUCKET_NAME=...
AZURE_STORAGE_ACCOUNT_NAME=... AZURE_STORAGE_ACCOUNT_KEY=... AZURE_STORAGE_CONTAINER=...
GOOGLE_CLOUD_PROJECT=... GOOGLE_CLOUD_BUCKET=...

# Monitoring
SENTRY_DSN=...
NEW_RELIC_LICENSE_KEY=...
DATADOG_API_KEY=...

# Integrations
SLACK_WEBHOOK_URL=...
```

---

## 10. Key Architectural Patterns

### Multi-tenancy
Every resource scoped to `organizationId`. Users, departments, teams, clients, projects, holidays, and leave balances all belong to an organisation. A single deployment can host multiple organisations.

### Role-based Access Control (RBAC)
8 roles with layered permission sets. Backend enforces via `authorize(...roles)` middleware. Frontend enforces via route guard components and hides nav items using `hasRole()`. The two layers are kept in sync via shared role constants mirrored in `roles.ts` (frontend) and `auth.middleware.ts` (backend).

### Approval Workflows
Timesheets and leave requests follow a configurable multi-level approval chain. Supports escalation (auto-escalate after N days), delegation (manager assigns a substitute), and manager-override by HR/Admin.

### Token Rotation
Access tokens (15 min) + refresh tokens (7 day, stored in DB). On 401, the frontend API client automatically calls `/auth/refresh` and retries the original request. Refresh tokens are single-use — each refresh issues a new pair and invalidates the old refresh token.

### Audit Logging (ISO 27001 A.12.4)
`audit.middleware.ts` logs every mutating request to the `AuditLog` table. Sensitive fields (`password`, `token`, `secret`) are redacted before storage.

### Branding / White-labelling
Organisation settings include primary colour, logo URL, and app name. These are served via `/api/public/branding` (unauthenticated) and applied at runtime via CSS custom properties and `BrandingContext`.

### Optimistic UI + React Query
All data fetching uses TanStack React Query with query keys. Mutations invalidate relevant queries to trigger refetches. The auth store (Zustand) handles cross-cutting auth state independently of server state.

### Docker Multi-stage Builds
Both services use multi-stage Dockerfiles to minimise final image size. TypeScript is compiled in a builder stage and only the compiled output + runtime dependencies are copied to the final image. The backend runs Prisma migrations on container start before accepting connections.
