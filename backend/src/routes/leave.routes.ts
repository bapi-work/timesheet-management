import { Router, Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest, ADMIN_ROLES } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { UserRole } from '@prisma/client';
import { notificationQueue } from '../services/queue.service';

const router = Router();
router.use(authenticate);

router.get('/balance', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const year = new Date().getFullYear();
    const balances = await prisma.leaveBalance.findMany({
      where: { userId: req.user!.userId, year },
    });
    res.json(balances);
  } catch (err) {
    next(err);
  }
});

router.get('/requests', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, from, to } = req.query;
    const isManager = (ADMIN_ROLES as string[]).includes(req.user!.role) || req.user!.role === 'DEPARTMENT_MANAGER';

    const where: Record<string, unknown> = {};
    if (!isManager) where.userId = req.user!.userId;
    if (status) where.status = status;
    if (from || to) {
      where.startDate = {};
      if (from) (where.startDate as Record<string, unknown>).gte = new Date(from as string);
      if (to) (where.startDate as Record<string, unknown>).lte = new Date(to as string);
    }

    const requests = await prisma.leaveRequest.findMany({
      where,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
        approver: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(requests);
  } catch (err) {
    next(err);
  }
});

router.post('/requests', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { leaveType, startDate, endDate, reason } = req.body;

    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { managerId: true },
    });

    const request = await prisma.leaveRequest.create({
      data: {
        userId: req.user!.userId,
        leaveType,
        startDate: start,
        endDate: end,
        days,
        reason,
        approverId: user?.managerId || undefined,
      },
    });

    if (user?.managerId) {
      await notificationQueue.add({
        userId: user.managerId,
        type: 'APPROVAL_REQUIRED',
        title: 'Leave Request Pending',
        message: 'A leave request needs your approval.',
        data: { leaveRequestId: request.id },
      });
    }

    res.status(201).json(request);
  } catch (err) {
    next(err);
  }
});

router.post('/requests/:id/approve', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { comments } = req.body;
    const request = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
    if (!request) throw new AppError('Request not found', 404);
    if (request.approverId !== req.user!.userId && !(ADMIN_ROLES as string[]).includes(req.user!.role)) {
      throw new AppError('Forbidden', 403);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const req2 = await tx.leaveRequest.update({
        where: { id: req.params.id },
        data: { status: 'APPROVED', approverComments: comments, approvedAt: new Date() },
      });

      const year = request.startDate.getFullYear();
      await tx.leaveBalance.upsert({
        where: { userId_leaveType_year: { userId: request.userId, leaveType: request.leaveType, year } },
        update: { used: { increment: request.days }, pending: { decrement: request.days } },
        create: { userId: request.userId, leaveType: request.leaveType, year, entitled: 0, used: request.days },
      });

      return req2;
    });

    await notificationQueue.add({
      userId: request.userId,
      type: 'LEAVE_UPDATE',
      title: 'Leave Approved',
      message: 'Your leave request has been approved.',
      data: { leaveRequestId: request.id },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post('/requests/:id/reject', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { comments } = req.body;
    const request = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
    if (!request) throw new AppError('Request not found', 404);
    if (request.approverId !== req.user!.userId && !(ADMIN_ROLES as string[]).includes(req.user!.role)) {
      throw new AppError('Forbidden', 403);
    }

    const updated = await prisma.leaveRequest.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', approverComments: comments },
    });

    await notificationQueue.add({
      userId: request.userId,
      type: 'LEAVE_UPDATE',
      title: 'Leave Rejected',
      message: `Your leave request was rejected: ${comments}`,
      data: { leaveRequestId: request.id },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post('/requests/:id/cancel', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const request = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
    if (!request) throw new AppError('Not found', 404);
    if (request.userId !== req.user!.userId) throw new AppError('Forbidden', 403);
    if (!['PENDING'].includes(request.status)) throw new AppError('Cannot cancel', 400);

    await prisma.leaveRequest.update({ where: { id: req.params.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    res.json({ message: 'Cancelled' });
  } catch (err) {
    next(err);
  }
});

router.get('/holidays', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { year } = req.query;
    const y = year ? Number(year) : new Date().getFullYear();
    const holidays = await prisma.holiday.findMany({
      where: {
        organizationId: req.user!.organizationId,
        date: { gte: new Date(`${y}-01-01`), lte: new Date(`${y}-12-31`) },
      },
      orderBy: { date: 'asc' },
    });
    res.json(holidays);
  } catch (err) {
    next(err);
  }
});

// HR Admin: create holiday
router.post('/holidays', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, date, isOptional } = req.body;
    if (!name || !date) throw new AppError('name and date are required', 400);
    const holiday = await prisma.holiday.create({
      data: {
        organizationId: req.user!.organizationId,
        name,
        date: new Date(date),
        isOptional: !!isOptional,
      },
    });
    res.status(201).json(holiday);
  } catch (err) {
    next(err);
  }
});

// HR Admin: delete holiday
router.delete('/holidays/:id', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const holiday = await prisma.holiday.findUnique({ where: { id: req.params.id } });
    if (!holiday || holiday.organizationId !== req.user!.organizationId) throw new AppError('Not found', 404);
    await prisma.holiday.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (err) {
    next(err);
  }
});

// HR Admin: get all leave balances for the org
router.get('/balances/all', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { year } = req.query;
    const y = year ? Number(year) : new Date().getFullYear();
    const users = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId, isActive: true },
      select: { id: true, firstName: true, lastName: true, employeeId: true, department: { select: { name: true } } },
    });
    const balances = await prisma.leaveBalance.findMany({
      where: { year: y, userId: { in: users.map(u => u.id) } },
    });
    const userMap = new Map(users.map(u => [u.id, u]));
    res.json(balances.map(b => ({ ...b, user: userMap.get(b.userId) })));
  } catch (err) {
    next(err);
  }
});

// HR Admin: set/update leave balance for a user
router.put('/balances', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { userId, leaveType, year, entitled } = req.body;
    if (!userId || !leaveType || !year || entitled === undefined) throw new AppError('userId, leaveType, year, entitled are required', 400);
    const balance = await prisma.leaveBalance.upsert({
      where: { userId_leaveType_year: { userId, leaveType, year: Number(year) } },
      update: { entitled: Number(entitled) },
      create: { userId, leaveType, year: Number(year), entitled: Number(entitled), used: 0 },
    });
    res.json(balance);
  } catch (err) {
    next(err);
  }
});

export default router;
