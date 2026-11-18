CREATE TABLE "agencija_komitent_izmjene" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "komitent_id" UUID NOT NULL,
  "naziv" TEXT NOT NULL,
  "pib" TEXT, "maticni_broj" TEXT, "pdv_broj" TEXT,
  "pravna_forma" TEXT, "sifra_djelatnosti" TEXT, "datum_registracije" DATE,
  "is_foreign" BOOLEAN NOT NULL DEFAULT false,
  "country_code" TEXT, "country_name" TEXT, "foreign_tax_number" TEXT,
  "adresa" TEXT, "grad" TEXT, "drzava" TEXT, "telefon" TEXT, "email" TEXT, "web_sajt" TEXT,
  "verzija" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID NOT NULL, "updated_by" UUID NOT NULL,
  CONSTRAINT "agencija_komitent_izmjene_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agencija_komitent_izmjene_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "agencija_komitent_izmjene_komitent_id_fkey" FOREIGN KEY ("komitent_id") REFERENCES "komitenti"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "agencija_komitent_izmjene_agencija_id_komitent_id_key" ON "agencija_komitent_izmjene"("agencija_id", "komitent_id");
CREATE INDEX "agencija_komitent_izmjene_komitent_id_idx" ON "agencija_komitent_izmjene"("komitent_id");
CREATE INDEX "agencija_komitent_izmjene_naziv_trgm_idx" ON "agencija_komitent_izmjene" USING GIN ("naziv" gin_trgm_ops);
CREATE INDEX "agencija_komitent_izmjene_pib_idx" ON "agencija_komitent_izmjene"("agencija_id", "pib");
