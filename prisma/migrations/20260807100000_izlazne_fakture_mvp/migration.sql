ALTER TABLE "fiskalni_izlazni_racuni"
  ADD COLUMN "magacin_id" UUID,
  ADD COLUMN "nalog_id" UUID,
  ADD COLUMN "broj" INTEGER,
  ADD COLUMN "interni_broj" TEXT,
  ADD COLUMN "datum_prometa" DATE,
  ADD COLUMN "mjesto_izdavanja" TEXT,
  ADD COLUMN "vrsta_racuna" TEXT NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "nacin_placanja" TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
  ADD COLUMN "fiskalizacija_rezim" TEXT NOT NULL DEFAULT 'EXTERNAL_OR_NONE',
  ADD COLUMN "ukupno_rabat" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "correlation_id" TEXT,
  ADD COLUMN "fiscal_error_code" TEXT,
  ADD COLUMN "fiscal_error_message" TEXT,
  ADD COLUMN "last_fiscal_attempt_at" TIMESTAMP(3),
  ADD COLUMN "posted_at" TIMESTAMP(3),
  ADD COLUMN "posted_by" UUID;

WITH numbered AS (
  SELECT "id",
         ROW_NUMBER() OVER (PARTITION BY "firma_id", "poslovna_godina_id" ORDER BY "created_at", "id") AS rn
  FROM "fiskalni_izlazni_racuni"
)
UPDATE "fiskalni_izlazni_racuni" AS invoice
SET "broj" = numbered.rn,
    "interni_broj" = 'IF-' || EXTRACT(YEAR FROM invoice."datum_racuna")::INTEGER || '-' || LPAD(numbered.rn::TEXT, 4, '0'),
    "datum_prometa" = invoice."datum_racuna"
FROM numbered
WHERE numbered."id" = invoice."id";

ALTER TABLE "fiskalni_izlazni_racuni"
  ALTER COLUMN "broj" SET NOT NULL,
  ALTER COLUMN "interni_broj" SET NOT NULL,
  ALTER COLUMN "datum_prometa" SET NOT NULL,
  ALTER COLUMN "fiscal_api_invoice_id" DROP NOT NULL,
  ALTER COLUMN "fiscal_status" SET DEFAULT 'NOT_REQUIRED';

CREATE TABLE "stavke_izlaznih_faktura" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "izlazna_faktura_id" UUID NOT NULL,
  "redni_broj" INTEGER NOT NULL,
  "artikal_id" UUID NOT NULL,
  "sifra_artikla" TEXT NOT NULL,
  "naziv_artikla" TEXT NOT NULL,
  "jedinica_mjere" TEXT NOT NULL,
  "usluga" BOOLEAN NOT NULL,
  "kolicina" DECIMAL(18,3) NOT NULL,
  "jedinicna_cijena_bez_pdv" DECIMAL(14,4) NOT NULL,
  "rabat_procenat" DECIMAL(7,4) NOT NULL DEFAULT 0,
  "rabat_iznos" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "osnovica" DECIMAL(14,2) NOT NULL,
  "pdv_stopa_id" UUID,
  "pdv_stopa_sifra" TEXT NOT NULL,
  "pdv_stopa_naziv" TEXT NOT NULL,
  "pdv_stopa_procenat" DECIMAL(5,2) NOT NULL,
  "pdv_iznos" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "jedinicna_cijena_sa_pdv" DECIMAL(14,4) NOT NULL,
  "ukupno_sa_pdv" DECIMAL(14,2) NOT NULL,
  "jedinicna_nabavna_cijena" DECIMAL(14,4),
  "nabavna_vrijednost" DECIMAL(14,2),
  "napomena" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" UUID,
  CONSTRAINT "stavke_izlaznih_faktura_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiskalni_izlazni_racuni_nalog_id_key" ON "fiskalni_izlazni_racuni"("nalog_id");
CREATE UNIQUE INDEX "fiskalni_izlazni_racuni_idempotency_key_key" ON "fiskalni_izlazni_racuni"("idempotency_key");
CREATE UNIQUE INDEX "fiskalni_izlazni_racuni_firma_godina_broj_key" ON "fiskalni_izlazni_racuni"("firma_id", "poslovna_godina_id", "broj");
CREATE UNIQUE INDEX "fiskalni_izlazni_racuni_firma_godina_interni_key" ON "fiskalni_izlazni_racuni"("firma_id", "poslovna_godina_id", "interni_broj");
CREATE UNIQUE INDEX "stavke_izlaznih_faktura_faktura_redni_key" ON "stavke_izlaznih_faktura"("izlazna_faktura_id", "redni_broj");
CREATE INDEX "stavke_izlaznih_faktura_artikal_id_idx" ON "stavke_izlaznih_faktura"("artikal_id");

ALTER TABLE "fiskalni_izlazni_racuni" ADD CONSTRAINT "fiskalni_izlazni_racuni_magacin_id_fkey" FOREIGN KEY ("magacin_id") REFERENCES "magacini"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stavke_izlaznih_faktura" ADD CONSTRAINT "stavke_izlaznih_faktura_faktura_id_fkey" FOREIGN KEY ("izlazna_faktura_id") REFERENCES "fiskalni_izlazni_racuni"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stavke_izlaznih_faktura" ADD CONSTRAINT "stavke_izlaznih_faktura_artikal_id_fkey" FOREIGN KEY ("artikal_id") REFERENCES "artikli"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
