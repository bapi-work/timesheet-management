-- CreateEnum (idempotent)
DO $$ BEGIN
  CREATE TYPE "DaySubmissionStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable (idempotent)
CREATE TABLE IF NOT EXISTS "DaySubmission" (
    "id" TEXT NOT NULL,
    "timesheetId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "DaySubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DaySubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "DaySubmission_timesheetId_date_key" ON "DaySubmission"("timesheetId", "date");

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "DaySubmission_timesheetId_idx" ON "DaySubmission"("timesheetId");

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "DaySubmission_status_idx" ON "DaySubmission"("status");

-- AddForeignKey (idempotent)
DO $$ BEGIN
  ALTER TABLE "DaySubmission" ADD CONSTRAINT "DaySubmission_timesheetId_fkey"
    FOREIGN KEY ("timesheetId") REFERENCES "Timesheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey (idempotent)
DO $$ BEGIN
  ALTER TABLE "DaySubmission" ADD CONSTRAINT "DaySubmission_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
