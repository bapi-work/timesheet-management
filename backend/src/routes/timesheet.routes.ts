import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { addDays, format } from 'date-fns';
import multer from 'multer';
import * as XLSX from 'xlsx';
import prisma from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { emailQueue, notificationQueue } from '../services/queue.service';
import { approvalPendingTemplate } from '../services/email.service';
import { canReviewUser, getReviewableUserIds } from '../utils/access';
import {
  assertDatesEditable, assertEntryLinksInOrg, assertNotFuture, assertPeriodCurrent, assertWithinPeriod, clearEmptyDays, dayKey, displayStatus,
  DISPLAY_STATUS_SELECT, EMPTY_DRAFT, getOrCreateTimesheet, loadEditState, parseDay, recalcTotals, reopenForEdit, resolvePeriod,
  todayFor, utcDay,
} from '../utils/timesheet-rules';
import { Prisma, TimesheetStatus } from '@prisma/client';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();
router.use(authenticate);

const entrySchema = z.object({
  date: z.string(),
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  description: z.string().trim().min(1, 'Description is required').max(2000),
  category: z.string().optional(),
  hours: z.number().min(0.25, 'Minimum 0.25 hours').max(24, 'Maximum 24 hours per day'),
  isBillable: z.boolean().optional(),
  entryType: z.enum(['REGULAR', 'OVERTIME', 'COMP_OFF', 'ON_CALL']).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  breakMinutes: z.number().optional(),
});

const todayOf = (req: AuthRequest) => todayFor(req.user!.organizationId, req.get('x-timezone'));

