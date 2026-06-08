import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { startOfWeek, endOfWeek } from 'date-fns';
import prisma from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';

const router = Router();
router.use(authenticate);

const startSchema = z.object({
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  description: z.string().optional(),
});

// GET /api/timer/active — return the currently running timer entry (if any)
router.get('/active', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const entry = await prisma.timesheetEntry.findFirst({
      where: {
        startTime: { not: null },
        endTime: null,
        timesheet: { userId: req.user!.userId },
      },
      include: {
        project: { select: { id: true, name: true } },
        task: { select: { id: true, name: true } },
        timesheet: { select: { id: true, periodStart: true, periodEnd: true } },
      },
      orderBy: { startTime: 'desc' },
    });
    res.json(entry || null);
  } catch (err) {
    next(err);
  }
});

// POST /api/timer/start — start a new timer
router.post('/start', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { projectId, taskId, description } = startSchema.parse(req.body);

    // Check no timer is already running
    const existing = await prisma.timesheetEntry.findFirst({
      where: {
        startTime: { not: null },
        endTime: null,
        timesheet: { userId: req.user!.userId },
      },
    });
    if (existing) throw new AppError('A timer is already running. Stop it before starting a new one.', 409);

    const now = new Date();
    // Find or create today's timesheet (use current week period)
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { organization: { select: { weekStartDay: true } } },
    });
    const weekStart = startOfWeek(now, { weekStartsOn: (user?.organization?.weekStartDay ?? 1) as 0 | 1 });
    const weekEnd = endOfWeek(now, { weekStartsOn: (user?.organization?.weekStartDay ?? 1) as 0 | 1 });

    let timesheet = await prisma.timesheet.findFirst({
      where: {
        userId: req.user!.userId,
        periodStart: { lte: now },
        periodEnd: { gte: now },
      },
    });

    if (!timesheet) {
      timesheet = await prisma.timesheet.create({
        data: {
          userId: req.user!.userId,
          periodStart: weekStart,
          periodEnd: weekEnd,
          status: 'DRAFT',
        },
      });
    }

    if (!['DRAFT', 'REJECTED'].includes(timesheet.status)) {
      throw new AppError('Cannot start timer on a submitted or approved timesheet.', 400);
    }

    const entry = await prisma.timesheetEntry.create({
      data: {
        timesheetId: timesheet.id,
        date: now,
        projectId: projectId || null,
        taskId: taskId || null,
        description: description || null,
        hours: 0,
        startTime: now,
        endTime: null,
        isBillable: true,
        entryType: 'REGULAR',
      },
      include: {
        project: { select: { id: true, name: true } },
        task: { select: { id: true, name: true } },
        timesheet: { select: { id: true } },
      },
    });

    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

// POST /api/timer/stop/:entryId — stop the running timer
router.post('/stop/:entryId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { entryId } = req.params;

    const entry = await prisma.timesheetEntry.findUnique({
      where: { id: entryId },
      include: { timesheet: true },
    });

    if (!entry) throw new AppError('Timer entry not found', 404);
    if (entry.timesheet.userId !== req.user!.userId) throw new AppError('Not authorised', 403);
    if (!entry.startTime) throw new AppError('Entry has no start time', 400);
    if (entry.endTime) throw new AppError('Timer already stopped', 400);

    const now = new Date();
    const diffMs = now.getTime() - entry.startTime.getTime();
    const breakMs = (entry.breakMinutes || 0) * 60 * 1000;
    const netMs = Math.max(0, diffMs - breakMs);
    const hours = Math.round((netMs / (1000 * 60 * 60)) * 100) / 100;

    const updated = await prisma.timesheetEntry.update({
      where: { id: entryId },
      data: { endTime: now, hours },
      include: {
        project: { select: { id: true, name: true } },
        task: { select: { id: true, name: true } },
        timesheet: { select: { id: true } },
      },
    });

    // Recalculate timesheet totals
    const allEntries = await prisma.timesheetEntry.findMany({
      where: { timesheetId: entry.timesheetId },
      select: { hours: true, isBillable: true, entryType: true },
    });
    const totalHours = allEntries.reduce((s, e) => s + e.hours, 0);
    const billableHours = allEntries.filter(e => e.isBillable).reduce((s, e) => s + e.hours, 0);
    const overtimeHours = allEntries.filter(e => e.entryType === 'OVERTIME').reduce((s, e) => s + e.hours, 0);

    await prisma.timesheet.update({
      where: { id: entry.timesheetId },
      data: { totalHours, billableHours, overtimeHours },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/timer/:entryId — discard a running timer without saving
router.delete('/:entryId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const entry = await prisma.timesheetEntry.findUnique({
      where: { id: req.params.entryId },
      include: { timesheet: true },
    });
    if (!entry) throw new AppError('Not found', 404);
    if (entry.timesheet.userId !== req.user!.userId) throw new AppError('Not authorised', 403);
    if (entry.endTime) throw new AppError('Timer already completed', 400);

    await prisma.timesheetEntry.delete({ where: { id: req.params.entryId } });
    res.json({ message: 'Timer discarded' });
  } catch (err) {
    next(err);
  }
});

export default router;
