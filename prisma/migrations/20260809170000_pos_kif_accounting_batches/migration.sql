CREATE TABLE "pos_kif_batches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "poslovna_godina_id" UUID NOT NULL,
  "kif_entry_id" UUID NOT NULL,
  "aggregation_mode" TEXT NOT NULL,
  "period_from" DATE NOT NULL,
  "period_to" DATE NOT NULL,
  "invoice_count" INTEGER NOT NULL,
  "total_base" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total_tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total_gross" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'GENERATED',
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "generated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pos_kif_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_kif_batch_invoices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "pos_kif_batch_id" UUID NOT NULL,
  "fiskalni_izlazni_racun_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_kif_batch_invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pos_accounting_batches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "poslovna_godina_id" UUID NOT NULL,
  "pos_kif_batch_id" UUID NOT NULL,
  "journal_id" UUID,
  "aggregation_mode" TEXT NOT NULL,
  "period_from" DATE NOT NULL,
  "period_to" DATE NOT NULL,
  "invoice_count" INTEGER NOT NULL,
  "total_base" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total_tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total_gross" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'WAITING_KIF_POSTING',
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "generated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pos_accounting_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pos_kif_batches_kif_entry_id_key" ON "pos_kif_batches"("kif_entry_id");
CREATE UNIQUE INDEX "pos_kif_batches_period_key" ON "pos_kif_batches"("firma_id", "aggregation_mode", "period_from", "period_to");
CREATE INDEX "pos_kif_batches_scope_idx" ON "pos_kif_batches"("agencija_id", "firma_id", "poslovna_godina_id", "status");
CREATE UNIQUE INDEX "pos_kif_batch_invoices_invoice_key" ON "pos_kif_batch_invoices"("fiskalni_izlazni_racun_id");
CREATE UNIQUE INDEX "pos_kif_batch_invoices_membership_key" ON "pos_kif_batch_invoices"("pos_kif_batch_id", "fiskalni_izlazni_racun_id");
CREATE INDEX "pos_kif_batch_invoices_batch_idx" ON "pos_kif_batch_invoices"("pos_kif_batch_id");
CREATE UNIQUE INDEX "pos_accounting_batches_pos_kif_batch_id_key" ON "pos_accounting_batches"("pos_kif_batch_id");
CREATE UNIQUE INDEX "pos_accounting_batches_journal_id_key" ON "pos_accounting_batches"("journal_id");
CREATE UNIQUE INDEX "pos_accounting_batches_period_key" ON "pos_accounting_batches"("firma_id", "aggregation_mode", "period_from", "period_to");
CREATE INDEX "pos_accounting_batches_scope_idx" ON "pos_accounting_batches"("agencija_id", "firma_id", "poslovna_godina_id", "status");

ALTER TABLE "pos_kif_batches" ADD CONSTRAINT "pos_kif_batches_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_kif_batches" ADD CONSTRAINT "pos_kif_batches_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_kif_batches" ADD CONSTRAINT "pos_kif_batches_poslovna_godina_id_fkey" FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_kif_batches" ADD CONSTRAINT "pos_kif_batches_kif_entry_id_fkey" FOREIGN KEY ("kif_entry_id") REFERENCES "kif_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_kif_batch_invoices" ADD CONSTRAINT "pos_kif_batch_invoices_batch_id_fkey" FOREIGN KEY ("pos_kif_batch_id") REFERENCES "pos_kif_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_kif_batch_invoices" ADD CONSTRAINT "pos_kif_batch_invoices_invoice_id_fkey" FOREIGN KEY ("fiskalni_izlazni_racun_id") REFERENCES "fiskalni_izlazni_racuni"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_accounting_batches" ADD CONSTRAINT "pos_accounting_batches_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_accounting_batches" ADD CONSTRAINT "pos_accounting_batches_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_accounting_batches" ADD CONSTRAINT "pos_accounting_batches_poslovna_godina_id_fkey" FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_accounting_batches" ADD CONSTRAINT "pos_accounting_batches_pos_kif_batch_id_fkey" FOREIGN KEY ("pos_kif_batch_id") REFERENCES "pos_kif_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pos_accounting_batches" ADD CONSTRAINT "pos_accounting_batches_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "nalozi"("id") ON DELETE SET NULL ON UPDATE CASCADE;
