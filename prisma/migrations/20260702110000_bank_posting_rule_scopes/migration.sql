ALTER TABLE "bank_posting_rules"
ADD COLUMN IF NOT EXISTS "account_code" TEXT;

UPDATE "bank_posting_rules" AS bpr
SET "account_code" = fk."sifra"
FROM "firma_konta" AS fk
WHERE bpr."account_id" = fk."id"
  AND bpr."account_code" IS NULL;

ALTER TABLE "bank_posting_rules"
ALTER COLUMN "firma_id" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "bank_posting_rules_agencija_id_firma_id_direction_active_priority_idx"
ON "bank_posting_rules"("agencija_id", "firma_id", "direction", "active", "priority");
