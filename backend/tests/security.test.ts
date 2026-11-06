import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import speakeasy from 'speakeasy';
import bcrypt from 'bcryptjs';
import { app, anonymous, as, createOrg, createTimesheet, createUser, PASSWORD, prisma, redis, resetDatabase, WEEK } from './helpers';
import { ensureInitialAdmin } from '../src/services/bootstrap';

beforeEach(resetDatabase);

async function login(email: string, password = PASSWORD, extra: Record<string, unknown> = {}) {
  return anonymous().post('/api/auth/login').send({ email, password, ...extra });
}

describe('first-run admin', () => {
  it('creates one System Admin who must change the password, then does nothing on later starts', async () => {
    process.env.INITIAL_ADMIN_EMAIL = 'first@test.local';
    process.env.INITIAL_ADMIN_PASSWORD = 'First-Run-Pass1';
    await ensureInitialAdmin();
    await ensureInitialAdmin();
    delete process.env.INITIAL_ADMIN_PASSWORD;

    const users = await prisma.user.findMany();
    expect(users).toHaveLength(1);
    expect(users[0].role).toBe('SYSTEM_ADMIN');
    expect(await prisma.organization.count()).toBe(1);

    const res = await login('first@test.local', 'First-Run-Pass1');
    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);

    const auth = { Authorization: `Bearer ${res.body.accessToken}` };
    const blocked = await request(app).get('/api/users').set(auth);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await request(app).post('/api/auth/change-password').set(auth)
      .send({ currentPassword: 'First-Run-Pass1', newPassword: 'Brand-New-Pass2' });
    expect(changed.status).toBe(200);

    const after = await request(app).get('/api/users').set({ Authorization: `Bearer ${changed.body.accessToken}` });
    expect(after.status).toBe(200);
  });

  it('generates a usable password when none is configured', async () => {
    delete process.env.INITIAL_ADMIN_PASSWORD;
    process.env.INITIAL_ADMIN_EMAIL = 'gen@test.local';
    const logs: string[] = [];
    const original = console.log;
    console.log = (m: string) => { logs.push(String(m)); };
    await ensureInitialAdmin();
    console.log = original;

    const printed = logs.join('\n').match(/Password: (\S+)/)?.[1];
    expect(printed).toBeTruthy();
    expect((await login('gen@test.local', printed!)).status).toBe(200);
  });

  it('leaves an existing installation alone', async () => {
    const org = await createOrg();
    await createUser(org.id);
    await ensureInitialAdmin();
    expect(await prisma.user.count()).toBe(1);
  });

  it('rejects a weak configured password', async () => {
    process.env.INITIAL_ADMIN_PASSWORD = 'weak';
    await expect(ensureInitialAdmin()).rejects.toThrow(/INITIAL_ADMIN_PASSWORD/);
    delete process.env.INITIAL_ADMIN_PASSWORD;
  });
});

describe('role escalation', () => {
  it('stops HR promoting anyone, including themselves, to System Admin', async () => {
    const org = await createOrg();
    const hr = await createUser(org.id, 'HR_ADMIN');
    const emp = await createUser(org.id);
    expect((await as(hr).put(`/api/users/${hr.id}`).send({ role: 'SYSTEM_ADMIN' })).status).toBe(403);
    expect((await as(hr).put(`/api/users/${emp.id}`).send({ role: 'SYSTEM_ADMIN' })).status).toBe(403);
    expect((await as(hr).post('/api/users').send({ employeeId: 'X', email: 'x@test.local', firstName: 'X', lastName: 'Y', role: 'SYSTEM_ADMIN' })).status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: emp.id } })).role).toBe('EMPLOYEE');
  });

  it('stops HR changing or deactivating a System Admin', async () => {
    const org = await createOrg();
    const hr = await createUser(org.id, 'HR_ADMIN');
    const admin = await createUser(org.id, 'SYSTEM_ADMIN');
    expect((await as(hr).put(`/api/users/${admin.id}`).send({ role: 'EMPLOYEE' })).status).toBe(403);
    expect((await as(hr).delete(`/api/users/${admin.id}`)).status).toBe(403);
  });

  it('still lets HR manage normal roles and a System Admin grant the role', async () => {
    const org = await createOrg();
    const hr = await createUser(org.id, 'HR_ADMIN');
    const admin = await createUser(org.id, 'SYSTEM_ADMIN');
    const emp = await createUser(org.id);
    expect((await as(hr).put(`/api/users/${emp.id}`).send({ role: 'TEAM_LEAD' })).status).toBe(200);
    expect((await as(admin).put(`/api/users/${emp.id}`).send({ role: 'SYSTEM_ADMIN' })).status).toBe(200);
  });

  it('forces a password change on accounts created with a temporary password', async () => {
    const org = await createOrg();
    const hr = await createUser(org.id, 'HR_ADMIN');
    const res = await as(hr).post('/api/users').send({ employeeId: 'N1', email: 'new@test.local', firstName: 'N', lastName: 'U' });
    expect(res.status).toBe(201);
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.body.tempPassword.length).toBeGreaterThan(20);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: res.body.id } })).mustChangePassword).toBe(true);
  });
});

