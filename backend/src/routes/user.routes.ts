import { Router, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import multer from 'multer';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest, ADMIN_ROLES, MANAGER_ROLES } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { UserRole } from '@prisma/client';

const router = Router();
router.use(authenticate);

const upload = multer({ dest: 'uploads/avatars/', limits: { fileSize: 2 * 1024 * 1024 } });

const createUserSchema = z.object({
  employeeId: z.string(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  role: z.nativeEnum(UserRole).optional(),
  departmentId: z.string().optional(),
  managerId: z.string().optional(),
  designation: z.string().optional(),
  joinDate: z.string().optional(),
  phone: z.string().optional(),
  timezone: z.string().optional(),
});

router.get('/', authorize(...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page = '1', limit = '20', search, department, role, isActive } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Record<string, unknown> = {
      organizationId: req.user!.organizationId,
    };
    if (search) {
      where.OR = [
        { firstName: { contains: search as string, mode: 'insensitive' } },
        { lastName: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
        { employeeId: { contains: search as string, mode: 'insensitive' } },
      ];
    }
    if (department) where.departmentId = department;
    if (role) where.role = role;
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: Number(limit),
        select: {
          id: true, employeeId: true, email: true, firstName: true, lastName: true,
          role: true, isActive: true, designation: true, joinDate: true, avatarUrl: true,
          department: { select: { id: true, name: true } },
          manager: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { firstName: 'asc' },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ users, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: {
        department: true,
        manager: { select: { id: true, firstName: true, lastName: true, email: true } },
        teamMemberships: { include: { team: { select: { id: true, name: true } } } },
        projectAssignments: { include: { project: { select: { id: true, name: true, code: true } } } },
      },
    });
    if (!user) throw new AppError('User not found', 404);
    const { passwordHash, mfaSecret, ...safe } = user;
    res.json(safe);
  } catch (err) {
    next(err);
  }
});

router.post('/', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = createUserSchema.parse(req.body);
    const tempPassword = 'TempPass@' + Math.random().toString(36).slice(-6);
    const hash = await bcrypt.hash(tempPassword, 12);

    const user = await prisma.user.create({
      data: {
        ...data,
        organizationId: req.user!.organizationId,
        passwordHash: hash,
        joinDate: data.joinDate ? new Date(data.joinDate) : undefined,
      },
    });

    const { passwordHash, mfaSecret, ...safe } = user;
    res.status(201).json({ ...safe, tempPassword });
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const isAdmin = (ADMIN_ROLES as string[]).includes(req.user!.role);
    const isSelf = req.params.id === req.user!.userId;
    if (!isAdmin && !isSelf) throw new AppError('Forbidden', 403);

    const allowedFields = isAdmin
      ? ['firstName', 'lastName', 'phone', 'designation', 'departmentId', 'managerId', 'role', 'isActive', 'timezone', 'joinDate', 'exitDate']
      : ['firstName', 'lastName', 'phone', 'timezone'];

    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    const user = await prisma.user.update({ where: { id: req.params.id }, data: updates });
    const { passwordHash, mfaSecret, ...safe } = user;
    res.json(safe);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reset-password', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const target = await prisma.user.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!target) throw new AppError('User not found', 404);

    const newPassword = 'TempPass@' + Math.random().toString(36).slice(-8);
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash } });
    res.json({ message: 'Password reset successfully', tempPassword: newPassword });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/mfa', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const target = await prisma.user.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!target) throw new AppError('User not found', 404);

    await prisma.user.update({ where: { id: req.params.id }, data: { mfaEnabled: false, mfaSecret: null } });
    res.json({ message: 'MFA disabled successfully' });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false, exitDate: new Date() } });
    res.json({ message: 'User deactivated' });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/timesheets', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { from, to, status } = req.query;
    const where: Record<string, unknown> = { userId: req.params.id };
    if (from || to) {
      where.periodStart = {};
      if (from) (where.periodStart as Record<string, unknown>).gte = new Date(from as string);
      if (to) (where.periodStart as Record<string, unknown>).lte = new Date(to as string);
    }
    if (status) where.status = status;

    const timesheets = await prisma.timesheet.findMany({
      where,
      orderBy: { periodStart: 'desc' },
      include: { approvals: { include: { approver: { select: { firstName: true, lastName: true } } } } },
    });
    res.json(timesheets);
  } catch (err) {
    next(err);
  }
});

export default router;
