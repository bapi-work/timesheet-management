import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest, ADMIN_ROLES, MANAGER_ROLES } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { UserRole } from '@prisma/client';

const router = Router();
router.use(authenticate);

router.post('/clock-in', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await prisma.attendance.findUnique({
      where: { userId_date: { userId: req.user!.userId, date: today } },
    });
    if (existing?.checkIn) throw new AppError('Already clocked in today', 400);

    const record = await prisma.attendance.upsert({
      where: { userId_date: { userId: req.user!.userId, date: today } },
      update: { checkIn: new Date(), status: 'PRESENT' },
      create: {
        userId: req.user!.userId,
        date: today,
        checkIn: new Date(),
        status: 'PRESENT',
        ipAddress: req.ip,
        location: req.body.location,
      },
    });
    res.json(record);
  } catch (err) {
    next(err);
  }
});

router.post('/clock-out', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const record = await prisma.attendance.findUnique({
      where: { userId_date: { userId: req.user!.userId, date: today } },
    });
    if (!record?.checkIn) throw new AppError('No clock-in found for today', 400);
    if (record.checkOut) throw new AppError('Already clocked out', 400);

    const now = new Date();
    const workHours = (now.getTime() - record.checkIn!.getTime()) / (1000 * 60 * 60);

    const updated = await prisma.attendance.update({
      where: { userId_date: { userId: req.user!.userId, date: today } },
      data: { checkOut: now, workHours: Math.round(workHours * 100) / 100 },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.get('/today', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const record = await prisma.attendance.findUnique({
      where: { userId_date: { userId: req.user!.userId, date: today } },
    });
    res.json(record);
  } catch (err) {
    next(err);
  }
});

router.get('/my', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { from, to } = req.query;
    const records = await prisma.attendance.findMany({
      where: {
        userId: req.user!.userId,
        date: {
          gte: from ? new Date(from as string) : undefined,
          lte: to ? new Date(to as string) : undefined,
        },
      },
      orderBy: { date: 'desc' },
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

router.get('/all', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { from, to, userId } = req.query;
    const where: Prisma.AttendanceWhereInput = { user: { organizationId: req.user!.organizationId } };
    if (userId) where.userId = userId as string;
    if (from || to) {
      where.date = {};
      if (from) (where.date as Prisma.DateTimeFilter).gte = new Date(from as string);
      if (to) (where.date as Prisma.DateTimeFilter).lte = new Date(to as string);
    }
    const records = await prisma.attendance.findMany({
      where,
      include: { user: { select: { id: true, firstName: true, lastName: true, employeeId: true } } },
      orderBy: [{ date: 'desc' }, { userId: 'asc' }],
      take: 500,
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

router.get('/team', authorize(...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { date } = req.query;
    const targetDate = date ? new Date(date as string) : new Date();
    targetDate.setHours(0, 0, 0, 0);

    const subordinates = await prisma.user.findMany({
      where: { managerId: req.user!.userId, isActive: true },
      select: { id: true, firstName: true, lastName: true, employeeId: true },
    });

    const attendanceRecords = await prisma.attendance.findMany({
      where: { userId: { in: subordinates.map(u => u.id) }, date: targetDate },
    });

    const result = subordinates.map(u => ({
      ...u,
      attendance: attendanceRecords.find(a => a.userId === u.id) || null,
    }));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