describe('team structure', () => {
  it('stops a Team Lead taking over a team or adding people to their own', async () => {
    const org = await createOrg();
    const lead = await createUser(org.id, 'TEAM_LEAD');
    const emp = await createUser(org.id);
    const team = await prisma.team.create({ data: { name: 'T', organizationId: org.id, leadId: lead.id } });
    const other = await prisma.team.create({ data: { name: 'O', organizationId: org.id } });

    expect((await as(lead).put(`/api/teams/${other.id}`).send({ leadId: lead.id })).status).toBe(403);
    expect((await as(lead).post(`/api/teams/${team.id}/members`).send({ userId: emp.id })).status).toBe(403);
    expect((await as(lead).post('/api/teams').send({ name: 'Mine', leadId: lead.id })).status).toBe(403);
  });

  it('saves the organization on new teams so they stay visible and filterable', async () => {
    const org = await createOrg();
    const hr = await createUser(org.id, 'HR_ADMIN');
    const res = await as(hr).post('/api/teams').send({ name: 'Standalone' });
    expect(res.status).toBe(201);
    expect(res.body.organizationId).toBe(org.id);
    expect((await as(hr).get('/api/teams')).body).toHaveLength(1);
  });
});

describe('timesheet approvals', () => {
  it('stops a Team Lead bulk-approving people outside their team', async () => {
    const org = await createOrg();
    const lead = await createUser(org.id, 'TEAM_LEAD');
    const manager = await createUser(org.id, 'DEPARTMENT_MANAGER');
    const stranger = await createUser(org.id, 'EMPLOYEE', { managerId: manager.id });
    const { timesheet, approvals } = await createTimesheet(stranger.id, 'SUBMITTED', [manager.id]);

    const res = await as(lead).post('/api/approvals/bulk-approve').send({ approvalIds: [approvals[0].id] });
    expect(res.body).toEqual({ succeeded: 0, failed: 1 });
    expect((await prisma.timesheet.findUniqueOrThrow({ where: { id: timesheet.id } })).status).toBe('SUBMITTED');
  });

  it('lets a Team Lead approve their own team member', async () => {
    const org = await createOrg();
    const lead = await createUser(org.id, 'TEAM_LEAD');
    const emp = await createUser(org.id);
    await prisma.team.create({ data: { name: 'T', organizationId: org.id, leadId: lead.id, members: { create: { userId: emp.id } } } });
    const hr = await createUser(org.id, 'HR_ADMIN');
    const { timesheet, approvals } = await createTimesheet(emp.id, 'SUBMITTED', [hr.id]);

    const res = await as(lead).post('/api/approvals/bulk-approve').send({ approvalIds: [approvals[0].id] });
    expect(res.body.succeeded).toBe(1);
    expect((await prisma.timesheet.findUniqueOrThrow({ where: { id: timesheet.id } })).status).toBe('APPROVED');
  });

  it('blocks self-approval, including for HR and System Admins', async () => {
    const org = await createOrg();
    for (const role of ['HR_ADMIN', 'SYSTEM_ADMIN'] as const) {
      const admin = await createUser(org.id, role);
      const ts = await prisma.timesheet.create({ data: { userId: admin.id, periodStart: WEEK.start, periodEnd: WEEK.end, status: 'SUBMITTED' } });
      const approval = await prisma.timesheetApproval.create({ data: { timesheetId: ts.id, approverId: admin.id, level: 1, dueDate: new Date() } });
      expect((await as(admin).post(`/api/approvals/${approval.id}/approve`)).status).toBe(403);
      const pending = (await as(admin).get('/api/approvals/pending')).body as { timesheetId: string }[];
      expect(pending.map(p => p.timesheetId)).not.toContain(ts.id);
    }
  });

  it('never makes the submitter their own approver and falls back to a System Admin', async () => {
    const org = await createOrg();
    const hr = await createUser(org.id, 'HR_ADMIN');
    const admin = await createUser(org.id, 'SYSTEM_ADMIN');
    const ts = await prisma.timesheet.create({ data: { userId: hr.id, periodStart: WEEK.start, periodEnd: WEEK.end } });

    expect((await as(hr).post(`/api/timesheets/${ts.id}/submit`)).status).toBe(200);
    const approvals = await prisma.timesheetApproval.findMany({ where: { timesheetId: ts.id } });
    expect(approvals.map(a => a.approverId)).toEqual([admin.id]);
  });

  it('closes the other approvers\' requests, so a locked timesheet cannot be reopened', async () => {
    const org = await createOrg();
    const m1 = await createUser(org.id, 'HR_ADMIN');
    const m2 = await createUser(org.id, 'HR_ADMIN');
    const emp = await createUser(org.id);
    const { timesheet, approvals } = await createTimesheet(emp.id, 'SUBMITTED', [m1.id, m2.id]);

    expect((await as(m1).post(`/api/approvals/${approvals[0].id}/approve`)).status).toBe(200);
    expect((await as(m2).post(`/api/approvals/${approvals[1].id}/reject`).send({ comments: 'no' })).status).toBe(404);

    // A leftover row from before this fix must not flip a locked timesheet either
    await prisma.timesheet.update({ where: { id: timesheet.id }, data: { status: 'LOCKED' } });
    const stale = await prisma.timesheetApproval.create({ data: { timesheetId: timesheet.id, approverId: m2.id, level: 1, dueDate: new Date() } });
    expect((await as(m2).post(`/api/approvals/${stale.id}/approve`)).status).toBe(409);
    expect((await prisma.timesheet.findUniqueOrThrow({ where: { id: timesheet.id } })).status).toBe('LOCKED');
  });

  it('scopes day submissions and blocks approving your own day', async () => {
    const org = await createOrg();
    const pm = await createUser(org.id, 'PROJECT_MANAGER');
    const emp = await createUser(org.id);
    const { timesheet } = await createTimesheet(emp.id);
    const sub = await prisma.daySubmission.create({ data: { timesheetId: timesheet.id, date: new Date(WEEK.entryDate), status: 'SUBMITTED' } });
    expect((await as(pm).post(`/api/approvals/day-submissions/${sub.id}/approve`)).status).toBe(403);

    const own = await createTimesheet(pm.id);
    const ownSub = await prisma.daySubmission.create({ data: { timesheetId: own.timesheet.id, date: new Date(WEEK.entryDate), status: 'SUBMITTED' } });
    expect((await as(pm).post(`/api/approvals/day-submissions/${ownSub.id}/approve`)).status).toBe(403);
  });

  it('limits reading a timesheet to the owner and their reviewers', async () => {
    const org = await createOrg();
    const lead = await createUser(org.id, 'TEAM_LEAD');
    const manager = await createUser(org.id, 'DEPARTMENT_MANAGER');
    const emp = await createUser(org.id, 'EMPLOYEE', { managerId: manager.id });
    const { timesheet } = await createTimesheet(emp.id);
    expect((await as(lead).get(`/api/timesheets/${timesheet.id}`)).status).toBe(403);
    expect((await as(manager).get(`/api/timesheets/${timesheet.id}`)).status).toBe(200);
    expect((await as(emp).get(`/api/timesheets/${timesheet.id}`)).status).toBe(200);
  });
});

