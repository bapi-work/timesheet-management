import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { startOfWeek, endOfWeek, format } from 'date-fns';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { emailQueue, notificationQueue } from '../services/queue.service';
import { approvalPendingTemplate } from '../services/email.service';

const router = Router();
router.use(authenticate);

const entrySchema = z.object({
  date: z.string(),
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  description: z.string().optional(),
  hours: z.number().min(0).max(24),
  isBillable: z.boolean().optional(),
  entryType: z.enum(['REGULAR', 'OVERTIME', 'COMP_OFF', 'ON_CALL']).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  breakMinutes: z.number().optional(),
});

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { userId, status, from, to, page = '1', limit = '20' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const isManager = ['SYSTEM_ADMIN', 'HR_ADMIN', 'DEPARTMENT_MANAGER', 'PROJECT_MANAGER', 'TEAM_LEAD'].includes(req.user!.role);
    const targetUserId = (isManager && userId) ? userId as string : req.user!.userId;

    const where: Record<string, unknown> = { userId: targetUserId };
    if (status) where.status = status;
    if (from || to) {
      where.periodStart = {};
      if (from) (where.periodStart as Record<string, unknown>).gte = new Date(from as string);
      if (to) (where.periodStart as Record<string, unknown>).lte = new Date(to as string);
    }

    const [timesheets, total] = await Promise.all([
      prisma.timesheet.findMany({
        where,
        skip,
        take: Number(limit),
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
          user: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
        },
      }),
      prisma.timesheet.count({ where }),
    ]);

    res.json({ timesheets, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    next(err);
  }
});

