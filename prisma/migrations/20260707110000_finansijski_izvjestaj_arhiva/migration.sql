CREATE TABLE "finansijski_izvjestaj_arhive" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "poslovna_godina_id" UUID NOT NULL,
  "naziv" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SNIMLJEN',
  "snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" UUID,

  CONSTRAINT "finansijski_izvjestaj_arhive_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "finansijski_izvjestaj_arhive"
  ADD CONSTRAINT "finansijski_izvjestaj_arhive_firma_id_fkey"
  FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "finansijski_izvjestaj_arhive"
  ADD CONSTRAINT "finansijski_izvjestaj_arhive_poslovna_godina_id_fkey"
  FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "finansijski_izvjestaj_arhive_agencija_id_firma_id_poslovna_godina_id_created_at_idx"
  ON "finansijski_izvjestaj_arhive"("agencija_id", "firma_id", "poslovna_godina_id", "created_at");
