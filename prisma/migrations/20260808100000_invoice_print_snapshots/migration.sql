ALTER TABLE "fiskalni_izlazni_racuni"
  ADD COLUMN "official_invoice_number" TEXT,
  ADD COLUMN "issuer_snapshot" JSONB,
  ADD COLUMN "buyer_snapshot" JSONB;
