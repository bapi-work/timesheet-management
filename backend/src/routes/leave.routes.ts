import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import * as XLSX from 'xlsx';
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

    const userId = req.user!.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { managerId: true },
    });

    const request = await prisma.$transaction(async (tx) => {
      // One request per person at a time, so two submitted together can't both pass the checks
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'leave:' + userId}))`;

      const overlapping = await tx.leaveRequest.findMany({
        where: { userId, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: end }, endDate: { gte: start } },
        orderBy: { startDate: 'asc' },
      });
      // Two half days can make up one date
      const otherHalf = dayType === 'HALF_DAY' && overlapping.length === 1 && overlapping[0].dayType === 'HALF_DAY';
      if (overlapping.length > 0 && !otherHalf) {
        const o = overlapping[0];
        const [first, last] = [o.startDate, o.endDate].map(d => d.toISOString().slice(0, 10));
        throw new AppError(`This overlaps your ${o.status.toLowerCase()} ${o.leaveType.toLowerCase()} leave (${first === last ? first : `${first} to ${last}`})`, 409);
      }

      // Unpaid leave only draws on a balance if HR has set one
      const where = { userId_leaveType_year: { userId, leaveType, year } };
      const balance = await tx.leaveBalance.findUnique({ where });
      if (leaveType !== 'UNPAID' || (balance && balance.entitled > 0)) {
        const remaining = balance ? Math.max(0, balance.entitled - balance.used - balance.pending) : 0;
        if (!balance || days > remaining) {
          throw new AppError(`Insufficient leave balance. Available: ${remaining} day(s), Requested: ${days} day(s)`, 400);
        }
        // Reserve pending balance
        await tx.leaveBalance.update({ where, data: { pending: { increment: days } } });
      }

      return tx.leaveRequest.create({
        data: {
          userId,
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

// ─── Leave balance spreadsheet ────────────────────────────────────────────────
// One row per employee and one column per leave type, holding the days they're entitled to that year

const BALANCE_COLUMNS: { type: LeaveType; label: string }[] = [
  { type: 'ANNUAL', label: 'Annual' },
  { type: 'SICK', label: 'Sick' },
  { type: 'MATERNITY', label: 'Maternity' },
  { type: 'PATERNITY', label: 'Paternity' },
  { type: 'UNPAID', label: 'Unpaid' },
  { type: 'COMPENSATORY', label: 'Compensatory' },
  { type: 'OTHER', label: 'Other' },
];

const balanceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['.xlsx', '.xls', '.csv'].includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Upload the template as .xlsx, .xls or .csv'));
  },
});

// Accepts the template's headers, the stored names (ANNUAL) and stray spaces or case
const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '');

// GET /api/leave/balances/template?year=2026 — every employee with their current entitlements
router.get('/balances/template', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new AppError('Invalid year', 400);
    const users = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId, isActive: true, role: { not: 'SYSTEM_ADMIN' } },
      select: { id: true, employeeId: true, email: true, firstName: true, lastName: true, department: { select: { name: true } } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    const balances = await prisma.leaveBalance.findMany({ where: { year, userId: { in: users.map(u => u.id) } } });
    const entitled = new Map(balances.map(b => [`${b.userId}:${b.leaveType}`, b.entitled]));

    const rows = users.map(u => ({
      'Employee ID': u.employeeId || '',
      'Email': u.email,
      'Name': `${u.firstName} ${u.lastName}`.trim(),
      'Department': u.department?.name || '',
      'Year': year,
      ...Object.fromEntries(BALANCE_COLUMNS.map(c => [c.label, entitled.get(`${u.id}:${c.type}`) ?? null])),
    }));
    const headers = ['Employee ID', 'Email', 'Name', 'Department', 'Year', ...BALANCE_COLUMNS.map(c => c.label)];
    const sheet = XLSX.utils.json_to_sheet(rows, { header: headers });
    sheet['!cols'] = headers.map(h => ({ wch: ['Email', 'Name'].includes(h) ? 28 : 14 }));

    const help = XLSX.utils.aoa_to_sheet([
      ['How to fill in this sheet'],
      ['Enter the number of days each employee is entitled to for the year, under each leave type.'],
      ['Half days are allowed, for example 1.5. Use whole or half days only, from 0 to 366.'],
      ['Leave a cell empty to keep that balance as it is. Enter 0 to give no days of that type.'],
      ['Employees are matched by Email, or by Employee ID when Email is empty. Name and Department are not read.'],
      ['Days already taken or awaiting approval are kept. A number lower than those days is refused.'],
      ['Unpaid leave can be requested without a balance. Every other type needs one.'],
      ['Nothing is saved if any row has a mistake; the upload lists every row to correct.'],
    ]);
    help['!cols'] = [{ wch: 100 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Leave Balances');
    XLSX.utils.book_append_sheet(wb, help, 'Instructions');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="leave-balances-${year}.xlsx"`);
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

