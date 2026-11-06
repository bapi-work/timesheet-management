import { Router, Response, NextFunction } from 'express';
import { format } from 'date-fns';
import prisma from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { emailQueue, notificationQueue } from '../services/queue.service';
import { timesheetApprovedTemplate, timesheetRejectedTemplate } from '../services/email.service';
import { canReviewUser, getReviewableUserIds } from '../utils/access';

const router = Router();
router.use(authenticate);

// Who may act on an approval: never the employee, always someone assigned or in scope
async function loadActionableApproval(id: string, viewer: Express.User) {
  const approval = await prisma.timesheetApproval.findFirst({
    where: { id, status: 'PENDING', timesheet: { user: { organizationId: viewer.organizationId } } },
    include: { timesheet: { include: { user: true } } },
  });
  if (!approval) throw new AppError('Approval not found', 404);
  if (approval.timesheet.userId === viewer.userId) throw new AppError('You cannot review your own timesheet', 403);
  if (approval.timesheet.status !== 'SUBMITTED') throw new AppError('This timesheet is no longer awaiting approval', 409);
  if (approval.approverId !== viewer.userId && !(await canReviewUser(viewer, approval.timesheet.userId))) {
    throw new AppError('Not authorized to review this timesheet', 403);
  }
  return approval;
}

// One decision settles the timesheet, so the other approvers' requests are closed in the same transaction
async function decideApproval(
  approval: { id: string; timesheetId: string },
  decision: 'APPROVED' | 'REJECTED',
  approverId: string,
  comments?: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const settled = await tx.timesheet.updateMany({
      where: { id: approval.timesheetId, status: 'SUBMITTED' },
      data: decision === 'APPROVED' ? { status: 'APPROVED', approvedAt: new Date() } : { status: 'REJECTED' },
    });
    if (settled.count === 0) throw new AppError('This timesheet is no longer awaiting approval', 409);

    await tx.timesheetApproval.update({
      where: { id: approval.id },
      data: { status: decision, comments, actionAt: new Date(), approverId },
    });
    await tx.timesheetApproval.deleteMany({
      where: { timesheetId: approval.timesheetId, status: 'PENDING' },
    });

    if (decision === 'APPROVED') {
      // Mark all pending/submitted day submissions as approved too
      await tx.daySubmission.updateMany({
        where: { timesheetId: approval.timesheetId, status: { in: ['SUBMITTED'] } },
        data: { status: 'APPROVED' },
      });
    }
  });
}

// Shared check for approving or rejecting one day
async function loadActionableDaySubmission(id: string, viewer: Express.User) {
  const sub = await prisma.daySubmission.findFirst({
    where: { id, status: 'SUBMITTED', timesheet: { user: { organizationId: viewer.organizationId } } },
    include: { timesheet: { include: { user: true } } },
  });
  if (!sub) throw new AppError('Day submission not found or not pending', 404);
  if (sub.timesheet.userId === viewer.userId) throw new AppError('You cannot review your own timesheet', 403);
  if (sub.timesheet.status === 'LOCKED') throw new AppError('This timesheet is locked', 409);
  if (!(await canReviewUser(viewer, sub.timesheet.userId))) throw new AppError('Not authorized', 403);
  return sub;
}

router.get('/pending', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { teamId } = req.query;
    const reviewable = await getReviewableUserIds(req.user!);

    const approvals = await prisma.timesheetApproval.findMany({
      where: {
        status: 'PENDING',
        ...(reviewable ? { OR: [{ approverId: userId }, { timesheet: { userId: { in: reviewable } } }] } : {}),
        timesheet: {
          status: 'SUBMITTED',
          userId: { not: userId },
          user: {
            organizationId: req.user!.organizationId,
            ...(teamId ? { teamMemberships: { some: { teamId: String(teamId) } } } : {}),
          },
        },
      },
      include: {
        timesheet: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, employeeId: true, avatarUrl: true, department: { select: { name: true } }, teamMemberships: { include: { team: { select: { id: true, name: true } } } } } },
            entries: { include: { project: { select: { id: true, name: true } }, task: { select: { id: true, name: true } } } },
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    // A timesheet has one row per approver: show it once, preferring this viewer's own row
    const byTimesheet = new Map<string, (typeof approvals)[number]>();
    for (const approval of approvals) {
      if (!byTimesheet.has(approval.timesheetId) || approval.approverId === userId) {
        byTimesheet.set(approval.timesheetId, approval);
      }
    }
    res.json([...byTimesheet.values()]);
  } catch (err) {
    next(err);
  }
});