describe('timesheet locking', () => {
  const entry = { date: WEEK.entryDate, hours: 2 };

  async function approvedWeek() {
    const org = await createOrg();
    const hr = await createUser(org.id, 'HR_ADMIN');
    const emp = await createUser(org.id);
    const { timesheet, approvals } = await createTimesheet(emp.id, 'SUBMITTED', [hr.id]);
    await as(hr).post(`/api/approvals/${approvals[0].id}/approve`);
    return { emp, timesheet };
  }

  it('freezes hours after whole-week approval', async () => {
    const { emp, timesheet } = await approvedWeek();
    const entryId = timesheet.entries[0].id;
    expect((await as(emp).post(`/api/timesheets/${timesheet.id}/entries`).send(entry)).status).toBe(409);
    expect((await as(emp).put(`/api/timesheets/${timesheet.id}/entries/${entryId}`).send({ hours: 24 })).status).toBe(409);
    expect((await as(emp).delete(`/api/timesheets/${timesheet.id}/entries/${entryId}`)).status).toBe(409);
    expect((await prisma.timesheet.findUniqueOrThrow({ where: { id: timesheet.id } })).totalHours).toBe(8);
  });

  it('blocks every edit route on a locked timesheet, including copy-previous', async () => {
    const org = await createOrg();
    const emp = await createUser(org.id);
    const prev = await prisma.timesheet.create({
      data: {
        userId: emp.id,
        periodStart: new Date('2026-02-22T00:00:00.000Z'),
        periodEnd: new Date('2026-02-28T23:59:59.999Z'),
        entries: { create: { date: new Date('2026-02-25'), hours: 8 } },
      },
    });
    expect(prev.id).toBeTruthy();
    const { timesheet } = await createTimesheet(emp.id, 'LOCKED');
    expect((await as(emp).post(`/api/timesheets/${timesheet.id}/entries`).send(entry)).status).toBe(400);
    expect((await as(emp).post(`/api/timesheets/${timesheet.id}/copy-previous`)).status).toBe(400);
    expect(await prisma.timesheetEntry.count({ where: { timesheetId: timesheet.id } })).toBe(1);
  });

  it('sends a submitted timesheet back for review when hours change', async () => {
    const org = await createOrg();
    const hr = await createUser(org.id, 'HR_ADMIN');
    const emp = await createUser(org.id);
    const { timesheet } = await createTimesheet(emp.id, 'SUBMITTED', [hr.id]);
    const res = await as(emp).put(`/api/timesheets/${timesheet.id}/entries/${timesheet.entries[0].id}`).send({ hours: 4 });
    expect(res.status).toBe(200);
    expect((await prisma.timesheet.findUniqueOrThrow({ where: { id: timesheet.id } })).status).toBe('DRAFT');
    expect(await prisma.timesheetApproval.count({ where: { timesheetId: timesheet.id, status: 'PENDING' } })).toBe(0);
  });

  it('keeps per-day logging working: approved days freeze, other days stay open', async () => {
    const org = await createOrg();
    const emp = await createUser(org.id);
    const { timesheet } = await createTimesheet(emp.id, 'APPROVED');
    await prisma.daySubmission.create({ data: { timesheetId: timesheet.id, date: new Date(WEEK.entryDate), status: 'APPROVED' } });

    expect((await as(emp).post(`/api/timesheets/${timesheet.id}/entries`).send(entry)).status).toBe(409);
    expect((await as(emp).post(`/api/timesheets/${timesheet.id}/entries`).send({ date: '2026-03-05', hours: 2 })).status).toBe(201);

    // New unapproved hours mean the week as a whole isn't approved any more, so payroll won't pick it up
    expect((await prisma.timesheet.findUniqueOrThrow({ where: { id: timesheet.id } })).status).toBe('DRAFT');
  });

  it('rejects entries dated outside the timesheet period', async () => {
    const org = await createOrg();
    const emp = await createUser(org.id);
    const { timesheet } = await createTimesheet(emp.id);
    expect((await as(emp).post(`/api/timesheets/${timesheet.id}/entries`).send({ date: '2026-05-01', hours: 2 })).status).toBe(400);
  });

  it('copy-previous lands on the right dates across a month boundary', async () => {
    const org = await createOrg();
    const emp = await createUser(org.id);
    await prisma.timesheet.create({
      data: {
        userId: emp.id,
        periodStart: new Date('2026-02-22T00:00:00.000Z'),
        periodEnd: new Date('2026-02-28T23:59:59.999Z'),
        entries: { create: { date: new Date('2026-02-25T00:00:00.000Z'), hours: 8, category: 'Dev' } },
      },
    });
    const current = await prisma.timesheet.create({ data: { userId: emp.id, periodStart: WEEK.start, periodEnd: WEEK.end } });

    const res = await as(emp).post(`/api/timesheets/${current.id}/copy-previous`);
    expect(res.status).toBe(200);
    expect(new Date(res.body[0].date).toISOString().slice(0, 10)).toBe('2026-03-04');
    expect(res.body[0].category).toBe('Dev');
  });

  it('uses the same weeks for the timesheet screen, upload and timer', async () => {
    const org = await createOrg();
    const emp = await createUser(org.id);
    const first = await as(emp).get('/api/timesheets/current');
    const started = await as(emp).post('/api/timer/start').send({});
    expect(started.body.timesheetId).toBe(first.body.id);
    expect(await prisma.timesheet.count({ where: { userId: emp.id } })).toBe(1);
  });
});

