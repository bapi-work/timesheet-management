import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest, ADMIN_ROLES, MANAGER_ROLES } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';

const memberSchema = z.object({
  userId: z.string().min(1),
  role: z.string().optional(),
});

const router = Router();
router.use(authenticate);

const clientSchema = z.object({
  name: z.string().min(1, 'Client name is required'),
  code: z.string().optional(),
  contactPerson: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal('')),
  contactPhone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  zipCode: z.string().optional(),
  taxId: z.string().optional(),
  taxType: z.string().optional(),
  website: z.string().url().optional().or(z.literal('')),
  notes: z.string().optional(),
  isActive: z.boolean().optional(),
});

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { search, isActive, page = '1', limit = '50' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Record<string, unknown> = { organizationId: req.user!.organizationId };
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { code: { contains: search as string, mode: 'insensitive' } },
        { contactPerson: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        skip,
        take: Number(limit),
        include: { _count: { select: { projects: true } } },
        orderBy: { name: 'asc' },
      }),
      prisma.client.count({ where }),
    ]);

    res.json({ clients, total });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const client = await prisma.client.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: {
        projects: {
          select: { id: true, name: true, code: true, status: true, billable: true },
          orderBy: { name: 'asc' },
        },
        clientMembers: {
          include: { user: { select: { id: true, firstName: true, lastName: true, employeeId: true, designation: true, avatarUrl: true } } },
          orderBy: { joinedAt: 'asc' },
        },
        _count: { select: { projects: true, clientMembers: true } },
      },
    });
    if (!client) throw new AppError('Client not found', 404);
    res.json(client);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/members', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const client = await prisma.client.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!client) throw new AppError('Client not found', 404);

    const members = await prisma.clientMember.findMany({
      where: { clientId: req.params.id },
      include: { user: { select: { id: true, firstName: true, lastName: true, employeeId: true, designation: true, avatarUrl: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    res.json(members);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/members', authorize(...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const client = await prisma.client.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!client) throw new AppError('Client not found', 404);

    const { userId, role } = memberSchema.parse(req.body);

    // Validate user belongs to same org
    const user = await prisma.user.findFirst({
      where: { id: userId, organizationId: req.user!.organizationId },
    });
    if (!user) throw new AppError('User not found', 404);

    const member = await prisma.clientMember.upsert({
      where: { clientId_userId: { clientId: req.params.id, userId } },
      update: { role },
      create: { clientId: req.params.id, userId, role },
      include: { user: { select: { id: true, firstName: true, lastName: true, employeeId: true, designation: true } } },
    });
    res.status(201).json(member);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/members/:userId', authorize(...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const client = await prisma.client.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!client) throw new AppError('Client not found', 404);

    await prisma.clientMember.delete({
      where: { clientId_userId: { clientId: req.params.id, userId: req.params.userId } },
    });
    res.json({ message: 'Member removed' });
  } catch (err) {
    next(err);
  }
});

router.post('/', authorize(...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = clientSchema.parse(req.body);

    // Ensure name is unique within org
    const existing = await prisma.client.findFirst({
      where: { organizationId: req.user!.organizationId, name: { equals: data.name, mode: 'insensitive' } },
    });
    if (existing) throw new AppError('A client with this name already exists', 409);

    const client = await prisma.client.create({
      data: { ...data, organizationId: req.user!.organizationId },
    });
    res.status(201).json(client);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', authorize(...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.client.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!existing) throw new AppError('Client not found', 404);

    const data = clientSchema.partial().parse(req.body);

    // Check name uniqueness if changing name
    if (data.name && data.name !== existing.name) {
      const nameTaken = await prisma.client.findFirst({
        where: { organizationId: req.user!.organizationId, name: { equals: data.name, mode: 'insensitive' }, NOT: { id: req.params.id } },
      });
      if (nameTaken) throw new AppError('A client with this name already exists', 409);
    }

    const client = await prisma.client.update({
      where: { id: req.params.id },
      data,
    });
    res.json(client);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const client = await prisma.client.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: { _count: { select: { projects: true } } },
    });
    if (!client) throw new AppError('Client not found', 404);
    if (client._count.projects > 0) throw new AppError('Cannot delete client with associated projects. Deactivate it instead.', 400);

    await prisma.client.delete({ where: { id: req.params.id } });
    res.json({ message: 'Client deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