// The hours shouldn't be under review while a timer on that day is still counting
async function assertNoRunningTimer(timesheetId: string, day?: Date): Promise<void> {
  const running = await prisma.timesheetEntry.findFirst({
    where: {
      timesheetId, startTime: { not: null }, endTime: null,
      ...(day ? { date: { gte: day, lt: addDays(day, 1) } } : {}),
    },
    select: { id: true },
  });
  if (running) throw new AppError('Stop the running timer before submitting', 400);
}

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { userId, status, from, to, startDate, endDate, page = '1', limit = '20', teamId, departmentId, mine } = req.query;
    const fromDate = (from || startDate) as string | undefined;
    const toDate = (to || endDate) as string | undefined;
    const skip = (Number(page) - 1) * Number(limit);

    const isAdmin = ['SYSTEM_ADMIN', 'HR_ADMIN'].includes(req.user!.role);
    const isManager = ['DEPARTMENT_MANAGER', 'PROJECT_MANAGER', 'TEAM_LEAD'].includes(req.user!.role);

    const where: Record<string, unknown> = { NOT: EMPTY_DRAFT };
    const ownOnly = mine === 'true' || (!isAdmin && !isManager);

    if (ownOnly) {
      where.userId = req.user!.userId;
    } else {
      const reviewable = await getReviewableUserIds(req.user!);
      where.user = {
        organizationId: req.user!.organizationId,
        ...(teamId ? { teamMemberships: { some: { teamId: String(teamId) } } } : {}),
        ...(departmentId ? { departmentId: String(departmentId) } : {}),
      };
      if (userId) {
        const uid = String(userId);
        where.userId = !reviewable || reviewable.includes(uid) ? uid : { in: [] };
      } else if (reviewable) {
        where.userId = { in: reviewable };
      }
    }
    // The stored status doesn't reflect day submissions, so it only narrows down the candidates
    const maybeByDays: Prisma.TimesheetWhereInput = { status: { in: ['DRAFT', 'SUBMITTED', 'REJECTED'] }, daySubmissions: { some: {} } };
    let matches: ((shown: string) => boolean) | null = null;
    if (status === 'DRAFT') {
      where.status = { in: ['DRAFT', 'SUBMITTED', 'REJECTED'] };
      matches = shown => shown === 'DRAFT';
    } else if (status) {
      where.OR = [{ status: status as TimesheetStatus }, maybeByDays];
      matches = shown => shown === status || (status === 'SUBMITTED' && shown === 'IN_REVIEW');
    } else if (!ownOnly) {
      // Admins/managers don't need to see employee drafts by default
      where.OR = [{ status: { not: 'DRAFT' } }, maybeByDays];
      matches = shown => shown !== 'DRAFT';
    }
    if (fromDate || toDate) {
      where.periodStart = {};
      if (fromDate) (where.periodStart as Record<string, unknown>).gte = new Date(fromDate);
      if (toDate) (where.periodStart as Record<string, unknown>).lte = new Date(toDate);
    }

    let pageWhere: Prisma.TimesheetWhereInput = where;
    let total: number;
    if (matches) {
      const candidates = await prisma.timesheet.findMany({ where, orderBy: { periodStart: 'desc' }, select: { id: true, ...DISPLAY_STATUS_SELECT } });
      const ids = candidates.filter(c => matches!(displayStatus(c))).map(c => c.id);
      total = ids.length;
      pageWhere = { id: { in: ids.slice(skip, skip + Number(limit)) } };
    } else {
      total = await prisma.timesheet.count({ where });
    }

    const timesheets = await prisma.timesheet.findMany({
        where: pageWhere,
        ...(matches ? {} : { skip, take: Number(limit) }),
        orderBy: { periodStart: 'desc' },
        include: {
          entries: {
            include: {
              project: { select: { id: true, name: true, code: true } },
              task: { select: { id: true, name: true } },
            },
          },
          approvals: {
            include: { approver: { select: { id: true, firstName: true, lastName: true } } },
            orderBy: { level: 'asc' },
          },
          daySubmissions: { orderBy: { date: 'asc' } },
          user: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
        },
    });

    res.json({
      timesheets: timesheets.map(t => ({ ...t, displayStatus: displayStatus(t) })),
      total, page: Number(page), limit: Number(limit),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/current', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Allow clients to request any specific week by passing ?week=YYYY-MM-DD
    const base = req.query.week ? parseDay(req.query.week) : await todayOf(req);
    const { timesheetId, periodStart, periodEnd } = await resolvePeriod(prisma, req.user!.userId, req.user!.organizationId, base);

    const timesheet = timesheetId && await prisma.timesheet.findUnique({
      where: { id: timesheetId },
      include: {
        entries: {
          include: {
            project: { select: { id: true, name: true, code: true } },
            task: { select: { id: true, name: true } },
          },
          orderBy: { date: 'asc' },
        },
        approvals: { include: { approver: { select: { id: true, firstName: true, lastName: true } } } },
        daySubmissions: { orderBy: { date: 'asc' } },
      },
    });

    // Looking at a week doesn't create a timesheet; POST / does, when the first entry is added
    res.json(timesheet
      ? { ...timesheet, displayStatus: displayStatus(timesheet) }
      : {
          id: null, userId: req.user!.userId, periodStart, periodEnd, status: 'DRAFT', displayStatus: 'DRAFT',
          totalHours: 0, billableHours: 0, overtimeHours: 0, entries: [], approvals: [], daySubmissions: [],
        });
  } catch (err) {
    next(err);
  }
});