describe('payroll', () => {
  it('only locks this organization, and only once', async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const payroll = await createUser(orgA.id, 'PAYROLL_ADMIN');
    const a = await createUser(orgA.id);
    const b = await createUser(orgB.id);
    const tsA = await createTimesheet(a.id, 'APPROVED');
    const tsB = await createTimesheet(b.id, 'APPROVED');

    const period = await as(payroll).post('/api/payroll/periods').send({ name: 'Mar', startDate: '2026-02-01', endDate: '2026-04-01' });
    expect((await as(payroll).post(`/api/payroll/periods/${period.body.id}/process`)).status).toBe(200);
    expect((await prisma.timesheet.findUniqueOrThrow({ where: { id: tsA.timesheet.id } })).status).toBe('LOCKED');
    expect((await prisma.timesheet.findUniqueOrThrow({ where: { id: tsB.timesheet.id } })).status).toBe('APPROVED');
    expect((await as(payroll).post(`/api/payroll/periods/${period.body.id}/process`)).status).toBe(409);
  });
});

describe('leave', () => {
  async function setup() {
    const org = await createOrg();
    const hr = await createUser(org.id, 'HR_ADMIN');
    const emp = await createUser(org.id);
    await prisma.leaveBalance.create({ data: { userId: emp.id, leaveType: 'ANNUAL', year: 2026, entitled: 10, used: 0, pending: 0 } });
    return { org, hr, emp };
  }
  const balance = (userId: string) => prisma.leaveBalance.findFirstOrThrow({ where: { userId, leaveType: 'ANNUAL', year: 2026 } });
  const request1 = { leaveType: 'ANNUAL', startDate: '2026-06-01', endDate: '2026-06-03' };

  it('rejects an end date before the start date, which used to add balance', async () => {
    const { emp } = await setup();
    const res = await as(emp).post('/api/leave/requests').send({ leaveType: 'ANNUAL', startDate: '2026-12-31', endDate: '2026-12-01' });
    expect(res.status).toBe(400);
    expect((await balance(emp.id)).pending).toBe(0);
  });

  it('blocks approving your own leave and approving outside your scope', async () => {
    const { org, emp } = await setup();
    const lead = await createUser(org.id, 'TEAM_LEAD');
    const created = await as(emp).post('/api/leave/requests').send(request1);
    expect((await as(emp).post(`/api/leave/requests/${created.body.id}/approve`)).status).toBe(403);
    expect((await as(lead).post(`/api/leave/requests/${created.body.id}/approve`)).status).toBe(403);
  });

  it('only deducts once however many times approve is called', async () => {
    const { hr, emp } = await setup();
    const created = await as(emp).post('/api/leave/requests').send(request1);
    expect((await balance(emp.id)).pending).toBe(3);
    expect((await as(hr).post(`/api/leave/requests/${created.body.id}/approve`)).status).toBe(200);
    expect((await as(hr).post(`/api/leave/requests/${created.body.id}/approve`)).status).toBe(409);
    const b = await balance(emp.id);
    expect([b.used, b.pending]).toEqual([3, 0]);
  });

  it('returns reserved days when rejected or cancelled', async () => {
    const { hr, emp } = await setup();
    const one = await as(emp).post('/api/leave/requests').send(request1);
    await as(hr).post(`/api/leave/requests/${one.body.id}/reject`).send({ comments: 'no' });
    expect((await balance(emp.id)).pending).toBe(0);

    const two = await as(emp).post('/api/leave/requests').send(request1);
    await as(emp).post(`/api/leave/requests/${two.body.id}/cancel`);
    expect((await balance(emp.id)).pending).toBe(0);
  });

  it('hides other people\'s leave from a Team Lead who does not review them', async () => {
    const { org, emp } = await setup();
    const lead = await createUser(org.id, 'TEAM_LEAD');
    await as(emp).post('/api/leave/requests').send(request1);
    expect((await as(lead).get('/api/leave')).body.requests).toHaveLength(0);
  });
});

