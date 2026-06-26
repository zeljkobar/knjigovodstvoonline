ALTER TABLE "komitenti" ADD COLUMN "is_foreign" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "komitenti" ADD COLUMN "country_code" TEXT;
ALTER TABLE "komitenti" ADD COLUMN "country_name" TEXT;
ALTER TABLE "komitenti" ADD COLUMN "foreign_tax_number" TEXT;

ALTER TABLE "kuf_entries" ADD COLUMN "vat_transaction_type" TEXT NOT NULL DEFAULT 'DOMESTIC';
ALTER TABLE "kif_entries" ADD COLUMN "vat_transaction_type" TEXT NOT NULL DEFAULT 'DOMESTIC';

CREATE INDEX "komitenti_is_foreign_idx" ON "komitenti"("is_foreign");
CREATE INDEX "kuf_entries_vat_transaction_type_idx" ON "kuf_entries"("firma_id", "poslovna_godina_id", "vat_transaction_type");
CREATE INDEX "kif_entries_vat_transaction_type_idx" ON "kif_entries"("firma_id", "poslovna_godina_id", "vat_transaction_type");
