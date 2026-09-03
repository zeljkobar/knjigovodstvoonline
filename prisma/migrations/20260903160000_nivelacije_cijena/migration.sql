CREATE TABLE "nivelacije_cijena" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "poslovna_godina_id" UUID NOT NULL,
  "magacin_id" UUID NOT NULL,
  "poslovna_jedinica_id" UUID,
  "nalog_id" UUID,
  "broj" INTEGER NOT NULL,
  "interni_broj" TEXT NOT NULL,
  "datum" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "napomena" TEXT,
  "ukupna_promjena_maloprodajne_vrijednosti" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukupna_promjena_razlike_u_cijeni" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukupna_promjena_ukalkulisanog_pdv" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "posted_at" TIMESTAMP(3),
  "posted_by" UUID,
  "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  "deleted_at" TIMESTAMP(3),
  "deleted_by" UUID,
  "delete_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" UUID,
  CONSTRAINT "nivelacije_cijena_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stavke_nivelacije_cijena" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "nivelacija_cijena_id" UUID NOT NULL,
  "redni_broj" INTEGER NOT NULL,
  "artikal_id" UUID NOT NULL,
  "knjigovodstvena_kolicina" DECIMAL(18,3) NOT NULL,
  "nabavna_vrijednost" DECIMAL(14,2) NOT NULL,
  "pdv_stopa_procenat" DECIMAL(5,2) NOT NULL,
  "stara_prodajna_cijena_sa_pdv" DECIMAL(14,2) NOT NULL,
  "nova_prodajna_cijena_sa_pdv" DECIMAL(14,2) NOT NULL,
  "stara_maloprodajna_vrijednost" DECIMAL(14,2) NOT NULL,
  "nova_maloprodajna_vrijednost" DECIMAL(14,2) NOT NULL,
  "promjena_maloprodajne_vrijednosti" DECIMAL(14,2) NOT NULL,
  "stara_razlika_u_cijeni" DECIMAL(14,2) NOT NULL,
  "nova_razlika_u_cijeni" DECIMAL(14,2) NOT NULL,
  "promjena_razlike_u_cijeni" DECIMAL(14,2) NOT NULL,
  "stari_ukalkulisani_pdv" DECIMAL(14,2) NOT NULL,
  "novi_ukalkulisani_pdv" DECIMAL(14,2) NOT NULL,
  "promjena_ukalkulisanog_pdv" DECIMAL(14,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" UUID,
  CONSTRAINT "stavke_nivelacije_cijena_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stavke_nivelacije_cijena_kolicina_check" CHECK ("knjigovodstvena_kolicina" > 0),
  CONSTRAINT "stavke_nivelacije_cijena_stara_cijena_check" CHECK ("stara_prodajna_cijena_sa_pdv" > 0),
  CONSTRAINT "stavke_nivelacije_cijena_nova_cijena_check" CHECK ("nova_prodajna_cijena_sa_pdv" > 0)
);

CREATE UNIQUE INDEX "nivelacije_cijena_nalog_id_key" ON "nivelacije_cijena"("nalog_id");
CREATE UNIQUE INDEX "nivelacije_cijena_firma_id_poslovna_godina_id_broj_key" ON "nivelacije_cijena"("firma_id", "poslovna_godina_id", "broj");
CREATE UNIQUE INDEX "nivelacije_cijena_firma_id_poslovna_godina_id_interni_broj_key" ON "nivelacije_cijena"("firma_id", "poslovna_godina_id", "interni_broj");
CREATE INDEX "nivelacije_cijena_agencija_id_firma_id_poslovna_godina_id_status_is_deleted_idx" ON "nivelacije_cijena"("agencija_id", "firma_id", "poslovna_godina_id", "status", "is_deleted");
CREATE INDEX "nivelacije_cijena_magacin_id_datum_idx" ON "nivelacije_cijena"("magacin_id", "datum");
CREATE INDEX "nivelacije_cijena_poslovna_jedinica_id_idx" ON "nivelacije_cijena"("poslovna_jedinica_id");
CREATE UNIQUE INDEX "stavke_nivelacije_cijena_nivelacija_cijena_id_redni_broj_key" ON "stavke_nivelacije_cijena"("nivelacija_cijena_id", "redni_broj");
CREATE UNIQUE INDEX "stavke_nivelacije_cijena_nivelacija_cijena_id_artikal_id_key" ON "stavke_nivelacije_cijena"("nivelacija_cijena_id", "artikal_id");
CREATE INDEX "stavke_nivelacije_cijena_artikal_id_idx" ON "stavke_nivelacije_cijena"("artikal_id");

ALTER TABLE "nivelacije_cijena" ADD CONSTRAINT "nivelacije_cijena_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nivelacije_cijena" ADD CONSTRAINT "nivelacije_cijena_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nivelacije_cijena" ADD CONSTRAINT "nivelacije_cijena_poslovna_godina_id_fkey" FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nivelacije_cijena" ADD CONSTRAINT "nivelacije_cijena_magacin_id_fkey" FOREIGN KEY ("magacin_id") REFERENCES "magacini"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nivelacije_cijena" ADD CONSTRAINT "nivelacije_cijena_poslovna_jedinica_id_fkey" FOREIGN KEY ("poslovna_jedinica_id") REFERENCES "poslovne_jedinice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "nivelacije_cijena" ADD CONSTRAINT "nivelacije_cijena_nalog_id_fkey" FOREIGN KEY ("nalog_id") REFERENCES "nalozi"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stavke_nivelacije_cijena" ADD CONSTRAINT "stavke_nivelacije_cijena_nivelacija_cijena_id_fkey" FOREIGN KEY ("nivelacija_cijena_id") REFERENCES "nivelacije_cijena"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stavke_nivelacije_cijena" ADD CONSTRAINT "stavke_nivelacije_cijena_artikal_id_fkey" FOREIGN KEY ("artikal_id") REFERENCES "artikli"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "vrste_naloga" ("id", "sifra", "naziv", "opis", "sistemska", "prefiks", "aktivan", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'PRICE_ADJUSTMENT', 'Nivelacija cijena', 'Knjiženje promjene maloprodajne vrijednosti, razlike u cijeni i ukalkulisanog PDV-a.', true, 'NIV', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("sifra") DO NOTHING;
