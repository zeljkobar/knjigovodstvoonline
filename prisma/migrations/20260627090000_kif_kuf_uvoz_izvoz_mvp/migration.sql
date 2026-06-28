ALTER TABLE "kuf_entries" ADD COLUMN "is_import" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "kuf_entries" ADD COLUMN "customs_declaration_number" TEXT;
ALTER TABLE "kuf_entries" ADD COLUMN "customs_declaration_date" DATE;
ALTER TABLE "kuf_entries" ADD COLUMN "customs_vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "kif_entries" ADD COLUMN "is_export" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "kif_entries" ADD COLUMN "export_declaration_number" TEXT;
ALTER TABLE "kif_entries" ADD COLUMN "export_declaration_date" DATE;
