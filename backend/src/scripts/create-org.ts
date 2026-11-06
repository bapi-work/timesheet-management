import 'dotenv/config';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma';
import { PASSWORD_REGEX } from '../utils/sessions';

// Adds an organization and its first System Admin to this server:
//   docker compose exec backend node dist/scripts/create-org.js --name "Acme Ltd" --code ACME --admin-email admin@acme.example
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const name = arg('name');
  const code = arg('code')?.toUpperCase();
  const email = arg('admin-email')?.toLowerCase();
  if (!name || !code || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Usage: create-org --name "Acme Ltd" --code ACME --admin-email admin@acme.example [--admin-password ...]');
  }

  const configured = arg('admin-password');
  if (configured && !PASSWORD_REGEX.test(configured)) {
    throw new Error('Password must be at least 10 characters with uppercase, lowercase, number and special character');
  }
  const password = configured || `Init@${crypto.randomBytes(15).toString('base64url')}`;
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({ data: { name, code } });
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
  });

  console.log(`Created organization "${name}" (${code})`);
  console.log(`Admin email:    ${email}`);
  console.log(configured ? 'Admin password: as provided' : `Admin password: ${password}`);
  console.log('The password must be changed at first sign-in.');
}

main()
  .catch((err) => {
    const duplicate = err?.code === 'P2002';
    console.error(duplicate ? 'That organization code or email is already in use.' : err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
