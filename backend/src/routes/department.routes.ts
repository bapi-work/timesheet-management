import { Router, Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest, ADMIN_ROLES } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';

const router = Router();
router.use(authenticate);

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
    const dept = await prisma.department.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(dept);
  } catch (err) {
    next(err);
  }
});

export default router;
