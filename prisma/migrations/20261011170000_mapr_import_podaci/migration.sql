-- Technical snapshots of successful server-to-MAPR reads, never browser-supplied invoices.
CREATE TABLE "mapr_import_podaci" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(),
 "agencija_id" UUID NOT NULL,
 "firma_id" UUID NOT NULL,
 "poslovna_godina_id" UUID NOT NULL,
 "fiskalni_kljuc" TEXT NOT NULL,
 "verzija" INTEGER NOT NULL DEFAULT 1,
 "podaci" JSONB NOT NULL,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "created_by" UUID NOT NULL,
 CONSTRAINT "mapr_import_podaci_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "mapr_import_podaci_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "mapr_import_podaci_poslovna_godina_id_fkey" FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mapr_import_podaci_scope_kljuc_key" ON "mapr_import_podaci"("agencija_id", "firma_id", "poslovna_godina_id", "fiskalni_kljuc");
CREATE INDEX "mapr_import_podaci_firma_id_idx" ON "mapr_import_podaci"("firma_id");
