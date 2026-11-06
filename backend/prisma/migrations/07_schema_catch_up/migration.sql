-- Schema changes that earlier reached databases through `prisma db push` but never had a migration.
-- Safe on both kinds of database: existing ones already have these, fresh installs don't.

ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
ALTER TABLE "Team" ALTER COLUMN "departmentId" DROP NOT NULL;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "gender" TEXT;

ALTER TABLE "WorkCategory" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE TABLE IF NOT EXISTS "ClientMember" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientMember_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ClientMember_clientId_idx" ON "ClientMember"("clientId");
CREATE INDEX IF NOT EXISTS "ClientMember_userId_idx" ON "ClientMember"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "ClientMember_clientId_userId_key" ON "ClientMember"("clientId", "userId");

ALTER TABLE "Team" DROP CONSTRAINT IF EXISTS "Team_departmentId_fkey";
ALTER TABLE "Team" ADD CONSTRAINT "Team_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Team" DROP CONSTRAINT IF EXISTS "Team_projectId_fkey";
ALTER TABLE "Team" ADD CONSTRAINT "Team_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Team" DROP CONSTRAINT IF EXISTS "Team_clientId_fkey";
ALTER TABLE "Team" ADD CONSTRAINT "Team_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ClientMember" DROP CONSTRAINT IF EXISTS "ClientMember_clientId_fkey";
ALTER TABLE "ClientMember" ADD CONSTRAINT "ClientMember_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientMember" DROP CONSTRAINT IF EXISTS "ClientMember_userId_fkey";
ALTER TABLE "ClientMember" ADD CONSTRAINT "ClientMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
