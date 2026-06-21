CREATE TABLE "kif_books" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agencija_id" UUID NOT NULL,
    "firma_id" UUID NOT NULL,
    "poslovna_godina_id" UUID NOT NULL,
    "racun_vrsta_id" UUID NOT NULL,
    "redni_broj" INTEGER NOT NULL,
    "internal_kif_number" TEXT NOT NULL,
    "mjesec" INTEGER NOT NULL,
    "kif_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "kif_books_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "kif_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kif_book_id" UUID,
    "agencija_id" UUID NOT NULL,
    "firma_id" UUID NOT NULL,
    "poslovna_godina_id" UUID NOT NULL,
    "kupac_id" UUID NOT NULL,
    "redni_broj" INTEGER NOT NULL,
    "internal_kif_number" TEXT NOT NULL,
    "customer_invoice_number" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "exchange_rate" DECIMAL(14,6) NOT NULL DEFAULT 1,
    "total_base" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_output_vat" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_gross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "revenue_account_id" UUID,
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

    CONSTRAINT "kif_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "kif_entry_tax_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kif_entry_id" UUID NOT NULL,
    "vat_rate_id" UUID,
    "vat_rate_code" TEXT NOT NULL,
    "vat_rate_name" TEXT NOT NULL,
    "vat_rate_percent" DECIMAL(5,2) NOT NULL,
    "tax_base" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "output_vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_with_vat" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "kif_entry_tax_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "kif_books_firma_id_poslovna_godina_id_redni_broj_key"
ON "kif_books"("firma_id", "poslovna_godina_id", "redni_broj");

CREATE INDEX "kif_books_agencija_id_firma_id_poslovna_godina_id_status_idx"
ON "kif_books"("agencija_id", "firma_id", "poslovna_godina_id", "status");

CREATE INDEX "kif_books_racun_vrsta_id_idx"
ON "kif_books"("racun_vrsta_id");

CREATE INDEX "kif_books_firma_id_poslovna_godina_id_mjesec_idx"
ON "kif_books"("firma_id", "poslovna_godina_id", "mjesec");

CREATE UNIQUE INDEX "kif_entries_firma_id_poslovna_godina_id_redni_broj_key"
ON "kif_entries"("firma_id", "poslovna_godina_id", "redni_broj");

CREATE INDEX "kif_entries_kif_book_id_idx"
ON "kif_entries"("kif_book_id");

CREATE INDEX "kif_entries_agencija_id_firma_id_poslovna_godina_id_status_idx"
ON "kif_entries"("agencija_id", "firma_id", "poslovna_godina_id", "status");

CREATE INDEX "kif_entries_firma_id_kupac_id_customer_invoice_number_invoice_date_idx"
ON "kif_entries"("firma_id", "kupac_id", "customer_invoice_number", "invoice_date");

CREATE INDEX "kif_entry_tax_lines_kif_entry_id_idx"
ON "kif_entry_tax_lines"("kif_entry_id");

CREATE INDEX "kif_entry_tax_lines_vat_rate_id_idx"
ON "kif_entry_tax_lines"("vat_rate_id");

ALTER TABLE "kif_books"
ADD CONSTRAINT "kif_books_agencija_id_fkey"
FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "kif_books"
ADD CONSTRAINT "kif_books_firma_id_fkey"
FOREIGN KEY ("firma_id") REFERENCES "firme"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "kif_books"
ADD CONSTRAINT "kif_books_poslovna_godina_id_fkey"
FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "kif_books"
ADD CONSTRAINT "kif_books_racun_vrsta_id_fkey"
FOREIGN KEY ("racun_vrsta_id") REFERENCES "racun_vrste"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "kif_entries"
ADD CONSTRAINT "kif_entries_kif_book_id_fkey"
FOREIGN KEY ("kif_book_id") REFERENCES "kif_books"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "kif_entries"
ADD CONSTRAINT "kif_entries_agencija_id_fkey"
FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "kif_entries"
ADD CONSTRAINT "kif_entries_firma_id_fkey"
FOREIGN KEY ("firma_id") REFERENCES "firme"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "kif_entries"
ADD CONSTRAINT "kif_entries_poslovna_godina_id_fkey"
FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "kif_entries"
ADD CONSTRAINT "kif_entries_kupac_id_fkey"
FOREIGN KEY ("kupac_id") REFERENCES "komitenti"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "kif_entries"
ADD CONSTRAINT "kif_entries_revenue_account_id_fkey"
FOREIGN KEY ("revenue_account_id") REFERENCES "firma_konta"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "kif_entry_tax_lines"
ADD CONSTRAINT "kif_entry_tax_lines_kif_entry_id_fkey"
FOREIGN KEY ("kif_entry_id") REFERENCES "kif_entries"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
