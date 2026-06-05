import { Router, Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest, ANALYTICS_ROLES, MANAGER_ROLES } from '../middleware/auth.middleware';
import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';

const router = Router();
router.use(authenticate);

router.get('/utilization', authorize(...ANALYTICS_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { from, to, departmentId } = req.query;

    const where: Record<string, unknown> = {
      organizationId: req.user!.organizationId,
      isActive: true,
    };
    if (departmentId) where.departmentId = departmentId;

    const users = await prisma.user.findMany({
      where,
      select: { id: true, firstName: true, lastName: true, employeeId: true, department: { select: { name: true } } },
    });

    const entryWhere: Record<string, unknown> = {};
    if (from || to) {
      entryWhere.date = {};
      if (from) (entryWhere.date as Record<string, unknown>).gte = new Date(from as string);
      if (to) (entryWhere.date as Record<string, unknown>).lte = new Date(to as string);
    }

    const report = await Promise.all(
      users.map(async (user) => {
        const agg = await prisma.timesheetEntry.aggregate({
          where: { ...entryWhere, timesheet: { userId: user.id } },
          _sum: { hours: true },
        });
        const billableAgg = await prisma.timesheetEntry.aggregate({
          where: { ...entryWhere, timesheet: { userId: user.id }, isBillable: true },
          _sum: { hours: true },
        });
        const total = agg._sum.hours || 0;
        const billable = billableAgg._sum.hours || 0;
        return {
          ...user,
          totalHours: total,
          billableHours: billable,
          nonBillableHours: total - billable,
          utilizationPct: total > 0 ? Math.round((billable / total) * 100) : 0,
        };
      })
    );

    res.json(report);
  } catch (err) {
    next(err);
  }
});

router.get('/project-effort', authorize(...ANALYTICS_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { from, to } = req.query;
    const dateFilter: Record<string, unknown> = {};
    if (from) dateFilter.gte = new Date(from as string);
    if (to) dateFilter.lte = new Date(to as string);

    const entries = await prisma.timesheetEntry.groupBy({
      by: ['projectId'],
      where: {
        project: { organizationId: req.user!.organizationId },
        ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}),
      },
      _sum: { hours: true },
    });

    const projectIds = entries.map(e => e.projectId).filter(Boolean) as string[];
    const projects = await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true, code: true, budgetHours: true, billable: true, client: { select: { name: true } } },
    });

    const report = projects.map(p => {
      const entry = entries.find(e => e.projectId === p.id);
      const total = entry?._sum?.hours || 0;
      return {
        id: p.id, name: p.name, code: p.code, budgetHours: p.budgetHours, billable: p.billable,
        clientName: p.client?.name || null,
        totalHours: total,
        budgetUtilization: p.budgetHours ? Math.round((total / p.budgetHours) * 100) : null,
      };
    });

    res.json(report);
  } catch (err) {
    next(err);
  }
});

router.get('/overtime', authorize(...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { from, to } = req.query;
    const timesheets = await prisma.timesheet.findMany({
      where: {
        user: { organizationId: req.user!.organizationId },
        overtimeHours: { gt: 0 },
        periodStart: from ? { gte: new Date(from as string) } : undefined,
        periodEnd: to ? { lte: new Date(to as string) } : undefined,
      },
      include: { user: { select: { firstName: true, lastName: true, employeeId: true, department: { select: { name: true } } } } },
      orderBy: { overtimeHours: 'desc' },
    });
    res.json(timesheets);
  } catch (err) {
    next(err);
  }
});

router.get('/missing-timesheets', authorize(...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { from, to } = req.query;
    const periodStart = from ? new Date(from as string) : getWeekStart();
    const periodEnd = to ? new Date(to as string) : getWeekEnd();

    const allUsers = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId, isActive: true, role: { not: 'SYSTEM_ADMIN' } },
      select: { id: true, firstName: true, lastName: true, employeeId: true, email: true, department: { select: { name: true } } },
    });

    const submittedUserIds = await prisma.timesheet.findMany({
      where: {
        periodStart: { gte: periodStart },
        periodEnd: { lte: periodEnd },
        status: { in: ['SUBMITTED', 'APPROVED'] },
        userId: { in: allUsers.map(u => u.id) },
      },
      select: { userId: true },
    });

    const submittedIds = new Set(submittedUserIds.map(t => t.userId));
    const missing = allUsers.filter(u => !submittedIds.has(u.id));
    res.json(missing);
  } catch (err) {
    next(err);
  }
});