// POST /api/leave/balances/upload — sets entitlements from the template. All rows are saved, or none.
router.post('/balances/upload', authorize(...ADMIN_ROLES), (req: AuthRequest, res: Response, next: NextFunction) => {
  balanceUpload.single('file')(req, res, async (uploadErr: unknown) => {
    try {
      if (uploadErr) throw new AppError((uploadErr as Error).message || 'File upload failed', 400);
      if (!req.file) throw new AppError('Choose a file to upload', 400);

      let rows: Record<string, unknown>[];
      try {
        const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
        const ws = wb.Sheets['Leave Balances'] || wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      } catch {
        throw new AppError('This file could not be read. Download the template and fill that in.', 400);
      }
      if (rows.length === 0) throw new AppError('The file has no rows', 400);
      if (rows.length > 5000) throw new AppError('Upload at most 5000 rows at a time', 400);

      // Which column holds what, whatever case or spacing the headers have
      const headers = Object.keys(rows[0]);
      const find = (...names: string[]) => headers.find(h => names.includes(headerKey(h)));
      const emailCol = find('email', 'emailaddress');
      const idCol = find('employeeid', 'empid', 'employeecode');
      const yearCol = find('year');
      const typeCols = BALANCE_COLUMNS
        .map(c => ({ ...c, header: find(headerKey(c.label), headerKey(c.type), `${headerKey(c.label)}leave`) }))
        .filter((c): c is typeof c & { header: string } => !!c.header);
      if (!emailCol && !idCol) throw new AppError('The file needs an Email or Employee ID column', 400);
      if (typeCols.length === 0) throw new AppError(`The file needs at least one leave type column: ${BALANCE_COLUMNS.map(c => c.label).join(', ')}`, 400);

      const users = await prisma.user.findMany({
        where: { organizationId: req.user!.organizationId },
        select: { id: true, email: true, employeeId: true, firstName: true, lastName: true },
      });
      const byEmail = new Map(users.map(u => [u.email.toLowerCase(), u]));
      const byEmployeeId = new Map(users.filter(u => u.employeeId).map(u => [u.employeeId!.trim().toLowerCase(), u]));
      const defaultYear = Number(req.body?.year) || new Date().getFullYear();

      const errors: string[] = [];
      const updates: { userId: string; leaveType: LeaveType; year: number; entitled: number }[] = [];
      const seen = new Map<string, number>();
      let skipped = 0;

      rows.forEach((row, i) => {
        const line = i + 2; // the header is row 1
        const text = (col?: string) => (col ? String(row[col] ?? '').trim() : '');
        const email = text(emailCol);
        const employeeId = text(idCol);
        const cells = typeCols.map(c => ({ ...c, raw: text(c.header) })).filter(c => c.raw !== '');
        if (!email && !employeeId) {
          if (cells.length > 0) errors.push(`Row ${line}: enter the employee's Email or Employee ID`);
          else skipped++;
          return;
        }
        const user = (email && byEmail.get(email.toLowerCase())) || (!email && employeeId ? byEmployeeId.get(employeeId.toLowerCase()) : undefined);
        if (!user) {
          errors.push(`Row ${line}: no employee with ${email ? `email ${email}` : `Employee ID ${employeeId}`}`);
          return;
        }
        const yearText = text(yearCol);
        const year = yearText === '' ? defaultYear : Number(yearText);
        if (!Number.isInteger(year) || year < 2000 || year > 2100) {
          errors.push(`Row ${line}: "${yearText}" is not a valid year`);
          return;
        }
        const key = `${user.id}:${year}`;
        if (seen.has(key)) {
          errors.push(`Row ${line}: ${user.email} for ${year} is already on row ${seen.get(key)}`);
          return;
        }
        seen.set(key, line);
        if (cells.length === 0) { skipped++; return; }

        for (const c of cells) {
          const days = Number(c.raw);
          if (!Number.isFinite(days) || days < 0 || days > 366 || !Number.isInteger(days * 2)) {
            errors.push(`Row ${line}: ${c.label} must be a number of whole or half days from 0 to 366, not "${c.raw}"`);
          } else {
            updates.push({ userId: user.id, leaveType: c.type, year, entitled: days });
          }
        }
      });

      // A balance can't drop below what has already been taken or requested
      if (updates.length > 0) {
        const existing = await prisma.leaveBalance.findMany({
          where: { userId: { in: [...new Set(updates.map(u => u.userId))] }, year: { in: [...new Set(updates.map(u => u.year))] } },
        });
        const current = new Map(existing.map(b => [`${b.userId}:${b.leaveType}:${b.year}`, b]));
        for (const u of updates) {
          const b = current.get(`${u.userId}:${u.leaveType}:${u.year}`);
          if (b && u.entitled < b.used + b.pending) {
            const label = BALANCE_COLUMNS.find(c => c.type === u.leaveType)!.label;
            errors.push(`Row ${seen.get(`${u.userId}:${u.year}`)}: ${label} cannot be ${u.entitled}; ${b.used + b.pending} day(s) are already taken or awaiting approval`);
          }
        }
      }

      if (errors.length > 0) {
        res.status(400).json({
          message: `Nothing was saved. Correct ${errors.length === 1 ? 'this row' : `these ${errors.length} problems`} and upload again.`,
          errors: errors.slice(0, 100),
          moreErrors: Math.max(0, errors.length - 100),
        });
        return;
      }
      if (updates.length === 0) throw new AppError('The file has no balances to save. Enter days under the leave type columns.', 400);

      await prisma.$transaction(updates.map(u => prisma.leaveBalance.upsert({
        where: { userId_leaveType_year: { userId: u.userId, leaveType: u.leaveType, year: u.year } },
        update: { entitled: u.entitled },
        create: { ...u, used: 0, pending: 0 },
      })));

      const employees = new Set(updates.map(u => u.userId)).size;
      res.json({
        message: `Saved ${updates.length} balance${updates.length === 1 ? '' : 's'} for ${employees} employee${employees === 1 ? '' : 's'}`,
        employees,
        balances: updates.length,
        skipped,
      });
    } catch (err) {
      next(err);
    }
  });
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
