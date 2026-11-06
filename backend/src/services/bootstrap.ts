import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma';
import { logger } from '../utils/logger';
import { PASSWORD_REGEX } from '../utils/sessions';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DEMO_ACCOUNTS = [
  { email: 'admin@acme.com', password: 'Admin@123' },
  { email: 'hr@acme.com', password: 'HRAdmin@123' },
  { email: 'john.doe@acme.com', password: 'Employee@123' },
];

// Uses console rather than the logger so the password isn't written to the log files
function printInitialCredentials(email: string, password: string | null): void {
  console.log([
    '',
    '================================================================',
    '  FIRST-RUN ADMIN ACCOUNT CREATED',
    `  Email:    ${email}`,
    password ? `  Password: ${password}` : '  Password: the value of INITIAL_ADMIN_PASSWORD',
    '  You must change this password when you first sign in.',
    password ? '  It is only shown once and is not stored anywhere readable.' : '',
    '================================================================',
    '',
  ].join('\n'));
}

/**
 * On first deployment (no users in the database) creates the organization and one
 * System Admin, so the application can be signed in to without running the demo seed.
 * Does nothing once any user exists.
 */
export async function ensureInitialAdmin(): Promise<void> {
  if ((await prisma.user.count()) > 0) return;

  const email = (process.env.INITIAL_ADMIN_EMAIL || 'admin@timesheet.local').trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) throw new Error('INITIAL_ADMIN_EMAIL is not a valid email address');

  const configured = process.env.INITIAL_ADMIN_PASSWORD;
  if (configured && !PASSWORD_REGEX.test(configured)) {
    throw new Error('INITIAL_ADMIN_PASSWORD must be at least 10 characters with uppercase, lowercase, number and special character (@$!%*?&_-#)');
  }
  const generated = configured ? null : `Init@${crypto.randomBytes(15).toString('base64url')}`;
  const passwordHash = await bcrypt.hash(configured || generated!, 12);

  const created = await prisma.$transaction(async (tx) => {
    // Replicas may start together; only one of them should create the account
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(727401)`;
    if ((await tx.user.count()) > 0) return false;

    const organization = await tx.organization.findFirst()
      ?? await tx.organization.create({
        data: { name: process.env.INITIAL_ORG_NAME || 'My Organization', code: 'DEFAULT' },
      });

    await tx.user.create({
      data: {
        employeeId: 'ADMIN-001',
        email,
        firstName: 'System',
        lastName: 'Administrator',
        role: 'SYSTEM_ADMIN',
        passwordHash,
        mustChangePassword: true,
        organizationId: organization.id,
      },
    });
    return true;
  });

  if (created) printInitialCredentials(email, generated);
}

// Anyone who has read this repository knows these passwords
export async function flagDemoCredentials(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') return;

  for (const account of DEMO_ACCOUNTS) {
    const user = await prisma.user.findUnique({ where: { email: account.email }, select: { id: true, passwordHash: true, isActive: true } });
    if (!user?.isActive || !user.passwordHash) continue;
    if (await bcrypt.compare(account.password, user.passwordHash)) {
      await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });
      logger.error(`SECURITY: ${account.email} still uses its published demo password. Change or deactivate this account now.`);
    }
  }
}
