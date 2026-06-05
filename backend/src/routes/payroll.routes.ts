import { Router, Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest, PAYROLL_ROLES } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import * as XLSX from 'xlsx';

const router = Router();
router.use(authenticate);

router.get('/periods', authorize(...PAYROLL_ROLES), async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const periods = await prisma.payrollPeriod.findMany({ orderBy: { startDate: 'desc' } });
    res.json(periods);
  } catch (err) {
    next(err);
  }
});

router.post('/periods', authorize(...PAYROLL_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, startDate, endDate } = req.body;
    const period = await prisma.payrollPeriod.create({
      data: { name, startDate: new Date(startDate), endDate: new Date(endDate) },
    });
    res.status(201).json(period);
  } catch (err) {
    next(err);
  }
});

router.post('/periods/:id/process', authorize(...PAYROLL_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const period = await prisma.payrollPeriod.findUnique({ where: { id: req.params.id } });
    if (!period) throw new AppError('Period not found', 404);

    const timesheets = await prisma.timesheet.findMany({
      where: {
        periodStart: { gte: period.startDate },
        periodEnd: { lte: period.endDate },
        status: 'APPROVED',
        user: { organizationId: req.user!.organizationId },
      },
      include: { user: { select: { id: true, employeeId: true, firstName: true, lastName: true } } },
    });

    await prisma.$transaction([
      prisma.timesheet.updateMany({
        where: {
          periodStart: { gte: period.startDate },
          periodEnd: { lte: period.endDate },
          status: 'APPROVED',
        },
        data: { status: 'LOCKED', lockedAt: new Date() },
      }),
      prisma.payrollPeriod.update({
        where: { id: req.params.id },
        data: { processedAt: new Date(), lockedAt: new Date() },
      }),
    ]);

    const exportData = timesheets.map(t => ({
      employeeId: t.user.employeeId,
      name: `${t.user.firstName} ${t.user.lastName}`,
      regularHours: Math.min(t.totalHours - t.overtimeHours, t.totalHours),
      overtimeHours: t.overtimeHours,
      totalHours: t.totalHours,
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);
    XLSX.utils.book_append_sheet(wb, ws, 'Payroll');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const export_ = await prisma.payrollExport.create({
      data: {
        periodId: period.id,
        exportedBy: req.user!.userId,
        format: 'xlsx',
        totalEmployees: exportData.length,
        totalHours: exportData.reduce((s, r) => s + r.totalHours, 0),
        totalOvertimeHours: exportData.reduce((s, r) => s + r.overtimeHours, 0),
      },
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="payroll-${period.name}.xlsx"`);
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

export default router;
