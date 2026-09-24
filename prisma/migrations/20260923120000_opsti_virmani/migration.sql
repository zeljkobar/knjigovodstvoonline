CREATE TABLE "virmani" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agencija_id" UUID NOT NULL,
    "firma_id" UUID NOT NULL,
    "poslovna_godina_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "naziv_sablona" TEXT,
    "nalogodavac_naziv" TEXT NOT NULL,
    "nalogodavac_mjesto" TEXT,
    "nalogodavac_racun" TEXT,
    "svrha_placanja" TEXT NOT NULL,
    "primalac_naziv" TEXT NOT NULL,
    "primalac_mjesto" TEXT,
    "primalac_racun" TEXT,
    "iznos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sifra_placanja" TEXT,
    "model_zaduzenja" TEXT,
    "poziv_na_broj_zaduzenja" TEXT,
    "model_odobrenja" TEXT,
    "poziv_na_broj_odobrenja" TEXT,
    "datum_valute" DATE,
    "odstampan_at" TIMESTAMP(3),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "virmani_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "virmani_agencija_id_firma_id_poslovna_godina_id_status_is_deleted_idx"
ON "virmani"("agencija_id", "firma_id", "poslovna_godina_id", "status", "is_deleted");

CREATE INDEX "virmani_firma_id_datum_valute_idx"
ON "virmani"("firma_id", "datum_valute");

ALTER TABLE "virmani"
ADD CONSTRAINT "virmani_agencija_id_fkey"
FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "virmani"
ADD CONSTRAINT "virmani_firma_id_fkey"
FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "virmani"
ADD CONSTRAINT "virmani_poslovna_godina_id_fkey"
FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
