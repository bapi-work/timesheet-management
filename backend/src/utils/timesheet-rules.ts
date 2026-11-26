import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { AppError } from '../middleware/error.middleware';

type Db = Prisma.TransactionClient | typeof prisma;

const DAY_MS = 24 * 60 * 60 * 1000;

// Entry dates are stored as UTC midnight, so days are always compared in UTC
export const dayKey = (date: Date): string => date.toISOString().slice(0, 10);

export function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function parseDay(value: unknown): Date {
  const date = new Date(String(value));
  if (isNaN(date.getTime())) throw new AppError('Invalid date', 400);
  return utcDay(date);
}

// weekStartDay: 0 = Sunday, 1 = Monday (the default for organizations)
export function weekPeriod(date: Date, weekStartDay = 1): { periodStart: Date; periodEnd: Date } {
  const day = utcDay(date);
  const periodStart = new Date(day.getTime() - ((day.getUTCDay() - weekStartDay + 7) % 7) * DAY_MS);
  return { periodStart, periodEnd: new Date(periodStart.getTime() + 7 * DAY_MS - 1) };
}

// A draft nobody has put anything into. Viewing a week used to create these, so lists leave them out.
export const EMPTY_DRAFT = {
  status: 'DRAFT',
  entries: { none: {} },
  daySubmissions: { none: {} },
  approvals: { none: {} },
} satisfies Prisma.TimesheetWhereInput;

/**
 * The period that a date belongs to for this user. A timesheet that already covers the date
 * keeps its own period, and a new one fits around its neighbours, so changing the week start
 * never leaves a day in two timesheets.
 */
export async function resolvePeriod(
  db: Db,
  userId: string,
  organizationId: string,
  date: Date
): Promise<{ timesheetId: string | null; periodStart: Date; periodEnd: Date }> {
  const day = utcDay(date);
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { weekStartDay: true } });
  let { periodStart, periodEnd } = weekPeriod(day, org.weekStartDay);

  const nearby = await db.timesheet.findMany({
    where: { userId, NOT: EMPTY_DRAFT, periodStart: { lte: periodEnd }, periodEnd: { gte: periodStart } },
    select: { id: true, periodStart: true, periodEnd: true },
  });
  const covering = nearby.find(t => t.periodStart <= day && t.periodEnd >= day);
  if (covering) return { timesheetId: covering.id, periodStart: covering.periodStart, periodEnd: covering.periodEnd };

  for (const t of nearby) {
    if (t.periodEnd < day) {
      const after = new Date(utcDay(t.periodEnd).getTime() + DAY_MS);
      if (after > periodStart) periodStart = after;
    } else if (t.periodStart <= periodEnd) {
      periodEnd = new Date(t.periodStart.getTime() - 1);
    }
  }
  const unused = await db.timesheet.findUnique({
    where: { userId_periodStart_periodEnd: { userId, periodStart, periodEnd } },
    select: { id: true },
  });
  return { timesheetId: unused?.id ?? null, periodStart, periodEnd };
}

export async function getOrCreateTimesheet(db: Db, userId: string, organizationId: string, date: Date) {
  const { timesheetId, periodStart, periodEnd } = await resolvePeriod(db, userId, organizationId, date);
  if (timesheetId) return db.timesheet.findUniqueOrThrow({ where: { id: timesheetId } });
  return db.timesheet.upsert({
    where: { userId_periodStart_periodEnd: { userId, periodStart, periodEnd } },
    update: {},
    create: { userId, periodStart, periodEnd },
  });
}

// An unused timesheet from before its week moved must not be filled in, or its days would overlap another week
export async function assertPeriodCurrent(
  db: Db,
  timesheet: { id: string; userId: string; periodStart: Date },
  organizationId: string
): Promise<void> {
  if ((await db.timesheet.count({ where: { id: timesheet.id, ...EMPTY_DRAFT } })) === 0) return;
  const current = await resolvePeriod(db, timesheet.userId, organizationId, timesheet.periodStart);
  if (current.timesheetId !== timesheet.id) throw new AppError('This week has changed. Open it again from My Timesheet.', 409);
}

// Today's date where the user is, so "future" means the same thing here as on their screen
export async function todayFor(organizationId: string, timezone?: string): Promise<Date> {
  const inZone = (timeZone: string) => new Date(new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date()));
  if (timezone) {
    try { return inZone(timezone); } catch { /* not a known timezone */ }
  }
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { timezone: true } });
  try { return inZone(org.timezone); } catch { return utcDay(new Date()); }
}

export function assertNotFuture(dates: Date[], today: Date): void {
  if (dates.some(d => dayKey(d) > dayKey(today))) throw new AppError('Time cannot be logged or submitted for a future date', 400);
}

export function assertWithinPeriod(timesheet: { periodStart: Date; periodEnd: Date }, date: Date): void {
  if (isNaN(date.getTime())) throw new AppError('Invalid entry date', 400);
  // Older periods may have been stored in server-local time, so allow one day of drift
  if (date.getTime() < timesheet.periodStart.getTime() - DAY_MS || date.getTime() > timesheet.periodEnd.getTime() + DAY_MS) {
    throw new AppError('Entry date is outside this timesheet period', 400);
  }
}

// Hours can only be logged against this organization's projects and tasks
export async function assertEntryLinksInOrg(orgId: string, projectId?: string | null, taskId?: string | null): Promise<void> {
  if (projectId) {
    const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: orgId }, select: { id: true } });
    if (!project) throw new AppError('Project not found', 404);
  }
  if (taskId) {
    const task = await prisma.task.findFirst({
      where: { id: taskId, project: { organizationId: orgId }, ...(projectId ? { projectId } : {}) },
      select: { id: true },
    });
    if (!task) throw new AppError('Task not found', 404);
  }
}

