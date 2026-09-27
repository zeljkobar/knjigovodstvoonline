CREATE TABLE "firma_mail_podesavanja" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL REFERENCES "agencije"("id"),
  "firma_id" UUID NOT NULL REFERENCES "firme"("id"),
  "folder" TEXT,
  "ukljuci_podfoldere" BOOLEAN NOT NULL DEFAULT false,
  "ukljuci_inbox" BOOLEAN NOT NULL DEFAULT true,
  "pravila" JSONB NOT NULL DEFAULT '[]',
  "aktivno" BOOLEAN NOT NULL DEFAULT true,
  "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  "deleted_at" TIMESTAMP(3),
  "deleted_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID,
  CONSTRAINT "firma_mail_podesavanja_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "firma_mail_pravila_array" CHECK (jsonb_typeof("pravila") = 'array')
);
CREATE UNIQUE INDEX "firma_mail_podesavanja_firma_id_key" ON "firma_mail_podesavanja"("firma_id");
CREATE INDEX "firma_mail_podesavanja_agencija_id_firma_id_idx" ON "firma_mail_podesavanja"("agencija_id", "firma_id");
