-- AlterTable: Add dayType to LeaveRequest
ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "dayType" TEXT NOT NULL DEFAULT 'FULL_DAY';

-- AlterTable: Add organizationId to Team
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

-- AddForeignKey: Team.organizationId -> Organization.id
ALTER TABLE "Team" ADD CONSTRAINT "Team_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE SET NULL ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;
