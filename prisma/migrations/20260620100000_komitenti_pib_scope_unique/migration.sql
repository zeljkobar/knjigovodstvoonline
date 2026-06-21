-- Drop the old global unique constraint on pib that breaks multi-tenant scoping.
-- With KomitentScope, same PIB can legitimately exist across different agencies.
ALTER TABLE "komitenti" DROP CONSTRAINT IF EXISTS "komitenti_pib_key";

-- Partial unique indexes per scope:
-- GLOBAL: pib must be globally unique among global partners
CREATE UNIQUE INDEX "komitenti_pib_global_unique"
  ON "komitenti"("pib")
  WHERE "scope" = 'GLOBAL' AND "pib" IS NOT NULL;

-- AGENCY: pib must be unique within a single agency
CREATE UNIQUE INDEX "komitenti_pib_agency_unique"
  ON "komitenti"("agencija_id", "pib")
  WHERE "scope" = 'AGENCY' AND "pib" IS NOT NULL;

-- COMPANY: pib must be unique within a single company
CREATE UNIQUE INDEX "komitenti_pib_company_unique"
  ON "komitenti"("firma_id", "pib")
  WHERE "scope" = 'COMPANY' AND "pib" IS NOT NULL;

-- Data migration: fix scope for records that already have agencija_id or firma_id set
-- but still carry the DEFAULT 'GLOBAL' scope from the previous migration.
UPDATE "komitenti"
  SET "scope" = 'AGENCY'
  WHERE "agencija_id" IS NOT NULL AND "firma_id" IS NULL AND "scope" = 'GLOBAL';

UPDATE "komitenti"
  SET "scope" = 'COMPANY'
  WHERE "firma_id" IS NOT NULL AND "scope" = 'GLOBAL';
