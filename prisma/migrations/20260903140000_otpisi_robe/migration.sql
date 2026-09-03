CREATE TABLE "otpisi_robe" (
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
  "razlog" TEXT NOT NULL,
  "opis_razloga" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "napomena" TEXT,
  "ukupna_nabavna_vrijednost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukupna_maloprodajna_vrijednost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukupna_razlika_u_cijeni" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukupni_ukalkulisani_pdv" DECIMAL(14,2) NOT NULL DEFAULT 0,
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
  CONSTRAINT "otpisi_robe_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stavke_otpisa_robe" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "otpis_robe_id" UUID NOT NULL,
  "redni_broj" INTEGER NOT NULL,
  "artikal_id" UUID NOT NULL,
  "kolicina" DECIMAL(18,3) NOT NULL,
  "procijenjena_nabavna_cijena" DECIMAL(14,4),
  "jedinicna_nabavna_cijena" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "nabavna_vrijednost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "prodajna_cijena_sa_pdv" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "maloprodajna_vrijednost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "razlika_u_cijeni" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukalkulisani_pdv" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "napomena" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" UUID,
  CONSTRAINT "stavke_otpisa_robe_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stavke_otpisa_robe_kolicina_check" CHECK ("kolicina" > 0),
  CONSTRAINT "stavke_otpisa_robe_procijenjena_cijena_check" CHECK ("procijenjena_nabavna_cijena" IS NULL OR "procijenjena_nabavna_cijena" > 0)
);

CREATE UNIQUE INDEX "otpisi_robe_nalog_id_key" ON "otpisi_robe"("nalog_id");
CREATE UNIQUE INDEX "otpisi_robe_firma_id_poslovna_godina_id_broj_key" ON "otpisi_robe"("firma_id", "poslovna_godina_id", "broj");
CREATE UNIQUE INDEX "otpisi_robe_firma_id_poslovna_godina_id_interni_broj_key" ON "otpisi_robe"("firma_id", "poslovna_godina_id", "interni_broj");
CREATE INDEX "otpisi_robe_agencija_id_firma_id_poslovna_godina_id_status_is_deleted_idx" ON "otpisi_robe"("agencija_id", "firma_id", "poslovna_godina_id", "status", "is_deleted");
CREATE INDEX "otpisi_robe_magacin_id_datum_idx" ON "otpisi_robe"("magacin_id", "datum");
CREATE INDEX "otpisi_robe_poslovna_jedinica_id_idx" ON "otpisi_robe"("poslovna_jedinica_id");
CREATE UNIQUE INDEX "stavke_otpisa_robe_otpis_robe_id_redni_broj_key" ON "stavke_otpisa_robe"("otpis_robe_id", "redni_broj");
CREATE UNIQUE INDEX "stavke_otpisa_robe_otpis_robe_id_artikal_id_key" ON "stavke_otpisa_robe"("otpis_robe_id", "artikal_id");
CREATE INDEX "stavke_otpisa_robe_artikal_id_idx" ON "stavke_otpisa_robe"("artikal_id");

ALTER TABLE "otpisi_robe" ADD CONSTRAINT "otpisi_robe_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "otpisi_robe" ADD CONSTRAINT "otpisi_robe_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "otpisi_robe" ADD CONSTRAINT "otpisi_robe_poslovna_godina_id_fkey" FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "otpisi_robe" ADD CONSTRAINT "otpisi_robe_magacin_id_fkey" FOREIGN KEY ("magacin_id") REFERENCES "magacini"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "otpisi_robe" ADD CONSTRAINT "otpisi_robe_poslovna_jedinica_id_fkey" FOREIGN KEY ("poslovna_jedinica_id") REFERENCES "poslovne_jedinice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "otpisi_robe" ADD CONSTRAINT "otpisi_robe_nalog_id_fkey" FOREIGN KEY ("nalog_id") REFERENCES "nalozi"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stavke_otpisa_robe" ADD CONSTRAINT "stavke_otpisa_robe_otpis_robe_id_fkey" FOREIGN KEY ("otpis_robe_id") REFERENCES "otpisi_robe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stavke_otpisa_robe" ADD CONSTRAINT "stavke_otpisa_robe_artikal_id_fkey" FOREIGN KEY ("artikal_id") REFERENCES "artikli"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "vrste_naloga" ("id", "sifra", "naziv", "opis", "sistemska", "prefiks", "aktivan", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'WRITE_OFF', 'Otpis robe', 'Knjiženje rashoda i razduženja zaliha po dokumentu otpisa.', true, 'OTP', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("sifra") DO NOTHING;