describe('expenses', () => {
  const expense = { category: 'Travel', amount: 100, date: '2026-03-04', description: 'Taxi' };

  async function submitted(userId: string, organizationId: string) {
    return prisma.expense.create({ data: { userId, organizationId, category: 'Travel', amount: 100, date: new Date(), description: 'Taxi', status: 'SUBMITTED' } });
  }

  it('blocks approving your own expense and approving outside your scope', async () => {
    const org = await createOrg();
    const lead = await createUser(org.id, 'TEAM_LEAD');
    const emp = await createUser(org.id);
    const own = await submitted(lead.id, org.id);
    const other = await submitted(emp.id, org.id);
    expect((await as(lead).post(`/api/expenses/${own.id}/approve`)).status).toBe(403);
    expect((await as(lead).post(`/api/expenses/${other.id}/approve`)).status).toBe(403);
  });

  it('lets the employee\'s manager approve', async () => {
    const org = await createOrg();
    const manager = await createUser(org.id, 'DEPARTMENT_MANAGER');
    const emp = await createUser(org.id, 'EMPLOYEE', { managerId: manager.id });
    const e = await submitted(emp.id, org.id);
    expect((await as(manager).post(`/api/expenses/${e.id}/approve`)).status).toBe(200);
  });

  it('accepts the app\'s own uploaded receipt path and rejects script links', async () => {
    const org = await createOrg();
    const emp = await createUser(org.id);
    const ok = await as(emp).post('/api/expenses').send({ ...expense, receiptUrl: `/uploads/receipts/${'a'.repeat(32)}.pdf` });
    expect(ok.status).toBe(201);
    const bad = await as(emp).post('/api/expenses').send({ ...expense, receiptUrl: 'javascript:alert(document.domain)' });
    expect(bad.status).toBe(400);
  });
});

