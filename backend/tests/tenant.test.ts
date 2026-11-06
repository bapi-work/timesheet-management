import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app, anonymous, as, createOrg, createTimesheet, createUser, prisma, redis, resetDatabase, PASSWORD, WEEK } from './helpers';

vi.mock('basic-ftp', () => {
  const uploaded: { name: string; dir: string }[] = [];
  class Client {
    dir = '';
    access = vi.fn(async (o: { password: string }) => { if (o.password === 'bad') throw new Error('530 Login incorrect'); });
    ensureDir = vi.fn(async (d: string) => { this.dir = d; });
    uploadFrom = vi.fn(async (_s: unknown, name: string) => { uploaded.push({ name, dir: this.dir }); });
    close = vi.fn();
  }
  return { Client, uploaded };
});

beforeEach(resetDatabase);

async function twoOrgs() {
  const orgA = await createOrg('A');
  const orgB = await createOrg('B');
  const adminA = await createUser(orgA.id, 'SYSTEM_ADMIN');
  const hrA = await createUser(orgA.id, 'HR_ADMIN');
  const adminB = await createUser(orgB.id, 'SYSTEM_ADMIN');
  const empB = await createUser(orgB.id);
  return { orgA, orgB, adminA, hrA, adminB, empB };
}

async function clientAndProject(organizationId: string) {
  const client = await prisma.client.create({ data: { name: 'Secret Client', organizationId, taxId: 'TAX-1' } });
  const project = await prisma.project.create({ data: { name: 'Secret Project', code: 'P1', organizationId, clientId: client.id } });
  const task = await prisma.task.create({ data: { name: 'T', projectId: project.id } });
  return { client, project, task };
}

