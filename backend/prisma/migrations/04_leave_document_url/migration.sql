-- AlterTable: add documentUrl to LeaveRequest
ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "documentUrl" TEXT;