// ─── Download upload template (must be before /:id) ──────────────────────────
router.get('/upload-template', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const wb = XLSX.utils.book_new();
    const templateData = [
      { Date: '2024-01-15', 'Project Code': 'PROJ-001', 'Task Name': 'Frontend', Category: 'Software Development', Description: 'Feature development', Hours: 8, Billable: 'Y', 'Entry Type': 'REGULAR' },
      { Date: '2024-01-16', 'Project Code': 'PROJ-001', 'Task Name': '',         Category: 'Project Management',   Description: 'Code review',          Hours: 2, Billable: 'Y', 'Entry Type': 'REGULAR' },
      { Date: '2024-01-16', 'Project Code': '',          'Task Name': '',         Category: 'Self Development',     Description: 'Team meeting',          Hours: 1, Billable: 'N', 'Entry Type': 'REGULAR' },
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    ws['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 22 }, { wch: 30 }, { wch: 8 }, { wch: 10 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Timesheet Upload');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="timesheet-template.xlsx"');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

// Work categories — must be before /:id to avoid the wildcard catching it
router.get('/work-categories', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const categories = await prisma.workCategory.findMany({
      where: { organizationId: req.user!.organizationId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
    });
    res.json(categories);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const timesheet = await prisma.timesheet.findUnique({
      where: { id: req.params.id },
      include: {
        entries: {
          include: {
            project: { select: { id: true, name: true, code: true } },
            task: { select: { id: true, name: true } },
          },
          orderBy: { date: 'asc' },
        },
        approvals: {
          include: { approver: { select: { id: true, firstName: true, lastName: true, email: true } } },
          orderBy: { level: 'asc' },
        },
        daySubmissions: { orderBy: { date: 'asc' } },
        user: { select: { id: true, firstName: true, lastName: true, employeeId: true, managerId: true } },
      },
    });
    if (!timesheet) throw new AppError('Timesheet not found', 404);
    const canView = timesheet.userId === req.user!.userId
      || timesheet.approvals.some(a => a.approverId === req.user!.userId)
      || await canReviewUser(req.user!, timesheet.userId);
    if (!canView) throw new AppError('Forbidden', 403);
    res.json({ ...timesheet, displayStatus: displayStatus(timesheet) });
  } catch (err) {
    next(err);
  }
});

// The timesheet for the week containing a date, created if it doesn't exist yet
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const date = parseDay(req.body.date);
    assertNotFuture([date], await todayOf(req));
    const timesheet = await getOrCreateTimesheet(prisma, req.user!.userId, req.user!.organizationId, date);
    res.status(201).json(timesheet);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/entries', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const timesheet = await prisma.timesheet.findUnique({ where: { id: req.params.id } });
    if (!timesheet) throw new AppError('Timesheet not found', 404);
    if (timesheet.userId !== req.user!.userId) throw new AppError('Forbidden', 403);

    await assertPeriodCurrent(prisma, timesheet, req.user!.organizationId);
    const entries = Array.isArray(req.body) ? req.body : [req.body];
    if (entries.length > 200) throw new AppError('Too many entries in one request', 400);
    const validated = entries.map(e => entrySchema.parse(e));
    for (const e of validated) await assertEntryLinksInOrg(req.user!.organizationId, e.projectId, e.taskId);
    const dates = validated.map(e => new Date(e.date));
    dates.forEach(d => assertWithinPeriod(timesheet, d));
    assertNotFuture(dates, await todayOf(req));
    await assertDatesEditable(prisma, timesheet, dates);

    const created = await prisma.$transaction(async (tx) => {
      await clearEmptyDays(tx, timesheet.id);
      await reopenForEdit(tx, timesheet);

      const newEntries = await Promise.all(
        validated.map(e => tx.timesheetEntry.create({
          data: {
            timesheetId: req.params.id,
            date: new Date(e.date),
            projectId: e.projectId,
            taskId: e.taskId,
            description: e.description,
            category: e.category,
            hours: e.hours,
            isBillable: e.isBillable ?? true,
            entryType: e.entryType ?? 'REGULAR',
            startTime: e.startTime ? new Date(e.startTime) : undefined,
            endTime: e.endTime ? new Date(e.endTime) : undefined,
            breakMinutes: e.breakMinutes ?? 0,
          },
          include: { project: { select: { id: true, name: true } }, task: { select: { id: true, name: true } } },
        }))
      );

      await recalcTotals(tx, req.params.id);
      return newEntries;
    });

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.put('/:id/entries/:entryId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const timesheet = await prisma.timesheet.findUnique({ where: { id: req.params.id } });
    if (!timesheet || timesheet.userId !== req.user!.userId) throw new AppError('Forbidden', 404);

    const existing = await prisma.timesheetEntry.findFirst({ where: { id: req.params.entryId, timesheetId: req.params.id } });
    if (!existing) throw new AppError('Entry not found', 404);

    const data = entrySchema.partial().parse(req.body);
    await assertEntryLinksInOrg(req.user!.organizationId, data.projectId, data.taskId);
    const dates = [existing.date, ...(data.date ? [new Date(data.date)] : [])];
    if (data.date) {
      assertWithinPeriod(timesheet, new Date(data.date));
      assertNotFuture([new Date(data.date)], await todayOf(req));
    }
    await assertDatesEditable(prisma, timesheet, dates);

    const entry = await prisma.$transaction(async (tx) => {
      await reopenForEdit(tx, timesheet);
      const updated = await tx.timesheetEntry.update({
        where: { id: req.params.entryId, timesheetId: req.params.id },
        data: {
          ...data,
          date: data.date ? new Date(data.date) : undefined,
        },
        include: { project: true, task: true },
      });
      await clearEmptyDays(tx, req.params.id);
      await recalcTotals(tx, req.params.id);
      return updated;
    });

    res.json(entry);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/entries/:entryId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const timesheet = await prisma.timesheet.findUnique({ where: { id: req.params.id } });
    if (!timesheet || timesheet.userId !== req.user!.userId) throw new AppError('Forbidden', 403);

    // findFirst with timesheetId scope prevents cross-timesheet entry deletion
    const entry = await prisma.timesheetEntry.findFirst({ where: { id: req.params.entryId, timesheetId: req.params.id } });
    if (!entry) throw new AppError('Entry not found', 404);
    await assertDatesEditable(prisma, timesheet, [entry.date]);

    await prisma.$transaction(async (tx) => {
      await reopenForEdit(tx, timesheet);
      await tx.timesheetEntry.delete({ where: { id: req.params.entryId } });
      await clearEmptyDays(tx, req.params.id);
      await recalcTotals(tx, req.params.id);
    });

    res.json({ message: 'Entry deleted' });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/submit', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const timesheet = await prisma.timesheet.findUnique({
      where: { id: req.params.id },
      include: { user: { include: { manager: true } }, entries: { select: { date: true } }, approvals: { select: { status: true } } },
    });
    if (!timesheet) throw new AppError('Not found', 404);
    if (timesheet.userId !== req.user!.userId) throw new AppError('Forbidden', 403);
    // SUBMITTED without a pending approval only means that some days were submitted
    const submittable = ['DRAFT', 'REJECTED'].includes(timesheet.status)
      || (timesheet.status === 'SUBMITTED' && !timesheet.approvals.some(a => a.status === 'PENDING'));
    if (!submittable) throw new AppError('Cannot submit', 400);
    assertNotFuture(timesheet.entries.map(e => e.date), await todayOf(req));
    await assertNoRunningTimer(timesheet.id);

    // Collect all approvers: direct manager + team leads + HR admins
    const approverIds = new Set<string>();
    const approverMap: { id: string; email: string; firstName: string; level: number }[] = [];

    // Level 1: Direct manager
    const manager = timesheet.user.manager;
    if (manager && manager.id !== timesheet.userId) {
      approverIds.add(manager.id);
      approverMap.push({ id: manager.id, email: manager.email, firstName: manager.firstName, level: 1 });
    }

    // Level 2: Team leads of the employee's teams
    const teams = await prisma.team.findMany({
      where: { members: { some: { userId: timesheet.userId } } },
      include: { lead: { select: { id: true, email: true, firstName: true } } },
    });
    for (const team of teams) {
      if (team.lead && team.lead.id !== timesheet.userId && !approverIds.has(team.lead.id)) {
        approverIds.add(team.lead.id);
        approverMap.push({ id: team.lead.id, email: team.lead.email, firstName: team.lead.firstName, level: 2 });
      }
    }

    // Level 3: HR Admins in the same org
    const hrAdmins = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId, role: 'HR_ADMIN', isActive: true },
      select: { id: true, email: true, firstName: true },
    });
    for (const hr of hrAdmins) {
      if (hr.id !== timesheet.userId && !approverIds.has(hr.id)) {
        approverIds.add(hr.id);
        approverMap.push({ id: hr.id, email: hr.email, firstName: hr.firstName, level: 3 });
      }
    }

    // Nobody above them (for example the only HR admin): route to a System Admin
    if (approverMap.length === 0) {
      const sysAdmins = await prisma.user.findMany({
        where: { organizationId: req.user!.organizationId, role: 'SYSTEM_ADMIN', isActive: true, id: { not: timesheet.userId } },
        select: { id: true, email: true, firstName: true },
      });
      sysAdmins.forEach(a => approverMap.push({ ...a, level: 3 }));
    }
    if (approverMap.length === 0) throw new AppError('No one is available to approve this timesheet', 400);

    const updated = await prisma.$transaction(async (tx) => {
      const ts = await tx.timesheet.update({
        where: { id: req.params.id },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      });

      const period = `${format(timesheet.periodStart, 'MMM d')} - ${format(timesheet.periodEnd, 'MMM d, yyyy')}`;
      const employeeName = `${timesheet.user.firstName} ${timesheet.user.lastName}`;

      for (const approver of approverMap) {
        const existing = await tx.timesheetApproval.findFirst({
          where: { timesheetId: ts.id, approverId: approver.id },
        });
        if (existing) {
          // Reset to PENDING so it shows up in the approvals queue again
          await tx.timesheetApproval.update({
            where: { id: existing.id },
            data: { status: 'PENDING', comments: null, actionAt: null, dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) },
          });
          continue;
        }

        await tx.timesheetApproval.create({
          data: {
            timesheetId: ts.id,
            approverId: approver.id,
            level: approver.level,
            status: 'PENDING',
            dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          },
        });

        await emailQueue.add({
          to: approver.email,
          subject: `Timesheet Submitted: ${employeeName}`,
          html: approvalPendingTemplate(approver.firstName, employeeName),
        });

        await notificationQueue.add({
          userId: approver.id,
          type: 'APPROVAL_REQUIRED',
          title: 'Timesheet Pending Approval',
          message: `${employeeName}'s timesheet for ${period} needs your review.`,
          data: { timesheetId: ts.id },
        });
      }

      return ts;
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Takes a submitted week back so it can be changed
router.post('/:id/withdraw', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const timesheet = await prisma.timesheet.findUnique({ where: { id: req.params.id } });
    if (!timesheet) throw new AppError('Timesheet not found', 404);
    if (timesheet.userId !== req.user!.userId) throw new AppError('Forbidden', 403);

    await prisma.$transaction(async (tx) => {
      const withdrawn = await tx.timesheet.updateMany({
        where: { id: timesheet.id, status: 'SUBMITTED', approvals: { some: { status: 'PENDING' } } },
        data: { status: 'DRAFT', submittedAt: null },
      });
      if (withdrawn.count === 0) throw new AppError('Only a timesheet awaiting approval can be withdrawn', 409);
      await tx.timesheetApproval.deleteMany({ where: { timesheetId: timesheet.id, status: 'PENDING' } });
    });
    res.json({ message: 'Timesheet withdrawn' });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const timesheet = await prisma.timesheet.findUnique({ where: { id: req.params.id } });
    if (!timesheet) throw new AppError('Timesheet not found', 404);
    if (timesheet.userId !== req.user!.userId) throw new AppError('Forbidden', 403);
    if (timesheet.status !== 'DRAFT') throw new AppError('Only draft timesheets can be deleted', 400);
    await prisma.$transaction([
      prisma.timesheetEntry.deleteMany({ where: { timesheetId: req.params.id } }),
      prisma.daySubmission.deleteMany({ where: { timesheetId: req.params.id } }),
      prisma.timesheetApproval.deleteMany({ where: { timesheetId: req.params.id } }),
      prisma.timesheet.delete({ where: { id: req.params.id } }),
    ]);
    res.json({ message: 'Timesheet deleted' });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/copy-previous', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const timesheet = await prisma.timesheet.findUnique({ where: { id: req.params.id } });
    if (!timesheet || timesheet.userId !== req.user!.userId) throw new AppError('Forbidden', 403);

    await assertPeriodCurrent(prisma, timesheet, req.user!.organizationId);
    const previous = await prisma.timesheetEntry.findMany({
      where: {
        timesheet: { userId: req.user!.userId },
        date: { gte: addDays(timesheet.periodStart, -7), lte: addDays(timesheet.periodEnd, -7) },
      },
    });
    if (previous.length === 0) throw new AppError('No entries found in the previous week', 404);

    // Days that are still to come, or already submitted or approved, are left alone
    await assertDatesEditable(prisma, timesheet, []);
    const state = await loadEditState(prisma, timesheet.id);
    const today = dayKey(await todayOf(req));
    const toCopy = previous.filter(e => {
      const target = dayKey(addDays(e.date, 7));
      return target <= today && !state.approvedDays.has(target) && !state.pendingDays.has(target);
    });
    if (toCopy.length === 0) throw new AppError('Nothing to copy: the matching days are in the future, submitted or approved', 400);

    const created = await prisma.$transaction(async (tx) => {
      await clearEmptyDays(tx, timesheet.id);
      await reopenForEdit(tx, timesheet);
      const copies = await Promise.all(
        toCopy.map(e => tx.timesheetEntry.create({
          data: {
            timesheetId: timesheet.id,
            date: addDays(e.date, 7),
            projectId: e.projectId,
            taskId: e.taskId,
            description: e.description,
            category: e.category,
            hours: e.hours,
            isBillable: e.isBillable,
            entryType: e.entryType,
            breakMinutes: e.breakMinutes,
          },
        }))
      );
      await recalcTotals(tx, timesheet.id);
      return copies;
    });

    res.json(created);
  } catch (err) {
    next(err);
  }
});

