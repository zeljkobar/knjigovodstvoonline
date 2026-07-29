ALTER TABLE "kalkulacije"
  ADD COLUMN "fiscal_iic" TEXT,
  ADD COLUMN "fiscal_fic" TEXT,
  ADD COLUMN "fiscal_seller_tin" TEXT,
  ADD COLUMN "fiscal_datetime" TIMESTAMP(3),
  ADD COLUMN "fiscal_source_url" TEXT;

CREATE INDEX "kalkulacije_fiscal_idx"
  ON "kalkulacije"("firma_id", "fiscal_iic", "fiscal_seller_tin", "fiscal_datetime");

CREATE TABLE "dobavljac_artikal_veze" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "dobavljac_id" UUID NOT NULL,
  "artikal_id" UUID NOT NULL,
  "external_key" TEXT NOT NULL,
  "external_code" TEXT,
  "external_name" TEXT NOT NULL,
  "external_unit" TEXT,
  "external_vat_rate" DECIMAL(5,2),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID,
  CONSTRAINT "dobavljac_artikal_veze_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dobavljac_artikal_veze_agencija_id_fkey"
    FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id"),
  CONSTRAINT "dobavljac_artikal_veze_firma_id_fkey"
    FOREIGN KEY ("firma_id") REFERENCES "firme"("id"),
  CONSTRAINT "dobavljac_artikal_veze_dobavljac_id_fkey"
    FOREIGN KEY ("dobavljac_id") REFERENCES "komitenti"("id"),
  CONSTRAINT "dobavljac_artikal_veze_artikal_id_fkey"
    FOREIGN KEY ("artikal_id") REFERENCES "artikli"("id")
);

CREATE UNIQUE INDEX "dobavljac_artikal_veze_scope_key"
  ON "dobavljac_artikal_veze"("firma_id", "dobavljac_id", "external_key");
CREATE INDEX "dobavljac_artikal_veze_scope_idx"
  ON "dobavljac_artikal_veze"("agencija_id", "firma_id", "dobavljac_id");
CREATE INDEX "dobavljac_artikal_veze_artikal_id_idx"
  ON "dobavljac_artikal_veze"("artikal_id");
