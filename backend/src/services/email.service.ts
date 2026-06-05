import nodemailer from 'nodemailer';
import { logger } from '../utils/logger';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  cc?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}

export async function sendEmail(opts: EmailOptions): Promise<void> {
  if (!process.env.SMTP_USER) {
    logger.debug(`[Email skipped - no SMTP config] To: ${opts.to} | ${opts.subject}`);
    return;
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    ...opts,
  });
}

export function timesheetApprovedTemplate(name: string, period: string): string {
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#16a34a">Timesheet Approved</h2>
      <p>Hi ${name},</p>
      <p>Your timesheet for <strong>${period}</strong> has been <strong style="color:#16a34a">approved</strong>.</p>
    </div>`;
}

export function timesheetRejectedTemplate(name: string, period: string, reason: string): string {
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#dc2626">Timesheet Rejected</h2>
      <p>Hi ${name},</p>
      <p>Your timesheet for <strong>${period}</strong> has been <strong style="color:#dc2626">rejected</strong>.</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p>Please revise and resubmit.</p>
    </div>`;
}

export function approvalPendingTemplate(approverName: string, employeeName: string): string {
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#2563eb">Timesheet Pending Approval</h2>
      <p>Hi ${approverName},</p>
      <p><strong>${employeeName}</strong> has submitted a timesheet awaiting your approval.</p>
      <a href="${process.env.FRONTEND_URL}/approvals" style="background:#2563eb;color:white;padding:10px 20px;text-decoration:none;border-radius:4px">Review Now</a>
    </div>`;
}
