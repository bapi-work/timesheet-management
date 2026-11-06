import { Prisma } from '@prisma/client';
import { endOfWeek, startOfDay, startOfWeek } from 'date-fns';
import prisma from './prisma';
import { AppError } from '../middleware/error.middleware';

type Db = Prisma.TransactionClient | typeof prisma;

// The timesheet screens all work in Sunday-to-Saturday weeks
export function weekPeriod(date: Date): { periodStart: Date; periodEnd: Date } {
  return {
    periodStart: startOfWeek(date, { weekStartsOn: 0 }),
    periodEnd: endOfWeek(date, { weekStartsOn: 0 }),
  };
}

export function assertWithinPeriod(timesheet: { periodStart: Date; periodEnd: Date }, date: Date): void {
  if (isNaN(date.getTime())) throw new AppError('Invalid entry date', 400);
  // Dates arrive as UTC midnight while periods use server-local time, so allow one day of drift
  const dayMs = 24 * 60 * 60 * 1000;
  if (date.getTime() < timesheet.periodStart.getTime() - dayMs || date.getTime() > timesheet.periodEnd.getTime() + dayMs) {
    throw new AppError('Entry date is outside this timesheet period', 400);
  }
}

export async function loadEditState(db: Db, timesheetId: string) {
  const [weekApprovals, approvedDays] = await Promise.all([
    db.timesheetApproval.count({ where: { timesheetId, status: 'APPROVED' } }),
    db.daySubmission.findMany({ where: { timesheetId, status: 'APPROVED' }, select: { date: true } }),
  ]);
  return {
    weekApproved: weekApprovals > 0,
    approvedDays: new Set(approvedDays.map(d => startOfDay(d.date).getTime())),
  };
}

/**
 * Hours can't change once they've been approved. A whole-week approval or a payroll lock
 * freezes the timesheet; an approved day freezes that day only, so the rest of the week
 * can still be logged under per-day submission.
 */
export async function assertDatesEditable(
  db: Db,
  timesheet: { id: string; status: string },
  dates: Date[]
): Promise<void> {
  if (timesheet.status === 'LOCKED') throw new AppError('Cannot edit a locked timesheet', 400);
  const state = await loadEditState(db, timesheet.id);
  if (state.weekApproved) throw new AppError('This timesheet has been approved and can no longer be edited', 409);
  if (dates.some(d => state.approvedDays.has(startOfDay(d).getTime()))) {
    throw new AppError('This day has been approved and can no longer be edited', 409);
  }
}

// Changed hours need a fresh review, so pending approvals and day submissions are withdrawn
export async function reopenForEdit(
  db: Db,
  timesheet: { id: string; status: string },
  dates: Date[]
): Promise<void> {
  if (timesheet.status === 'SUBMITTED' || timesheet.status === 'APPROVED') {
    await db.timesheet.update({
      where: { id: timesheet.id },
      data: { status: 'DRAFT', submittedAt: null, approvedAt: null },
    });
    await db.timesheetApproval.deleteMany({ where: { timesheetId: timesheet.id, status: 'PENDING' } });
  }
  const days = [...new Set(dates.map(d => startOfDay(d).getTime()))].map(t => new Date(t));
  if (days.length > 0) {
    await db.daySubmission.updateMany({
      where: { timesheetId: timesheet.id, date: { in: days }, status: 'SUBMITTED' },
      data: { status: 'WITHDRAWN' },
    });
  }
}

export async function recalcTotals(db: Db, timesheetId: string): Promise<void> {
  const entries = await db.timesheetEntry.findMany({ where: { timesheetId } });
  const totalHours = entries.reduce((s, e) => s + e.hours, 0);
  const billableHours = entries.filter(e => e.isBillable).reduce((s, e) => s + e.hours, 0);
  const overtimeHours = entries.filter(e => e.entryType === 'OVERTIME').reduce((s, e) => s + e.hours, 0);
  await db.timesheet.update({ where: { id: timesheetId }, data: { totalHours, billableHours, overtimeHours } });
}