describe('organization isolation', () => {
  it('blocks every cross-organization write through departments', async () => {
    const { orgB, hrA, adminB } = await twoOrgs();
    const dept = await prisma.department.create({ data: { name: 'B', code: 'B', organizationId: orgB.id } });
    expect((await as(hrA).put(`/api/departments/${dept.id}`).send({ name: 'hacked' })).status).toBe(404);
    expect((await as(hrA).post('/api/departments').send({ name: 'X', code: 'X', managerId: adminB.id })).status).toBe(404);
    expect((await prisma.department.findUniqueOrThrow({ where: { id: dept.id } })).name).toBe('B');
  });

  it('ignores an attempt to move a department to another organization', async () => {
    const { orgA, orgB, hrA } = await twoOrgs();
    const dept = await prisma.department.create({ data: { name: 'A', code: 'A', organizationId: orgA.id } });
    const res = await as(hrA).put(`/api/departments/${dept.id}`).send({ name: 'A2', organizationId: orgB.id });
    expect(res.status).toBe(200);
    expect((await prisma.department.findUniqueOrThrow({ where: { id: dept.id } })).organizationId).toBe(orgA.id);
  });

  it('blocks project member and task changes across organizations', async () => {
    const { orgB, adminA, adminB } = await twoOrgs();
    const { project, task } = await clientAndProject(orgB.id);
    expect((await as(adminA).post(`/api/projects/${project.id}/members`).send({ userId: adminA.id })).status).toBe(404);
    expect((await as(adminA).post(`/api/projects/${project.id}/tasks`).send({ name: 'X' })).status).toBe(404);
    expect((await as(adminA).put(`/api/projects/${project.id}/tasks/${task.id}`).send({ name: 'hacked' })).status).toBe(404);
    expect((await as(adminA).delete(`/api/projects/${project.id}/tasks/${task.id}`)).status).toBe(404);
    expect((await as(adminA).get(`/api/projects/${project.id}/utilization`)).status).toBe(404);
    expect((await as(adminB).post(`/api/projects/${project.id}/members`).send({ userId: adminA.id })).status).toBe(404);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).name).toBe('T');
  });

  it('cannot attach another organization\'s client or project to an invoice', async () => {
    const { orgA, orgB, adminA } = await twoOrgs();
    const b = await clientAndProject(orgB.id);
    const a = await clientAndProject(orgA.id);
    const item = { description: 'x', quantity: 1, unitPrice: 1 };
    const stolen = await as(adminA).post('/api/invoices').send({ clientId: b.client.id, dueDate: '2026-12-01', items: [item] });
    expect(stolen.status).toBe(404);
    expect(JSON.stringify(stolen.body)).not.toContain('TAX-1');
    const viaItem = await as(adminA).post('/api/invoices').send({ clientId: a.client.id, dueDate: '2026-12-01', items: [{ ...item, projectId: b.project.id }] });
    expect(viaItem.status).toBe(404);
  });

  it('cannot log hours or expenses against another organization\'s project', async () => {
    const { orgA, orgB } = await twoOrgs();
    const emp = await createUser(orgA.id);
    const b = await clientAndProject(orgB.id);
    const { timesheet } = await createTimesheet(emp.id);
    expect((await as(emp).post(`/api/timesheets/${timesheet.id}/entries`).send({ date: WEEK.entryDate, hours: 1, projectId: b.project.id })).status).toBe(404);
    expect((await as(emp).post(`/api/timesheets/${timesheet.id}/entries`).send({ date: WEEK.entryDate, hours: 1, taskId: b.task.id })).status).toBe(404);
    expect((await as(emp).post('/api/timer/start').send({ projectId: b.project.id })).status).toBe(404);
    expect((await as(emp).post('/api/expenses').send({ category: 'x', amount: 1, date: '2026-03-04', description: 'd', projectId: b.project.id })).status).toBe(404);
  });

  it('cannot read another organization\'s attendance, even with a crafted filter', async () => {
    const { orgB, hrA, empB } = await twoOrgs();
    await prisma.attendance.create({ data: { userId: empB.id, date: new Date('2026-03-04'), status: 'PRESENT' } });
    expect((await as(hrA).get(`/api/attendance/all?userId=${empB.id}`)).body).toHaveLength(0);
    expect((await as(hrA).get('/api/attendance/all?userId[not]=x')).status).toBe(400);
    expect(orgB.id).toBeTruthy();
  });

  it('cannot delegate approvals to someone in another organization', async () => {
    const { adminA, adminB } = await twoOrgs();
    const res = await as(adminA).post('/api/approvals/delegate').send({ toUserId: adminB.id, startDate: '2026-01-01', endDate: '2026-01-02' });
    expect(res.status).toBe(404);
  });

  it('keeps timesheets, users, teams and payroll periods apart', async () => {
    const { orgB, adminA, adminB, empB } = await twoOrgs();
    const { timesheet } = await createTimesheet(empB.id, 'SUBMITTED');
    const team = await prisma.team.create({ data: { name: 'B', organizationId: orgB.id } });
    await as(adminB).post('/api/payroll/periods').send({ name: 'B', startDate: '2026-01-01', endDate: '2026-02-01' });

    expect((await as(adminA).get(`/api/timesheets/${timesheet.id}`)).status).toBe(403);
    const listed = await as(adminA).get(`/api/timesheets?userId=${empB.id}`);
    expect(listed.body.timesheets).toHaveLength(0);
    expect((await as(adminA).get(`/api/users/${empB.id}`)).status).toBe(404);
    expect((await as(adminA).delete(`/api/users/${empB.id}`)).status).toBe(404);
    expect((await as(adminA).get(`/api/teams/${team.id}`)).status).toBe(404);
    expect((await as(adminA).get('/api/payroll/periods')).body).toHaveLength(0);
  });

  it('counts this organization only on the dashboard', async () => {
    const { adminA, empB } = await twoOrgs();
    await prisma.timesheet.create({ data: { userId: empB.id, periodStart: new Date(), periodEnd: new Date(Date.now() + 1000), status: 'SUBMITTED' } });
    const res = await as(adminA).get('/api/analytics/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.submittedThisWeek).toBe(0);
    // One HR admin in org A has submitted nothing; another org's submission must not cancel that out
    expect(res.body.missingThisWeek).toBe(1);
  });

  it('allows the same employee ID and invoice numbers in different organizations', async () => {
    const { orgA, orgB, adminA, adminB } = await twoOrgs();
    const body = { employeeId: 'E001', firstName: 'A', lastName: 'B' };
    expect((await as(adminA).post('/api/users').send({ ...body, email: 'one@test.local' })).status).toBe(201);
    expect((await as(adminB).post('/api/users').send({ ...body, email: 'two@test.local' })).status).toBe(201);
    const dup = await as(adminA).post('/api/users').send({ ...body, email: 'three@test.local' });
    expect(dup.status).toBe(409);
    expect(JSON.stringify(dup.body)).not.toMatch(/prisma|Unique constraint|organizationId/i);

    const a = await clientAndProject(orgA.id);
    const b = await clientAndProject(orgB.id);
    const item = { description: 'x', quantity: 1, unitPrice: 1 };
    const invA = await as(adminA).post('/api/invoices').send({ clientId: a.client.id, dueDate: '2026-12-01', items: [item] });
    const invB = await as(adminB).post('/api/invoices').send({ clientId: b.client.id, dueDate: '2026-12-01', items: [item] });
    expect(invA.body.invoiceNumber).toBe('INV-00001');
    expect(invB.body.invoiceNumber).toBe('INV-00001');
  });

  it('does not reuse an invoice number after a deletion', async () => {
    const { orgA, adminA } = await twoOrgs();
    const a = await clientAndProject(orgA.id);
    const item = { description: 'x', quantity: 1, unitPrice: 1 };
    const send = () => as(adminA).post('/api/invoices').send({ clientId: a.client.id, dueDate: '2026-12-01', items: [item] });
    const first = await send();
    const second = await send();
    await as(adminA).delete(`/api/invoices/${first.body.id}`);
    const third = await send();
    expect(third.status).toBe(201);
    expect(third.body.invoiceNumber).toBe('INV-00003');
    expect(second.body.invoiceNumber).toBe('INV-00002');
  });

  it('hides tenant branding on the sign-in page once there are several organizations', async () => {
    const org = await createOrg('Only');
    await prisma.organization.update({ where: { id: org.id }, data: { appName: 'Only App' } });
    expect((await request(app).get('/api/public/branding')).body.appName).toBe('Only App');
    const other = await createOrg('Second');
    expect((await request(app).get('/api/public/branding')).body).toEqual({});

    const user = await createUser(other.id);
    await prisma.organization.update({ where: { id: other.id }, data: { appName: 'Second App' } });
    expect((await as(user).get('/api/auth/branding')).body.appName).toBe('Second App');
  });
});

