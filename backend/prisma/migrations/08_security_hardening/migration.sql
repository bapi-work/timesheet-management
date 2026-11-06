-- Forced password change, session revocation and non-destructive MFA enrolment
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mfaPendingSecret" TEXT;

-- Refresh tokens are now stored hashed. Existing plaintext rows can't be used, so everyone signs in again.
DELETE FROM "RefreshToken";

-- Payroll periods belong to an organization
ALTER TABLE "PayrollPeriod" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
CREATE INDEX IF NOT EXISTS "PayrollPeriod_organizationId_idx" ON "PayrollPeriod"("organizationId");
UPDATE "PayrollPeriod"
SET "organizationId" = (SELECT "id" FROM "Organization" LIMIT 1)
WHERE "organizationId" IS NULL AND (SELECT COUNT(*) FROM "Organization") = 1;

-- Teams created before this release could be saved without an organization
UPDATE "Team" t SET "organizationId" = d."organizationId"
FROM "Department" d WHERE t."organizationId" IS NULL AND t."departmentId" = d."id";
UPDATE "Team" t SET "organizationId" = p."organizationId"
FROM "Project" p WHERE t."organizationId" IS NULL AND t."projectId" = p."id";
UPDATE "Team" t SET "organizationId" = c."organizationId"
FROM "Client" c WHERE t."organizationId" IS NULL AND t."clientId" = c."id";
UPDATE "Team"
SET "organizationId" = (SELECT "id" FROM "Organization" LIMIT 1)
WHERE "organizationId" IS NULL AND (SELECT COUNT(*) FROM "Organization") = 1;

-- Remove cloud storage credentials that earlier versions wrote to the audit log
UPDATE "AuditLog"
SET "newValues" = ("newValues"::jsonb - 'secretKey' - 'accessKey')::json
WHERE "newValues" IS NOT NULL AND jsonb_typeof("newValues"::jsonb) = 'object'
  AND ("newValues"::jsonb ? 'secretKey' OR "newValues"::jsonb ? 'accessKey');
