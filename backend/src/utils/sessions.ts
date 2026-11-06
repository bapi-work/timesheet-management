import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from './prisma';

export const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&_\-#])[A-Za-z\d@$!%*?&_\-#]{10,}/;

export function generateTempPassword(): string {
  return `TempPass@${crypto.randomBytes(12).toString('base64url')}`;
}

// Refresh tokens are stored hashed so a database read doesn't expose usable sessions
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Invalidates every access and refresh token the user currently holds
export async function revokeSessions(
  userId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
  await db.refreshToken.deleteMany({ where: { userId } });
}

export function stripSecrets<T extends { passwordHash?: unknown; mfaSecret?: unknown; mfaPendingSecret?: unknown; sessionVersion?: unknown }>(
  user: T
): Omit<T, 'passwordHash' | 'mfaSecret' | 'mfaPendingSecret' | 'sessionVersion'> {
  const { passwordHash, mfaSecret, mfaPendingSecret, sessionVersion, ...safe } = user;
  void passwordHash; void mfaSecret; void mfaPendingSecret; void sessionVersion;
  return safe;
}
