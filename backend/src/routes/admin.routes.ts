import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest, ADMIN_ROLES } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';

const router = Router();
router.use(authenticate);
router.use(authorize(...ADMIN_ROLES));

const upload = multer({ dest: 'uploads/imports/' });

router.get('/organization', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const org = await prisma.organization.findUnique({ where: { id: req.user!.organizationId } });
    res.json(org);
  } catch (err) {
    next(err);
  }
});

router.put('/organization', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const allowed = ['name', 'timezone', 'dateFormat', 'weekStartDay', 'workingHoursPerDay', 'workingDaysPerWeek', 'timesheetPeriod', 'overtimeThreshold', 'supportEmail', 'footerText'];
    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    const org = await prisma.organization.update({ where: { id: req.user!.organizationId }, data });
    res.json(org);
  } catch (err) {
    next(err);
  }
});

// ─── Branding ────────────────────────────────────────────────────────────────

router.get('/branding', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.user!.organizationId },
      select: {
        appName: true, logoUrl: true, faviconUrl: true,
        primaryColor: true, secondaryColor: true, accentColor: true,
        sidebarBgColor: true, loginBgColor: true,
        footerText: true, supportEmail: true, name: true,
      },
    });
    res.json(org);
  } catch (err) {
    next(err);
  }
});

router.put('/branding', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const allowed = ['appName', 'logoUrl', 'faviconUrl', 'primaryColor', 'secondaryColor', 'accentColor', 'sidebarBgColor', 'loginBgColor', 'footerText', 'supportEmail'];
    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key] || null;
    }
    const org = await prisma.organization.update({ where: { id: req.user!.organizationId }, data });
    res.json(org);
  } catch (err) {
    next(err);
  }
});

router.get('/audit-logs', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { entity, userId, from, to, page = '1', limit = '50' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: Record<string, unknown> = {};
    if (entity) where.entity = entity;
    if (userId) where.userId = userId;
    if (from || to) {
      where.createdAt = {};
      if (from) (where.createdAt as Record<string, unknown>).gte = new Date(from as string);
      if (to) (where.createdAt as Record<string, unknown>).lte = new Date(to as string);
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: Number(limit),
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ logs, total });
  } catch (err) {
    next(err);
  }
});

router.post('/import-employees', upload.single('file'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) throw new AppError('No file uploaded', 400);

    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws);

    const results = { created: 0, failed: 0, errors: [] as string[] };

    for (const row of rows) {
      try {
        const hash = await bcrypt.hash('TempPass@123', 12);
        await prisma.user.create({
          data: {
            employeeId: row['Employee ID'] || row['employeeId'],
            email: row['Email'] || row['email'],
            firstName: row['First Name'] || row['firstName'],
            lastName: row['Last Name'] || row['lastName'],
            designation: row['Designation'] || row['designation'],
            passwordHash: hash,
            organizationId: req.user!.organizationId,
          },
        });
        results.created++;
      } catch (e) {
        results.failed++;
        results.errors.push(`Row ${results.created + results.failed}: ${(e as Error).message}`);
      }
    }

    res.json(results);
  } catch (err) {
    next(err);
  }
});

router.get('/export-employees', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { department: { select: { name: true } } },
    });

    const data = users.map(u => ({
      'Employee ID': u.employeeId,
      'First Name': u.firstName,
      'Last Name': u.lastName,
      'Email': u.email,
      'Role': u.role,
      'Department': u.department?.name || '',
      'Designation': u.designation || '',
      'Join Date': u.joinDate?.toISOString().split('T')[0] || '',
      'Active': u.isActive ? 'Yes' : 'No',
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Employees');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="employees.xlsx"');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

router.post('/holidays', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, date, isOptional } = req.body;
    const holiday = await prisma.holiday.create({
      data: { name, date: new Date(date), isOptional: isOptional ?? false, organizationId: req.user!.organizationId },
    });
    res.status(201).json(holiday);
  } catch (err) {
    next(err);
  }
});

router.delete('/holidays/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.holiday.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
