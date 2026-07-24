-- CreateTable
CREATE TABLE IF NOT EXISTS "WorkCategory" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "isActive"       BOOLEAN NOT NULL DEFAULT true,
    "sortOrder"      INTEGER NOT NULL DEFAULT 0,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WorkCategory_organizationId_name_key" ON "WorkCategory"("organizationId", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkCategory_organizationId_isActive_idx" ON "WorkCategory"("organizationId", "isActive");

-- AddForeignKey (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkCategory_organizationId_fkey') THEN
    ALTER TABLE "WorkCategory" ADD CONSTRAINT "WorkCategory_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Seed default categories for every existing organization
INSERT INTO "WorkCategory" ("id", "organizationId", "name", "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    o.id,
    cat.name,
    true,
    cat.sort_order,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Organization" o
CROSS JOIN (VALUES
    ('Deliverables',            1),
    ('Project Management',      2),
    ('Software Development',    3),
    ('Self Development',        4),
    ('Project Support',         5),
    ('Project Implementation',  6),
    ('Other',                   7)
) AS cat(name, sort_order)
ON CONFLICT ("organizationId", "name") DO NOTHING;
