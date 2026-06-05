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

    if (canViewAnalytics) {
      const [
        totalEmployees,
        pendingApprovals,
        missingThisWeek,
        totalHoursThisWeek,
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
        prisma.timesheet.count({ where: { periodStart: { gte: weekStart }, status: 'SUBMITTED', user: { organizationId: orgId } } }),
        prisma.timesheet.count({ where: { periodStart: { gte: weekStart }, status: 'APPROVED', user: { organizationId: orgId } } }),
      ]);

      res.json({ totalEmployees, pendingApprovals, missingThisWeek, totalHoursThisWeek: totalHoursThisWeek._sum.hours || 0, submittedThisWeek, approvedThisWeek });
    } else {
      const [myTimesheet, pendingLeave, myHoursThisMonth, recentTimesheets] = await Promise.all([
        prisma.timesheet.findFirst({
          where: { userId: req.user!.userId, periodStart: { gte: weekStart } },
          select: { status: true, totalHours: true },
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
          select: { id: true, periodStart: true, periodEnd: true, totalHours: true, status: true },
        }),
      ]);

      res.json({
        currentTimesheetStatus: myTimesheet?.status || 'NOT_STARTED',
        hoursThisWeek: myTimesheet?.totalHours || 0,
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
    const { months = '6' } = req.query;
    const result = [];
    const now = new Date();

    for (let i = Number(months) - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      const agg = await prisma.timesheetEntry.aggregate({
        where: {
          date: { gte: start, lte: end },
          timesheet: { user: { organizationId: req.user!.organizationId } },
        },
        _sum: { hours: true },
      });
      result.push({
        month: start.toLocaleString('default', { month: 'short', year: 'numeric' }),
        hours: agg._sum.hours || 0,
      });
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
