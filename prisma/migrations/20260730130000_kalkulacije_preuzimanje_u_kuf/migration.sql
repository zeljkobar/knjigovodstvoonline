ALTER TABLE "kuf_entries"
  ADD COLUMN "source_type" TEXT NOT NULL DEFAULT 'KUF',
  ADD COLUMN "source_id" UUID,
  ADD COLUMN "posting_mode" TEXT NOT NULL DEFAULT 'KUF_RULES';

UPDATE "kuf_entries" AS ke
SET
  "source_type" = 'CALCULATION',
  "source_id" = k."id",
  "posting_mode" = 'SOURCE_DOCUMENT'
FROM "kalkulacije" AS k
WHERE k."kuf_entry_id" = ke."id";

ALTER TABLE "kuf_entries"
  ADD CONSTRAINT "kuf_entries_source_type_check"
    CHECK ("source_type" IN ('KUF', 'CALCULATION')),
  ADD CONSTRAINT "kuf_entries_posting_mode_check"
    CHECK ("posting_mode" IN ('KUF_RULES', 'SOURCE_DOCUMENT'));

CREATE UNIQUE INDEX "kuf_entries_source_type_source_id_key"
  ON "kuf_entries"("source_type", "source_id");

CREATE INDEX "kuf_entries_posting_mode_status_idx"
  ON "kuf_entries"(
    "firma_id",
    "poslovna_godina_id",
    "posting_mode",
    "posting_status"
  );

ALTER TABLE "kalkulacije"
  DROP CONSTRAINT "kalkulacije_status_check";

ALTER TABLE "kalkulacije"
  ADD CONSTRAINT "kalkulacije_status_check"
    CHECK ("status" IN ('DRAFT', 'WAITING_KUF', 'POSTED', 'DELETED', 'NEEDS_REVIEW'));