describe('uploaded files', () => {
  const name = `${'b'.repeat(32)}.pdf`;
  const url = `/uploads/leave-docs/${name}`;
  const dir = path.join(process.cwd(), 'uploads', 'leave-docs');
  const file = path.join(dir, name);

  async function withDocument() {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, 'medical certificate');
    const org = await createOrg();
    const emp = await createUser(org.id);
    await prisma.leaveRequest.create({
      data: { userId: emp.id, leaveType: 'SICK', startDate: new Date('2026-06-01'), endDate: new Date('2026-06-01'), days: 1, documentUrl: url },
    });
    return { org, emp };
  }

  it('no longer serves /uploads without signing in', async () => {
    await withDocument();
    expect((await request(app).get(url)).status).toBe(404);
    expect((await request(app).get(`/api/files/leave-docs/${name}`)).status).toBe(401);
    fs.unlinkSync(file);
  });

  it('serves a document to its owner and reviewers only', async () => {
    const { org, emp } = await withDocument();
    const hr = await createUser(org.id, 'HR_ADMIN');
    const colleague = await createUser(org.id);
    expect((await as(emp).get(`/api/files/leave-docs/${name}`)).status).toBe(200);
    expect((await as(hr).get(`/api/files/leave-docs/${name}`)).status).toBe(200);
    expect((await as(colleague).get(`/api/files/leave-docs/${name}`)).status).toBe(404);
    fs.unlinkSync(file);
  });

  it('rejects path traversal', async () => {
    const org = await createOrg();
    const emp = await createUser(org.id);
    expect((await as(emp).get('/api/files/leave-docs/..%2F..%2F.env')).status).toBe(404);
  });

  it('leaves nothing on disk after an employee import', async () => {
    const org = await createOrg();
    const hr = await createUser(org.id, 'HR_ADMIN');
    const importDir = path.join(process.cwd(), 'uploads', 'imports');
    const before = fs.existsSync(importDir) ? fs.readdirSync(importDir).length : 0;
    const res = await as(hr).post('/api/admin/import-employees')
      .attach('file', Buffer.from('Employee ID,Email,First Name,Last Name\nI1,imp@test.local,Imp,Orted\n'), 'employees.csv');
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(fs.existsSync(importDir) ? fs.readdirSync(importDir).length : 0).toBe(before);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'imp@test.local' } })).mustChangePassword).toBe(true);
  });
});