router.get('/history', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page = '1', limit = '20' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [approvals, total] = await Promise.all([
      prisma.timesheetApproval.findMany({
        where: { approverId: req.user!.userId, status: { not: 'PENDING' } },
        include: {
          timesheet: {
            include: { user: { select: { id: true, firstName: true, lastName: true } } },
          },
        },
        skip,
        take: Number(limit),
        orderBy: { actionAt: 'desc' },
      }),
      prisma.timesheetApproval.count({
        where: { approverId: req.user!.userId, status: { not: 'PENDING' } },
      }),
    ]);

    res.json({ approvals, total });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/approve', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { comments } = req.body;
    const approval = await loadActionableApproval(req.params.id, req.user!);
    await decideApproval(approval, 'APPROVED', req.user!.userId, comments);

    const user = approval.timesheet.user;
    const period = `${format(approval.timesheet.periodStart, 'MMM d')} - ${format(approval.timesheet.periodEnd, 'MMM d, yyyy')}`;

    await emailQueue.add({
      to: user.email,
      subject: 'Your Timesheet Has Been Approved',
      html: timesheetApprovedTemplate(`${user.firstName} ${user.lastName}`, period),
    });

    await notificationQueue.add({
      userId: user.id,
      type: 'TIMESHEET_APPROVED',
      title: 'Timesheet Approved',
      message: `Your timesheet for ${period} has been approved.`,
      data: { timesheetId: approval.timesheetId },
    });

    res.json({ message: 'Approved' });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reject', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { comments } = req.body;
    if (!comments) throw new AppError('Rejection reason required', 400);

    const approval = await loadActionableApproval(req.params.id, req.user!);
    await decideApproval(approval, 'REJECTED', req.user!.userId, comments);

    const user = approval.timesheet.user;
    const period = `${format(approval.timesheet.periodStart, 'MMM d')} - ${format(approval.timesheet.periodEnd, 'MMM d, yyyy')}`;

    await emailQueue.add({
      to: user.email,
      subject: 'Your Timesheet Has Been Rejected',
      html: timesheetRejectedTemplate(`${user.firstName} ${user.lastName}`, period, comments),
    });

    await notificationQueue.add({
      userId: user.id,
      type: 'TIMESHEET_REJECTED',
      title: 'Timesheet Rejected',
      message: `Your timesheet for ${period} was rejected: ${comments}`,
      data: { timesheetId: approval.timesheetId },
    });

    res.json({ message: 'Rejected' });
  } catch (err) {
    next(err);
  }
});

router.post('/bulk-approve', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { approvalIds, comments } = req.body as { approvalIds: string[]; comments?: string };
    if (!Array.isArray(approvalIds) || approvalIds.length === 0) throw new AppError('No IDs provided', 400);
    if (approvalIds.length > 500) throw new AppError('Too many approvals in one request', 400);

    // One at a time: two rows can belong to the same timesheet, and only the first may settle it
    let succeeded = 0;
    let failed = 0;
    for (const id of approvalIds) {
      try {
        const approval = await loadActionableApproval(String(id), req.user!);
        await decideApproval(approval, 'APPROVED', req.user!.userId, comments);
        await notificationQueue.add({
          userId: approval.timesheet.userId,
          type: 'TIMESHEET_APPROVED',
          title: 'Timesheet Approved',
          message: 'Your timesheet has been approved.',
          data: { timesheetId: approval.timesheetId },
        });
        succeeded++;
      } catch {
        failed++;
      }
    }
    res.json({ succeeded, failed });
  } catch (err) {
    next(err);
  }
});

