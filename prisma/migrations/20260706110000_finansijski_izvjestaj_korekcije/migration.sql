CREATE TABLE "finansijski_izvjestaj_korekcije" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "poslovna_godina_id" UUID NOT NULL,
  "tip_sifra" TEXT NOT NULL,
  "aop" TEXT NOT NULL,
  "kolona" TEXT NOT NULL,
  "vrijednost" DECIMAL(14, 2) NOT NULL,
  "napomena" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" UUID,

  CONSTRAINT "finansijski_izvjestaj_korekcije_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "finansijski_izvjestaj_korekcije_firma_id_fkey"
    FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "finansijski_izvjestaj_korekcije_poslovna_godina_id_fkey"
    FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "finansijski_izvjestaj_korekcije_firma_godina_tip_aop_kolona_key"
  ON "finansijski_izvjestaj_korekcije"("firma_id", "poslovna_godina_id", "tip_sifra", "aop", "kolona");

CREATE INDEX "finansijski_izvjestaj_korekcije_scope_idx"
  ON "finansijski_izvjestaj_korekcije"("agencija_id", "firma_id", "poslovna_godina_id", "tip_sifra");
