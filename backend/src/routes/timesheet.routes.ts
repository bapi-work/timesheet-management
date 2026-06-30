import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { startOfWeek, endOfWeek, format, parseISO, startOfDay } from 'date-fns';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import * as XLSX from 'xlsx';
import prisma from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { emailQueue, notificationQueue } from '../services/queue.service';
import { approvalPendingTemplate } from '../services/email.service';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();
router.use(authenticate);

const entrySchema = z.object({
  date: z.string(),
  projectId: z.string().optional(),
  taskId: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  hours: z.number().min(0.25).max(24),
  isBillable: z.boolean().optional(),
  entryType: z.enum(['REGULAR', 'OVERTIME', 'COMP_OFF', 'ON_CALL']).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  breakMinutes: z.number().optional(),
});

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { userId, status, from, to, startDate, endDate, page = '1', limit = '20' } = req.query;
    const fromDate = (from || startDate) as string | undefined;
    const toDate = (to || endDate) as string | undefined;
    const skip = (Number(page) - 1) * Number(limit);

    const isAdmin = ['SYSTEM_ADMIN', 'HR_ADMIN'].includes(req.user!.role);
    const isManager = ['DEPARTMENT_MANAGER', 'PROJECT_MANAGER', 'TEAM_LEAD'].includes(req.user!.role);

    const where: Record<string, unknown> = {};
    if (isAdmin) {
      // Admins see all org users; optionally filter by a specific userId
      if (userId) {
        where.userId = userId as string;
      } else {
        where.user = { organizationId: req.user!.organizationId };
      }
    } else if (isManager) {
      // Managers see all org timesheets; optionally filter by a specific userId
      if (userId) {
        where.userId = userId as string;
      }
      where.user = { organizationId: req.user!.organizationId };
    } else {
      where.userId = req.user!.userId;
    }
    if (status) where.status = status;
    if (fromDate || toDate) {
      where.periodStart = {};
      if (fromDate) (where.periodStart as Record<string, unknown>).gte = new Date(fromDate);
      if (toDate) (where.periodStart as Record<string, unknown>).lte = new Date(toDate);
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
          daySubmissions: { orderBy: { date: 'asc' } },
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
    const periodStart = startOfWeek(base, { weekStartsOn: 0 });
    const periodEnd = endOfWeek(base, { weekStartsOn: 0 });

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
        daySubmissions: { orderBy: { date: 'asc' } },
      },
    });

    if (!timesheet) {
      timesheet = await prisma.timesheet.create({
        data: { userId: req.user!.userId, periodStart, periodEnd },
        include: {
          entries: { include: { project: true, task: true } },
          approvals: { include: { approver: true } },
          daySubmissions: true,
        },
      });
    }

    res.json(timesheet);
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

      // Auto-withdraw any SUBMITTED day submissions for dates being modified
      const datesBeingAdded = [...new Set(validated.map(e => startOfDay(new Date(e.date)).toISOString()))];
      for (const dateIso of datesBeingAdded) {
        const daySub = await tx.daySubmission.findFirst({
          where: { timesheetId: req.params.id, date: new Date(dateIso), status: 'SUBMITTED' },
        });
        if (daySub) {
          await tx.daySubmission.update({ where: { id: daySub.id }, data: { status: 'WITHDRAWN' } });
        }
      }

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
    if (['SUBMITTED', 'APPROVED', 'LOCKED'].includes(timesheet.status)) throw new AppError('Cannot edit', 400);

    const data = entrySchema.partial().parse(req.body);
    const entry = await prisma.$transaction(async (tx) => {
      const updated = await tx.timesheetEntry.update({
        where: { id: req.params.entryId, timesheetId: req.params.id },
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
    if (['APPROVED', 'LOCKED'].includes(timesheet.status)) throw new AppError('Cannot edit', 400);

    await prisma.$transaction(async (tx) => {
      // findFirst with timesheetId scope prevents cross-timesheet entry deletion
      const entry = await tx.timesheetEntry.findFirst({ where: { id: req.params.entryId, timesheetId: req.params.id } });
      if (!entry) throw new AppError('Entry not found', 404);
      const entryDate = startOfDay(entry.date);
      const daySub = await tx.daySubmission.findFirst({
        where: { timesheetId: req.params.id, date: entryDate, status: 'SUBMITTED' },
      });
      if (daySub) {
        await tx.daySubmission.update({ where: { id: daySub.id }, data: { status: 'WITHDRAWN' } });
      }
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

// ─── Per-day submit ───────────────────────────────────────────────────────────
router.post('/:id/days/:date/submit', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const timesheet = await prisma.timesheet.findUnique({
      where: { id: req.params.id },
      include: { user: { include: { manager: true } } },
    });
    if (!timesheet) throw new AppError('Timesheet not found', 404);
    if (timesheet.userId !== req.user!.userId) throw new AppError('Forbidden', 403);
    if (['APPROVED', 'LOCKED'].includes(timesheet.status)) throw new AppError('Cannot modify an approved or locked timesheet', 400);

    const date = startOfDay(parseISO(req.params.date));

    // Upsert DaySubmission
    const existing = await prisma.daySubmission.findUnique({
      where: { timesheetId_date: { timesheetId: req.params.id, date } },
    });

    let daySubmission;
    if (existing) {
      if (existing.status === 'APPROVED') throw new AppError('This day has already been approved', 400);
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

    const date = startOfDay(parseISO(req.params.date));
    const existing = await prisma.daySubmission.findUnique({
      where: { timesheetId_date: { timesheetId: req.params.id, date } },
    });
    if (!existing) throw new AppError('No submission found for this day', 404);
    if (existing.status === 'APPROVED') throw new AppError('Cannot withdraw an approved day', 400);

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

    // Validate and group entries by week
    const timesheetMap = new Map<string, { periodStart: Date; periodEnd: Date; entries: typeof entrySchema._type[] }>();

    const projects = await prisma.project.findMany({
      where: { organizationId: req.user!.organizationId },
      select: { id: true, code: true, name: true, tasks: { select: { id: true, name: true } } },
    });

    const errors: string[] = [];
    const validRows: { timesheetKey: string; periodStart: Date; periodEnd: Date; entry: typeof entrySchema._type }[] = [];

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
      const taskRaw = String(row['taskname'] || row['task'] || '').trim();
      if (taskRaw && projectId) {
        const proj = projects.find(p => p.id === projectId) as typeof projects[0] & { tasks?: { id: string; name: string }[] };
        const tasks = proj?.tasks || [];
        const foundTask = tasks.find(t => t.name.toLowerCase() === taskRaw.toLowerCase());
        if (foundTask) taskId = foundTask.id;
      }

      const billableRaw = String(row['billable'] || 'Y').trim().toUpperCase();
      const isBillable = billableRaw === 'Y' || billableRaw === 'YES' || billableRaw === 'TRUE' || billableRaw === '1';

      const entryTypeRaw = String(row['entrytype'] || 'REGULAR').trim().toUpperCase();
      const validTypes = ['REGULAR', 'OVERTIME', 'COMP_OFF', 'ON_CALL'];
      const entryType = validTypes.includes(entryTypeRaw) ? entryTypeRaw : 'REGULAR';

      const description = String(row['description'] || row['notes'] || '').trim();

      const entryDay = startOfDay(date);
      const periodStart = startOfWeek(entryDay, { weekStartsOn: 1 });
      const periodEnd = endOfWeek(entryDay, { weekStartsOn: 1 });
      const timesheetKey = periodStart.toISOString();

      validRows.push({
        timesheetKey,
        periodStart,
        periodEnd,
        entry: { date: entryDay.toISOString(), projectId, taskId, description, hours, isBillable, entryType: entryType as 'REGULAR' | 'OVERTIME' | 'COMP_OFF' | 'ON_CALL' },
      });

      if (!timesheetMap.has(timesheetKey)) {
        timesheetMap.set(timesheetKey, { periodStart, periodEnd, entries: [] });
      }
    }

    if (errors.length > 0 && validRows.length === 0) {
      throw new AppError(`Upload failed:\n${errors.join('\n')}`, 400);
    }

    // Create or find timesheets and add entries
    const results: { week: string; timesheetId: string; entriesAdded: number }[] = [];

    await prisma.$transaction(async (tx) => {
      for (const [key, weekData] of timesheetMap.entries()) {
        const weekRows = validRows.filter(r => r.timesheetKey === key);

        let timesheet = await tx.timesheet.findUnique({
          where: { userId_periodStart_periodEnd: { userId: req.user!.userId, periodStart: weekData.periodStart, periodEnd: weekData.periodEnd } },
        });

        if (!timesheet) {
          timesheet = await tx.timesheet.create({
            data: { userId: req.user!.userId, periodStart: weekData.periodStart, periodEnd: weekData.periodEnd },
          });
        } else if (['SUBMITTED', 'APPROVED', 'LOCKED'].includes(timesheet.status)) {
          errors.push(`Week of ${format(weekData.periodStart, 'MMM d')}: Timesheet is ${timesheet.status} and cannot be modified`);
          continue;
        }

        for (const row of weekRows) {
          await tx.timesheetEntry.create({
            data: {
              timesheetId: timesheet.id,
              date: new Date(row.entry.date),
              projectId: row.entry.projectId,
              taskId: row.entry.taskId,
              description: row.entry.description,
              hours: row.entry.hours,
              isBillable: row.entry.isBillable,
              entryType: row.entry.entryType ?? 'REGULAR',
            },
          });
        }

        await recalcTotals(tx, timesheet.id);

        results.push({
          week: format(weekData.periodStart, 'MMM d, yyyy'),
          timesheetId: timesheet.id,
          entriesAdded: weekRows.length,
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


async function recalcTotals(tx: Prisma.TransactionClient | typeof prisma, timesheetId: string): Promise<void> {
  const entries = await tx.timesheetEntry.findMany({ where: { timesheetId } });
  const totalHours = entries.reduce((s, e) => s + e.hours, 0);
  const billableHours = entries.filter(e => e.isBillable).reduce((s, e) => s + e.hours, 0);
  const overtimeHours = entries.filter(e => e.entryType === 'OVERTIME').reduce((s, e) => s + e.hours, 0);
  await tx.timesheet.update({ where: { id: timesheetId }, data: { totalHours, billableHours, overtimeHours } });
}

export default router;
