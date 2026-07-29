CREATE TABLE "kalkulacije" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "poslovna_godina_id" UUID NOT NULL,
  "magacin_id" UUID NOT NULL,
  "dobavljac_id" UUID NOT NULL,
  "kuf_book_id" UUID,
  "kuf_entry_id" UUID,
  "konto_robe_sifra" TEXT,
  "nalog_id" UUID,
  "broj" INTEGER NOT NULL,
  "interni_broj" TEXT NOT NULL,
  "broj_racuna_dobavljaca" TEXT NOT NULL,
  "datum_racuna_dobavljaca" DATE NOT NULL,
  "datum_kalkulacije" DATE NOT NULL,
  "datum_valute" DATE,
  "tip" TEXT NOT NULL DEFAULT 'DOMESTIC',
  "tip_prodaje" TEXT NOT NULL DEFAULT 'WHOLESALE',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "valuta" TEXT NOT NULL DEFAULT 'EUR',
  "napomena" TEXT,
  "ukupno_fakturno_bez_pdv" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukupno_rabat" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukupno_neto_fakturno" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukupno_ulazni_pdv" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukupno_racun_sa_pdv" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukupno_zavisni_troskovi" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukupno_nabavna_vrijednost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukupno_prodajna_vrijednost_bez_pdv" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukupno_prodajna_vrijednost_sa_pdv" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukupno_razlika_u_cijeni" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukupno_ukalkulisani_pdv" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  "deleted_at" TIMESTAMP(3),
  "deleted_by" UUID,
  "delete_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID,
  "posted_at" TIMESTAMP(3),
  "posted_by" UUID,
  CONSTRAINT "kalkulacije_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "kalkulacije_tip_check" CHECK ("tip" IN ('DOMESTIC', 'IMPORT')),
  CONSTRAINT "kalkulacije_tip_prodaje_check" CHECK ("tip_prodaje" IN ('WHOLESALE', 'RETAIL')),
  CONSTRAINT "kalkulacije_status_check" CHECK ("status" IN ('DRAFT', 'POSTED', 'DELETED', 'NEEDS_REVIEW')),
  CONSTRAINT "kalkulacije_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id"),
  CONSTRAINT "kalkulacije_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id"),
  CONSTRAINT "kalkulacije_poslovna_godina_id_fkey" FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id"),
  CONSTRAINT "kalkulacije_magacin_id_fkey" FOREIGN KEY ("magacin_id") REFERENCES "magacini"("id"),
  CONSTRAINT "kalkulacije_dobavljac_id_fkey" FOREIGN KEY ("dobavljac_id") REFERENCES "komitenti"("id"),
  CONSTRAINT "kalkulacije_kuf_book_id_fkey" FOREIGN KEY ("kuf_book_id") REFERENCES "kuf_books"("id"),
  CONSTRAINT "kalkulacije_kuf_entry_id_fkey" FOREIGN KEY ("kuf_entry_id") REFERENCES "kuf_entries"("id"),
  CONSTRAINT "kalkulacije_nalog_id_fkey" FOREIGN KEY ("nalog_id") REFERENCES "nalozi"("id")
);

CREATE UNIQUE INDEX "kalkulacije_firma_id_poslovna_godina_id_broj_key"
  ON "kalkulacije"("firma_id", "poslovna_godina_id", "broj");
CREATE UNIQUE INDEX "kalkulacije_firma_id_poslovna_godina_id_interni_broj_key"
  ON "kalkulacije"("firma_id", "poslovna_godina_id", "interni_broj");
CREATE UNIQUE INDEX "kalkulacije_nalog_id_key" ON "kalkulacije"("nalog_id");
CREATE INDEX "kalkulacije_scope_status_idx"
  ON "kalkulacije"("agencija_id", "firma_id", "poslovna_godina_id", "status", "is_deleted");
CREATE INDEX "kalkulacije_magacin_datum_idx" ON "kalkulacije"("magacin_id", "datum_kalkulacije");
CREATE INDEX "kalkulacije_dobavljac_racun_idx"
  ON "kalkulacije"("dobavljac_id", "broj_racuna_dobavljaca");

CREATE TABLE "stavke_kalkulacije" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "kalkulacija_id" UUID NOT NULL,
  "redni_broj" INTEGER NOT NULL,
  "artikal_id" UUID NOT NULL,
  "kolicina" DECIMAL(18,3) NOT NULL,
  "fakturna_cijena" DECIMAL(14,4) NOT NULL,
  "fakturna_vrijednost" DECIMAL(14,2) NOT NULL,
  "rabat_procenat" DECIMAL(7,4) NOT NULL DEFAULT 0,
  "rabat_iznos" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "neto_fakturna_cijena" DECIMAL(14,4) NOT NULL,
  "neto_fakturna_vrijednost" DECIMAL(14,2) NOT NULL,
  "zavisni_trosak" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "nabavna_vrijednost" DECIMAL(14,2) NOT NULL,
  "jedinicna_nabavna_cijena" DECIMAL(14,4) NOT NULL,
  "ulazni_pdv_stopa" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "ulazni_pdv_iznos" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "marza_procenat" DECIMAL(7,4) NOT NULL DEFAULT 0,
  "marza_iznos" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "prodajna_cijena_bez_pdv" DECIMAL(14,4) NOT NULL,
  "prodajna_cijena_sa_pdv" DECIMAL(14,4) NOT NULL,
  "prodajna_vrijednost_bez_pdv" DECIMAL(14,2) NOT NULL,
  "prodajna_vrijednost_sa_pdv" DECIMAL(14,2) NOT NULL,
  "ukalkulisani_pdv_iznos" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "razlika_u_cijeni" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ruc_procenat" DECIMAL(7,4) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID,
  CONSTRAINT "stavke_kalkulacije_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stavke_kalkulacije_kalkulacija_id_fkey"
    FOREIGN KEY ("kalkulacija_id") REFERENCES "kalkulacije"("id") ON DELETE CASCADE,
  CONSTRAINT "stavke_kalkulacije_artikal_id_fkey"
    FOREIGN KEY ("artikal_id") REFERENCES "artikli"("id")
);
CREATE UNIQUE INDEX "stavke_kalkulacije_kalkulacija_id_redni_broj_key"
  ON "stavke_kalkulacije"("kalkulacija_id", "redni_broj");
