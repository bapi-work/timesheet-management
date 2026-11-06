import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest, ADMIN_ROLES, MANAGER_ROLES } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { canReviewUser, getReviewableUserIds } from '../utils/access';

const RECEIPT_DIR = path.join(process.cwd(), 'uploads', 'receipts');
try { fs.mkdirSync(RECEIPT_DIR, { recursive: true }); } catch { /* already exists */ }

const receiptUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, RECEIPT_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, crypto.randomBytes(16).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.heic'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

const router = Router();
router.use(authenticate);

const EXPENSE_CATEGORIES = [
  'Travel', 'Accommodation', 'Meals', 'Equipment', 'Software',
  'Training', 'Marketing', 'Office Supplies', 'Communication', 'Other',
];

const expenseFields = {
  projectId: z.string().optional(),
  category: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string(),
  date: z.string(),
  description: z.string().min(1),
  // An uploaded receipt, or a link to one elsewhere. Rejects javascript: and other schemes.
  receiptUrl: z.string().regex(/^(\/uploads\/receipts\/[a-f0-9]{32}\.[a-z0-9]{2,5}|https?:\/\/\S+)$/i, 'Invalid receipt link').optional(),
  notes: z.string().optional(),
};

const createSchema = z.object({ ...expenseFields, currency: z.string().default('USD') });

// No defaults here: an update that leaves a field out must keep its current value
const updateSchema = z.object(expenseFields).partial();

async function assertProjectInOrg(projectId: string | undefined, orgId: string): Promise<void> {
  if (!projectId) return;
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: orgId }, select: { id: true } });
  if (!project) throw new AppError('Project not found', 404);
}

async function loadReviewableExpense(id: string, viewer: Express.User) {
  const expense = await prisma.expense.findFirst({ where: { id, organizationId: viewer.organizationId } });
  if (!expense) throw new AppError('Expense not found', 404);
  if (expense.userId === viewer.userId) throw new AppError('You cannot review your own expense', 403);
  if (!(await canReviewUser(viewer, expense.userId))) throw new AppError('Not authorised', 403);
  return expense;
}

// GET /api/expenses
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, category, projectId, userId: filterUserId, page = '1', limit = '20' } = req.query as Record<string, string>;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const isManager = [...ADMIN_ROLES, ...MANAGER_ROLES].includes(req.user!.role as never);

    const where: Record<string, unknown> = { organizationId: req.user!.organizationId };

    // Non-managers can only see their own expenses
    if (!isManager) {
      where.userId = req.user!.userId;
      if (status) where.status = status;
    } else {
      const reviewable = await getReviewableUserIds(req.user!);
      if (filterUserId && filterUserId !== req.user!.userId && reviewable && !reviewable.includes(filterUserId)) {
        where.userId = { in: [] };
      } else if (filterUserId) {
        where.userId = filterUserId;
      } else if (reviewable) {
        where.userId = { in: [...reviewable, req.user!.userId] };
      }
      // Managers never see other users' drafts
      where.AND = [
        ...(status ? [{ status }] : []),
        { OR: [{ userId: req.user!.userId }, { status: { not: 'DRAFT' } }] },
      ];
    }
    if (category) where.category = category;
    if (projectId) where.projectId = projectId;

    const [expenses, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          project: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { date: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.expense.count({ where }),
    ]);

    res.json({ expenses, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    next(err);
  }
});

// GET /api/expenses/categories
router.get('/categories', (_req, res) => {
  res.json(EXPENSE_CATEGORIES);
});

// GET /api/expenses/:id
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        project: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!expense) throw new AppError('Expense not found', 404);
    const isOwner = expense.userId === req.user!.userId;
    if (expense.organizationId !== req.user!.organizationId) throw new AppError('Expense not found', 404);
    if (!isOwner && !(await canReviewUser(req.user!, expense.userId))) throw new AppError('Not authorised', 403);
    res.json(expense);
  } catch (err) {
    next(err);
  }
});

