ALTER TABLE "firma_konta" ADD COLUMN "override_type" TEXT NOT NULL DEFAULT 'CUSTOM';
ALTER TABLE "firma_konta" ADD COLUMN "napomena" TEXT;

CREATE TABLE "firma_podrazumijevana_konta" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firma_id" UUID NOT NULL,
    "namjena" TEXT NOT NULL,
    "sifra_konta" TEXT NOT NULL,
    "napomena" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "firma_podrazumijevana_konta_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "firma_podrazumijevana_konta_firma_id_namjena_key" ON "firma_podrazumijevana_konta"("firma_id", "namjena");

ALTER TABLE "firma_podrazumijevana_konta" ADD CONSTRAINT "firma_podrazumijevana_konta_firma_id_fkey" FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "konta" ("sifra", "naziv", "klasa", "tip_konta", "analitika_obavezna", "sinteticki_konto", "aktivan", "created_at", "updated_at")
VALUES
  ('0000', 'Osnovni kapital', '0', 'analiticko', false, null, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('0100', 'Nematerijalna ulaganja', '0', 'analiticko', false, null, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('0200', 'Nekretnine, postrojenja i oprema', '0', 'analiticko', false, null, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('1010', 'Zalihe robe', '1', 'analiticko', false, null, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('2020', 'Kupci u zemlji', '2', 'analiticko', true, null, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('2030', 'Kupci u inostranstvu', '2', 'analiticko', true, null, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('2700', 'Ulazni PDV', '2', 'analiticko', false, null, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('2710', 'Ulazni PDV po uvozu', '2', 'analiticko', false, null, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('4300', 'Dobavljaci u zemlji', '4', 'analiticko', true, null, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('4310', 'Dobavljaci u inostranstvu', '4', 'analiticko', true, null, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('4700', 'Obaveze za PDV', '4', 'analiticko', false, null, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5100', 'Nabavna vrijednost prodate robe', '5', 'analiticko', false, null, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5200', 'Troskovi materijala', '5', 'analiticko', false, null, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5300', 'Blagajna', '5', 'analiticko', false, null, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5350', 'Ziro racun', '5', 'analiticko', false, null, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5500', 'Troskovi zarada', '5', 'analiticko', false, null, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('5590', 'Ostali poslovni rashodi', '5', 'analiticko', false, null, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('6020', 'Prihodi od prodaje robe', '6', 'analiticko', false, null, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('6040', 'Prihodi od prodaje usluga', '6', 'analiticko', false, null, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('6400', 'Ostali poslovni prihodi', '6', 'analiticko', false, null, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("sifra") DO NOTHING;
