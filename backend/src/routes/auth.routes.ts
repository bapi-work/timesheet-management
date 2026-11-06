import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import speakeasy from 'speakeasy';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import prisma from '../utils/prisma';
import redis from '../utils/redis';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken, TokenPayload } from '../utils/jwt';
import { hashToken, PASSWORD_REGEX, revokeSessions, stripSecrets } from '../utils/sessions';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';

const router = Router();

// Applies to credential checks only; /me and /refresh run on normal page use
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  mfaCode: z.string().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string()
    .min(10, 'Password must be at least 10 characters')
    .regex(PASSWORD_REGEX, 'Password must contain uppercase, lowercase, number and special character (@$!%*?&_-#)'),
});

const setupMfaSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  mfaCode: z.string().optional(),
});

const verifyMfaSchema = z.object({
  code: z.string().min(1, 'Code is required'),
});

// ISO 27001 A.9.4: Track failed login attempts in Redis (distributed, survives restarts)
const MAX_FAILED = 5;
const LOCKOUT_SECS = 30 * 60; // 30 minutes
const REFRESH_COOKIE_PATH = '/api/auth';
const lockKey = (email: string) => `login:lock:${email.toLowerCase()}`;
const attemptsKey = (email: string) => `login:attempts:${email.toLowerCase()}`;

// Counts wrong passwords and wrong MFA codes alike; locks after MAX_FAILED
async function recordFailedAttempt(email: string): Promise<void> {
  const count = await redis.incr(attemptsKey(email));
  if (count === 1) await redis.expire(attemptsKey(email), LOCKOUT_SECS);
  if (count >= MAX_FAILED) {
    await redis.set(lockKey(email), '1', 'EX', LOCKOUT_SECS);
    await redis.del(attemptsKey(email));
  }
}

// A code is valid once: replaying one seen on the wire or over a shoulder fails
async function verifyTotp(userId: string, secret: string, code: string): Promise<boolean> {
  const verified = speakeasy.totp.verify({ secret, encoding: 'base32', token: code, window: 1 });
  if (!verified) return false;
  const firstUse = await redis.set(`mfa:used:${userId}:${code}`, '1', 'EX', 120, 'NX');
  return firstUse === 'OK';
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie('refreshToken', token, {
    httpOnly: true,          // Always httpOnly — never accessible via JS (ISO 27001 A.13.2)
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',      // CSRF protection
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: REFRESH_COOKIE_PATH, // Restrict cookie scope to auth endpoints only
  });
}

async function startSession(res: Response, payload: TokenPayload): Promise<string> {
  const refreshToken = generateRefreshToken(payload);
  await prisma.refreshToken.create({
    data: {
      token: hashToken(refreshToken),
      userId: payload.userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  setRefreshCookie(res, refreshToken);
  return generateAccessToken(payload);
}

router.post('/login', credentialLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, mfaCode } = loginSchema.parse(req.body);

    // ISO 27001 A.9.4: Check account lockout via Redis
    const ttl = await redis.ttl(lockKey(email));
    if (ttl > 0) {
      const minutesLeft = Math.ceil(ttl / 60);
      throw new AppError(`Account temporarily locked. Try again in ${minutesLeft} minute(s).`, 423);
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true, email: true, passwordHash: true, role: true,
        organizationId: true, firstName: true, lastName: true,
        isActive: true, mfaEnabled: true, mfaSecret: true,
        avatarUrl: true, employeeId: true, ipWhitelist: true, gender: true,
        mustChangePassword: true, sessionVersion: true,
      },
    });

    if (!user || !user.isActive) throw new AppError('Invalid credentials', 401);
    if (!user.passwordHash) throw new AppError('Please use SSO to login', 401);

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await recordFailedAttempt(email);
      throw new AppError('Invalid credentials', 401);
    }

    // ISO 27001 A.9.4: IP whitelist check
    // Use req.ip which respects Express `trust proxy` setting — never read X-Forwarded-For directly
    if (user.ipWhitelist && user.ipWhitelist.length > 0) {
      const clientIp = req.ip || '';
      if (!user.ipWhitelist.includes(clientIp)) {
        throw new AppError('Access denied from this IP address', 403);
      }
    }

    if (user.mfaEnabled) {
      if (!mfaCode) {
        res.json({ requiresMfa: true });
        return;
      }
      if (!(await verifyTotp(user.id, user.mfaSecret!, mfaCode))) {
        await recordFailedAttempt(email);
        throw new AppError('Invalid MFA code', 401);
      }
    }

    // Clear failed attempts only after every factor has passed
    await redis.del(attemptsKey(email));
    await redis.del(lockKey(email));

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const accessToken = await startSession(res, {
      userId: user.id, email: user.email, role: user.role, organizationId: user.organizationId, sv: user.sessionVersion,
    });

    res.json({ accessToken, user: stripSecrets(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies.refreshToken;
    if (!token) throw new AppError('No refresh token', 401);

    const stored = await prisma.refreshToken.findUnique({ where: { token: hashToken(token) } });
    if (!stored || stored.expiresAt < new Date()) {
      throw new AppError('Invalid refresh token', 401);
    }

    let payload: TokenPayload;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      throw new AppError('Invalid refresh token', 401);
    }

    // Issue tokens from the current account state, not what it was at login
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || !user.isActive || user.sessionVersion !== (payload.sv ?? 0)) {
      await prisma.refreshToken.deleteMany({ where: { id: stored.id } });
      throw new AppError('Invalid refresh token', 401);
    }

    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      sv: user.sessionVersion,
    });

    res.json({ accessToken });
  } catch (err) {
    next(err);
  }
});

