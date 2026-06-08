-- AlterTable
ALTER TABLE "firma_komitent" ADD COLUMN     "rok_placanja_dana" INTEGER;

-- CreateTable
CREATE TABLE "banke" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "naziv" TEXT NOT NULL,
    "sifra" TEXT,
    "swift" TEXT,
    "aktivan" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "banke_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "komitent_ziro_racuni" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "komitent_id" UUID NOT NULL,
    "banka_id" UUID,
    "broj_racuna" TEXT NOT NULL,
    "valuta" TEXT NOT NULL DEFAULT 'EUR',
    "glavni" BOOLEAN NOT NULL DEFAULT false,
    "aktivan" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "komitent_ziro_racuni_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "komitent_kontakti" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "komitent_id" UUID NOT NULL,
    "ime" TEXT,
    "prezime" TEXT,
    "naziv" TEXT,
    "pozicija" TEXT,
    "telefon" TEXT,
    "email" TEXT,
    "napomena" TEXT,
    "glavni" BOOLEAN NOT NULL DEFAULT false,
    "aktivan" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "komitent_kontakti_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "banke_sifra_key" ON "banke"("sifra");

-- CreateIndex
CREATE UNIQUE INDEX "komitent_ziro_racuni_komitent_id_broj_racuna_key" ON "komitent_ziro_racuni"("komitent_id", "broj_racuna");

-- AddForeignKey
ALTER TABLE "komitent_ziro_racuni" ADD CONSTRAINT "komitent_ziro_racuni_komitent_id_fkey" FOREIGN KEY ("komitent_id") REFERENCES "komitenti"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "komitent_ziro_racuni" ADD CONSTRAINT "komitent_ziro_racuni_banka_id_fkey" FOREIGN KEY ("banka_id") REFERENCES "banke"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "komitent_kontakti" ADD CONSTRAINT "komitent_kontakti_komitent_id_fkey" FOREIGN KEY ("komitent_id") REFERENCES "komitenti"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
