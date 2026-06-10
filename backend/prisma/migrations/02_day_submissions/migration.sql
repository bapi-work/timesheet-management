-- CreateEnum
CREATE TYPE "DaySubmissionStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "DaySubmission" (
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

-- CreateIndex
CREATE UNIQUE INDEX "DaySubmission_timesheetId_date_key" ON "DaySubmission"("timesheetId", "date");

-- CreateIndex
CREATE INDEX "DaySubmission_timesheetId_idx" ON "DaySubmission"("timesheetId");

-- CreateIndex
CREATE INDEX "DaySubmission_status_idx" ON "DaySubmission"("status");

-- AddForeignKey
ALTER TABLE "DaySubmission" ADD CONSTRAINT "DaySubmission_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "Timesheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DaySubmission" ADD CONSTRAINT "DaySubmission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
