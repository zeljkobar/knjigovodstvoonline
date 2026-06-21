DELETE FROM "kuf_entry_tax_lines";
DELETE FROM "kuf_entries";
DELETE FROM "kuf_books";
DELETE FROM "firma_podrazumijevana_konta"
WHERE "dokument_tip" IN ('KUF', 'KIF')
   OR "namjena" LIKE 'KUF_%'
   OR "namjena" LIKE 'KIF_%';

CREATE TABLE "racun_vrste" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agencija_id" UUID NOT NULL,
    "firma_id" UUID NOT NULL,
    "dokument_tip" TEXT NOT NULL,
    "sifra" TEXT NOT NULL,
    "naziv" TEXT NOT NULL,
    "opis" TEXT,
    "redosljed" INTEGER NOT NULL DEFAULT 0,
    "sistemska" BOOLEAN NOT NULL DEFAULT false,
    "aktivna" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "racun_vrste_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "racun_kontiranje_pravila" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "racun_vrsta_id" UUID NOT NULL,
    "polje_sifra" TEXT NOT NULL,
    "polje_naziv" TEXT NOT NULL,
    "pdv_stopa_sifra" TEXT,
    "smjer" TEXT NOT NULL,
    "konto_izvor" TEXT NOT NULL DEFAULT 'FIXED',
    "sifra_konta" TEXT,
    "redosljed" INTEGER NOT NULL DEFAULT 0,
    "aktivno" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "racun_kontiranje_pravila_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "kuf_books"
DROP COLUMN IF EXISTS "vrsta",
ADD COLUMN "racun_vrsta_id" UUID NOT NULL;

CREATE UNIQUE INDEX "racun_vrste_firma_id_dokument_tip_sifra_key"
ON "racun_vrste"("firma_id", "dokument_tip", "sifra");

CREATE INDEX "racun_vrste_agencija_id_firma_id_dokument_tip_aktivna_idx"
ON "racun_vrste"("agencija_id", "firma_id", "dokument_tip", "aktivna");

CREATE UNIQUE INDEX "racun_kontiranje_pravila_racun_vrsta_id_polje_sifra_key"
ON "racun_kontiranje_pravila"("racun_vrsta_id", "polje_sifra");

CREATE INDEX "racun_kontiranje_pravila_racun_vrsta_id_redosljed_idx"
ON "racun_kontiranje_pravila"("racun_vrsta_id", "redosljed");

CREATE INDEX "kuf_books_racun_vrsta_id_idx"
ON "kuf_books"("racun_vrsta_id");

ALTER TABLE "racun_vrste"
ADD CONSTRAINT "racun_vrste_firma_id_fkey"
FOREIGN KEY ("firma_id") REFERENCES "firme"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "racun_kontiranje_pravila"
ADD CONSTRAINT "racun_kontiranje_pravila_racun_vrsta_id_fkey"
FOREIGN KEY ("racun_vrsta_id") REFERENCES "racun_vrste"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "kuf_books"
ADD CONSTRAINT "kuf_books_racun_vrsta_id_fkey"
FOREIGN KEY ("racun_vrsta_id") REFERENCES "racun_vrste"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
