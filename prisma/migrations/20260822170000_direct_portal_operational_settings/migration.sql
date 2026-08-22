ALTER TABLE "pos_podesavanja"
  ADD COLUMN "format_stampe" TEXT NOT NULL DEFAULT '58',
  ADD COLUMN "podrazumijevani_rok_dana" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "podrazumijevana_kasa_id" UUID;

CREATE UNIQUE INDEX "pos_podesavanja_podrazumijevana_kasa_id_key"
  ON "pos_podesavanja"("podrazumijevana_kasa_id");

ALTER TABLE "pos_podesavanja"
  ADD CONSTRAINT "pos_podesavanja_podrazumijevana_kasa_id_fkey"
  FOREIGN KEY ("podrazumijevana_kasa_id") REFERENCES "pos_registers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
