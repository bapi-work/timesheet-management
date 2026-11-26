import { addDays, format, parseISO } from 'date-fns';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import api from './api';

// The server works out displayStatus, so every screen shows the same label for a timesheet
const STATUS: Record<string, { label: string; cls: string }> = {
  NOT_STARTED: { label: 'Not Started', cls: 'badge-yellow' },
  DRAFT:       { label: 'Draft',       cls: 'badge-gray' },
  IN_REVIEW:   { label: 'In Review',   cls: 'badge-blue' },
  SUBMITTED:   { label: 'Submitted',   cls: 'badge-blue' },
  PART_APPROVED: { label: 'Partly Approved', cls: 'badge-green' },
  APPROVED:    { label: 'Approved',    cls: 'badge-green' },
  REJECTED:    { label: 'Rejected',    cls: 'badge-red' },
  LOCKED:      { label: 'Locked',      cls: 'badge-purple' },
};

export function timesheetStatus(status: string | undefined): { label: string; cls: string } {
  return STATUS[status || 'DRAFT'] || { label: status as string, cls: 'badge-gray' };
}

export const ENTRY_TYPE_LABELS: Record<string, string> = {
  REGULAR: 'Regular', OVERTIME: 'Overtime', COMP_OFF: 'Comp Off', ON_CALL: 'On Call',
};

// Server dates are whole days in UTC. Reading them as local time moves them by a day in some timezones.
export const dayOf = (iso: string): string => iso.slice(0, 10);
export const formatDay = (iso: string, fmt = 'MMM d, yyyy'): string => format(parseISO(dayOf(iso)), fmt);
export const formatPeriod = (start: string, end: string): string => `${formatDay(start, 'MMM d')} – ${formatDay(end)}`;

export const todayKey = (): string => format(new Date(), 'yyyy-MM-dd');
export const shiftDay = (iso: string, days: number): string => format(addDays(parseISO(dayOf(iso)), days), 'yyyy-MM-dd');

interface Lockable {
  status: string;
  approvals?: { status: string }[];
  daySubmissions?: { date: string; status: string }[];
}

// The whole week has been sent for approval, as opposed to some of its days
export function isWeekPending(ts: Lockable): boolean {
  return ts.status === 'SUBMITTED' && !!ts.approvals?.some(a => a.status === 'PENDING');
}

// Mirrors the server: nothing awaiting approval, approved or locked can be edited
export function isDayFrozen(ts: Lockable, day: string): boolean {
  if (ts.status === 'LOCKED' || isWeekPending(ts) || ts.approvals?.some(a => a.status === 'APPROVED')) return true;
  const submission = ts.daySubmissions?.find(d => dayOf(d.date) === day);
  return submission?.status === 'SUBMITTED' || submission?.status === 'APPROVED';
}

// Everything that shows hours or a status
export function refreshTimesheets(qc: QueryClient): void {
  ['timesheet', 'timesheets', 'grid-timesheets', 'analytics', 'report', 'calendar-timesheets']
    .forEach(key => qc.invalidateQueries({ queryKey: [key] }));
}

// 0 = Sunday, 1 = Monday
export function useWeekStart(): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  const { data } = useQuery({
    queryKey: ['my-profile'],
    queryFn: () => api.get('/auth/me').then(r => r.data),
  });
  return data?.organization?.weekStartDay ?? 1;
}

// Same rule as the server: digits with the usual separators, 7 to 15 of them
export function validatePhone(value: string | undefined): true | string {
  const v = (value || '').trim();
  const ok = v === '' || (/^\+?[\d\s().-]+$/.test(v) && /^\d{7,15}$/.test(v.replace(/\D/g, '')));
  return ok || 'Enter a valid phone number (7 to 15 digits)';
}