router.get('/current', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Allow clients to request any specific week by passing ?week=YYYY-MM-DD
    const base = req.query.week ? new Date(req.query.week as string) : new Date();
    const periodStart = startOfWeek(base, { weekStartsOn: 1 });
    const periodEnd = endOfWeek(base, { weekStartsOn: 1 });

    let timesheet = await prisma.timesheet.findUnique({
      where: { userId_periodStart_periodEnd: { userId: req.user!.userId, periodStart, periodEnd } },
      include: {
        entries: {
          include: {
            project: { select: { id: true, name: true, code: true } },
            task: { select: { id: true, name: true } },
          },
          orderBy: { date: 'asc' },
        },
        approvals: { include: { approver: { select: { id: true, firstName: true, lastName: true } } } },
      },
    });

    if (!timesheet) {
      timesheet = await prisma.timesheet.create({
        data: { userId: req.user!.userId, periodStart, periodEnd },
        include: {
          entries: { include: { project: true, task: true } },
          approvals: { include: { approver: true } },
        },
      });
    }

    res.json(timesheet);
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
        user: { select: { id: true, firstName: true, lastName: true, employeeId: true, managerId: true } },
      },
    });
    if (!timesheet) throw new AppError('Timesheet not found', 404);
    if (timesheet.userId !== req.user!.userId && !['SYSTEM_ADMIN', 'HR_ADMIN', 'DEPARTMENT_MANAGER', 'PROJECT_MANAGER', 'TEAM_LEAD'].includes(req.user!.role)) {
      throw new AppError('Forbidden', 403);
    }
    res.json(timesheet);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { periodStart, periodEnd } = req.body;
    const timesheet = await prisma.timesheet.create({
      data: {
        userId: req.user!.userId,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
      },
    });
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
    if (['APPROVED', 'LOCKED'].includes(timesheet.status)) {
      throw new AppError('Cannot edit an approved or locked timesheet', 400);
    }

    const entries = Array.isArray(req.body) ? req.body : [req.body];
    const validated = entries.map(e => entrySchema.parse(e));

    const created = await prisma.$transaction(async (tx) => {
      // If the timesheet was submitted but user is adding more entries, revert to DRAFT
      if (timesheet.status === 'SUBMITTED') {
        await tx.timesheet.update({ where: { id: req.params.id }, data: { status: 'DRAFT', submittedAt: null } });
        await tx.timesheetApproval.deleteMany({ where: { timesheetId: req.params.id } });
      }

      const newEntries = await Promise.all(
        validated.map(e => tx.timesheetEntry.create({
          data: {
            timesheetId: req.params.id,
            date: new Date(e.date),
            projectId: e.projectId,
            taskId: e.taskId,
            description: e.description,
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
    if (['SUBMITTED', 'APPROVED', 'LOCKED'].includes(timesheet.status)) throw new AppError('Cannot edit', 400);

    const data = entrySchema.partial().parse(req.body);
    const entry = await prisma.$transaction(async (tx) => {
      const updated = await tx.timesheetEntry.update({
        where: { id: req.params.entryId },
        data: {
          ...data,
          date: data.date ? new Date(data.date) : undefined,
        },
        include: { project: true, task: true },
      });
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
    if (['SUBMITTED', 'APPROVED', 'LOCKED'].includes(timesheet.status)) throw new AppError('Cannot edit', 400);

    await prisma.$transaction(async (tx) => {
      await tx.timesheetEntry.delete({ where: { id: req.params.entryId } });
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
      include: { user: { include: { manager: true } } },
    });
    if (!timesheet) throw new AppError('Not found', 404);
    if (timesheet.userId !== req.user!.userId) throw new AppError('Forbidden', 403);
    if (!['DRAFT', 'REJECTED'].includes(timesheet.status)) throw new AppError('Cannot submit', 400);

    // Collect all approvers: direct manager + team leads + HR admins
    const approverIds = new Set<string>();
    const approverMap: { id: string; email: string; firstName: string; level: number }[] = [];

    // Level 1: Direct manager
    const manager = timesheet.user.manager;
    if (manager) {
      approverIds.add(manager.id);
      approverMap.push({ id: manager.id, email: manager.email, firstName: manager.firstName, level: 1 });
    }

    // Level 2: Team leads of the employee's teams
    const teams = await prisma.team.findMany({
      where: { members: { some: { userId: timesheet.userId } } },
      include: { lead: { select: { id: true, email: true, firstName: true } } },
    });
    for (const team of teams) {
      if (team.lead && !approverIds.has(team.lead.id)) {
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
      if (!approverIds.has(hr.id)) {
        approverIds.add(hr.id);
        approverMap.push({ id: hr.id, email: hr.email, firstName: hr.firstName, level: 3 });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const ts = await tx.timesheet.update({
        where: { id: req.params.id },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      });

      const period = `${format(timesheet.periodStart, 'MMM d')} - ${format(timesheet.periodEnd, 'MMM d, yyyy')}`;
      const employeeName = `${timesheet.user.firstName} ${timesheet.user.lastName}`;

      for (const approver of approverMap) {
        // Skip if approval record already exists
        const existing = await tx.timesheetApproval.findFirst({
          where: { timesheetId: ts.id, approverId: approver.id },
        });
        if (existing) continue;

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

router.post('/:id/copy-previous', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const timesheet = await prisma.timesheet.findUnique({ where: { id: req.params.id } });
    if (!timesheet || timesheet.userId !== req.user!.userId) throw new AppError('Forbidden', 403);

    const prevStart = new Date(timesheet.periodStart);
    prevStart.setDate(prevStart.getDate() - 7);
    const prevEnd = new Date(timesheet.periodEnd);
    prevEnd.setDate(prevEnd.getDate() - 7);

    const prevTimesheet = await prisma.timesheet.findUnique({
      where: { userId_periodStart_periodEnd: { userId: req.user!.userId, periodStart: prevStart, periodEnd: prevEnd } },
      include: { entries: true },
    });

    if (!prevTimesheet) throw new AppError('No previous timesheet found', 404);

    const currentDiff = timesheet.periodStart.getDate() - prevStart.getDate();
    const created = await Promise.all(
      prevTimesheet.entries.map(e => {
        const newDate = new Date(e.date);
        newDate.setDate(newDate.getDate() + currentDiff);
        return prisma.timesheetEntry.create({
          data: {
            timesheetId: timesheet.id,
            date: newDate,
            projectId: e.projectId,
            taskId: e.taskId,
            description: e.description,
            hours: e.hours,
            isBillable: e.isBillable,
            entryType: e.entryType,
            breakMinutes: e.breakMinutes,
          },
        });
      })
    );

    await recalcTotals(prisma, req.params.id);
    res.json(created);
  } catch (err) {
    next(err);
  }
});

async function recalcTotals(tx: Prisma.TransactionClient | typeof prisma, timesheetId: string): Promise<void> {
  const entries = await tx.timesheetEntry.findMany({ where: { timesheetId } });
  const totalHours = entries.reduce((s, e) => s + e.hours, 0);
  const billableHours = entries.filter(e => e.isBillable).reduce((s, e) => s + e.hours, 0);
  const overtimeHours = entries.filter(e => e.entryType === 'OVERTIME').reduce((s, e) => s + e.hours, 0);
  await tx.timesheet.update({ where: { id: timesheetId }, data: { totalHours, billableHours, overtimeHours } });
}

export default router;
