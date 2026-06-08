import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest, ADMIN_ROLES, MANAGER_ROLES } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';

const router = Router();
router.use(authenticate);

const itemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  projectId: z.string().optional(),
});

const invoiceSchema = z.object({
  clientId: z.string(),
  dueDate: z.string(),
  currency: z.string().default('USD'),
  taxRate: z.number().min(0).max(100).default(0),
  discount: z.number().min(0).default(0),
  notes: z.string().optional(),
  terms: z.string().optional(),
  items: z.array(itemSchema).min(1),
});

const updateSchema = invoiceSchema.partial().extend({
  status: z.enum(['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED']).optional(),
});

function calcTotals(items: { quantity: number; unitPrice: number }[], taxRate: number, discount: number) {
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const taxAmount = ((subtotal - discount) * taxRate) / 100;
  const total = subtotal - discount + taxAmount;
  return { subtotal, taxAmount, total };
}

// GET /api/invoices
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, clientId, page = '1', limit = '20' } = req.query as Record<string, string>;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where: Record<string, unknown> = { organizationId: req.user!.organizationId };
    if (status) where.status = status;
    if (clientId) where.clientId = clientId;

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: {
          client: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.invoice.count({ where }),
    ]);

    res.json({ invoices, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    next(err);
  }
});

// GET /api/invoices/:id
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: {
        client: true,
        items: true,
      },
    });
    if (!invoice) throw new AppError('Invoice not found', 404);
    res.json(invoice);
  } catch (err) {
    next(err);
  }
});

// POST /api/invoices
router.post('/', authorize(...ADMIN_ROLES, ...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = invoiceSchema.parse(req.body);

    // Auto-generate invoice number
    const count = await prisma.invoice.count({ where: { organizationId: req.user!.organizationId } });
    const invoiceNumber = `INV-${String(count + 1).padStart(5, '0')}`;

    const totals = calcTotals(data.items, data.taxRate, data.discount);

    const invoice = await prisma.invoice.create({
      data: {
        organizationId: req.user!.organizationId,
        clientId: data.clientId,
        invoiceNumber,
        dueDate: new Date(data.dueDate),
        currency: data.currency,
        taxRate: data.taxRate,
        discount: data.discount,
        notes: data.notes,
        terms: data.terms,
        createdBy: req.user!.userId,
        ...totals,
        items: {
          create: data.items.map(item => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.quantity * item.unitPrice,
            projectId: item.projectId || null,
          })),
        },
      },
      include: { client: true, items: true },
    });

    res.status(201).json(invoice);
  } catch (err) {
    next(err);
  }
});

// PUT /api/invoices/:id
router.put('/:id', authorize(...ADMIN_ROLES, ...MANAGER_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.invoice.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!existing) throw new AppError('Invoice not found', 404);
    if (existing.status === 'PAID' || existing.status === 'CANCELLED') {
      throw new AppError('Cannot edit a paid or cancelled invoice', 400);
    }

    const data = updateSchema.parse(req.body);
    const items = data.items;

    let totals = {};
    if (items) {
      totals = calcTotals(items, data.taxRate ?? existing.taxRate, data.discount ?? existing.discount);
    }

    // Track status transitions for timestamps
    const statusData: Record<string, unknown> = {};
    if (data.status === 'SENT' && !existing.sentAt) statusData.sentAt = new Date();
    if (data.status === 'PAID' && !existing.paidAt) statusData.paidAt = new Date();

    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data: {
        ...(data.clientId && { clientId: data.clientId }),
        ...(data.dueDate && { dueDate: new Date(data.dueDate) }),
        ...(data.currency && { currency: data.currency }),
        ...(data.taxRate !== undefined && { taxRate: data.taxRate }),
        ...(data.discount !== undefined && { discount: data.discount }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.terms !== undefined && { terms: data.terms }),
        ...(data.status && { status: data.status }),
        ...totals,
        ...statusData,
        ...(items && {
          items: {
            deleteMany: {},
            create: items.map(item => ({
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              amount: item.quantity * item.unitPrice,
              projectId: item.projectId || null,
            })),
          },
        }),
      },
      include: { client: true, items: true },
    });

    res.json(invoice);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/invoices/:id
router.delete('/:id', authorize(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.invoice.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!existing) throw new AppError('Invoice not found', 404);
    if (existing.status === 'PAID') throw new AppError('Cannot delete a paid invoice', 400);

    await prisma.invoice.delete({ where: { id: req.params.id } });
    res.json({ message: 'Invoice deleted' });
  } catch (err) {
    next(err);
  }
});

// GET /api/invoices/:id/summary — stats
router.get('/stats/summary', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const [draft, sent, paid, overdue, cancelled] = await Promise.all([
      prisma.invoice.aggregate({ where: { organizationId: orgId, status: 'DRAFT' }, _count: true, _sum: { total: true } }),
      prisma.invoice.aggregate({ where: { organizationId: orgId, status: 'SENT' }, _count: true, _sum: { total: true } }),
      prisma.invoice.aggregate({ where: { organizationId: orgId, status: 'PAID' }, _count: true, _sum: { total: true } }),
      prisma.invoice.aggregate({ where: { organizationId: orgId, status: 'OVERDUE' }, _count: true, _sum: { total: true } }),
      prisma.invoice.aggregate({ where: { organizationId: orgId, status: 'CANCELLED' }, _count: true, _sum: { total: true } }),
    ]);
    res.json({ draft, sent, paid, overdue, cancelled });
  } catch (err) {
    next(err);
  }
});

export default router;
