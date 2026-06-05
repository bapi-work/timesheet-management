import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const org = await prisma.organization.upsert({
    where: { code: 'ACME' },
    update: {},
    create: {
      name: 'Acme Corporation',
      code: 'ACME',
      timezone: 'America/New_York',
      workingHoursPerDay: 8,
      workingDaysPerWeek: 5,
      timesheetPeriod: 'WEEKLY',
      overtimeThreshold: 8,
    },
  });

  const dept = await prisma.department.upsert({
    where: { organizationId_code: { organizationId: org.id, code: 'IT' } },
    update: {},
    create: {
      name: 'Information Technology',
      code: 'IT',
      organizationId: org.id,
    },
  });

  const adminHash = await bcrypt.hash('Admin@123', 12);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@acme.com' },
    update: {},
    create: {
      employeeId: 'EMP001',
      email: 'admin@acme.com',
      passwordHash: adminHash,
      firstName: 'System',
      lastName: 'Administrator',
      role: UserRole.SYSTEM_ADMIN,
      organizationId: org.id,
      departmentId: dept.id,
      joinDate: new Date(),
      isActive: true,
    },
  });

  const hrHash = await bcrypt.hash('HRAdmin@123', 12);

  await prisma.user.upsert({
    where: { email: 'hr@acme.com' },
    update: {},
    create: {
      employeeId: 'EMP002',
      email: 'hr@acme.com',
      passwordHash: hrHash,
      firstName: 'HR',
      lastName: 'Manager',
      role: UserRole.HR_ADMIN,
      organizationId: org.id,
      departmentId: dept.id,
      joinDate: new Date(),
      isActive: true,
    },
  });

  const empHash = await bcrypt.hash('Employee@123', 12);

  await prisma.user.upsert({
    where: { email: 'john.doe@acme.com' },
    update: {},
    create: {
      employeeId: 'EMP003',
      email: 'john.doe@acme.com',
      passwordHash: empHash,
      firstName: 'John',
      lastName: 'Doe',
      role: UserRole.EMPLOYEE,
      organizationId: org.id,
      departmentId: dept.id,
      managerId: admin.id,
      joinDate: new Date(),
      isActive: true,
    },
  });

  await prisma.project.upsert({
    where: { organizationId_code: { organizationId: org.id, code: 'PROJ-001' } },
    update: {},
    create: {
      organizationId: org.id,
      name: 'Internal Operations',
      code: 'PROJ-001',
      description: 'Internal operational tasks',
      billable: false,
      status: 'ACTIVE',
    },
  });

  await prisma.project.upsert({
    where: { organizationId_code: { organizationId: org.id, code: 'PROJ-002' } },
    update: {},
    create: {
      organizationId: org.id,
      name: 'Client Portal Development',
      code: 'PROJ-002',
      description: 'Client-facing portal development',
      billable: true,
      status: 'ACTIVE',
      budgetHours: 2000,
    },
  });

  const currentYear = new Date().getFullYear();
  const holidays = [
    { name: "New Year's Day", date: new Date(`${currentYear}-01-01`) },
    { name: 'Independence Day', date: new Date(`${currentYear}-07-04`) },
    { name: 'Thanksgiving', date: new Date(`${currentYear}-11-28`) },
    { name: 'Christmas Day', date: new Date(`${currentYear}-12-25`) },
  ];

  for (const h of holidays) {
    await prisma.holiday.upsert({
      where: { organizationId_date: { organizationId: org.id, date: h.date } },
      update: {},
      create: { ...h, organizationId: org.id },
    });
  }

  console.log('Seed complete.');
  console.log('Admin: admin@acme.com / Admin@123');
  console.log('HR:    hr@acme.com    / HRAdmin@123');
  console.log('Employee: john.doe@acme.com / Employee@123');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
