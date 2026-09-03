CREATE TABLE "popisi_robe" (
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
  "ukupna_vrijednost_viska" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukupna_vrijednost_manjka" DECIMAL(14,2) NOT NULL DEFAULT 0,
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
  CONSTRAINT "popisi_robe_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stavke_popisa_robe" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "popis_robe_id" UUID NOT NULL,
  "redni_broj" INTEGER NOT NULL,
  "artikal_id" UUID NOT NULL,
  "knjigovodstvena_kolicina" DECIMAL(18,3) NOT NULL,
  "stvarna_kolicina" DECIMAL(18,3),
  "razlika_kolicina" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "knjigovodstvena_prosjecna_nabavna_cijena" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "rucna_nabavna_cijena_viska" DECIMAL(14,4),
  "knjigovodstvena_nabavna_vrijednost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "knjigovodstvena_maloprodajna_vrijednost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "knjigovodstvena_razlika_u_cijeni" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "knjigovodstveni_ukalkulisani_pdv" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "nabavna_vrijednost_razlike" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "maloprodajna_vrijednost_razlike" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "razlika_u_cijeni_razlike" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukalkulisani_pdv_razlike" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" UUID,
  CONSTRAINT "stavke_popisa_robe_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stavke_popisa_robe_stvarna_kolicina_check" CHECK ("stvarna_kolicina" IS NULL OR "stvarna_kolicina" >= 0),
  CONSTRAINT "stavke_popisa_robe_rucna_cijena_check" CHECK ("rucna_nabavna_cijena_viska" IS NULL OR "rucna_nabavna_cijena_viska" >= 0)
);

CREATE UNIQUE INDEX "popisi_robe_nalog_id_key" ON "popisi_robe"("nalog_id");
CREATE UNIQUE INDEX "popisi_robe_firma_id_poslovna_godina_id_broj_key" ON "popisi_robe"("firma_id", "poslovna_godina_id", "broj");
CREATE UNIQUE INDEX "popisi_robe_firma_id_poslovna_godina_id_interni_broj_key" ON "popisi_robe"("firma_id", "poslovna_godina_id", "interni_broj");
CREATE INDEX "popisi_robe_agencija_id_firma_id_poslovna_godina_id_status_is_deleted_idx" ON "popisi_robe"("agencija_id", "firma_id", "poslovna_godina_id", "status", "is_deleted");
CREATE INDEX "popisi_robe_magacin_id_datum_idx" ON "popisi_robe"("magacin_id", "datum");
CREATE INDEX "popisi_robe_poslovna_jedinica_id_idx" ON "popisi_robe"("poslovna_jedinica_id");
CREATE UNIQUE INDEX "stavke_popisa_robe_popis_robe_id_redni_broj_key" ON "stavke_popisa_robe"("popis_robe_id", "redni_broj");
CREATE UNIQUE INDEX "stavke_popisa_robe_popis_robe_id_artikal_id_key" ON "stavke_popisa_robe"("popis_robe_id", "artikal_id");
CREATE INDEX "stavke_popisa_robe_artikal_id_idx" ON "stavke_popisa_robe"("artikal_id");

ALTER TABLE "popisi_robe" ADD CONSTRAINT "popisi_robe_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "popisi_robe" ADD CONSTRAINT "popisi_robe_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "popisi_robe" ADD CONSTRAINT "popisi_robe_poslovna_godina_id_fkey" FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "popisi_robe" ADD CONSTRAINT "popisi_robe_magacin_id_fkey" FOREIGN KEY ("magacin_id") REFERENCES "magacini"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "popisi_robe" ADD CONSTRAINT "popisi_robe_poslovna_jedinica_id_fkey" FOREIGN KEY ("poslovna_jedinica_id") REFERENCES "poslovne_jedinice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "popisi_robe" ADD CONSTRAINT "popisi_robe_nalog_id_fkey" FOREIGN KEY ("nalog_id") REFERENCES "nalozi"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stavke_popisa_robe" ADD CONSTRAINT "stavke_popisa_robe_popis_robe_id_fkey" FOREIGN KEY ("popis_robe_id") REFERENCES "popisi_robe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stavke_popisa_robe" ADD CONSTRAINT "stavke_popisa_robe_artikal_id_fkey" FOREIGN KEY ("artikal_id") REFERENCES "artikli"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "vrste_naloga" ("id", "sifra", "naziv", "opis", "sistemska", "prefiks", "aktivan", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'STOCK_COUNT', 'Popis robe', 'Knjiženje viška i manjka utvrđenog popisom robe.', true, 'POP', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("sifra") DO NOTHING;
