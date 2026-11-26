import { beforeEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { as, createOrg, createUser, prisma, resetDatabase } from './helpers';
import { dayKey, displayStatus, resolvePeriod, weekPeriod } from '../src/utils/timesheet-rules';

beforeEach(resetDatabase);

const DAY_MS = 86400000;
const today = () => new Date(`${dayKey(new Date())}T00:00:00.000Z`);
const inDays = (n: number) => dayKey(new Date(today().getTime() + n * DAY_MS));

// Wed 2026-03-04; its Monday week is Mar 2 - 8
const WED = '2026-03-04';
const THU = '2026-03-05';
const entry = (date: string, extra: Record<string, unknown> = {}) => ({ date, hours: 2, description: 'Work', ...extra });

async function setup() {
  const org = await createOrg();
  const manager = await createUser(org.id, 'DEPARTMENT_MANAGER');
  const emp = await createUser(org.id, 'EMPLOYEE', { managerId: manager.id });
  return { org, manager, emp };
}

type User = Awaited<ReturnType<typeof createUser>>;

async function sheetWith(emp: User, ...dates: string[]) {
  const sheet = (await as(emp).post('/api/timesheets').send({ date: dates[0] })).body;
  for (const date of dates) expect((await as(emp).post(`/api/timesheets/${sheet.id}/entries`).send(entry(date))).status).toBe(201);
  return sheet;
}

const submitDay = (emp: User, id: string, day: string) => as(emp).post(`/api/timesheets/${id}/days/${day}/submit`);

async function review(manager: User, id: string, decision: 'approve' | 'reject') {
  const sub = await prisma.daySubmission.findFirstOrThrow({ where: { timesheetId: id, status: 'SUBMITTED' } });
  return as(manager).post(`/api/approvals/day-submissions/${sub.id}/${decision}`).send({ comments: 'Reviewed' });
}

// The status each screen shows for one timesheet
async function statuses(emp: User, id: string) {
  const list = (await as(emp).get('/api/timesheets')).body.timesheets.find((t: { id: string }) => t.id === id);
  const recent = (await as(emp).get('/api/analytics/dashboard')).body.recentTimesheets.find((t: { id: string }) => t.id === id);
  const detail = (await as(emp).get(`/api/timesheets/${id}`)).body;
  return [list?.displayStatus, recent?.displayStatus, detail.displayStatus];
}

const tab = async (user: User, status: string) =>
  (await as(user).get(`/api/timesheets?status=${status}`)).body.timesheets.map((t: { id: string }) => t.id);

describe('weeks', () => {
  it('run Monday to Sunday by default, and follow the organization setting', () => {
    const range = (day: string, start?: number) => Object.values(weekPeriod(new Date(day), start)).map(dayKey);
    expect(range('2026-11-18')).toEqual(['2026-11-16', '2026-11-22']);
    expect(range('2026-11-22')).toEqual(['2026-11-16', '2026-11-22']);
    expect(range('2026-11-23')).toEqual(['2026-11-23', '2026-11-29']);
    expect(range('2026-11-18', 0)).toEqual(['2026-11-15', '2026-11-21']);
  });

  it('keep timesheets from Sunday weeks, and never put a day in two timesheets', async () => {
    const { org, emp } = await setup();
    const old = await prisma.timesheet.create({
      data: {
        userId: emp.id, periodStart: new Date('2026-02-22T00:00:00Z'), periodEnd: new Date('2026-02-28T23:59:59.999Z'),
        entries: { create: { date: new Date('2026-02-25'), hours: 8 } },
      },
    });
    const at = async (day: string) => {
      const p = await resolvePeriod(prisma, emp.id, org.id, new Date(day));
      return [p.timesheetId, dayKey(p.periodStart), dayKey(p.periodEnd)];
    };
    expect(await at('2026-02-22')).toEqual([old.id, '2026-02-22', '2026-02-28']);
    expect(await at('2026-02-28')).toEqual([old.id, '2026-02-22', '2026-02-28']);
    expect(await at('2026-03-01')).toEqual([null, '2026-03-01', '2026-03-01']);
    expect(await at('2026-03-02')).toEqual([null, '2026-03-02', '2026-03-08']);
    expect(await at('2026-02-21')).toEqual([null, '2026-02-16', '2026-02-21']);
  });

  it('are not turned into a timesheet by looking at them', async () => {
    const { emp } = await setup();
    const res = await as(emp).get(`/api/timesheets/current?week=${WED}`);
    expect([res.body.id, res.body.displayStatus, dayKey(new Date(res.body.periodStart))]).toEqual([null, 'DRAFT', '2026-03-02']);
    expect(await prisma.timesheet.count()).toBe(0);

    // Empty drafts left over from when viewing did create them stay out of sight
    const leftover = await prisma.timesheet.create({ data: { userId: emp.id, periodStart: new Date('2026-03-01T00:00:00Z'), periodEnd: new Date('2026-03-07T23:59:59.999Z') } });
    expect((await as(emp).get('/api/timesheets')).body.timesheets).toEqual([]);
    expect((await as(emp).get('/api/analytics/dashboard')).body.recentTimesheets).toEqual([]);
    expect((await as(emp).post(`/api/timesheets/${leftover.id}/entries`).send(entry(WED))).status).toBe(409);
  });
});

describe('employee dashboard', () => {
  it('shows this week\'s hours and status', async () => {
    const { emp } = await setup();
    const empty = (await as(emp).get('/api/analytics/dashboard')).body;
    expect([empty.currentTimesheetStatus, empty.hoursThisWeek]).toEqual(['NOT_STARTED', 0]);

    await sheetWith(emp, inDays(0));
    const body = (await as(emp).get('/api/analytics/dashboard')).body;
    expect([body.currentTimesheetStatus, body.hoursThisWeek, body.billableHoursThisWeek]).toEqual(['DRAFT', 2, 2]);
  });

  it('finds a current week that was stored Sunday to Saturday', async () => {
    const { emp } = await setup();
    const { periodStart, periodEnd } = weekPeriod(today(), 0);
    await prisma.timesheet.create({ data: { userId: emp.id, periodStart, periodEnd, totalHours: 10.25, entries: { create: { date: today(), hours: 10.25 } } } });
    const body = (await as(emp).get('/api/analytics/dashboard')).body;
    expect([body.currentTimesheetStatus, body.hoursThisWeek]).toEqual(['DRAFT', 10.25]);
  });
});

describe('timesheet status', () => {
  it('is the same on the dashboard, history and timesheet at every step', async () => {
    const { emp, manager } = await setup();
    const sheet = await sheetWith(emp, WED, THU);
    const all = (s: string) => [s, s, s];
    expect(await statuses(emp, sheet.id)).toEqual(all('DRAFT'));

    await submitDay(emp, sheet.id, WED);
    expect(await statuses(emp, sheet.id)).toEqual(all('IN_REVIEW'));

    await review(manager, sheet.id, 'reject');
    expect(await statuses(emp, sheet.id)).toEqual(all('REJECTED'));

    await submitDay(emp, sheet.id, WED);
    await review(manager, sheet.id, 'approve');
    expect(await statuses(emp, sheet.id)).toEqual(all('DRAFT')); // Thursday still has to be submitted

    await submitDay(emp, sheet.id, THU);
    await review(manager, sheet.id, 'approve');
    expect(await statuses(emp, sheet.id)).toEqual(all('APPROVED'));
  });

  it('is shown as submitted for the week, and as not submitted when only its days were', async () => {
    const { emp } = await setup();
    const sheet = await sheetWith(emp, WED);
    expect((await as(emp).post(`/api/timesheets/${sheet.id}/submit`)).status).toBe(200);
    expect(await statuses(emp, sheet.id)).toEqual(['SUBMITTED', 'SUBMITTED', 'SUBMITTED']);

    const base = { approvals: [], entries: [{ date: new Date(WED) }, { date: new Date(THU) }] };
    expect(displayStatus({ ...base, status: 'SUBMITTED', daySubmissions: [{ date: new Date(WED), status: 'APPROVED' }] })).toBe('DRAFT');
  });

  it('decides which history tab a timesheet is under', async () => {
    const { emp, manager } = await setup();
    const sheet = await sheetWith(emp, WED);
    const tabs = async () => Object.fromEntries(await Promise.all(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'].map(async s => [s, (await tab(emp, s)).length])));
    expect(await tabs()).toEqual({ DRAFT: 1, SUBMITTED: 0, APPROVED: 0, REJECTED: 0 });
    expect((await as(manager).get('/api/timesheets')).body.total).toBe(0);

    await submitDay(emp, sheet.id, WED);
    expect(await tabs()).toEqual({ DRAFT: 0, SUBMITTED: 1, APPROVED: 0, REJECTED: 0 });
    expect((await as(manager).get('/api/timesheets')).body.total).toBe(1);

    await review(manager, sheet.id, 'reject');
    expect(await tabs()).toEqual({ DRAFT: 0, SUBMITTED: 0, APPROVED: 0, REJECTED: 1 });

    await submitDay(emp, sheet.id, WED);
    await review(manager, sheet.id, 'approve');
    expect(await tabs()).toEqual({ DRAFT: 0, SUBMITTED: 0, APPROVED: 1, REJECTED: 0 });
  });

  it('pages filtered results correctly', async () => {
    const { emp } = await setup();
    for (const day of ['2026-02-03', '2026-02-10', '2026-02-17']) await sheetWith(emp, day);
    const submitted = await sheetWith(emp, WED);
    await submitDay(emp, submitted.id, WED);
    const page = async (n: number) => (await as(emp).get(`/api/timesheets?status=DRAFT&limit=2&page=${n}`)).body;
    expect([(await page(1)).total, (await page(1)).timesheets.length, (await page(2)).timesheets.length]).toEqual([3, 2, 1]);
  });
});

describe('days awaiting approval or approved', () => {
  it('cannot be edited, added to or deleted until withdrawn', async () => {
    const { emp, manager } = await setup();
    const sheet = await sheetWith(emp, WED, THU);
    const wed = await prisma.timesheetEntry.findFirstOrThrow({ where: { timesheetId: sheet.id, date: new Date(WED) } });
    const url = `/api/timesheets/${sheet.id}/entries`;
    const attempts = async () => [
      (await as(emp).put(`${url}/${wed.id}`).send({ hours: 3 })).status,
      (await as(emp).delete(`${url}/${wed.id}`)).status,
      (await as(emp).post(url).send(entry(WED))).status,
    ];
    await submitDay(emp, sheet.id, WED);
    expect(await attempts()).toEqual([409, 409, 409]);
    expect((await prisma.daySubmission.findFirstOrThrow({ where: { timesheetId: sheet.id } })).status).toBe('SUBMITTED');

    // The rest of the week stays open, and can't be moved onto the frozen day
    const thu = await prisma.timesheetEntry.findFirstOrThrow({ where: { timesheetId: sheet.id, date: new Date(THU) } });
    expect((await as(emp).put(`${url}/${thu.id}`).send({ hours: 1 })).status).toBe(200);
    expect((await as(emp).put(`${url}/${thu.id}`).send({ date: WED })).status).toBe(409);

    await as(emp).post(`/api/timesheets/${sheet.id}/days/${WED}/withdraw`);
    expect((await as(emp).put(`${url}/${wed.id}`).send({ hours: 3 })).status).toBe(200);

    await submitDay(emp, sheet.id, WED);
    await review(manager, sheet.id, 'approve');
    expect(await attempts()).toEqual([409, 409, 409]);
  });

  it('lose a withdrawn or rejected status once their entries are gone', async () => {
    const { emp, manager } = await setup();
    const sheet = await sheetWith(emp, WED, THU);
    await submitDay(emp, sheet.id, WED);
    await as(emp).post(`/api/timesheets/${sheet.id}/days/${WED}/withdraw`);
    await submitDay(emp, sheet.id, THU);
    await review(manager, sheet.id, 'reject');

    for (const e of await prisma.timesheetEntry.findMany({ where: { timesheetId: sheet.id } })) {
      expect((await as(emp).delete(`/api/timesheets/${sheet.id}/entries/${e.id}`)).status).toBe(200);
    }
    expect(await prisma.daySubmission.count({ where: { timesheetId: sheet.id } })).toBe(0);
    expect((await as(emp).get(`/api/timesheets/${sheet.id}`)).body.displayStatus).toBe('DRAFT');
  });

  it('keep the rejection while other rejected entries remain on the day', async () => {
    const { emp, manager } = await setup();
    const sheet = await sheetWith(emp, WED, WED);
    await submitDay(emp, sheet.id, WED);
    await review(manager, sheet.id, 'reject');
    const [first] = await prisma.timesheetEntry.findMany({ where: { timesheetId: sheet.id } });
    await as(emp).delete(`/api/timesheets/${sheet.id}/entries/${first.id}`);
    expect((await prisma.daySubmission.findFirstOrThrow({ where: { timesheetId: sheet.id } })).status).toBe('REJECTED');
  });

  it('cannot be submitted empty or with a timer running', async () => {
    const { emp } = await setup();
    const sheet = await sheetWith(emp, WED);
    expect((await submitDay(emp, sheet.id, THU)).status).toBe(400);
    await prisma.timesheetEntry.create({ data: { timesheetId: sheet.id, date: new Date(`${WED}T09:00:00Z`), hours: 0, startTime: new Date(`${WED}T09:00:00Z`) } });
    expect((await submitDay(emp, sheet.id, WED)).body.message).toMatch(/timer/);
  });
});

describe('future dates', () => {
  it('are blocked for entries, submission, moving and upload', async () => {
    const { emp } = await setup();
    const sheet = await sheetWith(emp, inDays(0));
    const { periodStart } = await prisma.timesheet.update({ where: { id: sheet.id }, data: { periodEnd: new Date(`${inDays(3)}T23:59:59.999Z`) } });
    expect(periodStart).toBeTruthy();

    expect((await as(emp).post(`/api/timesheets/${sheet.id}/entries`).send(entry(inDays(2)))).status).toBe(400);
    const own = await prisma.timesheetEntry.findFirstOrThrow({ where: { timesheetId: sheet.id } });
    expect((await as(emp).put(`/api/timesheets/${sheet.id}/entries/${own.id}`).send({ date: inDays(2) })).status).toBe(400);
    expect((await as(emp).post('/api/timesheets').send({ date: inDays(2) })).status).toBe(400);

    // An entry from before this rule can be removed, but not submitted
    const old = await prisma.timesheetEntry.create({ data: { timesheetId: sheet.id, date: new Date(inDays(2)), hours: 1 } });
    expect((await submitDay(emp, sheet.id, inDays(2))).status).toBe(400);
    expect((await as(emp).post(`/api/timesheets/${sheet.id}/submit`)).status).toBe(400);
    expect((await as(emp).delete(`/api/timesheets/${sheet.id}/entries/${old.id}`)).status).toBe(200);

    const csv = `Date,Description,Hours\n${inDays(2)},Later,2\n${inDays(0)},Today,2\n${inDays(0)},,2\n`;
    const upload = await as(emp).post('/api/timesheets/upload').attach('file', Buffer.from(csv), 'x.csv');
    expect(upload.body.totalEntriesAdded).toBe(1);
    expect(upload.body.warnings).toEqual(['Row 2: Date is in the future', 'Row 4: Missing description']);
  });

  it('are judged by the day it is for the user', async () => {
    const { emp } = await setup();
    const key = (timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
    const [ahead, behind] = [key('Pacific/Kiritimati'), key('Pacific/Niue')]; // 25 hours apart, so never the same date
    const post = (zone: string) => as(emp).post('/api/timesheets').set('X-Timezone', zone).send({ date: ahead });
    expect(ahead > behind).toBe(true);
    expect((await post('Pacific/Kiritimati')).status).toBe(201);
    expect((await post('Pacific/Niue')).status).toBe(400);
    expect((await post('Not/AZone')).status).toBeLessThan(500);
  });

  it('are skipped when copying the previous week', async () => {
    const { emp } = await setup();
    const { periodStart } = weekPeriod(today());
    const previous = Array.from({ length: 7 }, (_, i) => dayKey(new Date(periodStart.getTime() + (i - 7) * DAY_MS)));
    await sheetWith(emp, ...previous);
    const current = (await as(emp).post('/api/timesheets').send({ date: inDays(0) })).body;
    const copied = await as(emp).post(`/api/timesheets/${current.id}/copy-previous`);
    expect(copied.status).toBe(200);
    expect(copied.body).toHaveLength((today().getTime() - periodStart.getTime()) / DAY_MS + 1);
  });
});

describe('entry form rules', () => {
  it('needs a description and at most 24 hours', async () => {
    const { emp } = await setup();
    const sheet = await sheetWith(emp, WED);
    const post = (extra: Record<string, unknown>) => as(emp).post(`/api/timesheets/${sheet.id}/entries`).send(entry(WED, extra));
    expect((await post({ hours: 25 })).body.message).toBe('Maximum 24 hours per day');
    expect((await post({ hours: 0.1 })).body.message).toBe('Minimum 0.25 hours');
    expect((await post({ description: '   ' })).body.message).toBe('Description is required');
    const own = await prisma.timesheetEntry.findFirstOrThrow({ where: { timesheetId: sheet.id } });
    expect((await as(emp).put(`/api/timesheets/${sheet.id}/entries/${own.id}`).send({ description: '' })).status).toBe(400);
  });
});

describe('leave requests', () => {
  const leave = (extra: Record<string, unknown> = {}) => ({ leaveType: 'ANNUAL', startDate: '2026-12-21', endDate: '2026-12-22', ...extra });
  const entitle = (userId: string, leaveType: 'ANNUAL' | 'SICK', entitled: number) =>
    prisma.leaveBalance.create({ data: { userId, leaveType, year: 2026, entitled } });

  it('are rejected without enough balance, except unpaid leave', async () => {
    const { emp } = await setup();
    const send = (extra?: Record<string, unknown>) => as(emp).post('/api/leave/requests').send(leave(extra));
    const none = await send();
    expect([none.status, none.body.message]).toEqual([400, 'Insufficient leave balance. Available: 0 day(s), Requested: 2 day(s)']);
    await entitle(emp.id, 'ANNUAL', 0);
    expect((await send()).status).toBe(400);
    expect(await prisma.leaveRequest.count()).toBe(0);
    expect((await send({ leaveType: 'UNPAID' })).status).toBe(201);
  });

  it('cannot overlap a pending or approved request of any type', async () => {
    const { emp } = await setup();
    await entitle(emp.id, 'SICK', 10);
    await entitle(emp.id, 'ANNUAL', 10);
    const send = (extra: Record<string, unknown>) => as(emp).post('/api/leave/requests').send(leave(extra));
    const first = await send({ leaveType: 'SICK', startDate: '2026-12-10', endDate: '2026-12-11' });
    expect(first.status).toBe(201);

    const overlap = await send({ leaveType: 'SICK', startDate: '2026-12-10', endDate: '2026-12-10' });
    expect([overlap.status, overlap.body.message]).toEqual([409, 'This overlaps your pending sick leave (2026-12-10 to 2026-12-11)']);
    expect((await send({ startDate: '2026-12-11', endDate: '2026-12-14' })).status).toBe(409);
    expect((await send({ startDate: '2026-12-12', endDate: '2026-12-12' })).status).toBe(201);
    expect((await prisma.leaveBalance.findFirstOrThrow({ where: { leaveType: 'SICK' } })).pending).toBe(2);

    await as(emp).post(`/api/leave/requests/${first.body.id}/cancel`);
    expect((await send({ leaveType: 'SICK', startDate: '2026-12-10', endDate: '2026-12-10' })).status).toBe(201);
  });

  it('can be two half days on one date, but not three', async () => {
    const { emp } = await setup();
    await entitle(emp.id, 'ANNUAL', 10);
    const half = () => as(emp).post('/api/leave/requests').send(leave({ startDate: '2026-12-10', endDate: '2026-12-10', dayType: 'HALF_DAY' }));
    expect([(await half()).status, (await half()).status, (await half()).status]).toEqual([201, 201, 409]);
  });

  it('are checked one at a time when sent together', async () => {
    const { emp } = await setup();
    await entitle(emp.id, 'ANNUAL', 10);
    const results = await Promise.all([1, 2, 3].map(() => as(emp).post('/api/leave/requests').send(leave())));
    expect(results.map(r => r.status).sort()).toEqual([201, 409, 409]);
  });
});

describe('phone numbers', () => {
  it('must be valid on the profile and when HR creates or edits an employee', async () => {
    const { org, emp } = await setup();
    const hr = await createUser(org.id, 'HR_ADMIN');
    const save = (user: User, phone: unknown) => as(user).put(`/api/users/${emp.id}`).send({ phone });
    for (const bad of ['abc-invalid', '12345', '1234567890123456', '+', '555 0000 ext 9']) expect((await save(emp, bad)).status).toBe(400);
    expect((await save(hr, 'abc-invalid')).status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: emp.id } })).phone).toBeNull();
    for (const good of ['+1 555 000 0000', '(044) 2345-6789', '9876543210', '']) expect((await save(emp, good)).status).toBe(200);

    const created = await as(hr).post('/api/users').send({ employeeId: 'N1', email: 'n1@test.local', firstName: 'N', lastName: 'One', phone: 'abc' });
    expect(created.status).toBe(400);
  });
});