// Doesn't require an access token, so an expired session can still be ended
router.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies.refreshToken;
    if (token) {
      await prisma.refreshToken.deleteMany({ where: { token: hashToken(token) } });
    }
    res.clearCookie('refreshToken', { path: REFRESH_COOKIE_PATH });
    res.json({ message: 'Logged out' });
  } catch (err) {
    next(err);
  }
});

router.post('/change-password', credentialLimiter, authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user?.passwordHash) throw new AppError('No password set', 400);

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new AppError('Incorrect current password', 400);

    const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSamePassword) throw new AppError('New password must differ from current password', 400);

    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: hash, mustChangePassword: false } });
      await revokeSessions(user.id, tx);
    });

    // Every other device is signed out; this one continues on a new session
    const accessToken = await startSession(res, {
      userId: user.id, email: user.email, role: user.role, organizationId: user.organizationId, sv: user.sessionVersion + 1,
    });
    res.json({ message: 'Password updated', accessToken });
  } catch (err) {
    next(err);
  }
});

router.post('/setup-mfa', credentialLimiter, authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, mfaCode } = setupMfaSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) throw new AppError('User not found', 404);

    // A stolen access token alone must not be able to replace the second factor
    if (!user.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new AppError('Incorrect current password', 400);
    }
    if (user.mfaEnabled && !(mfaCode && user.mfaSecret && await verifyTotp(user.id, user.mfaSecret, mfaCode))) {
      throw new AppError('A valid code from your current authenticator is required', 400);
    }

    const secret = speakeasy.generateSecret({ name: `Timesheet:${req.user!.email}`, length: 20 });
    // Stored as pending: the existing factor keeps working until the new one is verified
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { mfaPendingSecret: secret.base32 },
    });
    res.json({ secret: secret.base32, otpauthUrl: secret.otpauth_url });
  } catch (err) {
    next(err);
  }
});

router.post('/verify-mfa', credentialLimiter, authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code } = verifyMfaSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user?.mfaPendingSecret) throw new AppError('MFA not set up', 400);

    if (!(await verifyTotp(user.id, user.mfaPendingSecret, code))) throw new AppError('Invalid code', 400);

    await prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true, mfaSecret: user.mfaPendingSecret, mfaPendingSecret: null },
    });
    res.json({ message: 'MFA enabled' });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: {
        department: { select: { id: true, name: true } },
        manager: { select: { id: true, firstName: true, lastName: true, email: true } },
        organization: { select: { id: true, name: true, timezone: true, timesheetPeriod: true } },
      },
    });
    if (!user) throw new AppError('User not found', 404);
    res.json(stripSecrets(user));
  } catch (err) {
    next(err);
  }
});

export default router;