// ─── Per-day submit ───────────────────────────────────────────────────────────
router.post('/:id/days/:date/submit', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const timesheet = await prisma.timesheet.findUnique({
      where: { id: req.params.id },
      include: { user: { include: { manager: true } } },
    });
    if (!timesheet) throw new AppError('Timesheet not found', 404);
    if (timesheet.userId !== req.user!.userId) throw new AppError('Forbidden', 403);
    const date = parseDay(req.params.date);
    assertWithinPeriod(timesheet, date);
    assertNotFuture([date], await todayOf(req));
    await assertDatesEditable(prisma, timesheet, [date]);
    const logged = await prisma.timesheetEntry.count({ where: { timesheetId: timesheet.id, date: { gte: date, lt: addDays(date, 1) } } });
    if (logged === 0) throw new AppError('There are no entries to submit for this day', 400);
    await assertNoRunningTimer(timesheet.id, date);

    // Upsert DaySubmission
    const existing = await prisma.daySubmission.findUnique({
      where: { timesheetId_date: { timesheetId: req.params.id, date } },
    });

    let daySubmission;
    if (existing) {
      daySubmission = await prisma.daySubmission.update({
        where: { id: existing.id },
        data: { status: 'SUBMITTED', submittedAt: new Date(), reviewedAt: null, reviewedById: null, comments: null },
      });
    } else {
      daySubmission = await prisma.daySubmission.create({
        data: { timesheetId: req.params.id, date, status: 'SUBMITTED' },
      });
    }

    const dateLabel = format(date, 'MMM d, yyyy');
    const employeeName = `${timesheet.user.firstName} ${timesheet.user.lastName}`;

    // Notify manager / team leads / HR
    const approverIds = new Set<string>();
    if (timesheet.user.manager) {
      approverIds.add(timesheet.user.manager.id);
      await notificationQueue.add({
        userId: timesheet.user.manager.id,
        type: 'APPROVAL_REQUIRED',
        title: 'Day Timesheet Pending Approval',
        message: `${employeeName}'s timesheet for ${dateLabel} needs your review.`,
        data: { timesheetId: req.params.id, daySubmissionId: daySubmission.id },
      });
    }

    const teams = await prisma.team.findMany({
      where: { members: { some: { userId: timesheet.userId } } },
      include: { lead: { select: { id: true } } },
    });
    for (const team of teams) {
      if (team.lead && !approverIds.has(team.lead.id)) {
        approverIds.add(team.lead.id);
        await notificationQueue.add({
          userId: team.lead.id,
          type: 'APPROVAL_REQUIRED',
          title: 'Day Timesheet Pending Approval',
          message: `${employeeName}'s timesheet for ${dateLabel} needs your review.`,
          data: { timesheetId: req.params.id, daySubmissionId: daySubmission.id },
        });
      }
    }

    res.json(daySubmission);
  } catch (err) {
    next(err);
  }
});

