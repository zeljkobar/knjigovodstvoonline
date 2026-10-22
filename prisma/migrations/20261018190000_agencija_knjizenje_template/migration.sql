CREATE UNIQUE INDEX "firme_agencija_id_id_key" ON "firme"("agencija_id", "id");
CREATE TABLE "agencija_knjizenje_template" (
  "agencija_id" UUID PRIMARY KEY,
  "firma_id" UUID NOT NULL UNIQUE,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID,
  CONSTRAINT "agencija_knjizenje_template_agencija_fkey" FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE CASCADE,
  CONSTRAINT "agencija_knjizenje_template_firma_scope_fkey" FOREIGN KEY ("agencija_id", "firma_id") REFERENCES "firme"("agencija_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT
);
