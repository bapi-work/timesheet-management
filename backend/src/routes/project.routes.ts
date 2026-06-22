import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest, MANAGER_ROLES } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';

const router = Router();
router.use(authenticate);

const projectSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  code: z.string().min(1, 'Project code is required'),
  clientId: z.string().min(1, 'Client is required'),
  description: z.string().optional(),
  status: z.enum(['ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'ARCHIVED']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  budgetHours: z.number().optional(),
  budgetCost: z.number().optional(),
  billable: z.boolean().optional(),
  managerId: z.string().optional(),
});

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { search, status, clientId, page = '1', limit = '20' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const isEmployee = req.user!.role === 'EMPLOYEE' || req.user!.role === 'TEAM_LEAD';
    const where: Record<string, unknown> = { organizationId: req.user!.organizationId };
    if (status) where.status = status;
    if (clientId) where.clientId = clientId;
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { code: { contains: search as string, mode: 'insensitive' } },
      ];
    }
    if (isEmployee) {
      where.members = { some: { userId: req.user!.userId } };
    }

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
        skip,
        take: Number(limit),
        include: {
          client: { select: { id: true, name: true } },
          tasks: { where: { isActive: true }, select: { id: true, name: true } },
          _count: { select: { members: true, entries: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.project.count({ where }),
    ]);

    res.json({ projects, total });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: {
        client: true,
        tasks: true,
        members: { include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } } },
        _count: { select: { entries: true } },
      },
    });
    if (!project) throw new AppError('Project not found', 404);
    res.json(project);
  } catch (err) {
    next(err);
  }
});

router.post('/', authorize(...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = projectSchema.parse(req.body);

    // Validate client belongs to same org
    const client = await prisma.client.findFirst({
      where: { id: data.clientId, organizationId: req.user!.organizationId, isActive: true },
    });
    if (!client) throw new AppError('Client not found or inactive', 404);

    const project = await prisma.project.create({
      data: {
        ...data,
        organizationId: req.user!.organizationId,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
      },
      include: { client: { select: { id: true, name: true } } },
    });
    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', authorize(...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.project.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!existing) throw new AppError('Project not found', 404);

    const data = projectSchema.partial().parse(req.body);

    // If changing client, validate it
    if (data.clientId && data.clientId !== existing.clientId) {
      const client = await prisma.client.findFirst({
        where: { id: data.clientId, organizationId: req.user!.organizationId, isActive: true },
      });
      if (!client) throw new AppError('Client not found or inactive', 404);
    }

    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: {
        ...data,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
      },
      include: { client: { select: { id: true, name: true } } },
    });
    res.json(project);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authorize(...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: { _count: { select: { timesheetEntries: true } } },
    });
    if (!project) throw new AppError('Project not found', 404);
    if (project._count.timesheetEntries > 0) throw new AppError('Cannot delete project with timesheet entries. Archive it instead.', 400);

    await prisma.project.delete({ where: { id: req.params.id } });
    res.json({ message: 'Project deleted' });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/members', authorize(...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { userId, role, allocatedHours, startDate, endDate } = req.body;
    const member = await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: req.params.id, userId } },
      update: { role, allocatedHours, startDate: startDate ? new Date(startDate) : undefined, endDate: endDate ? new Date(endDate) : undefined },
      create: { projectId: req.params.id, userId, role, allocatedHours, startDate: startDate ? new Date(startDate) : undefined, endDate: endDate ? new Date(endDate) : undefined },
    });
    res.status(201).json(member);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/members/:userId', authorize(...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId: req.params.id, userId: req.params.userId } },
    });
    res.json({ message: 'Member removed' });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/tasks', authorize(...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, description, estimatedHours, isBillable } = req.body;
    const task = await prisma.task.create({
      data: { projectId: req.params.id, name, description, estimatedHours, isBillable: isBillable ?? true },
    });
    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
});

router.put('/:id/tasks/:taskId', authorize(...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, description, estimatedHours, isBillable, isActive } = req.body;
    const task = await prisma.task.update({
      where: { id: req.params.taskId },
      data: { name, description, estimatedHours, isBillable, isActive },
    });
    res.json(task);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/tasks/:taskId', authorize(...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const inUse = await prisma.timesheetEntry.count({ where: { taskId: req.params.taskId } });
    if (inUse > 0) {
      const task = await prisma.task.update({ where: { id: req.params.taskId }, data: { isActive: false } });
      return res.json({ message: 'Task deactivated (has timesheet entries)', task });
    }
    await prisma.task.delete({ where: { id: req.params.taskId } });
    res.json({ message: 'Task deleted' });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/utilization', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { from, to } = req.query;
    const entries = await prisma.timesheetEntry.groupBy({
      by: ['taskId'],
      where: {
        projectId: req.params.id,
        date: {
          gte: from ? new Date(from as string) : undefined,
          lte: to ? new Date(to as string) : undefined,
        },
      },
      _sum: { hours: true },
    });

    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    const totalHours = entries.reduce((s, e) => s + (e._sum.hours || 0), 0);
    const utilization = project?.budgetHours ? (totalHours / project.budgetHours) * 100 : null;

    res.json({ entries, totalHours, budgetHours: project?.budgetHours, utilization });
  } catch (err) {
    next(err);
  }
});

export default router;
