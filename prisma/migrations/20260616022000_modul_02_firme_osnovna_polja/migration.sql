ALTER TABLE "firme"
  ADD COLUMN "skraceni_naziv" TEXT,
  ADD COLUMN "tip_subjekta" TEXT NOT NULL DEFAULT 'DOO',
  ADD COLUMN "sifra_djelatnosti" TEXT,
  ADD COLUMN "opis_djelatnosti" TEXT,
  ADD COLUMN "datum_registracije" DATE,
  ADD COLUMN "pravna_forma" TEXT,
  ADD COLUMN "status_registracije" TEXT,
  ADD COLUMN "status_firme" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "opstina" TEXT,
  ADD COLUMN "web_sajt" TEXT,
  ADD COLUMN "napomena" TEXT,
  ADD COLUMN "pdv_obveznik" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "firme_agencija_id_pib_key" ON "firme"("agencija_id", "pib");
