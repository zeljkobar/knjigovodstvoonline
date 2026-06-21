ALTER TABLE "kuf_books"
ADD COLUMN "vrsta" TEXT NOT NULL DEFAULT 'VIRMANI';

ALTER TABLE "firma_podrazumijevana_konta"
ADD COLUMN "dokument_tip" TEXT NOT NULL DEFAULT 'GENERAL',
ADD COLUMN "podvrsta" TEXT NOT NULL DEFAULT 'GENERAL',
ADD COLUMN "pdv_stopa_sifra" TEXT NOT NULL DEFAULT 'GENERAL';

ALTER TABLE "firma_podrazumijevana_konta"
DROP CONSTRAINT IF EXISTS "firma_podrazumijevana_konta_firma_id_namjena_key";

CREATE UNIQUE INDEX "firma_podrazumijevana_konta_firma_id_namjena_dokument_tip_podvrsta_pdv_stopa_sifra_key"
ON "firma_podrazumijevana_konta"("firma_id", "namjena", "dokument_tip", "podvrsta", "pdv_stopa_sifra");