// ─── Day-submission approval endpoints ───────────────────────────────────────

router.get('/day-submissions/pending', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { teamId } = req.query;
    const reviewable = await getReviewableUserIds(req.user!);

    const where: Record<string, unknown> = {
      status: 'SUBMITTED',
      timesheet: {
        userId: reviewable ? { in: reviewable } : { not: req.user!.userId },
        user: {
          organizationId: req.user!.organizationId,
          ...(teamId ? { teamMemberships: { some: { teamId: String(teamId) } } } : {}),
        },
      },
    };

    const submissions = await prisma.daySubmission.findMany({
      where,
      include: {
        timesheet: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, employeeId: true, department: { select: { name: true } } } },
            entries: {
              include: {
                project: { select: { id: true, name: true } },
                task: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { submittedAt: 'asc' },
    });

    // Attach only the entries matching each day
    const result = submissions.map(sub => ({
      ...sub,
      dayEntries: sub.timesheet.entries.filter(e => {
        const ed = new Date(e.date);
        const sd = new Date(sub.date);
        return ed.getFullYear() === sd.getFullYear() && ed.getMonth() === sd.getMonth() && ed.getDate() === sd.getDate();
      }),
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── History: approved day submissions (#22) ─────────────────────────────────
router.get('/day-submissions/history', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const reviewable = await getReviewableUserIds(req.user!);

    const where: Record<string, unknown> = {
      status: 'APPROVED',
      timesheet: {
        userId: reviewable ? { in: reviewable } : { not: req.user!.userId },
        user: { organizationId: req.user!.organizationId },
      },
    };

    const submissions = await prisma.daySubmission.findMany({
      where,
      include: {
        timesheet: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, employeeId: true, department: { select: { name: true } } } },
            entries: { include: { project: { select: { id: true, name: true } }, task: { select: { id: true, name: true } } } },
          },
        },
      },
      orderBy: { reviewedAt: 'desc' },
      take: 100,
    });

    const result = submissions.map(sub => ({
      ...sub,
      dayEntries: sub.timesheet.entries.filter(e => {
        const ed = new Date(e.date); const sd = new Date(sub.date);
        return ed.getFullYear() === sd.getFullYear() && ed.getMonth() === sd.getMonth() && ed.getDate() === sd.getDate();
      }),
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/day-submissions/:id/approve', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const sub = await loadActionableDaySubmission(req.params.id, req.user!);

    await prisma.$transaction(async (tx) => {
      await tx.daySubmission.update({
        where: { id: req.params.id },
        data: { status: 'APPROVED', reviewedAt: new Date(), reviewedById: userId, comments: req.body.comments },
      });
      // Update parent timesheet status based on all day submissions.
      // "Fully approved" means every day that actually has logged entries has an
      // APPROVED day submission — not merely every day submission that happens to exist,
      // since a lone day submission can otherwise look "complete" on its own.
      const [allDaySubs, entryDates] = await Promise.all([
        tx.daySubmission.findMany({ where: { timesheetId: sub.timesheetId } }),
        tx.timesheetEntry.findMany({ where: { timesheetId: sub.timesheetId }, select: { date: true }, distinct: ['date'] }),
      ]);
      const approvedDates = new Set(
        allDaySubs.filter(s => (s.id === req.params.id ? true : s.status === 'APPROVED')).map(s => s.date.toDateString())
      );
      const allApproved = entryDates.length > 0 && entryDates.every(e => approvedDates.has(e.date.toDateString()));
      const anySubmitted = allDaySubs.some(s => s.id !== req.params.id && s.status === 'SUBMITTED');
      if (allApproved) {
        await tx.timesheet.update({ where: { id: sub.timesheetId }, data: { status: 'APPROVED', approvedAt: new Date() } });
      } else if (anySubmitted) {
        await tx.timesheet.update({ where: { id: sub.timesheetId }, data: { status: 'SUBMITTED' } });
      }
    });

    const dateLabel = format(new Date(sub.date), 'MMM d, yyyy');
    await notificationQueue.add({
      userId: sub.timesheet.userId,
      type: 'TIMESHEET_APPROVED',
      title: 'Day Timesheet Approved',
      message: `Your timesheet for ${dateLabel} has been approved.`,
      data: { timesheetId: sub.timesheetId },
    });

    res.json({ message: 'Approved' });
  } catch (err) {
    next(err);
  }
});

router.post('/day-submissions/:id/reject', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { comments } = req.body;
    if (!comments) throw new AppError('Rejection reason required', 400);

    const userId = req.user!.userId;
    const sub = await loadActionableDaySubmission(req.params.id, req.user!);

    await prisma.daySubmission.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', reviewedAt: new Date(), reviewedById: userId, comments },
    });

    const dateLabel = format(new Date(sub.date), 'MMM d, yyyy');
    await notificationQueue.add({
      userId: sub.timesheet.userId,
      type: 'TIMESHEET_REJECTED',
      title: 'Day Timesheet Rejected',
      message: `Your timesheet for ${dateLabel} was rejected: ${comments}`,
      data: { timesheetId: sub.timesheetId },
    });

    res.json({ message: 'Rejected' });
  } catch (err) {
    next(err);
  }
});

