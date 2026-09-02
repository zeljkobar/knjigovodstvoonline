CREATE TABLE "poslovne_jedinice" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "sifra" TEXT NOT NULL,
  "naziv" TEXT NOT NULL,
  "tip" TEXT NOT NULL DEFAULT 'OTHER',
  "adresa" TEXT,
  "grad" TEXT,
  "aktivna" BOOLEAN NOT NULL DEFAULT true,
  "napomena" TEXT,
  "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  "deleted_at" TIMESTAMP(3),
  "deleted_by" UUID,
  "delete_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" UUID,
  CONSTRAINT "poslovne_jedinice_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "magacini" ADD COLUMN "poslovna_jedinica_id" UUID;
ALTER TABLE "kalkulacije" ADD COLUMN "poslovna_jedinica_id" UUID;
ALTER TABLE "nalozi" ADD COLUMN "poslovna_jedinica_id" UUID;

CREATE UNIQUE INDEX "poslovne_jedinice_firma_id_sifra_key"
  ON "poslovne_jedinice"("firma_id", "sifra");
CREATE INDEX "poslovne_jedinice_agencija_id_firma_id_aktivna_is_deleted_idx"
  ON "poslovne_jedinice"("agencija_id", "firma_id", "aktivna", "is_deleted");
CREATE INDEX "poslovne_jedinice_firma_id_naziv_idx"
  ON "poslovne_jedinice"("firma_id", "naziv");
CREATE INDEX "magacini_poslovna_jedinica_id_idx"
  ON "magacini"("poslovna_jedinica_id");
CREATE INDEX "kalkulacije_poslovna_jedinica_id_datum_kalkulacije_idx"
  ON "kalkulacije"("poslovna_jedinica_id", "datum_kalkulacije");
CREATE INDEX "nalozi_poslovna_jedinica_id_datum_idx"
  ON "nalozi"("poslovna_jedinica_id", "datum");

ALTER TABLE "poslovne_jedinice"
  ADD CONSTRAINT "poslovne_jedinice_agencija_id_fkey"
  FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "poslovne_jedinice"
  ADD CONSTRAINT "poslovne_jedinice_firma_id_fkey"
  FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "magacini"
  ADD CONSTRAINT "magacini_poslovna_jedinica_id_fkey"
  FOREIGN KEY ("poslovna_jedinica_id") REFERENCES "poslovne_jedinice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kalkulacije"
  ADD CONSTRAINT "kalkulacije_poslovna_jedinica_id_fkey"
  FOREIGN KEY ("poslovna_jedinica_id") REFERENCES "poslovne_jedinice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "nalozi"
  ADD CONSTRAINT "nalozi_poslovna_jedinica_id_fkey"
  FOREIGN KEY ("poslovna_jedinica_id") REFERENCES "poslovne_jedinice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
