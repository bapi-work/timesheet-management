import { Router, Response, NextFunction } from 'express';
import path from 'path';
import prisma from '../utils/prisma';
import { canReviewUser } from '../utils/access';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';

const router = Router();
router.use(authenticate);

const FILENAME = /^[a-f0-9]{32}\.[a-z0-9]{2,5}$/;

// Uploaded documents are served only to their owner, the assigned approver and reviewers
async function findOwner(category: string, url: string, orgId: string) {
  if (category === 'leave-docs') {
    const leave = await prisma.leaveRequest.findFirst({
      where: { documentUrl: url, user: { organizationId: orgId } },
      select: { userId: true, approverId: true },
    });
    return leave && { ownerId: leave.userId, approverId: leave.approverId };
  }
  if (category === 'receipts') {
    const expense = await prisma.expense.findFirst({
      where: { receiptUrl: url, organizationId: orgId },
      select: { userId: true },
    });
    return expense && { ownerId: expense.userId, approverId: null };
  }
  return null;
}

router.get('/:category/:filename', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { category, filename } = req.params;
    if (!FILENAME.test(filename)) throw new AppError('File not found', 404);

    const record = await findOwner(category, `/uploads/${category}/${filename}`, req.user!.organizationId);
    if (!record) throw new AppError('File not found', 404);

    const allowed = record.ownerId === req.user!.userId
      || record.approverId === req.user!.userId
      || await canReviewUser(req.user!, record.ownerId);
    if (!allowed) throw new AppError('File not found', 404);

    res.download(path.join(process.cwd(), 'uploads', category, filename), filename, { dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) next(new AppError('File not found', 404));
    });
  } catch (err) {
    next(err);
  }
});

export default router;