// Sends an approved timesheet back to the employee to correct. Blocked once payroll has locked it.
router.post('/timesheets/:id/reopen', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { reason } = req.body;
    if (typeof reason !== 'string' || !reason.trim()) throw new AppError('A reason is required to reopen a timesheet', 400);

    const timesheet = await prisma.timesheet.findFirst({
      where: { id: req.params.id, user: { organizationId: req.user!.organizationId } },
    });
    if (!timesheet) throw new AppError('Timesheet not found', 404);
    if (timesheet.userId === req.user!.userId) throw new AppError('You cannot reopen your own timesheet', 403);
    if (!(await canReviewUser(req.user!, timesheet.userId))) throw new AppError('Not authorized to reopen this timesheet', 403);
    if (timesheet.status === 'LOCKED') throw new AppError('This timesheet has been processed by payroll and cannot be reopened', 409);

    await prisma.$transaction(async (tx) => {
      const reopened = await tx.timesheet.updateMany({
        where: { id: timesheet.id, status: 'APPROVED' },
        data: { status: 'DRAFT', submittedAt: null, approvedAt: null },
      });
      if (reopened.count === 0) throw new AppError('Only an approved timesheet can be reopened', 409);

      await tx.timesheetApproval.updateMany({
        where: { timesheetId: timesheet.id, status: 'APPROVED' },
        data: { status: 'REOPENED', comments: reason.trim(), actionAt: new Date() },
      });
      await tx.daySubmission.updateMany({
        where: { timesheetId: timesheet.id, status: 'APPROVED' },
        data: { status: 'WITHDRAWN' },
      });
    });

    await notificationQueue.add({
      userId: timesheet.userId,
      type: 'TIMESHEET_REJECTED',
      title: 'Timesheet Reopened',
      message: `Your timesheet was reopened for correction: ${reason.trim()}`,
      data: { timesheetId: timesheet.id },
    });

    res.json({ message: 'Timesheet reopened' });
  } catch (err) {
    next(err);
  }
});

router.post('/delegate', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { toUserId, startDate, endDate, reason } = req.body;
    const delegate = await prisma.user.findFirst({ where: { id: String(toUserId), organizationId: req.user!.organizationId }, select: { id: true } });
    if (!delegate) throw new AppError('User not found', 404);
    const delegation = await prisma.approvalDelegation.create({
      data: {
        fromUserId: req.user!.userId,
        toUserId,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        reason,
      },
    });
    res.status(201).json(delegation);
  } catch (err) {
    next(err);
  }
});

export default router;
