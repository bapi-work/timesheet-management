import { Request, Response, NextFunction } from 'express';

const MAX_LIMIT = 1000;

/**
 * Query values reach Prisma filters, where ?userId[not]=x would become an operator.
 * Only plain strings are accepted, and page sizes are capped.
 */
export function sanitizeQuery(req: Request, res: Response, next: NextFunction): void {
  for (const value of Object.values(req.query)) {
    if (typeof value !== 'string') {
      res.status(400).json({ message: 'Invalid query parameter' });
      return;
    }
  }

  for (const key of ['limit', 'page']) {
    if (req.query[key] === undefined) continue;
    const n = parseInt(req.query[key] as string, 10);
    if (!Number.isFinite(n) || n < 1) delete req.query[key];
    else req.query[key] = String(key === 'limit' ? Math.min(n, MAX_LIMIT) : n);
  }
  next();
}
