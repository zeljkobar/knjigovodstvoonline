CREATE TABLE "os_kategorije" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agencija_id" UUID NOT NULL,
    "firma_id" UUID NOT NULL,
    "sifra" TEXT NOT NULL,
    "naziv" TEXT NOT NULL,
    "predlozeni_korisni_vijek_mjeseci" INTEGER,
    "konto_sredstva_id" UUID,
    "konto_ispravke_id" UUID,
    "konto_troska_id" UUID,
    "konto_neotpisane_vrijednosti_id" UUID,
    "aktivna" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,
    CONSTRAINT "os_kategorije_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "os_kategorije_vijek_check" CHECK ("predlozeni_korisni_vijek_mjeseci" IS NULL OR "predlozeni_korisni_vijek_mjeseci" > 0)
);

CREATE TABLE "osnovna_sredstva" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agencija_id" UUID NOT NULL,
    "firma_id" UUID NOT NULL,
    "inventarski_broj" TEXT NOT NULL,
    "naziv" TEXT NOT NULL,
    "opis" TEXT,
    "serijski_broj" TEXT,
    "kategorija_id" UUID,
    "vrsta_imovine" TEXT NOT NULL,
    "lokacija" TEXT,
    "zaduzena_osoba" TEXT,
    "poslovna_jedinica_id" UUID,
    "dobavljac_id" UUID,
    "broj_dokumenta" TEXT,
    "datum_nabavke" DATE,
    "datum_raspolozivosti" DATE,
    "datum_isknjizenja" DATE,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "verzija" INTEGER NOT NULL DEFAULT 1,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,
    CONSTRAINT "osnovna_sredstva_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "osnovna_sredstva_status_check" CHECK ("status" IN ('DRAFT', 'IN_PREPARATION', 'ACTIVE', 'DISPOSED')),
    CONSTRAINT "osnovna_sredstva_vrsta_check" CHECK ("vrsta_imovine" IN ('MATERIAL', 'INTANGIBLE', 'LAND', 'RIGHT_OF_USE', 'OTHER')),
    CONSTRAINT "osnovna_sredstva_datumi_check" CHECK ("datum_isknjizenja" IS NULL OR "datum_raspolozivosti" IS NULL OR "datum_isknjizenja" >= "datum_raspolozivosti")
);

CREATE TABLE "os_parametri" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agencija_id" UUID NOT NULL,
    "firma_id" UUID NOT NULL,
    "sredstvo_id" UUID NOT NULL,
    "vazi_od" DATE NOT NULL,
    "metoda" TEXT NOT NULL DEFAULT 'LINEAR',
    "korisni_vijek_mjeseci" INTEGER NOT NULL,
    "ostatak_vrijednosti" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "konto_sredstva_id" UUID,
    "konto_ispravke_id" UUID,
    "konto_troska_id" UUID,
    "komitent_id" UUID,
    "poslovna_jedinica_id" UUID,
    "poreski_tretman" TEXT NOT NULL DEFAULT 'UNSUPPORTED',
    "poreska_grupa" TEXT,
    "razlog_promjene" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,
    CONSTRAINT "os_parametri_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "os_parametri_vijek_check" CHECK ("korisni_vijek_mjeseci" > 0),
    CONSTRAINT "os_parametri_ostatak_check" CHECK ("ostatak_vrijednosti" >= 0),
    CONSTRAINT "os_parametri_metoda_check" CHECK ("metoda" IN ('LINEAR')),
    CONSTRAINT "os_parametri_poreski_tretman_check" CHECK ("poreski_tretman" IN ('GROUP_I', 'GROUP_POOL', 'ACCOUNTING_AMOUNT', 'EXEMPT', 'UNSUPPORTED'))
);

CREATE TABLE "os_promjene" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agencija_id" UUID NOT NULL,
    "firma_id" UUID NOT NULL,
    "poslovna_godina_id" UUID NOT NULL,
    "sredstvo_id" UUID NOT NULL,
    "datum" DATE NOT NULL,
    "vrsta" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "razlog" TEXT,
    "delta_nabavna_vrijednost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "delta_ispravka_vrijednosti" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "nabavna_vrijednost" DECIMAL(14,2),
    "akumulirana_amortizacija" DECIMAL(14,2),
    "ostatak_vrijednosti" DECIMAL(14,2),
    "preostali_vijek_mjeseci" INTEGER,
    "izvorni_nalog_id" UUID,
    "original_promjena_id" UUID,
    "snapshot" JSONB,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,
    CONSTRAINT "os_promjene_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "os_promjene_vrsta_check" CHECK ("vrsta" IN ('OPENING', 'ACQUISITION', 'ACTIVATION', 'CAPITAL_ADDITION', 'ESTIMATE_CHANGE', 'TRANSFER', 'SALE', 'WRITE_OFF', 'REVERSAL')),
    CONSTRAINT "os_promjene_status_check" CHECK ("status" IN ('DRAFT', 'CONFIRMED', 'REVERSED')),
    CONSTRAINT "os_promjene_stanja_check" CHECK (
      ("nabavna_vrijednost" IS NULL OR "nabavna_vrijednost" >= 0) AND
      ("akumulirana_amortizacija" IS NULL OR "akumulirana_amortizacija" >= 0) AND
      ("ostatak_vrijednosti" IS NULL OR "ostatak_vrijednosti" >= 0) AND
      ("preostali_vijek_mjeseci" IS NULL OR "preostali_vijek_mjeseci" > 0)
    )
);

