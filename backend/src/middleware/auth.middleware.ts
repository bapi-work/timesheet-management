import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from '../utils/jwt';
import { UserRole } from '@prisma/client';

export interface AuthRequest extends Request {
  user?: Express.User;
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'No token provided' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
}

export function authorize(...roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthenticated' });
      return;
    }
    if (!roles.includes(req.user.role as UserRole)) {
      res.status(403).json({ message: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

export const ADMIN_ROLES = [UserRole.SYSTEM_ADMIN, UserRole.HR_ADMIN];
export const PAYROLL_ROLES = [UserRole.SYSTEM_ADMIN, UserRole.HR_ADMIN, UserRole.PAYROLL_ADMIN];
export const MANAGER_ROLES = [
  UserRole.SYSTEM_ADMIN,
  UserRole.HR_ADMIN,
  UserRole.DEPARTMENT_MANAGER,
  UserRole.PROJECT_MANAGER,
  UserRole.TEAM_LEAD,
];
export const ANALYTICS_ROLES = [...MANAGER_ROLES, UserRole.EXECUTIVE];
