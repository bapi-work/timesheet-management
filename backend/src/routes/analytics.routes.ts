import { Router, Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest, ANALYTICS_ROLES } from '../middleware/auth.middleware';

const router = Router();
router.use(authenticate);

router.get('/dashboard', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const canViewAnalytics = ANALYTICS_ROLES.includes(req.user!.role as Parameters<typeof ANALYTICS_ROLES.includes>[0]);

    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay() + 1);
    weekStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    if (canViewAnalytics) {
      const [
        totalEmployees,
        pendingApprovals,
        missingThisWeek,
        totalHoursThisWeek,
        billableHoursThisMonth,
        totalBillableHoursAllTime,
        submittedThisWeek,
        approvedThisWeek,
      ] = await Promise.all([
        prisma.user.count({ where: { organizationId: orgId, isActive: true } }),
        prisma.timesheetApproval.count({ where: { approverId: req.user!.userId, status: 'PENDING' } }),
        (async () => {
          const submitted = await prisma.timesheet.findMany({
            where: { periodStart: { gte: weekStart }, status: { in: ['SUBMITTED', 'APPROVED'] } },
            select: { userId: true },
          });
          const total = await prisma.user.count({ where: { organizationId: orgId, isActive: true, role: { not: 'SYSTEM_ADMIN' } } });
          return total - submitted.length;
        })(),
        prisma.timesheetEntry.aggregate({
          where: { date: { gte: weekStart }, timesheet: { user: { organizationId: orgId } } },
          _sum: { hours: true },
        }),
        prisma.timesheetEntry.aggregate({
          where: { date: { gte: monthStart }, isBillable: true, timesheet: { user: { organizationId: orgId } } },
          _sum: { hours: true },
        }),
        prisma.timesheetEntry.aggregate({
          where: { isBillable: true, timesheet: { user: { organizationId: orgId } } },
          _sum: { hours: true },
        }),
        prisma.timesheet.count({ where: { periodStart: { gte: weekStart }, status: 'SUBMITTED', user: { organizationId: orgId } } }),
        prisma.timesheet.count({ where: { periodStart: { gte: weekStart }, status: 'APPROVED', user: { organizationId: orgId } } }),
      ]);

      res.json({
        totalEmployees,
        pendingApprovals,
        missingThisWeek,
        totalHoursThisWeek: totalHoursThisWeek._sum.hours || 0,
        billableHoursThisMonth: billableHoursThisMonth._sum.hours || 0,
        totalBillableHoursAllTime: totalBillableHoursAllTime._sum.hours || 0,
        submittedThisWeek,
        approvedThisWeek,
      });
    } else {
      const [myTimesheet, pendingLeave, myHoursThisMonth, recentTimesheets, weekDaySubmissions] = await Promise.all([
        prisma.timesheet.findFirst({
          where: { userId: req.user!.userId, periodStart: { gte: weekStart } },
          select: { id: true, status: true, totalHours: true, billableHours: true },
        }),
        prisma.leaveRequest.count({ where: { userId: req.user!.userId, status: 'PENDING' } }),
        prisma.timesheetEntry.aggregate({
          where: { timesheet: { userId: req.user!.userId }, date: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } },
          _sum: { hours: true },
        }),
        prisma.timesheet.findMany({
          where: { userId: req.user!.userId },
          orderBy: { periodStart: 'desc' },
          take: 5,
          select: { id: true, periodStart: true, periodEnd: true, totalHours: true, billableHours: true, status: true, submittedAt: true },
        }),
        prisma.daySubmission.findMany({
          where: { timesheet: { userId: req.user!.userId, periodStart: { gte: weekStart } } },
          select: { status: true },
        }),
      ]);

      // Derive display status: use timesheet status directly, but upgrade DRAFT if day submissions exist
      let currentTimesheetStatus = myTimesheet?.status || 'NOT_STARTED';
      if (currentTimesheetStatus === 'DRAFT' && weekDaySubmissions.length > 0) {
        const hasApproved = weekDaySubmissions.some(s => s.status === 'APPROVED');
        const hasSubmitted = weekDaySubmissions.some(s => s.status === 'SUBMITTED');
        if (hasApproved && !hasSubmitted) currentTimesheetStatus = 'APPROVED';
        else if (hasSubmitted) currentTimesheetStatus = 'SUBMITTED';
      }

      res.json({
        currentTimesheetStatus,
        hoursThisWeek: myTimesheet?.totalHours || 0,
        billableHoursThisWeek: myTimesheet?.billableHours || 0,
        hoursThisMonth: myHoursThisMonth._sum.hours || 0,
        pendingLeave,
        recentTimesheets,
      });
    }
  } catch (err) {
    next(err);
  }
});

