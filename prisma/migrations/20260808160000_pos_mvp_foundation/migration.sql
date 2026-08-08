ALTER TABLE "fiskalni_izlazni_racuni"
  ADD COLUMN "document_type" TEXT NOT NULL DEFAULT 'INVOICE',
  ADD COLUMN "sales_channel" TEXT NOT NULL DEFAULT 'OFFICE',
  ADD COLUMN "issued_at" TIMESTAMP(3),
  ADD COLUMN "pos_register_id" UUID;

CREATE TABLE "pos_registers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "magacin_id" UUID,
  "naziv" TEXT NOT NULL,
  "sifra" TEXT NOT NULL,
  "fiscal_business_unit_id" UUID NOT NULL,
  "fiscal_business_unit_name" TEXT,
  "fiscal_device_id" UUID NOT NULL,
  "fiscal_device_code" TEXT,
  "fiscal_operator_id" UUID,
  "podrazumijevano_placanje" TEXT NOT NULL DEFAULT 'CASH',
  "aktivan" BOOLEAN NOT NULL DEFAULT true,
  "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  "deleted_at" TIMESTAMP(3),
  "deleted_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" UUID,
  CONSTRAINT "pos_registers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_podesavanja" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "aktivan" BOOLEAN NOT NULL DEFAULT false,
  "racunovodstvena_integracija" BOOLEAN NOT NULL DEFAULT false,
  "kif_rezim" TEXT NOT NULL DEFAULT 'DAILY',
  "knjizenje_rezim" TEXT NOT NULL DEFAULT 'DAILY',
  "zahtijeva_smjenu" BOOLEAN NOT NULL DEFAULT false,
  "automatska_stampa" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" UUID,
  CONSTRAINT "pos_podesavanja_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_document_payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "fiskalni_izlazni_racun_id" UUID NOT NULL,
  "redni_broj" INTEGER NOT NULL DEFAULT 1,
  "payment_method" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "reference" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  CONSTRAINT "sales_document_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fiscalization_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "fiskalni_izlazni_racun_id" UUID NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "correlation_id" TEXT,
  "fiscal_api_invoice_id" UUID,
  "error_code" TEXT,
  "error_message" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  "duration_ms" INTEGER,
  "created_by" UUID,
  CONSTRAINT "fiscalization_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pos_registers_firma_id_sifra_key" ON "pos_registers"("firma_id", "sifra");
CREATE INDEX "pos_registers_agencija_id_firma_id_aktivan_idx" ON "pos_registers"("agencija_id", "firma_id", "aktivan");
CREATE UNIQUE INDEX "pos_podesavanja_firma_id_key" ON "pos_podesavanja"("firma_id");
CREATE INDEX "pos_podesavanja_agencija_id_aktivan_idx" ON "pos_podesavanja"("agencija_id", "aktivan");
CREATE UNIQUE INDEX "sales_document_payments_invoice_row_key" ON "sales_document_payments"("fiskalni_izlazni_racun_id", "redni_broj");
CREATE INDEX "sales_document_payments_method_created_idx" ON "sales_document_payments"("payment_method", "created_at");
CREATE UNIQUE INDEX "fiscalization_attempts_idempotency_key_key" ON "fiscalization_attempts"("idempotency_key");
CREATE UNIQUE INDEX "fiscalization_attempts_invoice_attempt_key" ON "fiscalization_attempts"("fiskalni_izlazni_racun_id", "attempt_number");
CREATE INDEX "fiscalization_attempts_invoice_started_idx" ON "fiscalization_attempts"("fiskalni_izlazni_racun_id", "started_at");
CREATE INDEX "fiscalization_attempts_status_started_idx" ON "fiscalization_attempts"("status", "started_at");
CREATE INDEX "fiskalni_izlazni_racuni_firma_channel_issued_idx" ON "fiskalni_izlazni_racuni"("firma_id", "sales_channel", "issued_at");
CREATE INDEX "fiskalni_izlazni_racuni_register_issued_idx" ON "fiskalni_izlazni_racuni"("pos_register_id", "issued_at");

ALTER TABLE "pos_registers" ADD CONSTRAINT "pos_registers_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_registers" ADD CONSTRAINT "pos_registers_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_registers" ADD CONSTRAINT "pos_registers_magacin_id_fkey" FOREIGN KEY ("magacin_id") REFERENCES "magacini"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_podesavanja" ADD CONSTRAINT "pos_podesavanja_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_podesavanja" ADD CONSTRAINT "pos_podesavanja_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_document_payments" ADD CONSTRAINT "sales_document_payments_invoice_fkey" FOREIGN KEY ("fiskalni_izlazni_racun_id") REFERENCES "fiskalni_izlazni_racuni"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fiscalization_attempts" ADD CONSTRAINT "fiscalization_attempts_invoice_fkey" FOREIGN KEY ("fiskalni_izlazni_racun_id") REFERENCES "fiskalni_izlazni_racuni"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fiskalni_izlazni_racuni" ADD CONSTRAINT "fiskalni_izlazni_racuni_pos_register_id_fkey" FOREIGN KEY ("pos_register_id") REFERENCES "pos_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
