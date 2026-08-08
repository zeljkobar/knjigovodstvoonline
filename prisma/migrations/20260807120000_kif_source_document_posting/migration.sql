ALTER TABLE "kif_entries"
  ADD COLUMN "posting_mode" TEXT NOT NULL DEFAULT 'KIF_RULES',
  ADD COLUMN "source_type" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "source_id" UUID;

CREATE UNIQUE INDEX "kif_entries_source_type_source_id_key"
  ON "kif_entries"("source_type", "source_id");

CREATE INDEX "kif_entries_firma_id_poslovna_godina_id_posting_mode_posting_status_idx"
  ON "kif_entries"("firma_id", "poslovna_godina_id", "posting_mode", "posting_status");
