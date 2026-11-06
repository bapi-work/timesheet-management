import { Router, Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest, ADMIN_ROLES, SYSTEM_ONLY_ROLES } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';

const router = Router();
router.use(authenticate);

async function assertLinksInOrg(orgId: string, managerId?: unknown, parentId?: unknown): Promise<void> {
  if (managerId) {
    const manager = await prisma.user.findFirst({ where: { id: String(managerId), organizationId: orgId }, select: { id: true } });
    if (!manager) throw new AppError('Manager not found', 404);
  }
  if (parentId) {
    const parent = await prisma.department.findFirst({ where: { id: String(parentId), organizationId: orgId }, select: { id: true } });
    if (!parent) throw new AppError('Parent department not found', 404);
  }
}

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const departments = await prisma.department.findMany({
      where: { organizationId: req.user!.organizationId },
      include: {
        manager: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { users: true, teams: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json(departments);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const dept = await prisma.department.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: {
        manager: { select: { id: true, firstName: true, lastName: true } },
        teams: { include: { lead: { select: { id: true, firstName: true, lastName: true } }, _count: { select: { members: true } } } },
        users: { select: { id: true, firstName: true, lastName: true, employeeId: true, designation: true } },
      },
    });
    if (!dept) throw new AppError('Department not found', 404);
    res.json(dept);
  } catch (err) {
    next(err);
  }
});

router.post('/', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, code, description, managerId, parentId, costCenter } = req.body;
    await assertLinksInOrg(req.user!.organizationId, managerId, parentId);
    const dept = await prisma.department.create({
      data: { name, code, description, managerId, parentId, costCenter, organizationId: req.user!.organizationId },
    });
    res.status(201).json(dept);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.department.findFirst({ where: { id: req.params.id, organizationId: req.user!.organizationId }, select: { id: true } });
    if (!existing) throw new AppError('Department not found', 404);

    const { name, code, description, managerId, parentId, costCenter } = req.body;
    await assertLinksInOrg(req.user!.organizationId, managerId, parentId);
    const dept = await prisma.department.update({
      where: { id: req.params.id },
      data: {
        name, code, description, costCenter,
        managerId: managerId === '' ? null : managerId,
        parentId: parentId === '' ? null : parentId,
      },
    });
    res.json(dept);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authorize(...SYSTEM_ONLY_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const dept = await prisma.department.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: { _count: { select: { users: true } } },
    });
    if (!dept) throw new AppError('Department not found', 404);
    if (dept._count.users > 0) throw new AppError('Cannot delete a department with employees. Reassign them first.', 400);

    await prisma.department.delete({ where: { id: req.params.id } });
    res.json({ message: 'Department deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
