import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest, ADMIN_ROLES, MANAGER_ROLES } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { LeaveType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { notificationQueue } from '../services/queue.service';
import { canReviewUser, getReviewableUserIds } from '../utils/access';

const LEAVE_DOC_DIR = path.join(process.cwd(), 'uploads', 'leave-docs');
try {
  fs.mkdirSync(LEAVE_DOC_DIR, { recursive: true });
  console.log('[leave] upload dir:', LEAVE_DOC_DIR);
} catch (e) {
  console.error('[leave] failed to create upload dir:', e);
}

const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.heic', '.doc', '.docx'];

const documentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, LEAVE_DOC_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, crypto.randomBytes(16).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not supported. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`));
    }
  },
});

const router = Router();
router.use(authenticate);

const dateString = z.string().refine(v => !isNaN(new Date(v).getTime()), 'Invalid date');

const leaveRequestSchema = z.object({
  leaveType: z.nativeEnum(LeaveType),
  startDate: dateString,
  endDate: dateString,
  reason: z.string().optional().nullable(),
  documentUrl: z.union([z.literal(''), z.string().regex(/^\/uploads\/leave-docs\/[a-f0-9]{32}\.[a-z0-9]{2,5}$/, 'Invalid document')]).optional().nullable(),
  dayType: z.enum(['FULL_DAY', 'HALF_DAY']).optional(),
}).refine(d => new Date(d.endDate) >= new Date(d.startDate), { message: 'End date cannot be before start date' })
  .refine(d => d.dayType !== 'HALF_DAY' || new Date(d.endDate).getTime() === new Date(d.startDate).getTime(), { message: 'A half day must start and end on the same date' });

// Gives back days reserved when the request was created, if any were
async function releasePending(tx: Prisma.TransactionClient, request: { userId: string; leaveType: LeaveType; startDate: Date; days: number }): Promise<void> {
  const where = { userId_leaveType_year: { userId: request.userId, leaveType: request.leaveType, year: request.startDate.getFullYear() } };
  const balance = await tx.leaveBalance.findUnique({ where });
  if (balance) await tx.leaveBalance.update({ where, data: { pending: Math.max(0, balance.pending - request.days) } });
}

// Moving a request to a final status happens once, even if two reviewers click at the same time
async function settleRequest(tx: Prisma.TransactionClient, id: string, data: Prisma.LeaveRequestUpdateManyMutationInput): Promise<void> {
  const settled = await tx.leaveRequest.updateMany({ where: { id, status: 'PENDING' }, data });
  if (settled.count === 0) throw new AppError('This leave request has already been decided', 409);
}

async function loadReviewableRequest(id: string, viewer: Express.User) {
  const request = await prisma.leaveRequest.findFirst({ where: { id, user: { organizationId: viewer.organizationId } } });
  if (!request) throw new AppError('Request not found', 404);
  if (request.userId === viewer.userId) throw new AppError('You cannot review your own leave request', 403);
  if (request.approverId !== viewer.userId && !(await canReviewUser(viewer, request.userId))) throw new AppError('Forbidden', 403);
  if (request.status !== 'PENDING') throw new AppError('This leave request has already been decided', 409);
  return request;
}

// GET /leave — used by CalendarPage and TimesheetPage to fetch leave requests for a date range
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, startDate, endDate } = req.query;
    const isManagerRole = (MANAGER_ROLES as string[]).includes(req.user!.role);
    const reviewable = isManagerRole ? await getReviewableUserIds(req.user!) : [];

    const where: Record<string, unknown> = { user: { organizationId: req.user!.organizationId } };
    if (reviewable) where.userId = { in: [...reviewable, req.user!.userId] };
    if (status) where.status = status;
    // Date overlap filter: leave overlaps [startDate, endDate] if startDate <= endDate AND endDate >= startDate
    if (startDate && endDate) {
      where.startDate = { lte: new Date(endDate as string) };
      where.endDate = { gte: new Date(startDate as string) };
    } else if (startDate) {
      where.endDate = { gte: new Date(startDate as string) };
    } else if (endDate) {
      where.startDate = { lte: new Date(endDate as string) };
    }

    const requests = await prisma.leaveRequest.findMany({
      where,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
        approver: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ requests });
  } catch (err) {
    next(err);
  }
});

router.get('/balance', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const year = new Date().getFullYear();
    const balances = await prisma.leaveBalance.findMany({
      where: { userId: req.user!.userId, year },
    });
    res.json(balances);
  } catch (err) {
    next(err);
  }
});

// POST /api/leave/upload-doc — upload supporting document
router.post('/upload-doc', (req: AuthRequest, res: Response, next: NextFunction) => {
  documentUpload.single('file')(req, res, (err) => {
    if (err) {
      console.error('[leave-upload] multer error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError('File too large. Maximum size is 10MB.', 400));
      if (err.code === 'LIMIT_UNEXPECTED_FILE') return next(new AppError('Unexpected file field.', 400));
      return next(new AppError(err.message || 'File upload failed', 400));
    }
    if (!req.file) return next(new AppError('No file received. Please select a file to upload.', 400));
    const url = `/uploads/leave-docs/${req.file.filename}`;
    console.log(`[leave-upload] saved ${req.file.originalname} → ${url}`);
    res.json({ url, filename: req.file.originalname });
  });
});

router.get('/requests', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, from, to } = req.query;
    const reviewable = await getReviewableUserIds(req.user!);

    const where: Record<string, unknown> = { user: { organizationId: req.user!.organizationId } };
    if (reviewable) where.userId = { in: [...reviewable, req.user!.userId] };
    if (status) where.status = status;
    if (from || to) {
      where.startDate = {};
      if (from) (where.startDate as Record<string, unknown>).gte = new Date(from as string);
      if (to) (where.startDate as Record<string, unknown>).lte = new Date(to as string);
    }

    const requests = await prisma.leaveRequest.findMany({
      where,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
        approver: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(requests);
  } catch (err) {
    next(err);
  }
});

router.post('/requests', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { leaveType, startDate, endDate, reason, documentUrl, dayType } = leaveRequestSchema.parse(req.body);

    const start = new Date(startDate);
    const end = new Date(endDate);
    const rawDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const days = dayType === 'HALF_DAY' ? 0.5 : rawDays;
    const year = start.getFullYear();

    // Check leave balance if entitlement is configured
    const balance = await prisma.leaveBalance.findUnique({
      where: { userId_leaveType_year: { userId: req.user!.userId, leaveType, year } },
    });
    if (balance && balance.entitled > 0) {
      const remaining = balance.entitled - balance.used - balance.pending;
      if (days > remaining) {
        throw new AppError(`Insufficient leave balance. Available: ${remaining} day(s), Requested: ${days} day(s)`, 400);
      }
      // Reserve pending balance
      await prisma.leaveBalance.update({
        where: { userId_leaveType_year: { userId: req.user!.userId, leaveType, year } },
        data: { pending: { increment: days } },
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { managerId: true },
    });

    const request = await prisma.leaveRequest.create({
      data: {
        userId: req.user!.userId,
        leaveType,
        startDate: start,
        endDate: end,
        days,
        reason,
        documentUrl: documentUrl || null,
        approverId: user?.managerId || undefined,
        dayType: dayType || 'FULL_DAY',
      },
    });

    if (user?.managerId) {
      notificationQueue.add({
        userId: user.managerId,
        type: 'APPROVAL_REQUIRED',
        title: 'Leave Request Pending',
        message: 'A leave request needs your approval.',
        data: { leaveRequestId: request.id },
      }).catch(() => { /* non-fatal: notification queue unavailable */ });
    }

    res.status(201).json(request);
  } catch (err) {
    next(err);
  }
});

router.post('/requests/:id/approve', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { comments } = req.body;
    const request = await loadReviewableRequest(req.params.id, req.user!);

    const updated = await prisma.$transaction(async (tx) => {
      await settleRequest(tx, req.params.id, { status: 'APPROVED', approverComments: comments, approvedAt: new Date() });

      const year = request.startDate.getFullYear();
      await releasePending(tx, request);
      await tx.leaveBalance.upsert({
        where: { userId_leaveType_year: { userId: request.userId, leaveType: request.leaveType, year } },
        update: { used: { increment: request.days } },
        create: { userId: request.userId, leaveType: request.leaveType, year, entitled: 0, used: request.days },
      });

      return tx.leaveRequest.findUniqueOrThrow({ where: { id: req.params.id } });
    });

    notificationQueue.add({
      userId: request.userId,
      type: 'LEAVE_UPDATE',
      title: 'Leave Approved',
      message: 'Your leave request has been approved.',
      data: { leaveRequestId: request.id },
    }).catch(() => {});

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post('/requests/:id/reject', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { comments } = req.body;
    const request = await loadReviewableRequest(req.params.id, req.user!);

    const updated = await prisma.$transaction(async (tx) => {
      await settleRequest(tx, req.params.id, { status: 'REJECTED', approverComments: comments });
      await releasePending(tx, request);
      return tx.leaveRequest.findUniqueOrThrow({ where: { id: req.params.id } });
    });

    notificationQueue.add({
      userId: request.userId,
      type: 'LEAVE_UPDATE',
      title: 'Leave Rejected',
      message: `Your leave request was rejected: ${comments}`,
      data: { leaveRequestId: request.id },
    }).catch(() => {});

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post('/requests/:id/cancel', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const request = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
    if (!request) throw new AppError('Not found', 404);
    if (request.userId !== req.user!.userId) throw new AppError('Forbidden', 403);
    if (!['PENDING'].includes(request.status)) throw new AppError('Cannot cancel', 400);

    await prisma.$transaction(async (tx) => {
      await settleRequest(tx, req.params.id, { status: 'CANCELLED', cancelledAt: new Date() });
      await releasePending(tx, request);
    });
    res.json({ message: 'Cancelled' });
  } catch (err) {
    next(err);
  }
});

router.get('/holidays', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { year } = req.query;
    const y = year ? Number(year) : new Date().getFullYear();
    const holidays = await prisma.holiday.findMany({
      where: {
        organizationId: req.user!.organizationId,
        date: { gte: new Date(`${y}-01-01`), lte: new Date(`${y}-12-31`) },
      },
      orderBy: { date: 'asc' },
    });
    res.json(holidays);
  } catch (err) {
    next(err);
  }
});

// HR Admin: create holiday
router.post('/holidays', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, date, isOptional } = req.body;
    if (!name || !date) throw new AppError('name and date are required', 400);
    const holiday = await prisma.holiday.create({
      data: {
        organizationId: req.user!.organizationId,
        name,
        date: new Date(date),
        isOptional: !!isOptional,
      },
    });
    res.status(201).json(holiday);
  } catch (err) {
    next(err);
  }
});

// HR Admin: delete holiday
router.delete('/holidays/:id', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const holiday = await prisma.holiday.findUnique({ where: { id: req.params.id } });
    if (!holiday || holiday.organizationId !== req.user!.organizationId) throw new AppError('Not found', 404);
    await prisma.holiday.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (err) {
    next(err);
  }
});

// HR Admin: get all leave balances for the org
router.get('/balances/all', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { year } = req.query;
    const y = year ? Number(year) : new Date().getFullYear();
    const users = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId, isActive: true },
      select: { id: true, firstName: true, lastName: true, employeeId: true, department: { select: { name: true } } },
    });
    const balances = await prisma.leaveBalance.findMany({
      where: { year: y, userId: { in: users.map(u => u.id) } },
    });
    const userMap = new Map(users.map(u => [u.id, u]));
    res.json(balances.map(b => ({ ...b, user: userMap.get(b.userId) })));
  } catch (err) {
    next(err);
  }
});

// HR Admin: set/update leave balance for a user
router.put('/balances', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { userId, leaveType, year, entitled } = req.body;
    if (!userId || !leaveType || !year || entitled === undefined) throw new AppError('userId, leaveType, year, entitled are required', 400);
    const target = await prisma.user.findFirst({ where: { id: userId, organizationId: req.user!.organizationId }, select: { id: true } });
    if (!target) throw new AppError('User not found', 404);
    const balance = await prisma.leaveBalance.upsert({
      where: { userId_leaveType_year: { userId, leaveType, year: Number(year) } },
      update: { entitled: Number(entitled) },
      create: { userId, leaveType, year: Number(year), entitled: Number(entitled), used: 0 },
    });
    res.json(balance);
  } catch (err) {
    next(err);
  }
});

// HR Admin: bulk set entitlements for all active employees for a leave type + year
router.post('/balances/bulk-entitlement', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { leaveType, year, entitled } = req.body;
    if (!leaveType || !year || entitled === undefined) throw new AppError('leaveType, year, entitled are required', 400);
    const users = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId, isActive: true },
      select: { id: true },
    });
    await Promise.all(users.map(u =>
      prisma.leaveBalance.upsert({
        where: { userId_leaveType_year: { userId: u.id, leaveType, year: Number(year) } },
        update: { entitled: Number(entitled) },
        create: { userId: u.id, leaveType, year: Number(year), entitled: Number(entitled), used: 0, pending: 0 },
      })
    ));
    res.json({ message: `Entitlement set for ${users.length} employees` });
  } catch (err) {
    next(err);
  }
});

// HR Admin: delete leave balance record
router.delete('/balances/:id', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const balance = await prisma.leaveBalance.findUnique({ where: { id: req.params.id } });
    const owner = balance && await prisma.user.findFirst({ where: { id: balance.userId, organizationId: req.user!.organizationId }, select: { id: true } });
    if (!owner) throw new AppError('Not found', 404);
    await prisma.leaveBalance.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
