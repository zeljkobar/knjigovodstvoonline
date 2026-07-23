CREATE TABLE "firma_odgovorna_lica" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "ime_prezime" TEXT NOT NULL,
  "jmbg" TEXT,
  "uloga" TEXT NOT NULL,
  "email" TEXT,
  "telefon" TEXT,
  "primarno" BOOLEAN NOT NULL DEFAULT false,
  "aktivan" BOOLEAN NOT NULL DEFAULT true,
  "napomena" TEXT,
  "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  "deleted_at" TIMESTAMP(3),
  "deleted_by" UUID,
  "delete_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID,
  CONSTRAINT "firma_odgovorna_lica_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "firma_odgovorna_lica_agencija_id_fkey"
    FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "firma_odgovorna_lica_firma_id_fkey"
    FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "firma_odgovorna_lica_jmbg_check"
    CHECK ("jmbg" IS NULL OR "jmbg" ~ '^[0-9]{13}$')
);

CREATE INDEX "firma_odgovorna_lica_agencija_id_firma_id_uloga_aktivan_is_deleted_idx"
  ON "firma_odgovorna_lica"("agencija_id", "firma_id", "uloga", "aktivan", "is_deleted");
