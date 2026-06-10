import { Router, Response, NextFunction } from 'express';
import { format } from 'date-fns';
import prisma from '../utils/prisma';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { emailQueue, notificationQueue } from '../services/queue.service';
import { timesheetApprovedTemplate, timesheetRejectedTemplate } from '../services/email.service';

const router = Router();
router.use(authenticate);

router.get('/pending', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const role = req.user!.role;
    const userId = req.user!.userId;
    const orgId = req.user!.organizationId;

    // HR_ADMIN: see all pending approvals across org (their assigned + all SUBMITTED)
    if (role === 'HR_ADMIN' || role === 'SYSTEM_ADMIN') {
      const approvals = await prisma.timesheetApproval.findMany({
        where: {
          status: 'PENDING',
          timesheet: { user: { organizationId: orgId } },
        },
        include: {
          timesheet: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true, employeeId: true, avatarUrl: true, department: { select: { name: true } } } },
              entries: true,
            },
          },
        },
        orderBy: { dueDate: 'asc' },
      });
      return res.json(approvals);
    }

    // TEAM_LEAD: see own assigned approvals + team members' approvals
    if (role === 'TEAM_LEAD') {
      const ledTeams = await prisma.team.findMany({
        where: { leadId: userId },
        include: { members: { select: { userId: true } } },
      });
      const teamMemberIds = [...new Set(ledTeams.flatMap(t => t.members.map(m => m.userId)))];

      const approvals = await prisma.timesheetApproval.findMany({
        where: {
          status: 'PENDING',
          OR: [
            { approverId: userId },
            { timesheet: { userId: { in: teamMemberIds } } },
          ],
        },
        include: {
          timesheet: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true, employeeId: true, avatarUrl: true, department: { select: { name: true } } } },
              entries: true,
            },
          },
        },
        orderBy: { dueDate: 'asc' },
      });

      // Deduplicate by timesheetId
      const seen = new Set<string>();
      const unique = approvals.filter(a => {
        if (seen.has(a.timesheetId)) return false;
        seen.add(a.timesheetId);
        return true;
      });
      return res.json(unique);
    }

    // Default: only assigned approvals
    const approvals = await prisma.timesheetApproval.findMany({
      where: { approverId: userId, status: 'PENDING' },
      include: {
        timesheet: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, employeeId: true, avatarUrl: true, department: { select: { name: true } } } },
            entries: true,
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });
    res.json(approvals);
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
    const role = req.user!.role;
    const userId = req.user!.userId;

    // Find the approval record - allow HR_ADMIN/SYSTEM_ADMIN/TEAM_LEAD to approve even without being the designated approver
    let approval = await prisma.timesheetApproval.findFirst({
      where: { id: req.params.id, approverId: userId, status: 'PENDING' },
      include: { timesheet: { include: { user: { include: { manager: true } } } } },
    });

    // HR/Admin/TeamLead can approve any pending approval by ID
    if (!approval && ['HR_ADMIN', 'SYSTEM_ADMIN', 'TEAM_LEAD'].includes(role)) {
      approval = await prisma.timesheetApproval.findFirst({
        where: { id: req.params.id, status: 'PENDING', timesheet: { user: { organizationId: req.user!.organizationId } } },
        include: { timesheet: { include: { user: { include: { manager: true } } } } },
      });
      if (!approval) throw new AppError('Approval not found', 404);

      // For TEAM_LEAD, verify the employee is in one of their teams
      if (role === 'TEAM_LEAD') {
        const ledTeams = await prisma.team.findMany({
          where: { leadId: userId },
          include: { members: { select: { userId: true } } },
        });
        const memberIds = new Set(ledTeams.flatMap(t => t.members.map(m => m.userId)));
        if (!memberIds.has(approval.timesheet.userId)) {
          throw new AppError('Not authorized to approve this timesheet', 403);
        }
      }
    }

    if (!approval) throw new AppError('Approval not found', 404);

    await prisma.$transaction(async (tx) => {
      await tx.timesheetApproval.update({
        where: { id: req.params.id },
        data: { status: 'APPROVED', comments, actionAt: new Date(), approverId: userId },
      });

      await tx.timesheet.update({
        where: { id: approval!.timesheetId },
        data: { status: 'APPROVED', approvedAt: new Date() },
      });

      const user = approval!.timesheet.user;
      const period = `${format(approval!.timesheet.periodStart, 'MMM d')} - ${format(approval!.timesheet.periodEnd, 'MMM d, yyyy')}`;

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
        data: { timesheetId: approval!.timesheetId },
      });
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

    const role = req.user!.role;
    const userId = req.user!.userId;

    let approval = await prisma.timesheetApproval.findFirst({
      where: { id: req.params.id, approverId: userId, status: 'PENDING' },
      include: { timesheet: { include: { user: true } } },
    });

    if (!approval && ['HR_ADMIN', 'SYSTEM_ADMIN', 'TEAM_LEAD'].includes(role)) {
      approval = await prisma.timesheetApproval.findFirst({
        where: { id: req.params.id, status: 'PENDING', timesheet: { user: { organizationId: req.user!.organizationId } } },
        include: { timesheet: { include: { user: true } } },
      });
      if (!approval) throw new AppError('Approval not found', 404);

      if (role === 'TEAM_LEAD') {
        const ledTeams = await prisma.team.findMany({
          where: { leadId: userId },
          include: { members: { select: { userId: true } } },
        });
        const memberIds = new Set(ledTeams.flatMap(t => t.members.map(m => m.userId)));
        if (!memberIds.has(approval.timesheet.userId)) throw new AppError('Not authorized', 403);
      }
    }

    if (!approval) throw new AppError('Approval not found', 404);

    await prisma.$transaction(async (tx) => {
      await tx.timesheetApproval.update({
        where: { id: req.params.id },
        data: { status: 'REJECTED', comments, actionAt: new Date(), approverId: userId },
      });

      await tx.timesheet.update({
        where: { id: approval!.timesheetId },
        data: { status: 'REJECTED' },
      });

      const user = approval!.timesheet.user;
      const period = `${format(approval!.timesheet.periodStart, 'MMM d')} - ${format(approval!.timesheet.periodEnd, 'MMM d, yyyy')}`;

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
        data: { timesheetId: approval!.timesheetId },
      });
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
    const role = req.user!.role;
    const userId = req.user!.userId;

    const results = await Promise.allSettled(
      approvalIds.map(id =>
        prisma.$transaction(async (tx) => {
          const where: Record<string, unknown> = { id, status: 'PENDING' };
          if (!['HR_ADMIN', 'SYSTEM_ADMIN', 'TEAM_LEAD'].includes(role)) {
            where.approverId = userId;
          }

          const approval = await tx.timesheetApproval.findFirst({
            where,
            include: { timesheet: { include: { user: true } } },
          });
          if (!approval) throw new Error('Not found or unauthorized');

          await tx.timesheetApproval.update({
            where: { id },
            data: { status: 'APPROVED', comments, actionAt: new Date(), approverId: userId },
          });
          await tx.timesheet.update({
            where: { id: approval.timesheetId },
            data: { status: 'APPROVED', approvedAt: new Date() },
          });

          await notificationQueue.add({
            userId: approval.timesheet.userId,
            type: 'TIMESHEET_APPROVED',
            title: 'Timesheet Approved',
            message: 'Your timesheet has been approved.',
            data: { timesheetId: approval.timesheetId },
          });
        })
      )
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    res.json({ succeeded, failed });
  } catch (err) {
    next(err);
  }
});

