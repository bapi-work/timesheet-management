import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import speakeasy from 'speakeasy';
import { z } from 'zod';
import prisma from '../utils/prisma';
import redis from '../utils/redis';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';

const router = Router();

const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&_\-#])[A-Za-z\d@$!%*?&_\-#]{10,}/;

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

// ISO 27001 A.9.4: Track failed login attempts in Redis (distributed, survives restarts)
const MAX_FAILED = 5;
const LOCKOUT_SECS = 30 * 60; // 30 minutes
const lockKey = (email: string) => `login:lock:${email}`;
const attemptsKey = (email: string) => `login:attempts:${email}`;

router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
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
        avatarUrl: true, employeeId: true, ipWhitelist: true,
      },
    });

    if (!user || !user.isActive) throw new AppError('Invalid credentials', 401);
    if (!user.passwordHash) throw new AppError('Please use SSO to login', 401);

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      // Increment attempt counter in Redis; lock after MAX_FAILED (distributed, survives restarts)
      const count = await redis.incr(attemptsKey(email));
      if (count === 1) await redis.expire(attemptsKey(email), LOCKOUT_SECS);
      if (count >= MAX_FAILED) {
        await redis.set(lockKey(email), '1', 'EX', LOCKOUT_SECS);
        await redis.del(attemptsKey(email));
      }
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

    // Clear failed attempts on success
    await redis.del(attemptsKey(email));
    await redis.del(lockKey(email));

    if (user.mfaEnabled) {
      if (!mfaCode) {
        res.json({ requiresMfa: true });
        return;
      }
      const verified = speakeasy.totp.verify({
        secret: user.mfaSecret!,
        encoding: 'base32',
        token: mfaCode,
        window: 2,
      });
      if (!verified) throw new AppError('Invalid MFA code', 401);
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const payload = { userId: user.id, email: user.email, role: user.role, organizationId: user.organizationId };
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,          // Always httpOnly — never accessible via JS (ISO 27001 A.13.2)
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',      // CSRF protection
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/auth',       // Restrict cookie scope to auth endpoints only
    });

    const { passwordHash: _, mfaSecret: __, ...safeUser } = user;
    res.json({ accessToken, user: safeUser });
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies.refreshToken || req.body.refreshToken;
    if (!token) throw new AppError('No refresh token', 401);

    const stored = await prisma.refreshToken.findUnique({ where: { token } });
    if (!stored || stored.expiresAt < new Date()) {
      throw new AppError('Invalid refresh token', 401);
    }

    const payload = verifyRefreshToken(token);
    const accessToken = generateAccessToken({
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      organizationId: payload.organizationId,
    });

    res.json({ accessToken });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies.refreshToken;
    if (token) {
      await prisma.refreshToken.deleteMany({ where: { token } });
    }
    res.clearCookie('refreshToken');
    res.json({ message: 'Logged out' });
  } catch (err) {
    next(err);
  }
});

router.post('/change-password', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user?.passwordHash) throw new AppError('No password set', 400);

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new AppError('Incorrect current password', 400);

    const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSamePassword) throw new AppError('New password must differ from current password', 400);

    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
    res.json({ message: 'Password updated' });
  } catch (err) {
    next(err);
  }
});

router.post('/setup-mfa', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const secret = speakeasy.generateSecret({ name: `Timesheet:${req.user!.email}`, length: 20 });
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { mfaSecret: secret.base32 },
    });
    res.json({ secret: secret.base32, otpauthUrl: secret.otpauth_url });
  } catch (err) {
    next(err);
  }
});

router.post('/verify-mfa', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user?.mfaSecret) throw new AppError('MFA not set up', 400);

    const verified = speakeasy.totp.verify({
      secret: user.mfaSecret,
      encoding: 'base32',
      token: code,
      window: 2,
    });
    if (!verified) throw new AppError('Invalid code', 400);

    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
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
    const { passwordHash, mfaSecret, ...safeUser } = user;
    res.json(safeUser);
  } catch (err) {
    next(err);
  }
});

export default router;
