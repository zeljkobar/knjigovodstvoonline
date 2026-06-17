CREATE TABLE "firma_bankovni_racuni" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agencija_id" UUID NOT NULL,
    "firma_id" UUID NOT NULL,
    "naziv_banke" TEXT NOT NULL,
    "broj_racuna" TEXT NOT NULL,
    "valuta" TEXT NOT NULL DEFAULT 'EUR',
    "glavni" BOOLEAN NOT NULL DEFAULT false,
    "aktivan" BOOLEAN NOT NULL DEFAULT true,
    "napomena" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "firma_bankovni_racuni_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "firma_ugovori" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agencija_id" UUID NOT NULL,
    "firma_id" UUID NOT NULL,
    "datum_pocetka" DATE,
    "datum_prestanka" DATE,
    "mjesecna_cijena" DECIMAL(14,2),
    "valuta" TEXT NOT NULL DEFAULT 'EUR',
    "rok_placanja_dana" INTEGER,
    "dan_fakturisanja" INTEGER,
    "paket" TEXT,
    "dodatne_usluge" TEXT,
    "dugovanje" DECIMAL(14,2),
    "blokiran_zbog_duga" BOOLEAN NOT NULL DEFAULT false,
    "automatsko_fakturisanje" BOOLEAN NOT NULL DEFAULT false,
    "faktura_kao_nacrt" BOOLEAN NOT NULL DEFAULT true,
    "napomena" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "firma_ugovori_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "firma_bankovni_racuni_firma_id_broj_racuna_key" ON "firma_bankovni_racuni"("firma_id", "broj_racuna");
CREATE INDEX "firma_bankovni_racuni_agencija_id_firma_id_idx" ON "firma_bankovni_racuni"("agencija_id", "firma_id");
CREATE UNIQUE INDEX "firma_ugovori_firma_id_key" ON "firma_ugovori"("firma_id");
CREATE INDEX "firma_ugovori_agencija_id_firma_id_idx" ON "firma_ugovori"("agencija_id", "firma_id");

ALTER TABLE "firma_bankovni_racuni" ADD CONSTRAINT "firma_bankovni_racuni_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "firma_ugovori" ADD CONSTRAINT "firma_ugovori_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
