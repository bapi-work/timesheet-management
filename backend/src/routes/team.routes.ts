import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest, ADMIN_ROLES, MANAGER_ROLES } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';

const router = Router();
router.use(authenticate);

const teamSchema = z.object({
  name: z.string().min(1, 'Team name is required'),
  description: z.string().optional(),
  departmentId: z.string().optional(),
  projectId: z.string().optional(),
  clientId: z.string().optional(),
  leadId: z.string().optional(),
});

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { departmentId, projectId, clientId, search } = req.query;
    const orgFilter = {
      OR: [
        { department: { organizationId: req.user!.organizationId } },
        { project: { organizationId: req.user!.organizationId } },
        { client: { organizationId: req.user!.organizationId } },
      ],
    };

    const andFilters: object[] = [orgFilter];
    if (departmentId) andFilters.push({ departmentId });
    if (projectId) andFilters.push({ projectId });
    if (clientId) andFilters.push({ clientId });
    if (search) andFilters.push({ name: { contains: search as string, mode: 'insensitive' } });

    const teams = await prisma.team.findMany({
      where: { AND: andFilters },
      include: {
        department: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
        lead: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { members: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json(teams);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const team = await prisma.team.findUnique({
      where: { id: req.params.id },
      include: {
        department: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
        lead: { select: { id: true, firstName: true, lastName: true } },
        members: {
          include: { user: { select: { id: true, firstName: true, lastName: true, employeeId: true, designation: true, avatarUrl: true } } },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    if (!team) throw new AppError('Team not found', 404);
    res.json(team);
  } catch (err) {
    next(err);
  }
});

router.post('/', authorize(...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = teamSchema.parse(req.body);

    // Must belong to at least one context or be standalone with org context
    if (data.departmentId) {
      const dept = await prisma.department.findFirst({ where: { id: data.departmentId, organizationId: req.user!.organizationId } });
      if (!dept) throw new AppError('Department not found', 404);
    }
    if (data.projectId) {
      const proj = await prisma.project.findFirst({ where: { id: data.projectId, organizationId: req.user!.organizationId } });
      if (!proj) throw new AppError('Project not found', 404);
    }
    if (data.clientId) {
      const cl = await prisma.client.findFirst({ where: { id: data.clientId, organizationId: req.user!.organizationId } });
      if (!cl) throw new AppError('Client not found', 404);
    }

    const team = await prisma.team.create({
      data,
      include: {
        department: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
        lead: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { members: true } },
      },
    });
    res.status(201).json(team);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', authorize(...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = teamSchema.partial().parse(req.body);
    const team = await prisma.team.update({
      where: { id: req.params.id },
      data,
      include: {
        department: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
        lead: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { members: true } },
      },
    });
    res.json(team);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authorize(...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.team.delete({ where: { id: req.params.id } });
    res.json({ message: 'Team deleted' });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/members', authorize(...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.body;
    if (!userId) throw new AppError('userId is required', 400);

    const member = await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: req.params.id, userId } },
      update: {},
      create: { teamId: req.params.id, userId },
      include: { user: { select: { id: true, firstName: true, lastName: true, employeeId: true, designation: true } } },
    });
    res.status(201).json(member);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/members/:userId', authorize(...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.teamMember.delete({
      where: { teamId_userId: { teamId: req.params.id, userId: req.params.userId } },
    });
    res.json({ message: 'Member removed' });
  } catch (err) {
    next(err);
  }
});

export default router;
