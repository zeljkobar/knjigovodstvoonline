CREATE TABLE "povrati_dobavljacu" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "poslovna_godina_id" UUID NOT NULL,
  "magacin_id" UUID NOT NULL,
  "poslovna_jedinica_id" UUID,
  "dobavljac_id" UUID NOT NULL,
  "kalkulacija_id" UUID,
  "originalni_kuf_id" UUID,
  "kuf_book_id" UUID,
  "kuf_entry_id" UUID UNIQUE,
  "broj_odobrenja" TEXT NOT NULL,
  "ukupna_osnovica" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukupni_ulazni_pdv" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukupno_odobrenje" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "nalog_id" UUID,
  "broj" INTEGER NOT NULL,
  "interni_broj" TEXT NOT NULL,
  "datum" DATE NOT NULL,
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
  CONSTRAINT "povrati_dobavljacu_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stavke_povrata_dobavljacu" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "povrat_dobavljacu_id" UUID NOT NULL,
  "redni_broj" INTEGER NOT NULL,
  "artikal_id" UUID NOT NULL,
  "kolicina" DECIMAL(18,3) NOT NULL,
  "cijena_odobrenja" DECIMAL(14,4) NOT NULL,
  "pdv_stopa_id" UUID NOT NULL,
  "pdv_procenat" DECIMAL(5,2) NOT NULL,
  "osnovica" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ulazni_pdv" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "stavka_kalkulacije_id" UUID,
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
  CONSTRAINT "stavke_povrata_dobavljacu_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stavke_povrata_dobavljacu_kolicina_check" CHECK ("kolicina" > 0),
  CONSTRAINT "stavke_povrata_dobavljacu_procijenjena_cijena_check" CHECK ("cijena_odobrenja" > 0 AND "pdv_procenat" BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX "povrati_dobavljacu_nalog_id_key" ON "povrati_dobavljacu"("nalog_id");
CREATE UNIQUE INDEX "povrati_dobavljacu_firma_id_poslovna_godina_id_broj_key" ON "povrati_dobavljacu"("firma_id", "poslovna_godina_id", "broj");
CREATE UNIQUE INDEX "povrati_dobavljacu_firma_id_poslovna_godina_id_interni_broj_key" ON "povrati_dobavljacu"("firma_id", "poslovna_godina_id", "interni_broj");
CREATE INDEX "povrati_dobavljacu_agencija_id_firma_id_poslovna_godina_id_status_is_deleted_idx" ON "povrati_dobavljacu"("agencija_id", "firma_id", "poslovna_godina_id", "status", "is_deleted");
CREATE INDEX "povrati_dobavljacu_magacin_id_datum_idx" ON "povrati_dobavljacu"("magacin_id", "datum");
CREATE INDEX "povrati_dobavljacu_poslovna_jedinica_id_idx" ON "povrati_dobavljacu"("poslovna_jedinica_id");
CREATE UNIQUE INDEX "stavke_povrata_dobavljacu_povrat_dobavljacu_id_redni_broj_key" ON "stavke_povrata_dobavljacu"("povrat_dobavljacu_id", "redni_broj");
CREATE UNIQUE INDEX "stavke_povrata_dobavljacu_povrat_dobavljacu_id_artikal_id_key" ON "stavke_povrata_dobavljacu"("povrat_dobavljacu_id", "artikal_id");
CREATE INDEX "stavke_povrata_dobavljacu_artikal_id_idx" ON "stavke_povrata_dobavljacu"("artikal_id");

ALTER TABLE "povrati_dobavljacu" ADD CONSTRAINT "povrati_dobavljacu_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "povrati_dobavljacu" ADD CONSTRAINT "povrati_dobavljacu_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "povrati_dobavljacu" ADD CONSTRAINT "povrati_dobavljacu_poslovna_godina_id_fkey" FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "povrati_dobavljacu" ADD CONSTRAINT "povrati_dobavljacu_magacin_id_fkey" FOREIGN KEY ("magacin_id") REFERENCES "magacini"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "povrati_dobavljacu" ADD CONSTRAINT "povrati_dobavljacu_poslovna_jedinica_id_fkey" FOREIGN KEY ("poslovna_jedinica_id") REFERENCES "poslovne_jedinice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "povrati_dobavljacu" ADD CONSTRAINT "povrati_dobavljacu_nalog_id_fkey" FOREIGN KEY ("nalog_id") REFERENCES "nalozi"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stavke_povrata_dobavljacu" ADD CONSTRAINT "stavke_povrata_dobavljacu_povrat_dobavljacu_id_fkey" FOREIGN KEY ("povrat_dobavljacu_id") REFERENCES "povrati_dobavljacu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stavke_povrata_dobavljacu" ADD CONSTRAINT "stavke_povrata_dobavljacu_artikal_id_fkey" FOREIGN KEY ("artikal_id") REFERENCES "artikli"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "povrati_dobavljacu" ADD CONSTRAINT "povrati_dobavljacu_dobavljac_id_fkey" FOREIGN KEY ("dobavljac_id") REFERENCES "komitenti"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "povrati_dobavljacu" ADD CONSTRAINT "povrati_dobavljacu_kalkulacija_id_fkey" FOREIGN KEY ("kalkulacija_id") REFERENCES "kalkulacije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "povrati_dobavljacu" ADD CONSTRAINT "povrati_dobavljacu_originalni_kuf_id_fkey" FOREIGN KEY ("originalni_kuf_id") REFERENCES "kuf_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "povrati_dobavljacu" ADD CONSTRAINT "povrati_dobavljacu_kuf_book_id_fkey" FOREIGN KEY ("kuf_book_id") REFERENCES "kuf_books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "povrati_dobavljacu" ADD CONSTRAINT "povrati_dobavljacu_kuf_entry_id_fkey" FOREIGN KEY ("kuf_entry_id") REFERENCES "kuf_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stavke_povrata_dobavljacu" ADD CONSTRAINT "stavke_povrata_dobavljacu_pdv_stopa_id_fkey" FOREIGN KEY ("pdv_stopa_id") REFERENCES "pdv_stope"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stavke_povrata_dobavljacu" ADD CONSTRAINT "stavke_povrata_dobavljacu_stavka_kalkulacije_id_fkey" FOREIGN KEY ("stavka_kalkulacije_id") REFERENCES "stavke_kalkulacije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE povrati_dobavljacu ADD CONSTRAINT povrat_status_check CHECK (status IN ('DRAFT','POSTED','DELETED'));
CREATE INDEX povrat_kalkulacija_idx ON povrati_dobavljacu(kalkulacija_id);
CREATE INDEX povrat_dobavljac_idx ON povrati_dobavljacu(dobavljac_id);
CREATE INDEX povrat_originalni_kuf_idx ON povrati_dobavljacu(originalni_kuf_id);
CREATE INDEX povrat_stavka_kalkulacije_idx ON stavke_povrata_dobavljacu(stavka_kalkulacije_id);
INSERT INTO vrste_naloga (id,sifra,naziv,opis,sistemska,prefiks,aktivan,created_at,updated_at)
VALUES (gen_random_uuid(),'SUPPLIER_RETURN','Povrat dobavljaču','Povrat robe i ispravka obaveze i ulaznog PDV-a.',true,'POV',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT (sifra) DO NOTHING;