CREATE UNIQUE INDEX "os_kategorije_firma_id_sifra_key" ON "os_kategorije"("firma_id", "sifra");
CREATE INDEX "os_kategorije_agencija_id_firma_id_aktivna_is_deleted_idx" ON "os_kategorije"("agencija_id", "firma_id", "aktivna", "is_deleted");
CREATE UNIQUE INDEX "osnovna_sredstva_firma_id_inventarski_broj_key" ON "osnovna_sredstva"("firma_id", "inventarski_broj");
CREATE INDEX "osnovna_sredstva_agencija_id_firma_id_status_is_deleted_idx" ON "osnovna_sredstva"("agencija_id", "firma_id", "status", "is_deleted");
CREATE INDEX "osnovna_sredstva_firma_id_kategorija_id_naziv_idx" ON "osnovna_sredstva"("firma_id", "kategorija_id", "naziv");
CREATE UNIQUE INDEX "os_parametri_sredstvo_id_vazi_od_key" ON "os_parametri"("sredstvo_id", "vazi_od");
CREATE INDEX "os_parametri_agencija_id_firma_id_vazi_od_idx" ON "os_parametri"("agencija_id", "firma_id", "vazi_od");
CREATE INDEX "os_promjene_agencija_id_firma_id_poslovna_godina_id_status_datum_idx" ON "os_promjene"("agencija_id", "firma_id", "poslovna_godina_id", "status", "datum");
CREATE INDEX "os_promjene_sredstvo_id_datum_status_is_deleted_idx" ON "os_promjene"("sredstvo_id", "datum", "status", "is_deleted");
CREATE UNIQUE INDEX "os_promjene_jedno_pocetno_stanje_idx" ON "os_promjene"("sredstvo_id") WHERE "vrsta" = 'OPENING' AND "status" = 'CONFIRMED' AND "is_deleted" = false;

ALTER TABLE "os_kategorije" ADD CONSTRAINT "os_kategorije_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "os_kategorije" ADD CONSTRAINT "os_kategorije_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "os_kategorije" ADD CONSTRAINT "os_kategorije_konto_sredstva_id_fkey" FOREIGN KEY ("konto_sredstva_id") REFERENCES "firma_konta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "os_kategorije" ADD CONSTRAINT "os_kategorije_konto_ispravke_id_fkey" FOREIGN KEY ("konto_ispravke_id") REFERENCES "firma_konta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "os_kategorije" ADD CONSTRAINT "os_kategorije_konto_troska_id_fkey" FOREIGN KEY ("konto_troska_id") REFERENCES "firma_konta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "os_kategorije" ADD CONSTRAINT "os_kategorije_konto_neotpisane_vrijednosti_id_fkey" FOREIGN KEY ("konto_neotpisane_vrijednosti_id") REFERENCES "firma_konta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "osnovna_sredstva" ADD CONSTRAINT "osnovna_sredstva_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "osnovna_sredstva" ADD CONSTRAINT "osnovna_sredstva_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "osnovna_sredstva" ADD CONSTRAINT "osnovna_sredstva_kategorija_id_fkey" FOREIGN KEY ("kategorija_id") REFERENCES "os_kategorije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "osnovna_sredstva" ADD CONSTRAINT "osnovna_sredstva_poslovna_jedinica_id_fkey" FOREIGN KEY ("poslovna_jedinica_id") REFERENCES "poslovne_jedinice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "osnovna_sredstva" ADD CONSTRAINT "osnovna_sredstva_dobavljac_id_fkey" FOREIGN KEY ("dobavljac_id") REFERENCES "komitenti"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "os_parametri" ADD CONSTRAINT "os_parametri_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "os_parametri" ADD CONSTRAINT "os_parametri_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "os_parametri" ADD CONSTRAINT "os_parametri_sredstvo_id_fkey" FOREIGN KEY ("sredstvo_id") REFERENCES "osnovna_sredstva"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "os_parametri" ADD CONSTRAINT "os_parametri_konto_sredstva_id_fkey" FOREIGN KEY ("konto_sredstva_id") REFERENCES "firma_konta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "os_parametri" ADD CONSTRAINT "os_parametri_konto_ispravke_id_fkey" FOREIGN KEY ("konto_ispravke_id") REFERENCES "firma_konta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "os_parametri" ADD CONSTRAINT "os_parametri_konto_troska_id_fkey" FOREIGN KEY ("konto_troska_id") REFERENCES "firma_konta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "os_parametri" ADD CONSTRAINT "os_parametri_komitent_id_fkey" FOREIGN KEY ("komitent_id") REFERENCES "komitenti"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "os_parametri" ADD CONSTRAINT "os_parametri_poslovna_jedinica_id_fkey" FOREIGN KEY ("poslovna_jedinica_id") REFERENCES "poslovne_jedinice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "os_promjene" ADD CONSTRAINT "os_promjene_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "os_promjene" ADD CONSTRAINT "os_promjene_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "os_promjene" ADD CONSTRAINT "os_promjene_poslovna_godina_id_fkey" FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "os_promjene" ADD CONSTRAINT "os_promjene_sredstvo_id_fkey" FOREIGN KEY ("sredstvo_id") REFERENCES "osnovna_sredstva"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "os_promjene" ADD CONSTRAINT "os_promjene_izvorni_nalog_id_fkey" FOREIGN KEY ("izvorni_nalog_id") REFERENCES "nalozi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "os_promjene" ADD CONSTRAINT "os_promjene_original_promjena_id_fkey" FOREIGN KEY ("original_promjena_id") REFERENCES "os_promjene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;