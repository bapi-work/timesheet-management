import { Request, Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from './auth.middleware';

export async function requestLogger(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const writeMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (!writeMethods.includes(req.method)) {
    next();
    return;
  }

  const oldSend = res.json.bind(res);
  res.json = function (body: unknown) {
    if (req.user && res.statusCode < 400) {
      const parts = req.path.split('/').filter(Boolean);
      const entity = parts[0] || 'unknown';
      const entityId = parts[1];
      prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          action: req.method,
          entity,
          entityId,
          newValues: req.body ? req.body : undefined,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        },
      }).catch(() => {});
    }
    return oldSend(body);
  };

  next();
}