router.get('/trends', authorize(...ANALYTICS_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { months = '12' } = req.query;
    const result = [];
    const now = new Date();

    for (let i = Number(months) - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      const [totalAgg, billableAgg] = await Promise.all([
        prisma.timesheetEntry.aggregate({
          where: {
            date: { gte: start, lte: end },
            timesheet: { user: { organizationId: req.user!.organizationId } },
          },
          _sum: { hours: true },
        }),
        prisma.timesheetEntry.aggregate({
          where: {
            date: { gte: start, lte: end },
            isBillable: true,
            timesheet: { user: { organizationId: req.user!.organizationId } },
          },
          _sum: { hours: true },
        }),
      ]);
      result.push({
        month: start.toLocaleString('default', { month: 'short', year: 'numeric' }),
        hours: totalAgg._sum.hours || 0,
        billableHours: billableAgg._sum.hours || 0,
      });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/billable-by-employee', authorize(...ANALYTICS_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { from, to, limit = '15' } = req.query;
    const dateFilter: Record<string, unknown> = {};
    if (from) dateFilter.gte = new Date(from as string);
    if (to) dateFilter.lte = new Date(to as string);

    const users = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId, isActive: true, role: { not: 'SYSTEM_ADMIN' } },
      select: { id: true, firstName: true, lastName: true, employeeId: true, department: { select: { name: true } } },
    });

    const report = await Promise.all(
      users.map(async (user) => {
        const [totalAgg, billableAgg] = await Promise.all([
          prisma.timesheetEntry.aggregate({
            where: { timesheet: { userId: user.id }, ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}) },
            _sum: { hours: true },
          }),
          prisma.timesheetEntry.aggregate({
            where: { timesheet: { userId: user.id }, isBillable: true, ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}) },
            _sum: { hours: true },
          }),
        ]);
        return {
          ...user,
          name: `${user.firstName} ${user.lastName}`,
          totalHours: totalAgg._sum.hours || 0,
          billableHours: billableAgg._sum.hours || 0,
        };
      })
    );

    const sorted = report
      .filter(r => r.billableHours > 0)
      .sort((a, b) => b.billableHours - a.billableHours)
      .slice(0, Number(limit));

    res.json(sorted);
  } catch (err) {
    next(err);
  }
});

router.get('/billable-by-project', authorize(...ANALYTICS_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { from, to, limit = '15' } = req.query;
    const dateFilter: Record<string, unknown> = {};
    if (from) dateFilter.gte = new Date(from as string);
    if (to) dateFilter.lte = new Date(to as string);

    const entries = await prisma.timesheetEntry.groupBy({
      by: ['projectId'],
      where: {
        isBillable: true,
        project: { organizationId: req.user!.organizationId },
        ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}),
      },
      _sum: { hours: true },
      orderBy: { _sum: { hours: 'desc' } },
      take: Number(limit),
    });

    const projectIds = entries.map(e => e.projectId).filter(Boolean) as string[];
    const projects = await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true, code: true, budgetHours: true, client: { select: { name: true } } },
    });

    const report = entries.map(entry => {
      const project = projects.find(p => p.id === entry.projectId);
      return {
        projectId: entry.projectId,
        name: project?.name || 'Unknown',
        code: project?.code || '',
        clientName: project?.client?.name || '',
        budgetHours: project?.budgetHours || null,
        billableHours: entry._sum.hours || 0,
      };
    });

    res.json(report);
  } catch (err) {
    next(err);
  }
});

export default router;
