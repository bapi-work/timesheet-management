import Bull from 'bull';
import { logger } from '../utils/logger';
import { sendEmail } from './email.service';
import prisma from '../utils/prisma';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const emailQueue = new Bull('email', REDIS_URL);
export const notificationQueue = new Bull('notification', REDIS_URL);
export const reminderQueue = new Bull('reminder', REDIS_URL);

export function initQueues(): void {
  emailQueue.process(async (job) => {
    await sendEmail(job.data);
  });

  notificationQueue.process(async (job) => {
    const { userId, type, title, message, data } = job.data;
    await prisma.notification.create({
      data: { userId, type, title, message, data },
    });
  });

  reminderQueue.process(async (_job) => {
    await sendTimesheetReminders();
  });

  reminderQueue.add({}, { repeat: { cron: '0 9 * * 1' } }); // Monday 9am

  emailQueue.on('failed', (job, err) => {
    logger.error(`Email job ${job.id} failed:`, err);
  });

  logger.info('Queues initialized');
}

async function sendTimesheetReminders(): Promise<void> {
  const { startOf, endOf } = getCurrentWeekBounds();

  const usersWithoutSubmission = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { notIn: ['SYSTEM_ADMIN'] },
      timesheets: {
        none: {
          periodStart: { gte: startOf },
          periodEnd: { lte: endOf },
          status: { in: ['SUBMITTED', 'APPROVED'] },
        },
      },
    },
    select: { id: true, email: true, firstName: true },
  });

  for (const user of usersWithoutSubmission) {
    await emailQueue.add({
      to: user.email,
      subject: 'Timesheet Reminder',
      html: `<p>Hi ${user.firstName}, please submit your timesheet for this week.</p>`,
    });

    await notificationQueue.add({
      userId: user.id,
      type: 'TIMESHEET_REMINDER',
      title: 'Timesheet Due',
      message: 'Please submit your timesheet for the current week.',
    });
  }
}

function getCurrentWeekBounds() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const startOf = new Date(now.setDate(diff));
  startOf.setHours(0, 0, 0, 0);
  const endOf = new Date(startOf);
  endOf.setDate(startOf.getDate() + 6);
  endOf.setHours(23, 59, 59, 999);
  return { startOf, endOf };
}
