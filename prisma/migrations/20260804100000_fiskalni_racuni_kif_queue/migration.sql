CREATE TABLE "fiskalni_izlazni_racuni" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agencija_id" UUID NOT NULL,
    "firma_id" UUID NOT NULL,
    "poslovna_godina_id" UUID NOT NULL,
    "kupac_id" UUID NOT NULL,
    "broj_racuna" TEXT NOT NULL,
    "datum_racuna" DATE NOT NULL,
    "datum_valute" DATE,
    "vat_transaction_type" TEXT NOT NULL DEFAULT 'DOMESTIC',
    "valuta" TEXT NOT NULL DEFAULT 'EUR',
    "kurs" DECIMAL(14,6) NOT NULL DEFAULT 1,
    "ukupno_osnovica" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ukupno_izlazni_pdv" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ukupno_sa_pdv" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fiscal_api_invoice_id" UUID NOT NULL,
    "fiscal_status" TEXT NOT NULL,
    "iic" TEXT,
    "jikr" TEXT,
    "qr_code_data" TEXT,
    "fiscalized_at" TIMESTAMP(3),
    "kif_status" TEXT NOT NULL DEFAULT 'WAITING_KIF',
    "kif_entry_id" UUID,
    "napomena" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,
    CONSTRAINT "fiskalni_izlazni_racuni_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fiskalni_izlazni_racun_porezi" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fiskalni_izlazni_racun_id" UUID NOT NULL,
    "vat_rate_code" TEXT NOT NULL,
    "vat_rate_name" TEXT NOT NULL,
    "vat_rate_percent" DECIMAL(5,2) NOT NULL,
    "tax_base" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "output_vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_with_vat" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    CONSTRAINT "fiskalni_izlazni_racun_porezi_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiskalni_izlazni_racuni_fiscal_api_invoice_id_key" ON "fiskalni_izlazni_racuni"("fiscal_api_invoice_id");
CREATE UNIQUE INDEX "fiskalni_izlazni_racuni_kif_entry_id_key" ON "fiskalni_izlazni_racuni"("kif_entry_id");
CREATE UNIQUE INDEX "fiskalni_izlazni_racuni_firma_id_broj_racuna_datum_key" ON "fiskalni_izlazni_racuni"("firma_id", "broj_racuna", "datum_racuna");
CREATE INDEX "fiskalni_izlazni_racuni_agencija_firma_godina_kif_idx" ON "fiskalni_izlazni_racuni"("agencija_id", "firma_id", "poslovna_godina_id", "kif_status");
CREATE INDEX "fiskalni_izlazni_racuni_firma_datum_status_idx" ON "fiskalni_izlazni_racuni"("firma_id", "datum_racuna", "fiscal_status");
CREATE INDEX "fiskalni_izlazni_racun_porezi_racun_id_idx" ON "fiskalni_izlazni_racun_porezi"("fiskalni_izlazni_racun_id");

ALTER TABLE "fiskalni_izlazni_racuni" ADD CONSTRAINT "fiskalni_izlazni_racuni_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiskalni_izlazni_racuni" ADD CONSTRAINT "fiskalni_izlazni_racuni_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiskalni_izlazni_racuni" ADD CONSTRAINT "fiskalni_izlazni_racuni_poslovna_godina_id_fkey" FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiskalni_izlazni_racuni" ADD CONSTRAINT "fiskalni_izlazni_racuni_kupac_id_fkey" FOREIGN KEY ("kupac_id") REFERENCES "komitenti"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiskalni_izlazni_racuni" ADD CONSTRAINT "fiskalni_izlazni_racuni_kif_entry_id_fkey" FOREIGN KEY ("kif_entry_id") REFERENCES "kif_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "fiskalni_izlazni_racun_porezi" ADD CONSTRAINT "fiskalni_izlazni_racun_porezi_racun_id_fkey" FOREIGN KEY ("fiskalni_izlazni_racun_id") REFERENCES "fiskalni_izlazni_racuni"("id") ON DELETE CASCADE ON UPDATE CASCADE;
