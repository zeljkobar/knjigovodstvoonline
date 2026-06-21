CREATE TABLE "pdv_stope" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agencija_id" UUID NOT NULL,
    "sifra" TEXT NOT NULL,
    "naziv" TEXT NOT NULL,
    "procenat" DECIMAL(5,2) NOT NULL,
    "opis" TEXT,
    "redosljed" INTEGER NOT NULL DEFAULT 0,
    "aktivna" BOOLEAN NOT NULL DEFAULT true,
    "vazi_od" DATE,
    "vazi_do" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "pdv_stope_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pdv_stope_agencija_id_sifra_key" ON "pdv_stope"("agencija_id", "sifra");
CREATE INDEX "pdv_stope_agencija_id_aktivna_redosljed_idx" ON "pdv_stope"("agencija_id", "aktivna", "redosljed");

ALTER TABLE "pdv_stope"
ADD CONSTRAINT "pdv_stope_agencija_id_fkey"
FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "pdv_stope" ("agencija_id", "sifra", "naziv", "procenat", "opis", "redosljed", "aktivna")
SELECT "id", 'PDV_21', 'Opsta stopa 21%', 21.00, 'Promet po stopi 21%', 10, true
FROM "agencije"
ON CONFLICT ("agencija_id", "sifra") DO NOTHING;

INSERT INTO "pdv_stope" ("agencija_id", "sifra", "naziv", "procenat", "opis", "redosljed", "aktivna")
SELECT "id", 'PDV_15', 'Snizena stopa 15%', 15.00, 'Promet po stopi 15%', 20, true
FROM "agencije"
ON CONFLICT ("agencija_id", "sifra") DO NOTHING;

INSERT INTO "pdv_stope" ("agencija_id", "sifra", "naziv", "procenat", "opis", "redosljed", "aktivna")
SELECT "id", 'PDV_7', 'Snizena stopa 7%', 7.00, 'Promet po stopi 7%', 30, true
FROM "agencije"
ON CONFLICT ("agencija_id", "sifra") DO NOTHING;

INSERT INTO "pdv_stope" ("agencija_id", "sifra", "naziv", "procenat", "opis", "redosljed", "aktivna")
SELECT "id", 'PDV_0', 'Nulta stopa', 0.00, 'Promet po stopi 0%', 40, true
FROM "agencije"
ON CONFLICT ("agencija_id", "sifra") DO NOTHING;
