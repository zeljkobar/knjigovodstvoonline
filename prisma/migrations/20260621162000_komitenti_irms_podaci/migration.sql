ALTER TABLE "komitenti"
  ADD COLUMN "pravna_forma" TEXT,
  ADD COLUMN "sifra_djelatnosti" TEXT,
  ADD COLUMN "datum_registracije" DATE;

CREATE INDEX "komitenti_scope_pib_idx"
  ON "komitenti"("scope", "pib");