router.get('/export', authorize(...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { type = 'utilization', format = 'xlsx', from, to } = req.query;

    let data: Record<string, unknown>[] = [];
    let title = 'Timesheet Report';

    if (type === 'utilization') {
      const users = await prisma.user.findMany({
        where: {
          organizationId: req.user!.organizationId,
          isActive: true,
        },
        select: { id: true, firstName: true, lastName: true, employeeId: true, department: { select: { name: true } } },
      });

      const entryWhere: Record<string, unknown> = {};
      if (from || to) {
        entryWhere.date = {};
        if (from) (entryWhere.date as Record<string, unknown>).gte = new Date(from as string);
        if (to) (entryWhere.date as Record<string, unknown>).lte = new Date(to as string);
      }

      data = await Promise.all(
        users.map(async (user) => {
          const totalAgg = await prisma.timesheetEntry.aggregate({
            where: { ...entryWhere, timesheet: { userId: user.id } },
            _sum: { hours: true },
          });
          const billableAgg = await prisma.timesheetEntry.aggregate({
            where: { ...entryWhere, timesheet: { userId: user.id }, isBillable: true },
            _sum: { hours: true },
          });
          const totalHours = totalAgg._sum.hours || 0;
          const billableHours = billableAgg._sum.hours || 0;
          return {
            'Employee ID': user.employeeId,
            'Name': `${user.firstName} ${user.lastName}`,
            'Department': user.department?.name || '',
            'Total Hours': totalHours,
            'Billable Hours': billableHours,
            'Utilization %': totalHours > 0 ? Math.round((billableHours / totalHours) * 100) : 0,
          };
        })
      );
      title = 'Employee Utilization Report';
    } else if (type === 'project-effort') {
      const dateFilter: Record<string, unknown> = {};
      if (from) dateFilter.gte = new Date(from as string);
      if (to) dateFilter.lte = new Date(to as string);

      const entries = await prisma.timesheetEntry.groupBy({
        by: ['projectId'],
        where: {
          project: { organizationId: req.user!.organizationId },
          ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}),
        },
        _sum: { hours: true },
      });

      const projectIds = entries.map(e => e.projectId).filter(Boolean) as string[];
      const projects = await prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true, code: true, budgetHours: true, billable: true, client: { select: { name: true } } },
      });

      data = projects.map(project => {
        const entry = entries.find(e => e.projectId === project.id);
        const totalHours = entry?._sum?.hours || 0;
        return {
          'Project Code': project.code,
          'Project': project.name,
          'Client': project.client?.name || '',
          'Hours Used': totalHours,
          'Budget Hours': project.budgetHours || '',
          'Budget Utilization %': project.budgetHours ? Math.round((totalHours / project.budgetHours) * 100) : '',
          'Type': project.billable ? 'Billable' : 'Internal',
        };
      });
      title = 'Project Effort Report';
    } else if (type === 'overtime') {
      const timesheets = await prisma.timesheet.findMany({
        where: {
          user: { organizationId: req.user!.organizationId },
          overtimeHours: { gt: 0 },
          periodStart: from ? { gte: new Date(from as string) } : undefined,
          periodEnd: to ? { lte: new Date(to as string) } : undefined,
        },
        include: { user: { select: { firstName: true, lastName: true, employeeId: true, department: { select: { name: true } } } } },
        orderBy: { overtimeHours: 'desc' },
      });

      data = timesheets.map(t => ({
        'Employee ID': t.user.employeeId,
        'Name': `${t.user.firstName} ${t.user.lastName}`,
        'Department': t.user.department?.name || '',
        'Period Start': t.periodStart.toISOString().split('T')[0],
        'Period End': t.periodEnd.toISOString().split('T')[0],
        'Total Hours': t.totalHours,
        'Overtime Hours': t.overtimeHours,
        'Status': t.status,
      }));
      title = 'Overtime Analysis Report';
    } else if (type === 'missing') {
      const periodStart = from ? new Date(from as string) : getWeekStart();
      const periodEnd = to ? new Date(to as string) : getWeekEnd();

      const allUsers = await prisma.user.findMany({
        where: { organizationId: req.user!.organizationId, isActive: true, role: { not: 'SYSTEM_ADMIN' } },
        select: { id: true, firstName: true, lastName: true, employeeId: true, email: true, department: { select: { name: true } } },
      });

      const submittedUserIds = await prisma.timesheet.findMany({
        where: {
          periodStart: { gte: periodStart },
          periodEnd: { lte: periodEnd },
          status: { in: ['SUBMITTED', 'APPROVED'] },
          userId: { in: allUsers.map(u => u.id) },
        },
        select: { userId: true },
      });

      const submittedIds = new Set(submittedUserIds.map(t => t.userId));
      data = allUsers.filter(u => !submittedIds.has(u.id)).map(user => ({
        'Employee ID': user.employeeId,
        'First Name': user.firstName,
        'Last Name': user.lastName,
        'Email': user.email,
        'Department': user.department?.name || '',
      }));
      title = 'Missing Timesheets Report';
    }

    if (format === 'csv') {
      const ws = XLSX.utils.json_to_sheet(data);
      const csv = XLSX.utils.sheet_to_csv(ws);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="report.csv"`);
      res.send(csv);
    } else if (format === 'xlsx') {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Report');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="report.xlsx"`);
      res.send(buf);
    } else {
      const doc = new PDFDocument({ margin: 30 });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="report.pdf"`);
      doc.pipe(res);
      doc.fontSize(18).text(title, { align: 'center' });
      doc.moveDown();
      if (data.length > 0) {
        const headers = Object.keys(data[0]);
        doc.fontSize(9);
        headers.forEach(h => doc.text(h, { continued: true, width: 80 }));
        doc.moveDown(0.5);
        data.forEach(row => {
          headers.forEach(h => doc.text(String(row[h] ?? ''), { continued: true, width: 80 }));
          doc.moveDown(0.3);
        });
      }
      doc.end();
    }
  } catch (err) {
    next(err);
  }
});

function getWeekStart(): Date {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekEnd(): Date {
  const d = getWeekStart();
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

export default router;
