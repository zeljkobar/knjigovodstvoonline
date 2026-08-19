CREATE TABLE "pos_smjene" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "poslovna_godina_id" UUID NOT NULL,
  "pos_register_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "opened_by" UUID NOT NULL,
  "opening_cash_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "closed_at" TIMESTAMP(3),
  "closed_by" UUID,
  "invoice_count" INTEGER NOT NULL DEFAULT 0,
  "cash_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "card_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "bank_transfer_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "other_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "gross_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "expected_cash_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pos_smjene_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pos_smjene_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pos_smjene_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pos_smjene_poslovna_godina_id_fkey" FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pos_smjene_pos_register_id_fkey" FOREIGN KEY ("pos_register_id") REFERENCES "pos_registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pos_smjene_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "korisnici"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pos_smjene_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "korisnici"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "pos_smjene_status_check" CHECK ("status" IN ('OPEN', 'CLOSED')),
  CONSTRAINT "pos_smjene_close_check" CHECK (
    ("status" = 'OPEN' AND "closed_at" IS NULL AND "closed_by" IS NULL) OR
    ("status" = 'CLOSED' AND "closed_at" IS NOT NULL AND "closed_by" IS NOT NULL)
  )
);

CREATE INDEX "pos_smjene_agencija_id_firma_id_poslovna_godina_id_opened_at_idx"
  ON "pos_smjene"("agencija_id", "firma_id", "poslovna_godina_id", "opened_at");

CREATE INDEX "pos_smjene_pos_register_id_status_idx"
  ON "pos_smjene"("pos_register_id", "status");

CREATE UNIQUE INDEX "pos_smjene_one_open_per_register_idx"
  ON "pos_smjene"("pos_register_id") WHERE "status" = 'OPEN';
