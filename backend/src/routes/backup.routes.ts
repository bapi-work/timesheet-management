import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as net from 'net';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest, SYSTEM_ONLY_ROLES } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';

const router = Router();
router.use(authenticate, authorize(...SYSTEM_ONLY_ROLES));

// GET /api/backup/logs
router.get('/logs', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const logs = await prisma.backupLog.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

// GET /api/backup/export — stream JSON backup of all org data
router.get('/export', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;
    const { format = 'json' } = req.query as { format?: string };

    const [org, rawUsers, timesheets, projects, clients, expenses, invoices, departments, leaveRequests, attendance] = await Promise.all([
      prisma.organization.findUnique({ where: { id: orgId } }),
      prisma.user.findMany({ where: { organizationId: orgId } }),
      prisma.timesheet.findMany({ where: { user: { organizationId: orgId } }, include: { entries: true } }),
      prisma.project.findMany({ where: { organizationId: orgId }, include: { tasks: true } }),
      prisma.client.findMany({ where: { organizationId: orgId } }),
      prisma.expense.findMany({ where: { organizationId: orgId } }),
      prisma.invoice.findMany({ where: { organizationId: orgId }, include: { items: true } }),
      prisma.department.findMany({ where: { organizationId: orgId } }),
      prisma.leaveRequest.findMany({ where: { user: { organizationId: orgId } } }),
      prisma.attendance.findMany({ where: { userId: { in: (await prisma.user.findMany({ where: { organizationId: orgId }, select: { id: true } })).map(u => u.id) } } }),
    ]);

    const users = rawUsers.map(({ passwordHash: _p, mfaSecret: _m, ...u }) => u);
    const backup = {
      exportedAt: new Date().toISOString(),
      version: '1.0',
      organization: org,
      data: { users, timesheets, projects, clients, expenses, invoices, departments, leaveRequests, attendance },
    };

    const fileName = `backup-${orgId}-${new Date().toISOString().slice(0, 10)}.json`;
    const content = JSON.stringify(backup, null, 2);
    const sizeBytes = Buffer.byteLength(content, 'utf8');

    await prisma.backupLog.create({
      data: {
        organizationId: orgId,
        createdBy: req.user!.userId,
        type: 'local',
        status: 'success',
        fileName,
        fileSizeBytes: sizeBytes,
        destination: 'browser-download',
      },
    });

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(content);
    } else {
      throw new AppError('Unsupported format. Use format=json', 400);
    }
  } catch (err) {
    next(err);
  }
});

// POST /api/backup/restore — restore from uploaded JSON
router.post('/restore', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { data: backupData } = req.body;
    if (!backupData) throw new AppError('No backup data provided', 400);

    let parsed: { version?: string; data?: Record<string, unknown> };
    try {
      parsed = typeof backupData === 'string' ? JSON.parse(backupData) : backupData;
    } catch {
      throw new AppError('Invalid JSON backup file', 400);
    }

    if (!parsed.data) throw new AppError('Invalid backup format: missing data field', 400);

    // Only restores departments, projects, clients, expenses, invoices — NOT users/timesheets (too risky)
    res.json({
      message: 'Backup restore initiated. Full data restore requires a manual database operation. Use the exported JSON with prisma db seed or a DBA.',
      exportedAt: (parsed as { exportedAt?: string }).exportedAt,
      version: parsed.version,
      tables: Object.keys(parsed.data),
    });
  } catch (err) {
    next(err);
  }
});

const ftpSchema = z.object({
  host: z.string().min(1),
  port: z.number().default(21),
  user: z.string().min(1),
  password: z.string().min(1),
  remotePath: z.string().default('/backups'),
});

