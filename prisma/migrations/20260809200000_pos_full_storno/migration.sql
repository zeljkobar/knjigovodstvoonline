ALTER TABLE "fiskalni_izlazni_racuni"
  ADD COLUMN "original_invoice_id" UUID,
  ADD COLUMN "correction_reason" TEXT;

ALTER TABLE "fiskalni_izlazni_racuni"
  ADD CONSTRAINT "fiskalni_izlazni_racuni_original_invoice_id_fkey"
  FOREIGN KEY ("original_invoice_id") REFERENCES "fiskalni_izlazni_racuni"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "fiskalni_izlazni_racuni_original_invoice_id_idx"
  ON "fiskalni_izlazni_racuni"("original_invoice_id");