describe('sessions', () => {
  function refreshCookie(res: { headers: Record<string, unknown> }): string {
    const cookies = res.headers['set-cookie'] as unknown as string[];
    return cookies.find(c => c.startsWith('refreshToken='))!.split(';')[0];
  }

  it('ends all access as soon as a user is deactivated', async () => {
    const org = await createOrg();
    const hr = await createUser(org.id, 'HR_ADMIN');
    const emp = await createUser(org.id);
    const loggedIn = await login(emp.email);
    const access = { Authorization: `Bearer ${loggedIn.body.accessToken}` };
    const cookie = refreshCookie(loggedIn);

    expect((await request(app).get('/api/auth/me').set(access)).status).toBe(200);
    await as(hr).delete(`/api/users/${emp.id}`);
    expect((await request(app).get('/api/auth/me').set(access)).status).toBe(401);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);
  });

  it('applies a demotion immediately, including on refresh', async () => {
    const org = await createOrg();
    const hr = await createUser(org.id, 'HR_ADMIN');
    const admin2 = await createUser(org.id, 'HR_ADMIN');
    const loggedIn = await login(admin2.email);
    const access = { Authorization: `Bearer ${loggedIn.body.accessToken}` };

    expect((await request(app).get('/api/attendance/all').set(access)).status).toBe(200);
    await as(hr).put(`/api/users/${admin2.id}`).send({ role: 'EMPLOYEE' });
    expect((await request(app).get('/api/attendance/all').set(access)).status).toBe(403);

    const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', refreshCookie(loggedIn));
    expect(refreshed.status).toBe(200);
    const payload = JSON.parse(Buffer.from(refreshed.body.accessToken.split('.')[1], 'base64url').toString());
    expect(payload.role).toBe('EMPLOYEE');
  });

  it('signs out other devices on password change but keeps this one', async () => {
    const org = await createOrg();
    const emp = await createUser(org.id);
    const deviceA = await login(emp.email);
    const deviceB = await login(emp.email);

    const changed = await request(app).post('/api/auth/change-password')
      .set({ Authorization: `Bearer ${deviceA.body.accessToken}` })
      .send({ currentPassword: PASSWORD, newPassword: 'Brand-New-Pass2' });
    expect(changed.status).toBe(200);

    expect((await request(app).get('/api/auth/me').set({ Authorization: `Bearer ${deviceB.body.accessToken}` })).status).toBe(401);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', refreshCookie(deviceB))).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set({ Authorization: `Bearer ${changed.body.accessToken}` })).status).toBe(200);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', refreshCookie(changed))).status).toBe(200);
  });

  it('stores refresh tokens hashed and logs out without an access token', async () => {
    const org = await createOrg();
    const emp = await createUser(org.id);
    const loggedIn = await login(emp.email);
    const cookie = refreshCookie(loggedIn);
    const raw = cookie.split('=')[1];
    expect(await prisma.refreshToken.count({ where: { token: raw } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { userId: emp.id } })).toBe(1);

    const out = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(200);
    expect(String(out.headers['set-cookie'])).toContain('Path=/api/auth');
    expect((await request(app).post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);
  });
});

