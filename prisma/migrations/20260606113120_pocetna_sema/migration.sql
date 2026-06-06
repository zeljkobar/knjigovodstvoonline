-- CreateEnum
CREATE TYPE "Rola" AS ENUM ('admin', 'agencija', 'klijent');

-- CreateEnum
CREATE TYPE "TipKomitenta" AS ENUM ('kupac', 'dobavljac', 'kupac_dobavljac', 'radnik', 'ostalo');

-- CreateEnum
CREATE TYPE "TipKonta" AS ENUM ('analiticko', 'sinteticko');

-- CreateTable
CREATE TABLE "agencije" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "naziv" TEXT NOT NULL,
    "pib" TEXT,
    "adresa" TEXT,
    "grad" TEXT,
    "telefon" TEXT,
    "email" TEXT,
    "aktivan" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agencije_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "korisnici" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "korisnicko_ime" TEXT NOT NULL,
    "lozinka_hash" TEXT NOT NULL,
    "rola" "Rola" NOT NULL,
    "agencija_id" UUID,
    "aktivan" BOOLEAN NOT NULL DEFAULT true,
    "zadnja_prijava_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "korisnici_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firme" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agencija_id" UUID NOT NULL,
    "naziv" TEXT NOT NULL,
    "pib" TEXT,
    "maticni_broj" TEXT,
    "pdv_broj" TEXT,
    "adresa" TEXT,
    "grad" TEXT,
    "drzava" TEXT DEFAULT 'Crna Gora',
    "telefon" TEXT,
    "email" TEXT,
    "aktivan" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "firme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "korisnik_firma" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "korisnik_id" UUID NOT NULL,
    "firma_id" UUID NOT NULL,
    "moze_da_gleda" BOOLEAN NOT NULL DEFAULT true,
    "moze_da_unosi" BOOLEAN NOT NULL DEFAULT false,
    "moze_da_mijenja" BOOLEAN NOT NULL DEFAULT false,
    "moze_da_brise" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "korisnik_firma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poslovne_godine" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firma_id" UUID NOT NULL,
    "godina" INTEGER NOT NULL,
    "datum_od" DATE NOT NULL,
    "datum_do" DATE NOT NULL,
    "zakljucena" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "poslovne_godine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "komitenti" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "naziv" TEXT NOT NULL,
    "pib" TEXT,
    "maticni_broj" TEXT,
    "pdv_broj" TEXT,
    "adresa" TEXT,
    "grad" TEXT,
    "drzava" TEXT DEFAULT 'Crna Gora',
    "telefon" TEXT,
    "email" TEXT,
    "web_sajt" TEXT,
    "aktivan" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "komitenti_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firma_komitent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firma_id" UUID NOT NULL,
    "komitent_id" UUID NOT NULL,
    "tip_komitenta" "TipKomitenta" NOT NULL,
    "sifra_u_firmi" TEXT,
    "napomena" TEXT,
    "aktivan" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "firma_komitent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "konta" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sifra" TEXT NOT NULL,
    "naziv" TEXT NOT NULL,
    "klasa" TEXT,
    "tip_konta" "TipKonta" NOT NULL,
    "analitika_obavezna" BOOLEAN NOT NULL DEFAULT false,
    "sinteticki_konto" TEXT,
    "aktivan" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "konta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agencija_konta" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agencija_id" UUID NOT NULL,
    "konto_id" UUID,
    "sifra" TEXT NOT NULL,
    "naziv" TEXT NOT NULL,
    "tip_konta" "TipKonta" NOT NULL,
    "analitika_obavezna" BOOLEAN NOT NULL DEFAULT false,
    "sinteticki_konto" TEXT,
    "aktivan" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agencija_konta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firma_konta" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firma_id" UUID NOT NULL,
    "konto_id" UUID,
    "agencija_konto_id" UUID,
    "sifra" TEXT NOT NULL,
    "naziv" TEXT NOT NULL,
    "tip_konta" "TipKonta" NOT NULL,
    "analitika_obavezna" BOOLEAN NOT NULL DEFAULT false,
    "sinteticki_konto" TEXT,
    "aktivan" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "firma_konta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vrste_naloga" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sifra" TEXT NOT NULL,
    "naziv" TEXT NOT NULL,
    "opis" TEXT,
    "aktivan" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "vrste_naloga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nalozi" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firma_id" UUID NOT NULL,
    "poslovna_godina_id" UUID NOT NULL,
    "vrsta_naloga_id" UUID NOT NULL,
    "broj" INTEGER NOT NULL,
    "datum" DATE NOT NULL,
    "opis" TEXT,
    "izvorni_dokument_id" UUID,
    "kreirao_korisnik_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nalozi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stavke_naloga" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nalog_id" UUID NOT NULL,
    "konto_id" UUID NOT NULL,
    "komitent_id" UUID,
    "duguje" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "potrazuje" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "opis" TEXT,
    "dodatni_opis" TEXT,
    "broj_dokumenta" TEXT,
    "datum_dokumenta" DATE,
    "datum_valute" DATE,
    "redni_broj" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stavke_naloga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "korisnik_id" UUID,
    "agencija_id" UUID,
    "firma_id" UUID,
    "akcija" TEXT NOT NULL,
    "tip_entiteta" TEXT NOT NULL,
    "entitet_id" UUID,
    "stara_vrijednost" JSONB,
    "nova_vrijednost" JSONB,
    "ip_adresa" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agencije_pib_key" ON "agencije"("pib");

