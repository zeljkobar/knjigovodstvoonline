CREATE TABLE "prenosi_robe" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "poslovna_godina_id" UUID NOT NULL,
  "izvorni_magacin_id" UUID NOT NULL,
  "odredisni_magacin_id" UUID NOT NULL,
  "izvorna_poslovna_jedinica_id" UUID,
  "odredisna_poslovna_jedinica_id" UUID,
  "nalog_id" UUID,
  "broj" INTEGER NOT NULL,
  "interni_broj" TEXT NOT NULL,
  "datum" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "napomena" TEXT,
  "ukupna_nabavna_vrijednost" DECIMAL(14,2) NOT NULL DEFAULT 0,
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
  CONSTRAINT "prenosi_robe_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prenosi_robe_razliciti_magacini_check" CHECK ("izvorni_magacin_id" <> "odredisni_magacin_id")
);

CREATE TABLE "stavke_prenosa_robe" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "prenos_robe_id" UUID NOT NULL,
  "redni_broj" INTEGER NOT NULL,
  "artikal_id" UUID NOT NULL,
  "kolicina" DECIMAL(18,3) NOT NULL,
  "jedinicna_nabavna_cijena" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "nabavna_vrijednost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "prodajna_cijena_sa_pdv" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "prodajna_vrijednost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "razlika_u_cijeni" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukalkulisani_pdv" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" UUID,
  CONSTRAINT "stavke_prenosa_robe_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stavke_prenosa_robe_kolicina_check" CHECK ("kolicina" > 0)
);

CREATE UNIQUE INDEX "prenosi_robe_nalog_id_key" ON "prenosi_robe"("nalog_id");
CREATE UNIQUE INDEX "prenosi_robe_firma_id_poslovna_godina_id_broj_key" ON "prenosi_robe"("firma_id", "poslovna_godina_id", "broj");
CREATE UNIQUE INDEX "prenosi_robe_firma_id_poslovna_godina_id_interni_broj_key" ON "prenosi_robe"("firma_id", "poslovna_godina_id", "interni_broj");
CREATE INDEX "prenosi_robe_agencija_id_firma_id_poslovna_godina_id_status_is_deleted_idx" ON "prenosi_robe"("agencija_id", "firma_id", "poslovna_godina_id", "status", "is_deleted");
CREATE INDEX "prenosi_robe_izvorni_magacin_id_odredisni_magacin_id_datum_idx" ON "prenosi_robe"("izvorni_magacin_id", "odredisni_magacin_id", "datum");
CREATE INDEX "prenosi_robe_izvorna_poslovna_jedinica_id_idx" ON "prenosi_robe"("izvorna_poslovna_jedinica_id");
CREATE INDEX "prenosi_robe_odredisna_poslovna_jedinica_id_idx" ON "prenosi_robe"("odredisna_poslovna_jedinica_id");
CREATE UNIQUE INDEX "stavke_prenosa_robe_prenos_robe_id_redni_broj_key" ON "stavke_prenosa_robe"("prenos_robe_id", "redni_broj");
CREATE UNIQUE INDEX "stavke_prenosa_robe_prenos_robe_id_artikal_id_key" ON "stavke_prenosa_robe"("prenos_robe_id", "artikal_id");
CREATE INDEX "stavke_prenosa_robe_artikal_id_idx" ON "stavke_prenosa_robe"("artikal_id");

ALTER TABLE "prenosi_robe" ADD CONSTRAINT "prenosi_robe_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prenosi_robe" ADD CONSTRAINT "prenosi_robe_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prenosi_robe" ADD CONSTRAINT "prenosi_robe_poslovna_godina_id_fkey" FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prenosi_robe" ADD CONSTRAINT "prenosi_robe_izvorni_magacin_id_fkey" FOREIGN KEY ("izvorni_magacin_id") REFERENCES "magacini"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prenosi_robe" ADD CONSTRAINT "prenosi_robe_odredisni_magacin_id_fkey" FOREIGN KEY ("odredisni_magacin_id") REFERENCES "magacini"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prenosi_robe" ADD CONSTRAINT "prenosi_robe_izvorna_poslovna_jedinica_id_fkey" FOREIGN KEY ("izvorna_poslovna_jedinica_id") REFERENCES "poslovne_jedinice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "prenosi_robe" ADD CONSTRAINT "prenosi_robe_odredisna_poslovna_jedinica_id_fkey" FOREIGN KEY ("odredisna_poslovna_jedinica_id") REFERENCES "poslovne_jedinice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "prenosi_robe" ADD CONSTRAINT "prenosi_robe_nalog_id_fkey" FOREIGN KEY ("nalog_id") REFERENCES "nalozi"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stavke_prenosa_robe" ADD CONSTRAINT "stavke_prenosa_robe_prenos_robe_id_fkey" FOREIGN KEY ("prenos_robe_id") REFERENCES "prenosi_robe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stavke_prenosa_robe" ADD CONSTRAINT "stavke_prenosa_robe_artikal_id_fkey" FOREIGN KEY ("artikal_id") REFERENCES "artikli"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "vrste_naloga" ("id", "sifra", "naziv", "opis", "sistemska", "prefiks", "aktivan", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'WAREHOUSE_TRANSFER', 'Prenos robe', 'Knjiženje prenosa robe između magacina.', true, 'PRN', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("sifra") DO NOTHING;
