import 'dotenv/config';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma';
import redis from '../utils/redis';

// Lists System Admins, or gives a user a new temporary password when they can't sign in:
//   docker compose exec backend node dist/scripts/reset-password.js
//   docker compose exec backend node dist/scripts/reset-password.js --email admin@acme.example [--reset-mfa]
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function listAdmins(): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { role: 'SYSTEM_ADMIN' },
    select: { email: true, isActive: true, mfaEnabled: true, organization: { select: { code: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (admins.length === 0) {
    console.log('No System Admins exist yet. One is created when the backend starts with an empty database.');
    return;
  }
  console.log('System Admins:');
  for (const a of admins) {
    console.log(`  ${a.email}  org=${a.organization.code}  ${a.isActive ? 'active' : 'INACTIVE'}  mfa=${a.mfaEnabled ? 'on' : 'off'}`);
  }
  console.log('\nTo reset one: node dist/scripts/reset-password.js --email <email> [--reset-mfa]');
}

async function main(): Promise<void> {
  const email = arg('email');
  if (!email) return listAdmins();

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, email: true },
  });
  if (!user) throw new Error(`No user with email ${email}`);

  const resetMfa = process.argv.includes('--reset-mfa');
  const password = `Reset@${crypto.randomBytes(15).toString('base64url')}`;
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(password, 12),
      mustChangePassword: true,
      isActive: true,
      // Signs out every existing session
      sessionVersion: { increment: 1 },
      ...(resetMfa ? { mfaEnabled: false, mfaSecret: null, mfaPendingSecret: null } : {}),
    },
  });

  // Clear sign-in lockouts left by earlier failed attempts
  const lowered = user.email.toLowerCase();
  const keys = [
    ...(await redis.keys(`login:attempts:${lowered}:*`)),
    ...(await redis.keys(`login:lock:${lowered}:*`)),
    `login:attempts-all:${lowered}`,
    `login:lock-all:${lowered}`,
  ];
  await redis.del(...keys);

  console.log(`Email:              ${user.email}`);
  console.log(`Temporary password: ${password}`);
  console.log('It must be changed at the next sign-in.');
  if (resetMfa) console.log('MFA was turned off; admins are asked to set it up again after signing in.');
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
