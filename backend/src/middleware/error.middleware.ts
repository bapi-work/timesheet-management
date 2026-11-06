import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error(err);

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      message: err.message,
      code: err.code,
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({ message: err.issues.map(e => e.message).join('; '), errors: err.issues });
    return;
  }

  // Prisma messages contain table and column names, so they never go to the client
  if (err.name === 'PrismaClientKnownRequestError') {
    const code = (err as Error & { code?: string }).code;
    if (code === 'P2002') {
      res.status(409).json({ message: 'A record with these details already exists' });
    } else if (code === 'P2025') {
      res.status(404).json({ message: 'Record not found' });
    } else {
      res.status(400).json({ message: 'Database operation failed' });
    }
    return;
  }

  if (err.name === 'PrismaClientValidationError' || err.name === 'MulterError') {
    res.status(400).json({ message: 'Invalid request' });
    return;
  }

  res.status(500).json({
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
}
