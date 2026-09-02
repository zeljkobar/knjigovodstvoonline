ALTER TABLE "kuf_entries" ADD COLUMN "poslovna_jedinica_id" UUID;
ALTER TABLE "kif_entries" ADD COLUMN "poslovna_jedinica_id" UUID;
ALTER TABLE "fiskalni_izlazni_racuni" ADD COLUMN "poslovna_jedinica_id" UUID;
ALTER TABLE "bank_statements" ADD COLUMN "poslovna_jedinica_id" UUID;
ALTER TABLE "plate_obracuni" ADD COLUMN "poslovna_jedinica_id" UUID;
ALTER TABLE "stavke_naloga" ADD COLUMN "poslovna_jedinica_id" UUID;

CREATE INDEX "kuf_entries_poslovna_jedinica_id_invoice_date_idx"
  ON "kuf_entries"("poslovna_jedinica_id", "invoice_date");
CREATE INDEX "kif_entries_poslovna_jedinica_id_invoice_date_idx"
  ON "kif_entries"("poslovna_jedinica_id", "invoice_date");
CREATE INDEX "fiskalni_izlazni_racuni_poslovna_jedinica_id_datum_racuna_idx"
  ON "fiskalni_izlazni_racuni"("poslovna_jedinica_id", "datum_racuna");
CREATE INDEX "bank_statements_poslovna_jedinica_id_statement_date_idx"
  ON "bank_statements"("poslovna_jedinica_id", "statement_date");
CREATE INDEX "plate_obracuni_poslovna_jedinica_id_datum_obracuna_idx"
  ON "plate_obracuni"("poslovna_jedinica_id", "datum_obracuna");
CREATE INDEX "stavke_naloga_poslovna_jedinica_id_idx"
  ON "stavke_naloga"("poslovna_jedinica_id");

ALTER TABLE "kuf_entries"
  ADD CONSTRAINT "kuf_entries_poslovna_jedinica_id_fkey"
  FOREIGN KEY ("poslovna_jedinica_id") REFERENCES "poslovne_jedinice"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kif_entries"
  ADD CONSTRAINT "kif_entries_poslovna_jedinica_id_fkey"
  FOREIGN KEY ("poslovna_jedinica_id") REFERENCES "poslovne_jedinice"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fiskalni_izlazni_racuni"
  ADD CONSTRAINT "fiskalni_izlazni_racuni_poslovna_jedinica_id_fkey"
  FOREIGN KEY ("poslovna_jedinica_id") REFERENCES "poslovne_jedinice"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bank_statements"
  ADD CONSTRAINT "bank_statements_poslovna_jedinica_id_fkey"
  FOREIGN KEY ("poslovna_jedinica_id") REFERENCES "poslovne_jedinice"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "plate_obracuni"
  ADD CONSTRAINT "plate_obracuni_poslovna_jedinica_id_fkey"
  FOREIGN KEY ("poslovna_jedinica_id") REFERENCES "poslovne_jedinice"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stavke_naloga"
  ADD CONSTRAINT "stavke_naloga_poslovna_jedinica_id_fkey"
  FOREIGN KEY ("poslovna_jedinica_id") REFERENCES "poslovne_jedinice"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "fiskalni_izlazni_racuni" AS r
SET "poslovna_jedinica_id" = m."poslovna_jedinica_id"
FROM "magacini" AS m
WHERE r."magacin_id" = m."id"
  AND r."poslovna_jedinica_id" IS NULL;

UPDATE "kif_entries" AS k
SET "poslovna_jedinica_id" = r."poslovna_jedinica_id"
FROM "fiskalni_izlazni_racuni" AS r
WHERE r."kif_entry_id" = k."id"
  AND k."poslovna_jedinica_id" IS NULL;

UPDATE "kuf_entries" AS k
SET "poslovna_jedinica_id" = c."poslovna_jedinica_id"
FROM "kalkulacije" AS c
WHERE c."kuf_entry_id" = k."id"
  AND k."poslovna_jedinica_id" IS NULL;

UPDATE "stavke_naloga" AS s
SET "poslovna_jedinica_id" = n."poslovna_jedinica_id"
FROM "nalozi" AS n
WHERE s."nalog_id" = n."id"
  AND s."poslovna_jedinica_id" IS NULL;
