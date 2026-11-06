import bcrypt from 'bcryptjs';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import app from '../src/app';
import prisma from '../src/utils/prisma';
import redis from '../src/utils/redis';
import { generateAccessToken } from '../src/utils/jwt';

export { app, prisma, redis };

export const PASSWORD = 'Correct-Horse1';
let passwordHash: string;
let counter = 0;

export async function resetDatabase(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(t => `"${t.tablename}"`).join(', ')} CASCADE`);
  await redis.flushall();
}

export async function createOrg(name = 'Org') {
  counter++;
  return prisma.organization.create({ data: { name, code: `ORG${counter}` } });
}

export async function createUser(organizationId: string, role: UserRole = 'EMPLOYEE', extra: Record<string, unknown> = {}) {
  passwordHash ??= await bcrypt.hash(PASSWORD, 4);
  counter++;
  return prisma.user.create({
    data: {
      employeeId: `E${counter}`,
      email: `user${counter}@test.local`,
      firstName: 'Test',
      lastName: `User${counter}`,
      role,
      organizationId,
      passwordHash,
      ...extra,
    },
  });
}

type TestUser = { id: string; email: string; role: string; organizationId: string; sessionVersion: number };

export function tokenFor(user: TestUser): string {
  return generateAccessToken({ userId: user.id, email: user.email, role: user.role, organizationId: user.organizationId, sv: user.sessionVersion });
}

// Each client gets its own IP so rate limits don't carry between tests
export function as(user: TestUser) {
  const auth = { Authorization: `Bearer ${tokenFor(user)}` };
  return {
    get: (url: string) => request(app).get(url).set(auth),
    post: (url: string) => request(app).post(url).set(auth),
    put: (url: string) => request(app).put(url).set(auth),
    delete: (url: string) => request(app).delete(url).set(auth),
  };
}

export function anonymous() {
  counter++;
  const ip = `198.51.100.${counter % 250}`;
  return {
    get: (url: string) => request(app).get(url).set('X-Forwarded-For', ip),
    post: (url: string) => request(app).post(url).set('X-Forwarded-For', ip),
  };
}

// A timesheet for the week containing Wed 2026-03-04, submitted with one pending approval per approver
export const WEEK = { start: new Date('2026-03-01T00:00:00.000Z'), end: new Date('2026-03-07T23:59:59.999Z'), entryDate: '2026-03-04' };

export async function createTimesheet(userId: string, status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'LOCKED' = 'DRAFT', approverIds: string[] = []) {
  const timesheet = await prisma.timesheet.create({
    data: {
      userId,
      periodStart: WEEK.start,
      periodEnd: WEEK.end,
      status,
      totalHours: 8,
      entries: { create: { date: new Date(WEEK.entryDate), hours: 8 } },
    },
    include: { entries: true },
  });
  const approvals = [];
  for (const approverId of approverIds) {
    approvals.push(await prisma.timesheetApproval.create({
      data: { timesheetId: timesheet.id, approverId, level: 1, status: 'PENDING', dueDate: new Date(Date.now() + 86400000) },
    }));
  }
  return { timesheet, approvals };
}
