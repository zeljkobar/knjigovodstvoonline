ALTER TABLE "plate_osnove_obracuna"
  ADD COLUMN "m4_kategorija" TEXT NOT NULL DEFAULT 'NE_ULAZI';

UPDATE "plate_osnove_obracuna"
SET "m4_kategorija" = 'ZARADA_OSNOVICA'
WHERE "sifra" = '001';

ALTER TABLE "plate_radnici"
  ADD COLUMN "licni_broj_osiguranika" TEXT,
  ADD COLUMN "m4_oznaka_staza" TEXT NOT NULL DEFAULT '01';

CREATE TABLE "plate_m4_podesavanja" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "poslovna_godina_id" UUID NOT NULL,
  "redni_broj_organizacione_jedinice" TEXT NOT NULL DEFAULT '0000',
  "opstina_sifra" TEXT,
  "mjesto_podnosenja" TEXT,
  "ovlasceno_lice" TEXT,
  "datum_podnosenja" DATE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID,
  CONSTRAINT "plate_m4_podesavanja_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plate_m4_podesavanja_firma_id_fkey"
    FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "plate_m4_podesavanja_poslovna_godina_id_fkey"
    FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "plate_m4_podesavanja_firma_id_poslovna_godina_id_key"
  ON "plate_m4_podesavanja"("firma_id", "poslovna_godina_id");
CREATE INDEX "plate_m4_podesavanja_agencija_id_firma_id_poslovna_godina_id_idx"
  ON "plate_m4_podesavanja"("agencija_id", "firma_id", "poslovna_godina_id");

CREATE TABLE "plate_m4_mjesecne_uplate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "poslovna_godina_id" UUID NOT NULL,
  "mjesec" INTEGER NOT NULL,
  "porez_cent" INTEGER NOT NULL DEFAULT 0,
  "zaposleni_pio_cent" INTEGER NOT NULL DEFAULT 0,
  "zaposleni_zdravstvo_cent" INTEGER NOT NULL DEFAULT 0,
  "zaposleni_nezaposleni_cent" INTEGER NOT NULL DEFAULT 0,
  "poslodavac_pio_cent" INTEGER NOT NULL DEFAULT 0,
  "poslodavac_zdravstvo_cent" INTEGER NOT NULL DEFAULT 0,
  "poslodavac_nezaposleni_cent" INTEGER NOT NULL DEFAULT 0,
  "fond_rada_cent" INTEGER NOT NULL DEFAULT 0,
  "invalidi_cent" INTEGER NOT NULL DEFAULT 0,
  "datum_uplate" DATE,
  "referenca" TEXT,
  "potvrdjena" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID,
  CONSTRAINT "plate_m4_mjesecne_uplate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plate_m4_mjesecne_uplate_mjesec_check" CHECK ("mjesec" BETWEEN 1 AND 12),
  CONSTRAINT "plate_m4_mjesecne_uplate_firma_id_fkey"
    FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "plate_m4_mjesecne_uplate_poslovna_godina_id_fkey"
    FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "plate_m4_mjesecne_uplate_firma_id_poslovna_godina_id_mjesec_key"
  ON "plate_m4_mjesecne_uplate"("firma_id", "poslovna_godina_id", "mjesec");
CREATE INDEX "plate_m4_mjesecne_uplate_agencija_id_firma_id_poslovna_godina_id_potvrdjena_idx"
  ON "plate_m4_mjesecne_uplate"("agencija_id", "firma_id", "poslovna_godina_id", "potvrdjena");