// What displayStatus needs, for queries that don't already load it
export const DISPLAY_STATUS_SELECT = {
  status: true,
  approvals: { select: { status: true } },
  daySubmissions: { select: { date: true, status: true } },
  entries: { select: { date: true } },
} satisfies Prisma.TimesheetSelect;

export type DisplayStatus = 'DRAFT' | 'IN_REVIEW' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'LOCKED';

/**
 * The status shown on every screen. Submitting a day doesn't change the stored status, so it has
 * to be worked out from both. IN_REVIEW means some days are awaiting approval; SUBMITTED means
 * the whole week is.
 */
export function displayStatus(timesheet: {
  status: string;
  approvals: { status: string }[];
  daySubmissions: { date: Date; status: string }[];
  entries: { date: Date }[];
}): DisplayStatus {
  const { status, approvals, daySubmissions, entries } = timesheet;
  if (status === 'LOCKED' || status === 'APPROVED') return status;
  if (status === 'SUBMITTED' && approvals.some(a => a.status === 'PENDING')) return 'SUBMITTED';

  const byDay = new Map(daySubmissions.map(d => [dayKey(d.date), d.status]));
  const loggedDays = [...new Set(entries.map(e => dayKey(e.date)))].map(day => byDay.get(day));
  if (loggedDays.length === 0) return 'DRAFT';
  if (loggedDays.includes('REJECTED')) return 'REJECTED';
  if (loggedDays.includes('SUBMITTED')) return 'IN_REVIEW';
  if (status === 'REJECTED') return 'REJECTED';
  return loggedDays.every(s => s === 'APPROVED') ? 'APPROVED' : 'DRAFT';
}

export async function loadEditState(db: Db, timesheetId: string) {
  const [approvals, days] = await Promise.all([
    db.timesheetApproval.findMany({ where: { timesheetId, status: { in: ['APPROVED', 'PENDING'] } }, select: { status: true } }),
    db.daySubmission.findMany({ where: { timesheetId, status: { in: ['APPROVED', 'SUBMITTED'] } }, select: { date: true, status: true } }),
  ]);
  const daysWith = (status: string) => new Set(days.filter(d => d.status === status).map(d => dayKey(d.date)));
  return {
    weekApproved: approvals.some(a => a.status === 'APPROVED'),
    weekPending: approvals.some(a => a.status === 'PENDING'),
    approvedDays: daysWith('APPROVED'),
    pendingDays: daysWith('SUBMITTED'),
  };
}

/**
 * Hours can't change while they're awaiting approval or once they've been approved. A whole-week
 * submission, approval or payroll lock freezes the timesheet; a submitted or approved day freezes
 * that day only, so the rest of the week can still be logged under per-day submission.
 */
export async function assertDatesEditable(
  db: Db,
  timesheet: { id: string; status: string },
  dates: Date[]
): Promise<void> {
  if (timesheet.status === 'LOCKED') throw new AppError('Cannot edit a locked timesheet', 400);
  const state = await loadEditState(db, timesheet.id);
  if (state.weekApproved) throw new AppError('This timesheet has been approved and can no longer be edited', 409);
  if (timesheet.status === 'SUBMITTED' && state.weekPending) {
    throw new AppError('This timesheet is awaiting approval. Withdraw it before making changes.', 409);
  }
  if (dates.some(d => state.approvedDays.has(dayKey(d)))) {
    throw new AppError('This day has been approved and can no longer be edited', 409);
  }
  if (dates.some(d => state.pendingDays.has(dayKey(d)))) {
    throw new AppError('This day is awaiting approval. Withdraw it before making changes.', 409);
  }
}

// New hours on a week whose logged days were all approved mean the week as a whole no longer is
export async function reopenForEdit(db: Db, timesheet: { id: string; status: string }): Promise<void> {
  if (timesheet.status === 'SUBMITTED' || timesheet.status === 'APPROVED') {
    await db.timesheet.update({
      where: { id: timesheet.id },
      data: { status: 'DRAFT', submittedAt: null, approvedAt: null },
    });
  }
}

// A rejection or withdrawal means nothing once the day's entries are gone
export async function clearEmptyDays(db: Db, timesheetId: string): Promise<void> {
  const [entries, days] = await Promise.all([
    db.timesheetEntry.findMany({ where: { timesheetId }, select: { date: true } }),
    db.daySubmission.findMany({ where: { timesheetId, status: { in: ['REJECTED', 'WITHDRAWN'] } }, select: { id: true, date: true } }),
  ]);
  const logged = new Set(entries.map(e => dayKey(e.date)));
  const stale = days.filter(d => !logged.has(dayKey(d.date))).map(d => d.id);
  if (stale.length > 0) await db.daySubmission.deleteMany({ where: { id: { in: stale } } });
  if (entries.length === 0) {
    await db.timesheet.updateMany({ where: { id: timesheetId, status: 'REJECTED' }, data: { status: 'DRAFT', submittedAt: null } });
  }
}

export async function recalcTotals(db: Db, timesheetId: string): Promise<void> {
  const entries = await db.timesheetEntry.findMany({ where: { timesheetId } });
  const totalHours = entries.reduce((s, e) => s + e.hours, 0);
  const billableHours = entries.filter(e => e.isBillable).reduce((s, e) => s + e.hours, 0);
  const overtimeHours = entries.filter(e => e.entryType === 'OVERTIME').reduce((s, e) => s + e.hours, 0);
  await db.timesheet.update({ where: { id: timesheetId }, data: { totalHours, billableHours, overtimeHours } });
}
