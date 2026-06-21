CREATE TYPE "KomitentScope" AS ENUM ('GLOBAL', 'AGENCY', 'COMPANY');

ALTER TABLE "komitenti"
ADD COLUMN "scope" "KomitentScope" NOT NULL DEFAULT 'GLOBAL',
ADD COLUMN "agencija_id" UUID,
ADD COLUMN "firma_id" UUID;

CREATE INDEX "komitenti_scope_idx" ON "komitenti"("scope");
CREATE INDEX "komitenti_agencija_id_idx" ON "komitenti"("agencija_id");
CREATE INDEX "komitenti_firma_id_idx" ON "komitenti"("firma_id");
