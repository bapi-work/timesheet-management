import { Response, NextFunction } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from './auth.middleware';

// ISO 27001 A.12.4: never write credentials to the audit log
const SENSITIVE_FIELD = /password|secret|token|mfacode|accesskey/i;
const OMITTED_FIELDS = ['data']; // Backup restore payloads: a whole database export

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const clean: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (OMITTED_FIELDS.includes(key)) continue;
    clean[key] = SENSITIVE_FIELD.test(key) ? '[REDACTED]' : sanitize(field);
  }
  return clean;
}

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
      // req.path is relative to the router by now, so read the full URL: /api/<entity>/<id>/...
      const parts = req.originalUrl.split('?')[0].split('/').filter(Boolean).slice(1);
      const entity = parts[0] || 'unknown';
      const entityId = parts[1];
      prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          action: req.method,
          entity,
          entityId,
          newValues: req.body ? (sanitize(req.body) as import('@prisma/client').Prisma.InputJsonValue) : undefined,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        },
      }).catch(() => {});
    }
    return oldSend(body);
  };

  next();
}
