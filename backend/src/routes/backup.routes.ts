import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Readable } from 'stream';
import { Client as FtpClient } from 'basic-ftp';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import prisma from '../utils/prisma';
import { authenticate, authorize, AuthRequest, SYSTEM_ONLY_ROLES } from '../middleware/auth.middleware';
import { AppError } from '../middleware/error.middleware';
import { stripSecrets } from '../utils/sessions';
import { resolvePublicHost } from '../utils/net-guard';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const router = Router();
router.use(authenticate, authorize(...SYSTEM_ONLY_ROLES));

// Build a complete org backup object — used by all export paths
async function buildBackupContent(orgId: string): Promise<{ json: string; compressed: Buffer; fileName: string }> {
  const userIds = await prisma.user.findMany({ where: { organizationId: orgId }, select: { id: true } });
  const ids = userIds.map(u => u.id);

  const [
    org, rawUsers, timesheets, projects, clients, expenses, invoices,
    departments, leaveRequests, leaveBalances, holidays, attendance,
    tasks, teams,
  ] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId } }),
    prisma.user.findMany({ where: { organizationId: orgId } }),
    prisma.timesheet.findMany({ where: { user: { organizationId: orgId } }, include: { entries: true } }),
    prisma.project.findMany({ where: { organizationId: orgId }, include: { tasks: true } }),
    prisma.client.findMany({ where: { organizationId: orgId } }),
    prisma.expense.findMany({ where: { organizationId: orgId } }),
    prisma.invoice.findMany({ where: { organizationId: orgId }, include: { items: true } }),
    prisma.department.findMany({ where: { organizationId: orgId } }),
    prisma.leaveRequest.findMany({ where: { user: { organizationId: orgId } } }),
    prisma.leaveBalance.findMany({ where: { userId: { in: ids } } }),
    prisma.holiday.findMany({ where: { organizationId: orgId } }),
    prisma.attendance.findMany({ where: { userId: { in: ids } } }),
    prisma.task.findMany({ where: { project: { organizationId: orgId } } }),
    prisma.team.findMany({ where: { organizationId: orgId }, include: { members: true } }),
  ]);

  const users = rawUsers.map(stripSecrets);

  const backup = {
    exportedAt: new Date().toISOString(),
    version: '2.0',
    organization: org,
    data: {
      users, departments, teams, projects, tasks, clients,
      timesheets, expenses, invoices,
      leaveRequests, leaveBalances, holidays, attendance,
    },
  };

  const json = JSON.stringify(backup, null, 2);
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `backup-${orgId}-${dateStr}.json.gz`;
  const compressed = await gzip(Buffer.from(json, 'utf8'));
  return { json, compressed, fileName };
}

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

// GET /api/backup/export — download compressed backup
router.get('/export', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = req.user!.organizationId;

    const { compressed, fileName } = await buildBackupContent(orgId);
    const sizeBytes = compressed.length;

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

    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', sizeBytes);
    res.send(compressed);
  } catch (err) {
    next(err);
  }
});

// POST /api/backup/restore — restore from uploaded JSON or JSON.GZ
router.post('/restore', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { data: backupData, fileType } = req.body;
    if (!backupData) throw new AppError('No backup data provided', 400);

    let parsed: { version?: string; data?: Record<string, unknown>; exportedAt?: string };
    try {
      if (fileType === 'gz' || fileType === 'gzip') {
        // backupData is base64-encoded gz
        const buf = Buffer.from(backupData as string, 'base64');
        const decompressed = await (gunzip as (b: Buffer, o: zlib.ZlibOptions) => Promise<Buffer>)(buf, { maxOutputLength: 200 * 1024 * 1024 });
        parsed = JSON.parse(decompressed.toString('utf8'));
      } else {
        parsed = typeof backupData === 'string' ? JSON.parse(backupData) : backupData;
      }
    } catch {
      throw new AppError('Invalid backup file — could not parse JSON or decompress GZ', 400);
    }

    if (!parsed.data) throw new AppError('Invalid backup format: missing data field', 400);

    res.json({
      message: 'Backup file validated successfully. Tables detected below. Full restore requires a DBA operation using the exported file.',
      exportedAt: parsed.exportedAt,
      version: parsed.version,
      tables: Object.keys(parsed.data),
      recordCounts: Object.fromEntries(
        Object.entries(parsed.data).map(([k, v]) => [k, Array.isArray(v) ? v.length : '?'])
      ),
    });
  } catch (err) {
    next(err);
  }
});

const ftpSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(21),
  secure: z.boolean().default(true), // FTPS. Plain FTP sends the password and backup unencrypted.
  user: z.string().min(1),
  password: z.string().min(1),
  remotePath: z.string().default('/backups'),
});

// POST /api/backup/ftp — upload a compressed backup over FTPS or FTP
router.post('/ftp', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { host, port, user, password, remotePath, secure } = ftpSchema.parse(req.body);
    const orgId = req.user!.organizationId;

    const address = await resolvePublicHost(host);
    const { compressed, fileName } = await buildBackupContent(orgId);

    // By default this client keeps data connections on the host checked above
    const client = new FtpClient(30000);
    try {
      await client.access({
        host: address,
        port,
        user,
        password,
        secure,
        secureOptions: { servername: host },
      });
      await client.ensureDir(remotePath);
      await client.uploadFrom(Readable.from(compressed), fileName);
    } finally {
      client.close();
    }

    const destination = `ftp://${user}@${host}:${port}${remotePath}/${fileName}`;

    await prisma.backupLog.create({
      data: {
        organizationId: orgId,
        createdBy: req.user!.userId,
        type: 'ftp',
        status: 'success',
        fileName,
        fileSizeBytes: compressed.length,
        destination,
      },
    });

    res.json({
      message: 'Backup uploaded successfully via FTP.',
      fileName,
      destination,
      compressedSizeBytes: compressed.length,
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
        fileName: `backup-${orgId}-${new Date().toISOString().slice(0, 10)}.json.gz`,
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
    await resolvePublicHost(new URL(endpoint).hostname);

    const { compressed, fileName } = await buildBackupContent(orgId);

    // Normalize endpoint: strip bucket subdomain if user pasted the bucket-specific URL
    let sdkEndpoint = endpoint;
    try {
      const u = new URL(endpoint);
      if (u.hostname.startsWith(bucket + '.')) {
        u.hostname = u.hostname.slice(bucket.length + 1);
        sdkEndpoint = `${u.protocol}//${u.hostname}`;
      }
    } catch { /* leave as-is */ }

    const s3 = new S3Client({
      endpoint: sdkEndpoint,
      region,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      forcePathStyle: false,
    });

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: fileName,
      Body: compressed,
      ContentType: 'application/gzip',
      ContentLength: compressed.length,
      ContentEncoding: 'gzip',
    }));

    await prisma.backupLog.create({
      data: {
        organizationId: orgId,
        createdBy: req.user!.userId,
        type: 's3',
        status: 'success',
        fileName,
        fileSizeBytes: compressed.length,
        destination: `s3://${bucket}/${fileName} (region: ${region})`,
      },
    });

    res.json({
      message: 'Backup uploaded successfully to cloud storage.',
      fileName,
      destination: `${endpoint}/${bucket}/${fileName}`,
      compressedSizeBytes: compressed.length,
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
        fileName: `backup-${orgId}-${new Date().toISOString().slice(0, 10)}.json.gz`,
        errorMessage: errorMsg,
      },
    });
    next(err);
  }
});

export default router;