describe('updates keep existing values', () => {
  it('a partial invoice update does not reset currency, tax or discount', async () => {
    const { orgA, adminA } = await twoOrgs();
    const a = await clientAndProject(orgA.id);
    const created = await as(adminA).post('/api/invoices').send({
      clientId: a.client.id, dueDate: '2026-12-01', currency: 'EUR', taxRate: 20, discount: 5,
      items: [{ description: 'x', quantity: 1, unitPrice: 100 }],
    });
    const updated = await as(adminA).put(`/api/invoices/${created.body.id}`).send({ notes: 'hello' });
    expect(updated.status).toBe(200);
    expect([updated.body.currency, updated.body.taxRate, updated.body.discount, updated.body.notes]).toEqual(['EUR', 20, 5, 'hello']);
  });

  it('a partial expense update does not reset the currency', async () => {
    const org = await createOrg();
    const emp = await createUser(org.id);
    const created = await as(emp).post('/api/expenses').send({ category: 'x', amount: 5, currency: 'EUR', date: '2026-03-04', description: 'd' });
    const updated = await as(emp).put(`/api/expenses/${created.body.id}`).send({ notes: 'n' });
    expect(updated.status).toBe(200);
    expect(updated.body.currency).toBe('EUR');
  });
});

describe('who can read what', () => {
  it('shows colleagues a directory entry, not personal or security details', async () => {
    const org = await createOrg();
    const a = await createUser(org.id, 'EMPLOYEE', { phone: '555-1', ipWhitelist: ['1.1.1.1'] });
    const colleague = await createUser(org.id);
    const res = await as(colleague).get(`/api/users/${a.id}`);
    expect(res.status).toBe(200);
    expect(res.body.firstName).toBe('Test');
    for (const field of ['phone', 'email', 'ipWhitelist', 'exitDate', 'gender']) expect(res.body[field]).toBeUndefined();
  });

  it('gives a manager their report\'s details without security settings, and HR everything', async () => {
    const org = await createOrg();
    const manager = await createUser(org.id, 'DEPARTMENT_MANAGER');
    const hr = await createUser(org.id, 'HR_ADMIN');
    const report = await createUser(org.id, 'EMPLOYEE', { managerId: manager.id, phone: '555-1', ipWhitelist: ['1.1.1.1'] });
    const byManager = await as(manager).get(`/api/users/${report.id}`);
    expect(byManager.body.phone).toBe('555-1');
    expect(byManager.body.ipWhitelist).toBeUndefined();
    expect((await as(hr).get(`/api/users/${report.id}`)).body.ipWhitelist).toEqual(['1.1.1.1']);
  });

  it('limits an employee\'s timesheet history to themselves and their reviewers', async () => {
    const org = await createOrg();
    const pm = await createUser(org.id, 'PROJECT_MANAGER');
    const emp = await createUser(org.id);
    expect((await as(pm).get(`/api/users/${emp.id}/timesheets`)).status).toBe(403);
    expect((await as(emp).get(`/api/users/${emp.id}/timesheets`)).status).toBe(200);
  });

  it('hides a project from employees not assigned to it, and client details from those who are', async () => {
    const org = await createOrg();
    const { project } = await clientAndProject(org.id);
    const outsider = await createUser(org.id);
    const member = await createUser(org.id);
    await prisma.projectMember.create({ data: { projectId: project.id, userId: member.id } });

    expect((await as(outsider).get(`/api/projects/${project.id}`)).status).toBe(404);
    expect((await as(outsider).get(`/api/projects/${project.id}/utilization`)).status).toBe(404);

    const seen = await as(member).get(`/api/projects/${project.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.client.name).toBe('Secret Client');
    expect(seen.body.client.taxId).toBeUndefined();
  });

  it('hides a client\'s member list from employees outside it', async () => {
    const org = await createOrg();
    const { client } = await clientAndProject(org.id);
    const outsider = await createUser(org.id);
    expect((await as(outsider).get(`/api/clients/${client.id}/members`)).status).toBe(404);
  });
});

describe('login abuse', () => {
  const from = (ip: string) => request(app).post('/api/auth/login').set('X-Forwarded-For', ip);

  it('a stranger failing repeatedly cannot lock the real user out', async () => {
    const org = await createOrg();
    const user = await createUser(org.id);
    for (let i = 0; i < 6; i++) await from('203.0.113.1').send({ email: user.email, password: 'wrong-pass' });
    expect((await from('203.0.113.1').send({ email: user.email, password: PASSWORD })).status).toBe(423);
    expect((await from('203.0.113.2').send({ email: user.email, password: PASSWORD })).status).toBe(200);
  });

  it('slows attacks spread across many addresses', async () => {
    const org = await createOrg();
    const user = await createUser(org.id);
    for (let i = 0; i < 50; i++) await redis.incr(`login:attempts-all:${user.email}`);
    await redis.set(`login:attempts-all:${user.email}`, '49');
    await from('203.0.113.9').send({ email: user.email, password: 'wrong-pass' });
    expect((await from('203.0.113.10').send({ email: user.email, password: PASSWORD })).status).toBe(423);
  });

  it('answers identically for unknown, inactive and SSO-only accounts', async () => {
    const org = await createOrg();
    const inactive = await createUser(org.id, 'EMPLOYEE', { isActive: false });
    const sso = await createUser(org.id, 'EMPLOYEE', { passwordHash: null });
    const emails = ['nobody@test.local', inactive.email, sso.email];
    const replies = [];
    for (const email of emails) replies.push(await anonymous().post('/api/auth/login').send({ email, password: 'wrong-pass' }));
    for (const r of replies) {
      expect(r.status).toBe(401);
      expect(r.body.message).toBe('Invalid credentials');
    }
  });

  it('locks unknown emails the same way, so lockout does not reveal which accounts exist', async () => {
    for (let i = 0; i < 5; i++) await from('203.0.113.3').send({ email: 'ghost@test.local', password: 'wrong-pass' });
    expect((await from('203.0.113.3').send({ email: 'ghost@test.local', password: 'wrong-pass' })).status).toBe(423);
  });

  it('never accepts a correct password on an inactive account', async () => {
    const org = await createOrg();
    const inactive = await createUser(org.id, 'EMPLOYEE', { isActive: false });
    expect((await anonymous().post('/api/auth/login').send({ email: inactive.email, password: PASSWORD })).status).toBe(401);
  });
});

describe('input and output safety', () => {
  it('rejects operator-style query parameters and caps page sizes', async () => {
    const org = await createOrg();
    const hr = await createUser(org.id, 'HR_ADMIN');
    expect((await as(hr).get('/api/users?role[not]=EMPLOYEE')).status).toBe(400);
    expect((await as(hr).get('/api/users?limit=99999999')).body.limit).toBe(1000);
    expect((await as(hr).get('/api/users?limit=abc')).status).toBe(200);
  });

  it('does not expose database details in errors', async () => {
    const org = await createOrg();
    const hr = await createUser(org.id, 'HR_ADMIN');
    const bad = await as(hr).get('/api/attendance/all?from=not-a-date');
    expect(bad.status).toBeLessThan(500);
    expect(JSON.stringify(bad.body)).not.toMatch(/prisma|invocation|column/i);
  });

  it('neutralizes formulas in CSV exports', async () => {
    const org = await createOrg();
    const hr = await createUser(org.id, 'HR_ADMIN');
    await createUser(org.id, 'EMPLOYEE', { firstName: '=HYPERLINK("http://evil")' });
    const res = await as(hr).get('/api/reports/export?type=missing&format=csv');
    expect(res.status).toBe(200);
    expect(res.text).toContain(`'=HYPERLINK`);
    expect(res.text).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it('escapes user-editable text in emails', async () => {
    const { approvalPendingTemplate, timesheetRejectedTemplate } = await import('../src/services/email.service');
    const evil = '<a href="http://phish">Click</a>';
    expect(approvalPendingTemplate('Boss', evil)).not.toContain('<a href="http://phish"');
    expect(timesheetRejectedTemplate(evil, 'Mar', evil)).toContain('&lt;a href=');
  });
});

describe('reopening an approved timesheet', () => {
  async function approved() {
    const org = await createOrg();
    const hr = await createUser(org.id, 'HR_ADMIN');
    const manager = await createUser(org.id, 'DEPARTMENT_MANAGER');
    const emp = await createUser(org.id, 'EMPLOYEE', { managerId: manager.id });
    const { timesheet, approvals } = await createTimesheet(emp.id, 'SUBMITTED', [hr.id]);
    await as(hr).post(`/api/approvals/${approvals[0].id}/approve`);
    return { org, hr, manager, emp, timesheet };
  }

  it('lets a reviewer send it back, after which the employee can correct and resubmit', async () => {
    const { manager, emp, timesheet } = await approved();
    expect((await as(manager).post(`/api/approvals/timesheets/${timesheet.id}/reopen`).send({})).status).toBe(400);
    expect((await as(manager).post(`/api/approvals/timesheets/${timesheet.id}/reopen`).send({ reason: 'Wrong project' })).status).toBe(200);
    expect((await prisma.timesheet.findUniqueOrThrow({ where: { id: timesheet.id } })).status).toBe('DRAFT');
    expect((await prisma.timesheetApproval.findFirstOrThrow({ where: { timesheetId: timesheet.id } })).status).toBe('REOPENED');

    expect((await as(emp).put(`/api/timesheets/${timesheet.id}/entries/${timesheet.entries[0].id}`).send({ hours: 6 })).status).toBe(200);
    expect((await as(emp).post(`/api/timesheets/${timesheet.id}/submit`)).status).toBe(200);
  });

  it('is refused for the employee, unrelated managers and other organizations', async () => {
    const { org, emp, timesheet } = await approved();
    const unrelated = await createUser(org.id, 'TEAM_LEAD');
    const otherOrg = await createOrg();
    const foreignAdmin = await createUser(otherOrg.id, 'SYSTEM_ADMIN');
    const body = { reason: 'x' };
    expect((await as(emp).post(`/api/approvals/timesheets/${timesheet.id}/reopen`).send(body)).status).toBe(403);
    expect((await as(unrelated).post(`/api/approvals/timesheets/${timesheet.id}/reopen`).send(body)).status).toBe(403);
    expect((await as(foreignAdmin).post(`/api/approvals/timesheets/${timesheet.id}/reopen`).send(body)).status).toBe(404);
  });

  it('is refused once payroll has locked it', async () => {
    const { hr, timesheet } = await approved();
    await prisma.timesheet.update({ where: { id: timesheet.id }, data: { status: 'LOCKED' } });
    expect((await as(hr).post(`/api/approvals/timesheets/${timesheet.id}/reopen`).send({ reason: 'x' })).status).toBe(409);
  });
});

describe('backup targets', () => {
  const ftp = { host: '127.0.0.1', user: 'u', password: 'p', remotePath: '/backups' };

  it('refuses internal addresses for FTP and S3', async () => {
    const org = await createOrg();
    const admin = await createUser(org.id, 'SYSTEM_ADMIN');
    process.env.ALLOW_PRIVATE_BACKUP_TARGETS = 'false';
    const targets = ['127.0.0.1', '10.0.0.5', '169.254.169.254', '192.168.1.1', 'localhost'];
    for (const host of targets) {
      const res = await as(admin).post('/api/backup/ftp').send({ ...ftp, host });
      expect(res.status, host).toBe(400);
    }
    const s3 = await as(admin).post('/api/backup/cloud').send({ endpoint: 'http://169.254.169.254/', bucket: 'b', accessKey: 'a', secretKey: 's' });
    expect(s3.status).toBe(400);
    process.env.ALLOW_PRIVATE_BACKUP_TARGETS = 'true';
  });

  it('uploads the backup over FTP and logs the result truthfully', async () => {
    const mocked = await import('basic-ftp') as unknown as { uploaded: { name: string; dir: string }[] };
    const org = await createOrg();
    const admin = await createUser(org.id, 'SYSTEM_ADMIN');

    const ok = await as(admin).post('/api/backup/ftp').send(ftp);
    expect(ok.status).toBe(200);
    expect(mocked.uploaded.at(-1)).toMatchObject({ dir: '/backups' });
    expect((await prisma.backupLog.findFirstOrThrow({ where: { organizationId: org.id } })).status).toBe('success');

    const failed = await as(admin).post('/api/backup/ftp').send({ ...ftp, password: 'bad' });
    expect(failed.status).toBe(500);
    expect((await prisma.backupLog.findFirstOrThrow({ where: { organizationId: org.id, status: 'failed' } })).errorMessage).toContain('530');
  });
});
