CREATE TABLE "bank_statement_line_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agencija_id" UUID NOT NULL,
    "firma_id" UUID NOT NULL,
    "poslovna_godina_id" UUID NOT NULL,
    "bank_statement_line_id" UUID NOT NULL,
    "document_type" TEXT NOT NULL,
    "kif_entry_id" UUID,
    "kuf_entry_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "bank_statement_line_allocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bank_statement_line_allocations_amount_check" CHECK ("amount" >= 0),
    CONSTRAINT "bank_statement_line_allocations_document_check" CHECK (
        ("document_type" = 'KIF' AND "kif_entry_id" IS NOT NULL AND "kuf_entry_id" IS NULL) OR
        ("document_type" = 'KUF' AND "kuf_entry_id" IS NOT NULL AND "kif_entry_id" IS NULL)
    )
);

CREATE INDEX "bank_statement_line_allocations_agencija_firma_godina_idx"
ON "bank_statement_line_allocations"("agencija_id", "firma_id", "poslovna_godina_id");

CREATE INDEX "bank_statement_line_allocations_line_idx"
ON "bank_statement_line_allocations"("bank_statement_line_id");

CREATE INDEX "bank_statement_line_allocations_kif_entry_idx"
ON "bank_statement_line_allocations"("kif_entry_id");

CREATE INDEX "bank_statement_line_allocations_kuf_entry_idx"
ON "bank_statement_line_allocations"("kuf_entry_id");

CREATE UNIQUE INDEX "bank_statement_line_allocations_line_kif_unique"
ON "bank_statement_line_allocations"("bank_statement_line_id", "kif_entry_id")
WHERE "kif_entry_id" IS NOT NULL;

CREATE UNIQUE INDEX "bank_statement_line_allocations_line_kuf_unique"
ON "bank_statement_line_allocations"("bank_statement_line_id", "kuf_entry_id")
WHERE "kuf_entry_id" IS NOT NULL;

ALTER TABLE "bank_statement_line_allocations"
ADD CONSTRAINT "bank_statement_line_allocations_line_fkey"
FOREIGN KEY ("bank_statement_line_id") REFERENCES "bank_statement_lines"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bank_statement_line_allocations"
ADD CONSTRAINT "bank_statement_line_allocations_kif_entry_fkey"
FOREIGN KEY ("kif_entry_id") REFERENCES "kif_entries"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bank_statement_line_allocations"
ADD CONSTRAINT "bank_statement_line_allocations_kuf_entry_fkey"
FOREIGN KEY ("kuf_entry_id") REFERENCES "kuf_entries"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
