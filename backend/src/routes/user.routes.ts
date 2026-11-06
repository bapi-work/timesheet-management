import { Router, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import multer from 'multer';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest, ADMIN_ROLES, MANAGER_ROLES, SYSTEM_ONLY_ROLES } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { generateTempPassword, revokeSessions, stripSecrets } from '../utils/sessions';
import { canReviewUser } from '../utils/access';
import { UserRole } from '@prisma/client';

const router = Router();
router.use(authenticate);

// Only a System Admin can grant System Admin, or change an account that already has it
function assertCanManageRole(actor: Express.User, targetRole?: string, newRole?: unknown): void {
  if (actor.role === 'SYSTEM_ADMIN') return;
  if (targetRole === 'SYSTEM_ADMIN' || newRole === 'SYSTEM_ADMIN') {
    throw new AppError('Only a System Admin can manage System Admin accounts', 403);
  }
}

// Manager and department links define who can approve what, so they must stay in this org
async function assertLinksInOrg(orgId: string, managerId?: unknown, departmentId?: unknown): Promise<void> {
  if (managerId) {
    const manager = await prisma.user.findFirst({ where: { id: String(managerId), organizationId: orgId }, select: { id: true } });
    if (!manager) throw new AppError('Manager not found', 404);
  }
  if (departmentId) {
    const department = await prisma.department.findFirst({ where: { id: String(departmentId), organizationId: orgId }, select: { id: true } });
    if (!department) throw new AppError('Department not found', 404);
  }
}

const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const upload = multer({
  dest: 'uploads/avatars/',
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_AVATAR_TYPES.includes(file.mimetype));
  },
});

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

    const viewer = req.user!;
    const safe = stripSecrets(user);
    const isAdmin = (ADMIN_ROLES as string[]).includes(viewer.role);

    // Security settings: the person themselves and HR/System Admins only
    if (user.id === viewer.userId || isAdmin) {
      res.json(safe);
      return;
    }

    const { ipWhitelist, ssoId, ssoProvider, mfaEnabled, lastLoginAt, ...hr } = safe;
    void ipWhitelist; void ssoId; void ssoProvider; void mfaEnabled; void lastLoginAt;
    if (await canReviewUser(viewer, user.id)) {
      res.json(hr);
      return;
    }

    // Everyone else gets what a staff directory would show
    const directory = {
      id: user.id, firstName: user.firstName, lastName: user.lastName, avatarUrl: user.avatarUrl,
      designation: user.designation, employeeId: user.employeeId,
      department: user.department && { id: user.department.id, name: user.department.name },
    };
    res.json((MANAGER_ROLES as string[]).includes(viewer.role)
      ? { ...directory, email: user.email, role: user.role, isActive: user.isActive, joinDate: user.joinDate, manager: user.manager, teamMemberships: user.teamMemberships, projectAssignments: user.projectAssignments }
      : directory);
  } catch (err) {
    next(err);
  }
});

router.post('/', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = createUserSchema.parse(req.body);
    assertCanManageRole(req.user!, undefined, data.role);
    await assertLinksInOrg(req.user!.organizationId, data.managerId, data.departmentId);
    const tempPassword = generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, 12);

    const user = await prisma.user.create({
      data: {
        ...data,
        organizationId: req.user!.organizationId,
        passwordHash: hash,
        mustChangePassword: true,
        joinDate: data.joinDate ? new Date(data.joinDate) : undefined,
        departmentId: data.departmentId || undefined,
        managerId: data.managerId || undefined,
      },
    });

    res.status(201).json({ ...stripSecrets(user), tempPassword });
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
      if (req.body[field] === undefined) continue;
      if ((field === 'joinDate' || field === 'exitDate') && req.body[field]) {
        updates[field] = new Date(req.body[field]);
      } else if (field === 'isActive') {
        updates[field] = req.body[field] === true || req.body[field] === 'true';
      } else if ((field === 'departmentId' || field === 'managerId') && req.body[field] === '') {
        updates[field] = null;
      } else {
        updates[field] = req.body[field];
      }
    }

    // Verify the target belongs to the same org before writing (prevents cross-tenant update)
    const target = await prisma.user.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!target) throw new AppError('User not found', 404);

    if (isAdmin) {
      assertCanManageRole(req.user!, target.role, updates.role);
      if (isSelf && updates.role !== undefined && updates.role !== target.role) {
        throw new AppError('You cannot change your own role', 403);
      }
      await assertLinksInOrg(req.user!.organizationId, updates.managerId, updates.departmentId);
    }

    const user = await prisma.user.update({ where: { id: req.params.id }, data: updates });
    if (updates.isActive === false && target.isActive) await revokeSessions(user.id);
    res.json(stripSecrets(user));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/reset-password', authorize(...SYSTEM_ONLY_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const target = await prisma.user.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!target) throw new AppError('User not found', 404);

    const newPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash, mustChangePassword: true } });
    await revokeSessions(req.params.id);
    res.json({ message: 'Password reset successfully', tempPassword: newPassword });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/mfa', authorize(...SYSTEM_ONLY_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const target = await prisma.user.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!target) throw new AppError('User not found', 404);

    await prisma.user.update({ where: { id: req.params.id }, data: { mfaEnabled: false, mfaSecret: null, mfaPendingSecret: null } });
    await revokeSessions(req.params.id);
    res.json({ message: 'MFA disabled successfully' });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const target = await prisma.user.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!target) throw new AppError('User not found', 404);
    assertCanManageRole(req.user!, target.role);
    if (target.id === req.user!.userId) throw new AppError('You cannot deactivate your own account', 400);

    await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false, exitDate: new Date() } });
    await revokeSessions(req.params.id);
    res.json({ message: 'User deactivated' });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/timesheets', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const isSelf = req.params.id === req.user!.userId;
    if (!isSelf && !(await canReviewUser(req.user!, req.params.id))) throw new AppError('Forbidden', 403);

    // Ensure the target user belongs to the same organization
    const targetUser = await prisma.user.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId } });
    if (!targetUser) throw new AppError('User not found', 404);

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
