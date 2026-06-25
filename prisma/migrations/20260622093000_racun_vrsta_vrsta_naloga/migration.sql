ALTER TABLE "racun_vrste"
ADD COLUMN "vrsta_naloga_id" UUID;

CREATE INDEX "racun_vrste_vrsta_naloga_id_idx"
ON "racun_vrste"("vrsta_naloga_id");

ALTER TABLE "racun_vrste"
ADD CONSTRAINT "racun_vrste_vrsta_naloga_id_fkey"
FOREIGN KEY ("vrsta_naloga_id") REFERENCES "vrste_naloga"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
