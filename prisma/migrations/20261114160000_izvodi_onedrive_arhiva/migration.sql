ALTER TABLE "mail_izvod_obrade"
  ADD COLUMN "imap_uid" BIGINT,
  ADD COLUMN "imap_uid_validity" TEXT,
  ADD COLUMN "imap_folder" TEXT,
  ADD COLUMN "indeks_priloga" INTEGER,
  ADD COLUMN "arhiva_status" TEXT,
  ADD COLUMN "arhiva_greska" TEXT,
  ADD COLUMN "arhiva_pokusaj_at" TIMESTAMP(3),
  ADD COLUMN "arhiva_item_id" TEXT;

CREATE INDEX "mail_izvod_arhiva_status_idx" ON "mail_izvod_obrade" ("arhiva_status", "arhiva_pokusaj_at");

CREATE TABLE "izvodi_arhiva_folderi" (
  "agencija_id" UUID NOT NULL REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "firma_id" UUID NOT NULL REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "poslovna_godina_id" UUID NOT NULL REFERENCES "poslovne_godine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "bankovni_racun_id" UUID NOT NULL REFERENCES "firma_bankovni_racuni"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "drive_id" TEXT NOT NULL,
  "folder_id" TEXT NOT NULL,
  "naziv" TEXT NOT NULL,
  CONSTRAINT "izvodi_arhiva_folderi_pkey" PRIMARY KEY ("firma_id", "poslovna_godina_id", "bankovni_racun_id")
);

CREATE UNIQUE INDEX "izvodi_arhiva_folderi_odrediste_key" ON "izvodi_arhiva_folderi" ("agencija_id", "drive_id", "folder_id");