describe('leave balance upload', () => {
  const sheet = (rows: Record<string, unknown>[], name = 'balances.xlsx') => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Leave Balances');
    return { buf: XLSX.write(wb, { type: 'buffer', bookType: name.endsWith('.csv') ? 'csv' : 'xlsx' }) as Buffer, name };
  };
  const upload = (user: User, file: { buf: Buffer; name: string }) =>
    as(user).post('/api/leave/balances/upload').attach('file', file.buf, file.name);
  const entitled = async (userId: string) => Object.fromEntries(
    (await prisma.leaveBalance.findMany({ where: { userId, year: 2026 } })).map(b => [b.leaveType, b.entitled]));

  it('lets HR download every employee and set their balances from the file', async () => {
    const { org, emp } = await setup();
    const hr = await createUser(org.id, 'HR_ADMIN');
    await prisma.leaveBalance.create({ data: { userId: emp.id, leaveType: 'SICK', year: 2026, entitled: 6 } });

    const template = await as(hr).get('/api/leave/balances/template?year=2026').buffer(true)
      .parse((res, cb) => { const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(template.status).toBe(200);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(XLSX.read(template.body).Sheets['Leave Balances']);
    const empRow = rows.find(r => r.Email === emp.email)!;
    expect([empRow.Year, empRow.Sick, empRow.Annual]).toEqual([2026, 6, undefined]);

    // Filled in as HR would: email in another case, a half day, and one employee found by ID alone
    const other = await createUser(org.id);
    const res = await upload(hr, sheet([
      { ...empRow, Email: emp.email.toUpperCase(), Annual: 12, Sick: '', Unpaid: 1.5 },
      { 'Employee ID': other.employeeId, Email: '', Year: 2026, Annual: 10 },
      { 'Employee ID': '', Email: '', Year: '', Annual: '' },
    ]));
    expect([res.status, res.body.message]).toEqual([200, 'Saved 3 balances for 2 employees']);
    expect(await entitled(emp.id)).toEqual({ ANNUAL: 12, SICK: 6, UNPAID: 1.5 });
    expect(await entitled(other.id)).toEqual({ ANNUAL: 10 });

    // The employee can now request annual leave
    const leave = await as(emp).post('/api/leave/requests').send({ leaveType: 'ANNUAL', startDate: '2026-12-21', endDate: '2026-12-22' });
    expect(leave.status).toBe(201);
  });

  it('saves nothing and lists every row to correct when any row is wrong', async () => {
    const { org, emp } = await setup();
    const admin = await createUser(org.id, 'SYSTEM_ADMIN');
    await prisma.leaveBalance.create({ data: { userId: emp.id, leaveType: 'ANNUAL', year: 2026, entitled: 10, used: 3, pending: 2 } });
    const outsider = await createUser((await createOrg('Other')).id);

    const res = await upload(admin, sheet([
      { Email: emp.email, Year: 2026, Annual: 4, Sick: 5 },
      { Email: outsider.email, Year: 2026, Annual: 5 },
      { Email: 'nobody@test.local', Year: 2026, Annual: 5 },
      { Email: emp.email, Year: 2026, Sick: 2 },
      { Email: admin.email, Year: 2026, Annual: 'ten', Sick: 0.3, Other: -1 },
      { Email: admin.email.replace('@', '+x@'), Year: 'next', Annual: 1 },
    ]));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Nothing was saved. Correct these 8 problems and upload again.');
    expect(res.body.errors).toEqual([
      `Row 3: no employee with email ${outsider.email}`,
      'Row 4: no employee with email nobody@test.local',
      `Row 5: ${emp.email} for 2026 is already on row 2`,
      'Row 6: Annual must be a number of whole or half days from 0 to 366, not "ten"',
      'Row 6: Sick must be a number of whole or half days from 0 to 366, not "0.3"',
      'Row 6: Other must be a number of whole or half days from 0 to 366, not "-1"',
      `Row 7: no employee with email ${admin.email.replace('@', '+x@')}`,
      'Row 2: Annual cannot be 4; 5 day(s) are already taken or awaiting approval',
    ]);
    expect(await entitled(emp.id)).toEqual({ ANNUAL: 10 });
  });

  it('reads CSV, and refuses files without the columns it needs', async () => {
    const { org, emp } = await setup();
    const hr = await createUser(org.id, 'HR_ADMIN');
    expect((await upload(hr, sheet([{ Email: emp.email, Year: 2026, 'Annual Leave': 8 }], 'b.csv'))).status).toBe(200);
    expect(await entitled(emp.id)).toEqual({ ANNUAL: 8 });

    const noType = await upload(hr, sheet([{ Email: emp.email, Days: 8 }]));
    expect([noType.status, noType.body.message]).toEqual([400, 'The file needs at least one leave type column: Annual, Sick, Maternity, Paternity, Unpaid, Compensatory, Other']);
    const noWho = await upload(hr, sheet([{ Name: 'Test', Annual: 8 }]));
    expect(noWho.body.message).toBe('The file needs an Email or Employee ID column');
    const wrongType = await as(hr).post('/api/leave/balances/upload').attach('file', Buffer.from('x'), 'b.pdf');
    expect([wrongType.status, wrongType.body.message]).toEqual([400, 'Upload the template as .xlsx, .xls or .csv']);
  });

  it('is only for HR and Admin', async () => {
    const { manager, emp } = await setup();
    for (const user of [emp, manager]) {
      expect((await as(user).get('/api/leave/balances/template')).status).toBe(403);
      expect((await upload(user, sheet([{ Email: user.email, Year: 2026, Annual: 99 }]))).status).toBe(403);
    }
    expect(await prisma.leaveBalance.count()).toBe(0);
  });
});