CREATE INDEX "stavke_kalkulacije_artikal_id_idx" ON "stavke_kalkulacije"("artikal_id");

CREATE TABLE "zavisni_troskovi_kalkulacije" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "kalkulacija_id" UUID NOT NULL,
  "vrsta" TEXT NOT NULL,
  "opis" TEXT,
  "iznos" DECIMAL(14,2) NOT NULL,
  "nacin_raspodjele" TEXT NOT NULL DEFAULT 'BY_VALUE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID,
  CONSTRAINT "zavisni_troskovi_kalkulacije_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "zavisni_troskovi_kalkulacije_nacin_check"
    CHECK ("nacin_raspodjele" IN ('BY_VALUE', 'MANUAL')),
  CONSTRAINT "zavisni_troskovi_kalkulacije_kalkulacija_id_fkey"
    FOREIGN KEY ("kalkulacija_id") REFERENCES "kalkulacije"("id") ON DELETE CASCADE
);
CREATE INDEX "zavisni_troskovi_kalkulacije_kalkulacija_id_idx"
  ON "zavisni_troskovi_kalkulacije"("kalkulacija_id");

CREATE TABLE "stanja_zaliha" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "poslovna_godina_id" UUID NOT NULL,
  "magacin_id" UUID NOT NULL,
  "artikal_id" UUID NOT NULL,
  "kolicina" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "prosjecna_nabavna_cijena" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "nabavna_vrijednost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "maloprodajna_vrijednost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "razlika_u_cijeni" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukalkulisani_pdv" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stanja_zaliha_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stanja_zaliha_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id"),
  CONSTRAINT "stanja_zaliha_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id"),
  CONSTRAINT "stanja_zaliha_poslovna_godina_id_fkey"
    FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id"),
  CONSTRAINT "stanja_zaliha_magacin_id_fkey" FOREIGN KEY ("magacin_id") REFERENCES "magacini"("id"),
  CONSTRAINT "stanja_zaliha_artikal_id_fkey" FOREIGN KEY ("artikal_id") REFERENCES "artikli"("id")
);
CREATE UNIQUE INDEX "stanja_zaliha_scope_artikal_key"
  ON "stanja_zaliha"("firma_id", "poslovna_godina_id", "magacin_id", "artikal_id");
CREATE INDEX "stanja_zaliha_scope_idx"
  ON "stanja_zaliha"("agencija_id", "firma_id", "poslovna_godina_id", "magacin_id");

CREATE TABLE "prometi_zaliha" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "poslovna_godina_id" UUID NOT NULL,
  "magacin_id" UUID NOT NULL,
  "artikal_id" UUID NOT NULL,
  "kalkulacija_id" UUID,
  "stavka_kalkulacije_id" UUID,
  "tip_dokumenta" TEXT NOT NULL,
  "dokument_id" UUID NOT NULL,
  "stavka_dokumenta_id" UUID,
  "datum_prometa" DATE NOT NULL,
  "smjer" TEXT NOT NULL,
  "kolicina" DECIMAL(18,3) NOT NULL,
  "jedinicna_nabavna_cijena" DECIMAL(14,4) NOT NULL,
  "nabavna_vrijednost" DECIMAL(14,2) NOT NULL,
  "prodajna_cijena_sa_pdv" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "prodajna_vrijednost" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "razlika_u_cijeni" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "ukalkulisani_pdv" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "prosjecna_cijena_nakon" DECIMAL(14,4) NOT NULL,
  "kolicina_nakon" DECIMAL(18,3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  CONSTRAINT "prometi_zaliha_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prometi_zaliha_smjer_check"
    CHECK ("smjer" IN ('IN', 'OUT', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT')),
  CONSTRAINT "prometi_zaliha_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id"),
  CONSTRAINT "prometi_zaliha_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id"),
  CONSTRAINT "prometi_zaliha_poslovna_godina_id_fkey"
    FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id"),
  CONSTRAINT "prometi_zaliha_magacin_id_fkey" FOREIGN KEY ("magacin_id") REFERENCES "magacini"("id"),
  CONSTRAINT "prometi_zaliha_artikal_id_fkey" FOREIGN KEY ("artikal_id") REFERENCES "artikli"("id"),
  CONSTRAINT "prometi_zaliha_kalkulacija_id_fkey"
    FOREIGN KEY ("kalkulacija_id") REFERENCES "kalkulacije"("id"),
  CONSTRAINT "prometi_zaliha_stavka_kalkulacije_id_fkey"
    FOREIGN KEY ("stavka_kalkulacije_id") REFERENCES "stavke_kalkulacije"("id")
);
CREATE UNIQUE INDEX "prometi_zaliha_dokument_stavka_key"
  ON "prometi_zaliha"("tip_dokumenta", "dokument_id", "stavka_dokumenta_id");
CREATE INDEX "prometi_zaliha_kartica_idx"
  ON "prometi_zaliha"("agencija_id", "firma_id", "poslovna_godina_id", "magacin_id", "artikal_id", "datum_prometa");
