-- AlterTable: add category to TimesheetEntry
ALTER TABLE "TimesheetEntry" ADD COLUMN IF NOT EXISTS "category" TEXT;
