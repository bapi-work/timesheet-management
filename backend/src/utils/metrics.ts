import client from 'prom-client';
import type { Request, Response, NextFunction } from 'express';
import prisma from './prisma';

export const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [register],
});

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const dbConnectionsUsed = new client.Gauge({
  name: 'timesheet_db_connections_used',
  help: 'Active PostgreSQL connections used by this application',
  registers: [register],
});

export const dbConnectionsMax = new client.Gauge({
  name: 'timesheet_db_connections_max',
  help: 'Maximum PostgreSQL connections configured for this application',
  registers: [register],
});

function getConfiguredPoolMax(): number {
  const url = process.env.DATABASE_URL || '';
  const match = url.match(/connection_limit=(\d+)/);
  return match ? parseInt(match[1], 10) : 13; // Prisma's default pool size
}

const poolMax = getConfiguredPoolMax();
dbConnectionsMax.set(poolMax);

let pollingStarted = false;
export function startDbPoolMetricsPolling(intervalMs = 15000): void {
  if (pollingStarted) return;
  pollingStarted = true;
  setInterval(async () => {
    try {
      const rows = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()
      `;
      dbConnectionsUsed.set(Number(rows[0]?.count ?? 0));
    } catch {
      // Metrics collection must never crash the app; skip this tick on failure.
    }
  }, intervalMs).unref();
}

export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    httpRequestDuration.observe(labels, durationSeconds);
  });
  next();
}