// POST /api/expenses
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = createSchema.parse(req.body);
    await assertProjectInOrg(data.projectId, req.user!.organizationId);
    const expense = await prisma.expense.create({
      data: {
        userId: req.user!.userId,
        organizationId: req.user!.organizationId,
        projectId: data.projectId || null,
        category: data.category,
        amount: data.amount,
        currency: data.currency,
        date: new Date(data.date),
        description: data.description,
        receiptUrl: data.receiptUrl || null,
        notes: data.notes || null,
        status: 'DRAFT',
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        project: { select: { id: true, name: true } },
      },
    });
    res.status(201).json(expense);
  } catch (err) {
    next(err);
  }
});

// PUT /api/expenses/:id
router.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Expense not found', 404);
    if (existing.userId !== req.user!.userId) throw new AppError('Not authorised', 403);
    if (!['DRAFT', 'REJECTED'].includes(existing.status)) throw new AppError('Cannot edit a submitted expense', 400);

    const data = updateSchema.parse(req.body);
    await assertProjectInOrg(data.projectId, req.user!.organizationId);
    const expense = await prisma.expense.update({
      where: { id: req.params.id },
      data: {
        ...(data.projectId !== undefined && { projectId: data.projectId || null }),
        ...(data.category && { category: data.category }),
        ...(data.amount !== undefined && { amount: data.amount }),
        ...(data.currency && { currency: data.currency }),
        ...(data.date && { date: new Date(data.date) }),
        ...(data.description && { description: data.description }),
        ...(data.receiptUrl !== undefined && { receiptUrl: data.receiptUrl || null }),
        ...(data.notes !== undefined && { notes: data.notes || null }),
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        project: { select: { id: true, name: true } },
      },
    });
    res.json(expense);
  } catch (err) {
    next(err);
  }
});

// POST /api/expenses/:id/submit
router.post('/:id/submit', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!expense) throw new AppError('Expense not found', 404);
    if (expense.userId !== req.user!.userId) throw new AppError('Not authorised', 403);
    if (expense.status !== 'DRAFT') throw new AppError('Expense already submitted', 400);

    const updated = await prisma.expense.update({
      where: { id: req.params.id },
      data: { status: 'SUBMITTED' },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/expenses/:id/approve
router.post('/:id/approve', authorize(...ADMIN_ROLES, ...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const expense = await loadReviewableExpense(req.params.id, req.user!);
    if (expense.status !== 'SUBMITTED') throw new AppError('Expense must be in SUBMITTED status to approve', 400);

    const updated = await prisma.expense.update({
      where: { id: req.params.id },
      data: { status: 'APPROVED', approvedById: req.user!.userId, approvedAt: new Date() },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/expenses/:id/reject
router.post('/:id/reject', authorize(...ADMIN_ROLES, ...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const expense = await loadReviewableExpense(req.params.id, req.user!);
    if (expense.status !== 'SUBMITTED') throw new AppError('Expense must be in SUBMITTED status', 400);

    const updated = await prisma.expense.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', approvedById: req.user!.userId, approvedAt: new Date() },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/expenses/:id/reimburse
router.post('/:id/reimburse', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const expense = await loadReviewableExpense(req.params.id, req.user!);
    if (expense.status !== 'APPROVED') throw new AppError('Expense must be approved before reimbursement', 400);

    const updated = await prisma.expense.update({
      where: { id: req.params.id },
      data: { status: 'REIMBURSED', reimbursedAt: new Date() },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/expenses/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!expense) throw new AppError('Not found', 404);
    if (expense.userId !== req.user!.userId) throw new AppError('Not authorised', 403);
    if (!['DRAFT', 'REJECTED'].includes(expense.status)) throw new AppError('Cannot delete submitted expense', 400);
    await prisma.expense.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (err) {
    next(err);
  }
});

// POST /api/expenses/upload-receipt — upload supporting document (#20)
router.post('/upload-receipt', receiptUpload.single('file'), (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) throw new AppError('No file uploaded', 400);
    // Return a relative URL the client can store as receiptUrl
    const url = `/uploads/receipts/${req.file.filename}`;
    res.json({ url, filename: req.file.originalname });
  } catch (err) {
    next(err);
  }
});

export default router;