-- CreateIndex
CREATE UNIQUE INDEX "korisnici_korisnicko_ime_key" ON "korisnici"("korisnicko_ime");

-- CreateIndex
CREATE UNIQUE INDEX "korisnik_firma_korisnik_id_firma_id_key" ON "korisnik_firma"("korisnik_id", "firma_id");

-- CreateIndex
CREATE UNIQUE INDEX "poslovne_godine_firma_id_godina_key" ON "poslovne_godine"("firma_id", "godina");

-- CreateIndex
CREATE UNIQUE INDEX "komitenti_pib_key" ON "komitenti"("pib");

-- CreateIndex
CREATE UNIQUE INDEX "firma_komitent_firma_id_komitent_id_key" ON "firma_komitent"("firma_id", "komitent_id");

-- CreateIndex
CREATE UNIQUE INDEX "konta_sifra_key" ON "konta"("sifra");

-- CreateIndex
CREATE UNIQUE INDEX "agencija_konta_agencija_id_sifra_key" ON "agencija_konta"("agencija_id", "sifra");

-- CreateIndex
CREATE UNIQUE INDEX "firma_konta_firma_id_sifra_key" ON "firma_konta"("firma_id", "sifra");

-- CreateIndex
CREATE UNIQUE INDEX "vrste_naloga_sifra_key" ON "vrste_naloga"("sifra");

-- CreateIndex
CREATE UNIQUE INDEX "nalozi_firma_id_poslovna_godina_id_broj_key" ON "nalozi"("firma_id", "poslovna_godina_id", "broj");

-- AddForeignKey
ALTER TABLE "korisnici" ADD CONSTRAINT "korisnici_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firme" ADD CONSTRAINT "firme_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "korisnik_firma" ADD CONSTRAINT "korisnik_firma_korisnik_id_fkey" FOREIGN KEY ("korisnik_id") REFERENCES "korisnici"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "korisnik_firma" ADD CONSTRAINT "korisnik_firma_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poslovne_godine" ADD CONSTRAINT "poslovne_godine_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firma_komitent" ADD CONSTRAINT "firma_komitent_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firma_komitent" ADD CONSTRAINT "firma_komitent_komitent_id_fkey" FOREIGN KEY ("komitent_id") REFERENCES "komitenti"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agencija_konta" ADD CONSTRAINT "agencija_konta_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agencija_konta" ADD CONSTRAINT "agencija_konta_konto_id_fkey" FOREIGN KEY ("konto_id") REFERENCES "konta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firma_konta" ADD CONSTRAINT "firma_konta_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firma_konta" ADD CONSTRAINT "firma_konta_konto_id_fkey" FOREIGN KEY ("konto_id") REFERENCES "konta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firma_konta" ADD CONSTRAINT "firma_konta_agencija_konto_id_fkey" FOREIGN KEY ("agencija_konto_id") REFERENCES "agencija_konta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nalozi" ADD CONSTRAINT "nalozi_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nalozi" ADD CONSTRAINT "nalozi_poslovna_godina_id_fkey" FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nalozi" ADD CONSTRAINT "nalozi_vrsta_naloga_id_fkey" FOREIGN KEY ("vrsta_naloga_id") REFERENCES "vrste_naloga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nalozi" ADD CONSTRAINT "nalozi_kreirao_korisnik_id_fkey" FOREIGN KEY ("kreirao_korisnik_id") REFERENCES "korisnici"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stavke_naloga" ADD CONSTRAINT "stavke_naloga_nalog_id_fkey" FOREIGN KEY ("nalog_id") REFERENCES "nalozi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stavke_naloga" ADD CONSTRAINT "stavke_naloga_konto_id_fkey" FOREIGN KEY ("konto_id") REFERENCES "firma_konta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stavke_naloga" ADD CONSTRAINT "stavke_naloga_komitent_id_fkey" FOREIGN KEY ("komitent_id") REFERENCES "komitenti"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_korisnik_id_fkey" FOREIGN KEY ("korisnik_id") REFERENCES "korisnici"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_agencija_id_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE SET NULL ON UPDATE CASCADE;
