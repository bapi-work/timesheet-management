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
      // Sanitize sensitive fields before logging (ISO 27001 A.12.4)
      const SENSITIVE_FIELDS = ['password', 'currentPassword', 'newPassword', 'mfaCode', 'mfaSecret', 'token', 'refreshToken', 'passwordHash'];
      const sanitizeBody = (body: Record<string, unknown>): Record<string, unknown> => {
        if (!body || typeof body !== 'object') return {};
        const sanitized = { ...body };
        for (const field of SENSITIVE_FIELDS) {
          if (field in sanitized) sanitized[field] = '[REDACTED]';
        }
        return sanitized;
      };
      prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          action: req.method,
          entity,
          entityId,
          newValues: req.body ? (sanitizeBody(req.body) as import('@prisma/client').Prisma.InputJsonValue) : undefined,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        },
      }).catch(() => {});
    }
    return oldSend(body);
  };

  next();
}
