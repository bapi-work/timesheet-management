import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';

import { errorHandler } from './middleware/error.middleware';
import { requestLogger } from './middleware/audit.middleware';

import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import timesheetRoutes from './routes/timesheet.routes';
import approvalRoutes from './routes/approval.routes';
import projectRoutes from './routes/project.routes';
import clientRoutes from './routes/client.routes';
import departmentRoutes from './routes/department.routes';
import attendanceRoutes from './routes/attendance.routes';
import leaveRoutes from './routes/leave.routes';
import reportRoutes from './routes/report.routes';
import notificationRoutes from './routes/notification.routes';
import adminRoutes from './routes/admin.routes';
import payrollRoutes from './routes/payroll.routes';
import analyticsRoutes from './routes/analytics.routes';
import timerRoutes from './routes/timer.routes';
import invoiceRoutes from './routes/invoice.routes';
import expenseRoutes from './routes/expense.routes';
import backupRoutes from './routes/backup.routes';
import teamRoutes from './routes/team.routes';
import prisma from './utils/prisma';

const app = express();

// Trust one reverse-proxy hop (nginx/load balancer) so req.ip is the real client IP
// Required for IP whitelist checks — never read X-Forwarded-For directly
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan('combined'));
app.use(requestLogger);

// Serve uploaded files (receipts, leave docs, avatars) at /uploads/*
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: 'Too many requests, please try again later.',
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
});
app.use('/api/auth/', authLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/timesheets', timesheetRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/timer', timerRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/teams', teamRoutes);

// Public branding endpoint (used by login page before auth)
app.get('/api/public/branding', async (_req, res) => {
  try {
    const org = await prisma.organization.findFirst({
      select: { appName: true, logoUrl: true, faviconUrl: true, primaryColor: true, secondaryColor: true, accentColor: true, loginBgColor: true, footerText: true, name: true },
    });
    res.json(org || {});
  } catch {
    res.json({});
  }
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date() }));

app.use(errorHandler);

export default app;
