CREATE TABLE "fiskalni_portali_firmi" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "agencija_id" UUID NOT NULL, "firma_id" UUID NOT NULL,
  "provider" TEXT NOT NULL CHECK ("provider" IN ('VG_EFISKAL', 'SUMMA_FISKAL')),
  "korisnicko_ime" TEXT, "lozinka_sifrovana" TEXT, "podrazumijevana_kasa" TEXT,
  "aktivan" BOOLEAN NOT NULL DEFAULT true, "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  "deleted_at" TIMESTAMP(3), "deleted_by" UUID, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID, "updated_at" TIMESTAMP(3) NOT NULL, "updated_by" UUID,
  CONSTRAINT "fiskalni_portali_firmi_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fiskalni_portali_firmi_agencija_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON UPDATE NO ACTION,
  CONSTRAINT "fiskalni_portali_firmi_scope_fkey" FOREIGN KEY ("agencija_id", "firma_id") REFERENCES "firme"("agencija_id", "id") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "fiskalni_portali_firmi_firma_id_key" ON "fiskalni_portali_firmi"("firma_id");
CREATE INDEX "fiskalni_portali_firmi_agencija_id_firma_id_idx" ON "fiskalni_portali_firmi"("agencija_id", "firma_id");
ALTER TABLE "kif_entries" ADD COLUMN "pazar_source_provider" TEXT, ADD COLUMN "pazar_source_device" TEXT, ADD COLUMN "pazar_source_digest" TEXT;
ALTER TABLE "kif_entries" DROP CONSTRAINT "kif_entries_pazar_period_type_check";
ALTER TABLE "kif_entries" ADD CONSTRAINT "kif_entries_pazar_period_type_check" CHECK ("pazar_period_type" IS NULL OR "pazar_period_type" IN ('DAILY','MONTHLY','RANGE'));
CREATE INDEX "kif_entries_pazar_source_idx" ON "kif_entries"("firma_id", "pazar_source_provider", "pazar_source_device", "pazar_period_from", "pazar_period_to");
CREATE UNIQUE INDEX "fiskalni_portali_firmi_agencija_id_firma_id_key" ON "fiskalni_portali_firmi"("agencija_id", "firma_id");
ALTER TABLE "kif_pazar_payments" DROP CONSTRAINT "kif_pazar_payments_amount_check";
