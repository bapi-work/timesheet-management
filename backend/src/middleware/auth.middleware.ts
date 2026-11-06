import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from '../utils/jwt';
import { UserRole } from '@prisma/client';
import prisma from '../utils/prisma';

export interface AuthRequest extends Request {
  user?: Express.User;
}

const MFA_REQUIRED_ROLES = ['SYSTEM_ADMIN', 'HR_ADMIN', 'PAYROLL_ADMIN'];

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'No token provided' });
    return;
  }

  const token = authHeader.split(' ')[1];
  let payload: TokenPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
    return;
  }

  try {
    // Role, status and revocation come from the database so changes apply immediately
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { email: true, role: true, organizationId: true, isActive: true, sessionVersion: true, mustChangePassword: true, mfaEnabled: true },
    });
    if (!user || !user.isActive || user.sessionVersion !== (payload.sv ?? 0)) {
      res.status(401).json({ message: 'Invalid or expired token' });
      return;
    }

    req.user = { userId: payload.userId, email: user.email, role: user.role, organizationId: user.organizationId, sv: user.sessionVersion };

    // Only the account endpoints stay available until the account is secured
    if (!req.originalUrl.startsWith('/api/auth/')) {
      if (user.mustChangePassword) {
        res.status(403).json({ message: 'You must change your password before continuing', code: 'PASSWORD_CHANGE_REQUIRED' });
        return;
      }
      if (process.env.REQUIRE_ADMIN_MFA !== 'false' && MFA_REQUIRED_ROLES.includes(user.role) && !user.mfaEnabled) {
        res.status(403).json({ message: 'You must enable two-factor authentication before continuing', code: 'MFA_SETUP_REQUIRED' });
        return;
      }
    }
    next();
  } catch (err) {
    next(err);
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

// SYSTEM_ADMIN only — system settings, backup, password/MFA resets
export const SYSTEM_ONLY_ROLES = [UserRole.SYSTEM_ADMIN];

// HR-level — employee & department management, holidays, audit logs, import/export
export const ADMIN_ROLES = [UserRole.SYSTEM_ADMIN, UserRole.HR_ADMIN];

// Payroll processing
export const PAYROLL_ROLES = [UserRole.SYSTEM_ADMIN, UserRole.PAYROLL_ADMIN];

// Management — approve timesheets, manage projects/clients/teams
export const MANAGER_ROLES = [
  UserRole.SYSTEM_ADMIN,
  UserRole.HR_ADMIN,
  UserRole.DEPARTMENT_MANAGER,
  UserRole.PROJECT_MANAGER,
  UserRole.TEAM_LEAD,
];

export const ANALYTICS_ROLES = [...MANAGER_ROLES, UserRole.EXECUTIVE, UserRole.PAYROLL_ADMIN];
