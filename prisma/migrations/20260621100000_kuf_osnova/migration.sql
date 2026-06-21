CREATE TABLE "kuf_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agencija_id" UUID NOT NULL,
    "firma_id" UUID NOT NULL,
    "poslovna_godina_id" UUID NOT NULL,
    "dobavljac_id" UUID NOT NULL,
    "redni_broj" INTEGER NOT NULL,
    "internal_kuf_number" TEXT NOT NULL,
    "supplier_invoice_number" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "receipt_date" DATE NOT NULL,
    "due_date" DATE,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "exchange_rate" DECIMAL(14,6) NOT NULL DEFAULT 1,
    "total_base" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_input_vat" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deductible_vat" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "non_deductible_vat" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_gross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payment_status" TEXT NOT NULL DEFAULT 'UNPAID',
    "posting_status" TEXT NOT NULL DEFAULT 'UNPOSTED',
    "status" TEXT NOT NULL DEFAULT 'RECORDED',
    "journal_id" UUID,
    "note" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "kuf_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "kuf_entry_tax_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kuf_entry_id" UUID NOT NULL,
    "vat_rate_id" UUID,
    "vat_rate_code" TEXT NOT NULL,
    "vat_rate_name" TEXT NOT NULL,
    "vat_rate_percent" DECIMAL(5,2) NOT NULL,
    "tax_base" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "input_vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deductible_vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "non_deductible_vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_with_vat" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "kuf_entry_tax_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "kuf_entries_firma_id_poslovna_godina_id_redni_broj_key"
ON "kuf_entries"("firma_id", "poslovna_godina_id", "redni_broj");

CREATE INDEX "kuf_entries_agencija_id_firma_id_poslovna_godina_id_status_idx"
ON "kuf_entries"("agencija_id", "firma_id", "poslovna_godina_id", "status");

CREATE INDEX "kuf_entries_firma_id_dobavljac_id_supplier_invoice_number_invoice_date_idx"
ON "kuf_entries"("firma_id", "dobavljac_id", "supplier_invoice_number", "invoice_date");

CREATE INDEX "kuf_entry_tax_lines_kuf_entry_id_idx"
ON "kuf_entry_tax_lines"("kuf_entry_id");

CREATE INDEX "kuf_entry_tax_lines_vat_rate_id_idx"
ON "kuf_entry_tax_lines"("vat_rate_id");

ALTER TABLE "kuf_entries"
ADD CONSTRAINT "kuf_entries_agencija_id_fkey"
FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "kuf_entries"
ADD CONSTRAINT "kuf_entries_firma_id_fkey"
FOREIGN KEY ("firma_id") REFERENCES "firme"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "kuf_entries"
ADD CONSTRAINT "kuf_entries_poslovna_godina_id_fkey"
FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "kuf_entries"
ADD CONSTRAINT "kuf_entries_dobavljac_id_fkey"
FOREIGN KEY ("dobavljac_id") REFERENCES "komitenti"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "kuf_entry_tax_lines"
ADD CONSTRAINT "kuf_entry_tax_lines_kuf_entry_id_fkey"
FOREIGN KEY ("kuf_entry_id") REFERENCES "kuf_entries"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "kuf_entry_tax_lines"
ADD CONSTRAINT "kuf_entry_tax_lines_vat_rate_id_fkey"
FOREIGN KEY ("vat_rate_id") REFERENCES "pdv_stope"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
