-- Employee IDs and invoice numbers belong to an organization: two organizations can both have E001 or INV-00001
DROP INDEX IF EXISTS "User_employeeId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "User_organizationId_employeeId_key" ON "User"("organizationId", "employeeId");

DROP INDEX IF EXISTS "Invoice_invoiceNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_organizationId_invoiceNumber_key" ON "Invoice"("organizationId", "invoiceNumber");

-- Recorded when an approved timesheet is sent back for correction
ALTER TYPE "ApprovalStatus" ADD VALUE IF NOT EXISTS 'REOPENED';
