CREATE TABLE "plate_osnove_obracuna" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sifra" text NOT NULL,
  "naziv" text NOT NULL,
  "opis" text,
  "kategorija" text,
  "source" text,
  "aktivan" boolean NOT NULL DEFAULT true,
  "valid_from" date NOT NULL,
  "valid_to" date,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" uuid,
  "updated_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" uuid
);

CREATE UNIQUE INDEX "plate_osnove_obracuna_sifra_valid_from_key"
  ON "plate_osnove_obracuna" ("sifra", "valid_from");

CREATE INDEX "plate_osnove_obracuna_sifra_aktivan_idx"
  ON "plate_osnove_obracuna" ("sifra", "aktivan");

CREATE TABLE "plate_osnova_pravila" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "osnova_id" uuid NOT NULL,
  "valid_from" date NOT NULL,
  "valid_to" date,
  "osnovica_pio_tip" text,
  "osnovica_pio_proc" decimal(8,2) NOT NULL DEFAULT 100,
  "pio_min_tip" text,
  "pio_max_tip" text,
  "pio_rok" text,
  "osnovica_rfzo_tip" text,
  "osnovica_rfzo_proc" decimal(8,2) NOT NULL DEFAULT 100,
  "rfzo_min_tip" text,
  "rfzo_max_tip" text,
  "rfzo_rok" text,
  "osnovica_zzz_tip" text,
  "osnovica_zzz_proc" decimal(8,2) NOT NULL DEFAULT 100,
  "zzz_min_tip" text,
  "zzz_max_tip" text,
  "zzz_rok" text,
  "osnovica_porez_tip" text,
  "osnovica_porez_proc" decimal(8,2) NOT NULL DEFAULT 100,
  "porez_min_tip" text,
  "porez_max_tip" text,
  "porez_rok" text,
  "napomena" text,
  "aktivan" boolean NOT NULL DEFAULT true,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" uuid,
  "updated_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" uuid,
  CONSTRAINT "plate_osnova_pravila_osnova_id_fkey"
    FOREIGN KEY ("osnova_id") REFERENCES "plate_osnove_obracuna" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "plate_osnova_pravila_osnova_id_aktivan_valid_from_idx"
  ON "plate_osnova_pravila" ("osnova_id", "aktivan", "valid_from");

CREATE TABLE "plate_osnova_stope" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "pravilo_id" uuid NOT NULL,
  "tip" text NOT NULL,
  "teret" text NOT NULL DEFAULT 'POREZ',
  "stopa" decimal(8,6) NOT NULL,
  "osnovica_tip" text,
  "aktivan" boolean NOT NULL DEFAULT true,
  "valid_from" date NOT NULL,
  "valid_to" date,
  "napomena" text,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" uuid,
  "updated_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" uuid,
  CONSTRAINT "plate_osnova_stope_pravilo_id_fkey"
    FOREIGN KEY ("pravilo_id") REFERENCES "plate_osnova_pravila" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "plate_osnova_stope_pravilo_id_tip_aktivan_idx"
  ON "plate_osnova_stope" ("pravilo_id", "tip", "aktivan");

ALTER TABLE "plate_sifre_primanja"
  ADD COLUMN "osnova_obracuna_id" uuid;

ALTER TABLE "plate_sifre_primanja"
  ADD CONSTRAINT "plate_sifre_primanja_osnova_obracuna_id_fkey"
  FOREIGN KEY ("osnova_obracuna_id") REFERENCES "plate_osnove_obracuna" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "plate_sifre_primanja_osnova_obracuna_id_idx"
  ON "plate_sifre_primanja" ("osnova_obracuna_id");

INSERT INTO "plate_osnove_obracuna" (
  "sifra",
  "naziv",
  "opis",
  "kategorija",
  "source",
  "valid_from"
)
VALUES
  (
    '047',
    'Ugovorena naknada za lica osigurana po drugom osnovu',
    'Ugovor o djelu, autorski ugovor i dr. za lica prijavljena na obavezno socijalno osiguranje po drugom osnovu.',
    'UGOVORI',
    'zadaci/plate/specifikacija-osnova-za-obracun-oktobar-2024-novine-pio-i-od-01012025.xls',
    DATE '2022-01-01'
  ),
  (
    '065',
    'Prihod od imovine',
    'Prihod od imovine.',
    'ZAKUP',
    'zadaci/plate/specifikacija-osnova-za-obracun-oktobar-2024-novine-pio-i-od-01012025.xls',
    DATE '2022-01-01'
  )
ON CONFLICT ("sifra", "valid_from") DO NOTHING;

INSERT INTO "plate_osnova_pravila" (
  "osnova_id",
  "valid_from",
  "osnovica_porez_tip",
  "osnovica_porez_proc",
  "porez_rok",
  "napomena"
)
SELECT
  o."id",
  DATE '2022-01-01',
  'PROCENAT_BRUTO',
  70.00,
  CASE WHEN o."sifra" = '065' THEN 'Istovremeno sa isplatom naknade.' ELSE NULL END,
  CASE
    WHEN o."sifra" = '047' THEN 'Osnovica poreza je oporezivi dohodak: 70% od ugovorene bruto naknade. Doprinosi nijesu navedeni za ovu osnovu.'
    WHEN o."sifra" = '065' THEN 'Osnovica poreza je 70% od bruto prihoda. Doprinosi nijesu navedeni za ovu osnovu.'
  END
FROM "plate_osnove_obracuna" o
WHERE o."sifra" IN ('047', '065')
  AND NOT EXISTS (
    SELECT 1
    FROM "plate_osnova_pravila" p
    WHERE p."osnova_id" = o."id"
      AND p."valid_from" = DATE '2022-01-01'
  );

INSERT INTO "plate_osnova_stope" (
  "pravilo_id",
  "tip",
  "teret",
  "stopa",
  "osnovica_tip",
  "valid_from",
  "napomena"
)
SELECT
  p."id",
  'POREZ',
  'POREZ',
  0.150000,
  'OSNOVICA_POREZ',
  DATE '2022-01-01',
  'Stopa poreza 15% od 01.01.2022.'
FROM "plate_osnova_pravila" p
JOIN "plate_osnove_obracuna" o ON o."id" = p."osnova_id"
WHERE o."sifra" IN ('047', '065')
  AND NOT EXISTS (
    SELECT 1
    FROM "plate_osnova_stope" s
    WHERE s."pravilo_id" = p."id"
      AND s."tip" = 'POREZ'
      AND s."valid_from" = DATE '2022-01-01'
  );

UPDATE "plate_sifre_primanja" sp
SET "osnova_obracuna_id" = o."id"
FROM "plate_osnove_obracuna" o
WHERE sp."sifra" = o."sifra"
  AND o."sifra" IN ('047', '065')
  AND sp."osnova_obracuna_id" IS NULL;
