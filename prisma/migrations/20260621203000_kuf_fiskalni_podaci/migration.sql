ALTER TABLE "kuf_entries"
  ADD COLUMN "fiscal_iic" TEXT,
  ADD COLUMN "fiscal_fic" TEXT,
  ADD COLUMN "fiscal_seller_tin" TEXT,
  ADD COLUMN "fiscal_datetime" TIMESTAMP(3),
  ADD COLUMN "fiscal_source_url" TEXT;

CREATE INDEX "kuf_entries_fiscal_lookup_idx"
  ON "kuf_entries"("firma_id", "fiscal_iic", "fiscal_seller_tin", "fiscal_datetime");

CREATE UNIQUE INDEX "kuf_entries_fiscal_unique"
  ON "kuf_entries"("firma_id", "fiscal_iic", "fiscal_seller_tin", "fiscal_datetime")
  WHERE "fiscal_iic" IS NOT NULL
    AND "fiscal_seller_tin" IS NOT NULL
    AND "fiscal_datetime" IS NOT NULL
    AND "is_deleted" = false;