describe('MFA', () => {
  async function enrolled() {
    const org = await createOrg();
    const secret = speakeasy.generateSecret({ length: 20 }).base32;
    const user = await createUser(org.id, 'EMPLOYEE', { mfaEnabled: true, mfaSecret: secret });
    return { user, secret };
  }
  const codeFor = (secret: string) => speakeasy.totp({ secret, encoding: 'base32' });

  it('a stolen access token cannot replace or start MFA without the password', async () => {
    const { user, secret } = await enrolled();
    expect((await as(user).post('/api/auth/setup-mfa').send({ currentPassword: 'wrong' })).status).toBe(400);
    expect((await as(user).post('/api/auth/setup-mfa').send({ currentPassword: PASSWORD })).status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mfaSecret).toBe(secret);
  });

  it('enrolment does not disturb the current factor until verified', async () => {
    const org = await createOrg();
    const user = await createUser(org.id);
    const setup = await as(user).post('/api/auth/setup-mfa').send({ currentPassword: PASSWORD });
    expect(setup.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mfaEnabled).toBe(false);

    const verified = await as(user).post('/api/auth/verify-mfa').send({ code: codeFor(setup.body.secret) });
    expect(verified.status).toBe(200);
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(saved.mfaEnabled).toBe(true);
    expect(saved.mfaSecret).toBe(setup.body.secret);
    expect(saved.mfaPendingSecret).toBeNull();
  });

  it('locks the account after repeated wrong codes', async () => {
    const { user, secret } = await enrolled();
    for (let i = 0; i < 5; i++) {
      expect((await login(user.email, PASSWORD, { mfaCode: '000000' })).status).toBe(401);
    }
    expect((await login(user.email, PASSWORD, { mfaCode: codeFor(secret) })).status).toBe(423);
  });

  it('a correct password does not reset the failure count before MFA passes', async () => {
    const { user } = await enrolled();
    await login(user.email, PASSWORD, { mfaCode: '000000' });
    await login(user.email, PASSWORD);
    expect(await redis.get(`login:attempts:${user.email}`)).toBe('1');
  });

  it('rejects a code that has already been used', async () => {
    const { user, secret } = await enrolled();
    const code = codeFor(secret);
    expect((await login(user.email, PASSWORD, { mfaCode: code })).status).toBe(200);
    expect((await login(user.email, PASSWORD, { mfaCode: code })).status).toBe(401);
  });

  it('can require MFA for admins', async () => {
    const org = await createOrg();
    const admin = await createUser(org.id, 'HR_ADMIN');
    process.env.REQUIRE_ADMIN_MFA = 'true';
    const res = await as(admin).get('/api/users');
    delete process.env.REQUIRE_ADMIN_MFA;
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MFA_SETUP_REQUIRED');
  });
});

describe('audit log', () => {
  it('can be viewed, records the real entity, and never stores credentials', async () => {
    const org = await createOrg();
    const admin = await createUser(org.id, 'SYSTEM_ADMIN');
    const emp = await createUser(org.id);
    await as(admin).put(`/api/users/${emp.id}`).send({ designation: 'Engineer' });
    await as(admin).post('/api/backup/cloud').send({
      endpoint: 'http://127.0.0.1:1', bucket: 'b', accessKey: 'AKIAFAKE', secretKey: 'super-secret-value', region: 'us-east-1',
    }).catch(() => undefined);
    await as(admin).post('/api/backup/restore').send({ data: JSON.stringify({ version: '2', data: { users: [] } }) });
    await new Promise(r => setTimeout(r, 300));

    const logs = await as(admin).get('/api/admin/audit-logs');
    expect(logs.status).toBe(200);
    const update = logs.body.logs.find((l: { action: string; entity: string }) => l.action === 'PUT');
    expect(update.entity).toBe('users');
    expect(update.entityId).toBe(emp.id);

    const everything = JSON.stringify(await prisma.auditLog.findMany());
    expect(everything).not.toContain('super-secret-value');
    expect(everything).not.toContain('AKIAFAKE');
  });
});

describe('backups', () => {
  it('does not record an FTP connection test as a successful backup', async () => {
    const net = await import('net');
    const server = net.createServer(s => s.destroy());
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const org = await createOrg();
    const admin = await createUser(org.id, 'SYSTEM_ADMIN');
    const res = await as(admin).post('/api/backup/ftp').send({ host: '127.0.0.1', port, user: 'u', password: 'p' });
    server.close();

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('no backup was uploaded');
    const log = await prisma.backupLog.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(log.status).toBe('connection-test');
  });
});

describe('metrics', () => {
  it('requires the token when one is configured', async () => {
    process.env.METRICS_TOKEN = 'metrics-token';
    expect((await request(app).get('/metrics')).status).toBe(404);
    expect((await request(app).get('/metrics').set('Authorization', 'Bearer metrics-token')).status).toBe(200);
    delete process.env.METRICS_TOKEN;
  });
});

describe('demo seed passwords', () => {
  it('are flagged in production', async () => {
    const { flagDemoCredentials } = await import('../src/services/bootstrap');
    const org = await createOrg();
    const demo = await createUser(org.id, 'SYSTEM_ADMIN', { email: 'admin@acme.com', passwordHash: await bcrypt.hash('Admin@123', 4) });
    process.env.NODE_ENV = 'production';
    await flagDemoCredentials();
    process.env.NODE_ENV = 'test';
    expect((await prisma.user.findUniqueOrThrow({ where: { id: demo.id } })).mustChangePassword).toBe(true);
  });
});