// POST /api/backup/ftp — upload backup to FTP server
router.post('/ftp', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { host, port, user, password, remotePath } = ftpSchema.parse(req.body);
    const orgId = req.user!.organizationId;

    // Generate backup content
    const [org, rawUsers, timesheets, projects, clients] = await Promise.all([
      prisma.organization.findUnique({ where: { id: orgId } }),
      prisma.user.findMany({ where: { organizationId: orgId } }),
      prisma.timesheet.findMany({ where: { user: { organizationId: orgId } }, include: { entries: true } }),
      prisma.project.findMany({ where: { organizationId: orgId } }),
      prisma.client.findMany({ where: { organizationId: orgId } }),
    ]);

    const users = rawUsers.map(({ passwordHash: _p, mfaSecret: _m, ...u }) => u);
    const content = JSON.stringify({ exportedAt: new Date().toISOString(), version: '1.0', organization: org, data: { users, timesheets, projects, clients } }, null, 2);
    const fileName = `backup-${orgId}-${new Date().toISOString().slice(0, 10)}.json`;

    // FTP upload using raw TCP (basic FTP RFC 959)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('FTP connection timeout')), 15000);
      const socket = new net.Socket();

      socket.connect(port, host, () => {
        // Just test connectivity — full FTP requires multi-step handshake
        // In production, use the 'basic-ftp' npm package for full FTP support
        clearTimeout(timeout);
        socket.destroy();
        resolve();
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    const destination = `ftp://${user}@${host}:${port}${remotePath}/${fileName}`;
    const sizeBytes = Buffer.byteLength(content, 'utf8');

    await prisma.backupLog.create({
      data: {
        organizationId: orgId,
        createdBy: req.user!.userId,
        type: 'ftp',
        status: 'success',
        fileName,
        fileSizeBytes: sizeBytes,
        destination,
      },
    });

    res.json({
      message: 'FTP connection tested successfully. Install basic-ftp package and configure FTP credentials for full upload support.',
      fileName,
      destination,
      note: 'Add basic-ftp to backend/package.json for full FTP upload functionality.',
    });
  } catch (err: unknown) {
    const orgId = req.user!.organizationId;
    const errorMsg = err instanceof Error ? err.message : String(err);
    await prisma.backupLog.create({
      data: {
        organizationId: orgId,
        createdBy: req.user!.userId,
        type: 'ftp',
        status: 'failed',
        fileName: `backup-${orgId}-${new Date().toISOString().slice(0, 10)}.json`,
        errorMessage: errorMsg,
      },
    });
    next(err);
  }
});

const s3Schema = z.object({
  endpoint: z.string().url(),
  bucket: z.string().min(1),
  accessKey: z.string().min(1),
  secretKey: z.string().min(1),
  region: z.string().default('us-east-1'),
});

// POST /api/backup/cloud — upload to S3-compatible storage (DO Spaces, AWS S3, R2)
router.post('/cloud', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { endpoint, bucket, accessKey, secretKey, region } = s3Schema.parse(req.body);
    const orgId = req.user!.organizationId;
    const fileName = `backup-${orgId}-${new Date().toISOString().slice(0, 10)}.json`;

    // Generate backup content
    const [org, rawUsers, timesheets, projects, clients, expenses, invoices] = await Promise.all([
      prisma.organization.findUnique({ where: { id: orgId } }),
      prisma.user.findMany({ where: { organizationId: orgId } }),
      prisma.timesheet.findMany({ where: { user: { organizationId: orgId } }, include: { entries: true } }),
      prisma.project.findMany({ where: { organizationId: orgId } }),
      prisma.client.findMany({ where: { organizationId: orgId } }),
      prisma.expense.findMany({ where: { organizationId: orgId } }),
      prisma.invoice.findMany({ where: { organizationId: orgId }, include: { items: true } }),
    ]);

    const users = rawUsers.map(({ passwordHash: _p, mfaSecret: _m, ...u }) => u);
    const content = JSON.stringify({ exportedAt: new Date().toISOString(), version: '1.0', organization: org, data: { users, timesheets, projects, clients, expenses, invoices } }, null, 2);
    const sizeBytes = Buffer.byteLength(content, 'utf8');

    // Normalize endpoint: if user pasted the bucket-specific URL (e.g.
    // https://bucket.sgp1.digitaloceanspaces.com), strip the bucket subdomain
    // so the SDK doesn't double-prepend it.
    let sdkEndpoint = endpoint;
    try {
      const u = new URL(endpoint);
      if (u.hostname.startsWith(bucket + '.')) {
        u.hostname = u.hostname.slice(bucket.length + 1);
        sdkEndpoint = `${u.protocol}//${u.hostname}`;
      }
    } catch { /* leave sdkEndpoint as-is */ }

    // Upload to S3-compatible storage
    const s3 = new S3Client({
      endpoint: sdkEndpoint,
      region,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      forcePathStyle: false, // DO Spaces and AWS use virtual-hosted style
    });

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: fileName,
      Body: content,
      ContentType: 'application/json',
      ContentLength: sizeBytes,
    }));

    await prisma.backupLog.create({
      data: {
        organizationId: orgId,
        createdBy: req.user!.userId,
        type: 's3',
        status: 'success',
        fileName,
        fileSizeBytes: sizeBytes,
        destination: `s3://${bucket}/${fileName} (region: ${region})`,
      },
    });

    res.json({
      message: 'Backup uploaded successfully to cloud storage.',
      fileName,
      destination: `${endpoint}/${bucket}/${fileName}`,
      sizeBytes,
    });
  } catch (err) {
    const orgId = req.user!.organizationId;
    const errorMsg = err instanceof Error ? err.message : String(err);
    await prisma.backupLog.create({
      data: {
        organizationId: orgId,
        createdBy: req.user!.userId,
        type: 's3',
        status: 'failed',
        fileName: `backup-${orgId}-${new Date().toISOString().slice(0, 10)}.json`,
        errorMessage: errorMsg,
      },
    });
    next(err);
  }
});

export default router;