// ─── Per-day withdraw ─────────────────────────────────────────────────────────
router.post('/:id/days/:date/withdraw', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const timesheet = await prisma.timesheet.findUnique({ where: { id: req.params.id } });
    if (!timesheet) throw new AppError('Timesheet not found', 404);
    if (timesheet.userId !== req.user!.userId) throw new AppError('Forbidden', 403);

    const date = parseDay(req.params.date);
    const existing = await prisma.daySubmission.findUnique({
      where: { timesheetId_date: { timesheetId: req.params.id, date } },
    });
    if (!existing) throw new AppError('No submission found for this day', 404);
    if (existing.status !== 'SUBMITTED') throw new AppError('Only a day awaiting approval can be withdrawn', 409);

    const updated = await prisma.daySubmission.update({
      where: { id: existing.id },
      data: { status: 'WITHDRAWN' },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ─── Bulk upload ──────────────────────────────────────────────────────────────
router.post('/upload', upload.single('file'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) throw new AppError('No file uploaded', 400);

    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

    if (!rows.length) throw new AppError('File is empty or has no data rows', 400);

    // Normalise header keys to lowercase without spaces
    const normalised = rows.map(row => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) out[k.toLowerCase().replace(/\s+/g, '')] = v;
      return out;
    });

    const today = await todayOf(req);

    const projects = await prisma.project.findMany({
      where: { organizationId: req.user!.organizationId },
      select: { id: true, code: true, name: true, billable: true, tasks: { select: { id: true, name: true, isBillable: true } } },
    });

    const errors: string[] = [];
    const validRows: z.infer<typeof entrySchema>[] = [];

    for (let i = 0; i < normalised.length; i++) {
      const row = normalised[i];
      const rowNum = i + 2; // spreadsheet row (1=header)

      // Parse date
      let date: Date;
      const rawDate = row['date'] || row['date(yyyy-mm-dd)'];
      if (!rawDate) { errors.push(`Row ${rowNum}: Missing date`); continue; }
      if (rawDate instanceof Date) {
        date = rawDate;
      } else {
        date = new Date(rawDate as string);
      }
      if (isNaN(date.getTime())) { errors.push(`Row ${rowNum}: Invalid date "${rawDate}"`); continue; }
      const entryDay = utcDay(date);
      if (entryDay > today) { errors.push(`Row ${rowNum}: Date is in the future`); continue; }

      // Parse hours
      const hoursRaw = row['hours'];
      const hours = parseFloat(String(hoursRaw));
      if (isNaN(hours) || hours <= 0 || hours > 24) { errors.push(`Row ${rowNum}: Invalid hours "${hoursRaw}"`); continue; }

      // Match project by code or name (optional)
      let projectId: string | undefined;
      const projectRaw = String(row['projectcode'] || row['project'] || '').trim();
      if (projectRaw) {
        const found = projects.find(
          p => p.code?.toLowerCase() === projectRaw.toLowerCase() || p.name?.toLowerCase() === projectRaw.toLowerCase()
        );
        if (!found) { errors.push(`Row ${rowNum}: Project "${projectRaw}" not found`); continue; }
        projectId = found.id;
      }

      // Match task by name within the project (optional)
      let taskId: string | undefined;
      let taskBillable: boolean | undefined;
      const taskRaw = String(row['taskname'] || row['task'] || '').trim();
      if (taskRaw && projectId) {
        const proj = projects.find(p => p.id === projectId);
        const tasks = proj?.tasks || [];
        const foundTask = tasks.find(t => t.name.toLowerCase() === taskRaw.toLowerCase());
        if (foundTask) {
          taskId = foundTask.id;
          taskBillable = (foundTask as { id: string; name: string; isBillable?: boolean }).isBillable;
        } else {
          errors.push(`Row ${rowNum}: Task "${taskRaw}" not found in project — entry imported without task`);
        }
      }

      // Billable: task overrides project overrides explicit column value; column defaults to project setting
      const proj = projectId ? projects.find(p => p.id === projectId) : undefined;
      const billableRaw = String(row['billable'] ?? '').trim().toUpperCase();
      const explicitBillable = billableRaw !== ''
        ? billableRaw === 'Y' || billableRaw === 'YES' || billableRaw === 'TRUE' || billableRaw === '1'
        : undefined;
      const isBillable = taskBillable !== undefined
        ? taskBillable
        : explicitBillable !== undefined
          ? explicitBillable
          : (proj as { billable?: boolean } | undefined)?.billable ?? true;

      const entryTypeRaw = String(row['entrytype'] || 'REGULAR').trim().toUpperCase();
      const validTypes = ['REGULAR', 'OVERTIME', 'COMP_OFF', 'ON_CALL'];
      const entryType = validTypes.includes(entryTypeRaw) ? entryTypeRaw : 'REGULAR';

      const description = String(row['description'] || row['notes'] || '').trim();

      if (!description) { errors.push(`Row ${rowNum}: Missing description`); continue; }

      validRows.push({ date: entryDay.toISOString(), projectId, taskId, description, hours, isBillable, entryType: entryType as 'REGULAR' | 'OVERTIME' | 'COMP_OFF' | 'ON_CALL' });
    }

    if (errors.length > 0 && validRows.length === 0) {
      throw new AppError(`Upload failed:\n${errors.join('\n')}`, 400);
    }

    // Create or find timesheets and add entries
    const results: { week: string; timesheetId: string; entriesAdded: number }[] = [];

    await prisma.$transaction(async (tx) => {
      // Group by the timesheet each date belongs to
      const remaining = new Set(validRows);
      for (const first of validRows) {
        if (!remaining.has(first)) continue;
        const timesheet = await getOrCreateTimesheet(tx, req.user!.userId, req.user!.organizationId, new Date(first.date));
        const weekRows = [...remaining].filter(r => new Date(r.date) >= timesheet.periodStart && new Date(r.date) <= timesheet.periodEnd);
        weekRows.forEach(r => remaining.delete(r));
        remaining.delete(first);

        const state = await loadEditState(tx, timesheet.id);
        if (timesheet.status === 'LOCKED' || state.weekApproved || (timesheet.status === 'SUBMITTED' && state.weekPending)) {
          errors.push(`Week of ${format(timesheet.periodStart, 'MMM d')}: Timesheet is locked, approved or awaiting approval and cannot be modified`);
          continue;
        }

        const editableRows = weekRows.filter(row => {
          const day = dayKey(new Date(row.date));
          const frozen = state.approvedDays.has(day) || state.pendingDays.has(day);
          if (frozen) errors.push(`${format(new Date(row.date), 'MMM d')}: Day is approved or awaiting approval and cannot be modified`);
          return !frozen;
        });
        if (editableRows.length === 0) continue;

        await clearEmptyDays(tx, timesheet.id);
        await reopenForEdit(tx, timesheet);

        for (const row of editableRows) {
          await tx.timesheetEntry.create({
            data: {
              timesheetId: timesheet.id,
              date: new Date(row.date),
              projectId: row.projectId,
              taskId: row.taskId,
              description: row.description,
              hours: row.hours,
              isBillable: row.isBillable,
              entryType: row.entryType ?? 'REGULAR',
            },
          });
        }

        await recalcTotals(tx, timesheet.id);

        results.push({
          week: format(timesheet.periodStart, 'MMM d, yyyy'),
          timesheetId: timesheet.id,
          entriesAdded: editableRows.length,
        });
      }
    });

    res.json({
      success: true,
      results,
      warnings: errors,
      totalEntriesAdded: results.reduce((s, r) => s + r.entriesAdded, 0),
    });
  } catch (err) {
    next(err);
  }
});


export default router;