// ─── Day-submission approval endpoints ───────────────────────────────────────

router.get('/day-submissions/pending', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const role = req.user!.role;
    const userId = req.user!.userId;
    const orgId = req.user!.organizationId;

    let where: Record<string, unknown> = { status: 'SUBMITTED', timesheet: { user: { organizationId: orgId } } };

    if (!['HR_ADMIN', 'SYSTEM_ADMIN', 'DEPARTMENT_MANAGER', 'PROJECT_MANAGER'].includes(role)) {
      // TEAM_LEAD: only their team members
      if (role === 'TEAM_LEAD') {
        const ledTeams = await prisma.team.findMany({
          where: { leadId: userId },
          include: { members: { select: { userId: true } } },
        });
        const memberIds = [...new Set(ledTeams.flatMap(t => t.members.map(m => m.userId)))];
        where = { status: 'SUBMITTED', timesheet: { userId: { in: memberIds } } };
      } else {
        // Regular managers: employees they manage
        where = { status: 'SUBMITTED', timesheet: { user: { managerId: userId, organizationId: orgId } } };
      }
    }

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

router.post('/day-submissions/:id/approve', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const role = req.user!.role;
    const userId = req.user!.userId;

    const sub = await prisma.daySubmission.findFirst({
      where: { id: req.params.id, status: 'SUBMITTED', timesheet: { user: { organizationId: req.user!.organizationId } } },
      include: { timesheet: { include: { user: true } } },
    });
    if (!sub) throw new AppError('Day submission not found or not pending', 404);

    // Authorise: must be manager of this user, team lead of their team, HR or System Admin
    const isPrivileged = ['HR_ADMIN', 'SYSTEM_ADMIN', 'DEPARTMENT_MANAGER', 'PROJECT_MANAGER'].includes(role);
    if (!isPrivileged) {
      if (role === 'TEAM_LEAD') {
        const ledTeams = await prisma.team.findMany({ where: { leadId: userId }, include: { members: { select: { userId: true } } } });
        const memberIds = new Set(ledTeams.flatMap(t => t.members.map(m => m.userId)));
        if (!memberIds.has(sub.timesheet.userId)) throw new AppError('Not authorized', 403);
      } else if (sub.timesheet.user.managerId !== userId) {
        throw new AppError('Not authorized', 403);
      }
    }

    await prisma.daySubmission.update({
      where: { id: req.params.id },
      data: { status: 'APPROVED', reviewedAt: new Date(), reviewedById: userId, comments: req.body.comments },
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

    const role = req.user!.role;
    const userId = req.user!.userId;

    const sub = await prisma.daySubmission.findFirst({
      where: { id: req.params.id, status: 'SUBMITTED', timesheet: { user: { organizationId: req.user!.organizationId } } },
      include: { timesheet: { include: { user: true } } },
    });
    if (!sub) throw new AppError('Day submission not found or not pending', 404);

    const isPrivileged = ['HR_ADMIN', 'SYSTEM_ADMIN', 'DEPARTMENT_MANAGER', 'PROJECT_MANAGER'].includes(role);
    if (!isPrivileged) {
      if (role === 'TEAM_LEAD') {
        const ledTeams = await prisma.team.findMany({ where: { leadId: userId }, include: { members: { select: { userId: true } } } });
        const memberIds = new Set(ledTeams.flatMap(t => t.members.map(m => m.userId)));
        if (!memberIds.has(sub.timesheet.userId)) throw new AppError('Not authorized', 403);
      } else if (sub.timesheet.user.managerId !== userId) {
        throw new AppError('Not authorized', 403);
      }
    }

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

router.post('/delegate', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { toUserId, startDate, endDate, reason } = req.body;
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
