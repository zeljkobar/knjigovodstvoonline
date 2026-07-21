WITH latest_rules AS (
  SELECT DISTINCT ON (o."id")
    o."id" AS "osnova_id",
    o."sifra",
    o."naziv",
    o."kategorija" AS "osnova_kategorija",
    p."id" AS "pravilo_id"
  FROM "plate_osnove_obracuna" o
  LEFT JOIN "plate_osnova_pravila" p ON p."osnova_id" = o."id" AND p."aktivan" = true
  WHERE o."aktivan" = true
  ORDER BY o."id", p."valid_from" DESC NULLS LAST, p."created_at" DESC NULLS LAST
),
mapped AS (
  SELECT
    lr.*,
    CASE
      WHEN lr."osnova_kategorija" = 'REDOVAN_RAD' THEN 'REDOVAN_RAD'
      WHEN lr."osnova_kategorija" = 'ZAKUP' THEN 'ZAKUP'
      WHEN lr."osnova_kategorija" = 'UGOVORI' THEN 'UGOVOR_O_DJELU'
      ELSE 'OSTALI_UGOVORI'
    END AS "kategorija",
    CASE
      WHEN lr."osnova_kategorija" = 'REDOVAN_RAD' THEN 'NET_WITHOUT_SENIORITY'
      ELSE 'NET_OTHER_INCOME'
    END AS "vrsta_sifra"
  FROM latest_rules lr
)
UPDATE "plate_ioppd_sifre" i
SET
  "naziv" = m."naziv",
  "opis" = 'Importovano iz šifarnika osnova obračuna.',
  "kategorija" = m."kategorija",
  "aktivan" = true,
  "updated_at" = CURRENT_TIMESTAMP
FROM mapped m
WHERE i."sifra" = m."sifra"
  AND i."aktivan" = true;

WITH latest_rules AS (
  SELECT DISTINCT ON (o."id")
    o."id" AS "osnova_id",
    o."sifra",
    o."naziv",
    o."kategorija" AS "osnova_kategorija",
    p."id" AS "pravilo_id"
  FROM "plate_osnove_obracuna" o
  LEFT JOIN "plate_osnova_pravila" p ON p."osnova_id" = o."id" AND p."aktivan" = true
  WHERE o."aktivan" = true
  ORDER BY o."id", p."valid_from" DESC NULLS LAST, p."created_at" DESC NULLS LAST
),
mapped AS (
  SELECT
    lr.*,
    CASE
      WHEN lr."osnova_kategorija" = 'REDOVAN_RAD' THEN 'REDOVAN_RAD'
      WHEN lr."osnova_kategorija" = 'ZAKUP' THEN 'ZAKUP'
      WHEN lr."osnova_kategorija" = 'UGOVORI' THEN 'UGOVOR_O_DJELU'
      ELSE 'OSTALI_UGOVORI'
    END AS "kategorija"
  FROM latest_rules lr
)
INSERT INTO "plate_ioppd_sifre" (
  "sifra",
  "naziv",
  "opis",
  "kategorija",
  "valid_from",
  "updated_at"
)
SELECT
  m."sifra",
  m."naziv",
  'Importovano iz šifarnika osnova obračuna.',
  m."kategorija",
  DATE '2025-01-01',
  CURRENT_TIMESTAMP
FROM mapped m
WHERE NOT EXISTS (
  SELECT 1
  FROM "plate_ioppd_sifre" existing
  WHERE existing."sifra" = m."sifra"
    AND existing."aktivan" = true
);

WITH latest_rules AS (
  SELECT DISTINCT ON (o."id")
    o."id" AS "osnova_id",
    o."sifra",
    o."naziv",
    o."kategorija" AS "osnova_kategorija",
    p."id" AS "pravilo_id"
  FROM "plate_osnove_obracuna" o
  LEFT JOIN "plate_osnova_pravila" p ON p."osnova_id" = o."id" AND p."aktivan" = true
  WHERE o."aktivan" = true
  ORDER BY o."id", p."valid_from" DESC NULLS LAST, p."created_at" DESC NULLS LAST
),
mapped AS (
  SELECT
    lr.*,
    CASE
      WHEN lr."osnova_kategorija" = 'REDOVAN_RAD' THEN 'REDOVAN_RAD'
      WHEN lr."osnova_kategorija" = 'ZAKUP' THEN 'ZAKUP'
      WHEN lr."osnova_kategorija" = 'UGOVORI' THEN 'UGOVOR_O_DJELU'
      ELSE 'OSTALI_UGOVORI'
    END AS "kategorija",
    CASE
      WHEN lr."osnova_kategorija" = 'REDOVAN_RAD' THEN 'NET_WITHOUT_SENIORITY'
      ELSE 'NET_OTHER_INCOME'
    END AS "vrsta_sifra"
  FROM latest_rules lr
),
flags AS (
  SELECT
    m.*,
    EXISTS (
      SELECT 1 FROM "plate_osnova_stope" s
      WHERE s."pravilo_id" = m."pravilo_id" AND s."aktivan" = true AND s."tip" = 'POREZ'
    ) AS "koristi_porez",
    EXISTS (
      SELECT 1 FROM "plate_osnova_stope" s
      WHERE s."pravilo_id" = m."pravilo_id" AND s."aktivan" = true AND s."tip" = 'PIO' AND s."teret" = 'ZAPOSLENI'
    ) AS "koristi_zaposleni_pio",
    EXISTS (
      SELECT 1 FROM "plate_osnova_stope" s
      WHERE s."pravilo_id" = m."pravilo_id" AND s."aktivan" = true AND s."tip" = 'RFZO' AND s."teret" = 'ZAPOSLENI'
    ) AS "koristi_zaposleni_zdravstvo",
    EXISTS (
      SELECT 1 FROM "plate_osnova_stope" s
      WHERE s."pravilo_id" = m."pravilo_id" AND s."aktivan" = true AND s."tip" = 'ZZZ' AND s."teret" = 'ZAPOSLENI'
    ) AS "koristi_zaposleni_nezaposleni",
    EXISTS (
      SELECT 1 FROM "plate_osnova_stope" s
      WHERE s."pravilo_id" = m."pravilo_id" AND s."aktivan" = true AND s."tip" = 'PIO' AND s."teret" = 'POSLODAVAC'
    ) AS "koristi_poslodavac_pio",
    EXISTS (
      SELECT 1 FROM "plate_osnova_stope" s
      WHERE s."pravilo_id" = m."pravilo_id" AND s."aktivan" = true AND s."tip" = 'RFZO' AND s."teret" = 'POSLODAVAC'
    ) AS "koristi_poslodavac_zdravstvo",
    EXISTS (
      SELECT 1 FROM "plate_osnova_stope" s
      WHERE s."pravilo_id" = m."pravilo_id" AND s."aktivan" = true AND s."tip" = 'ZZZ' AND s."teret" = 'POSLODAVAC'
    ) AS "koristi_poslodavac_nezaposleni",
    EXISTS (
      SELECT 1 FROM "plate_osnova_stope" s
      WHERE s."pravilo_id" = m."pravilo_id" AND s."aktivan" = true AND s."tip" = 'FOND_RADA'
    ) AS "koristi_fond_rada"
  FROM mapped m
)
UPDATE "plate_sifre_primanja" sp
SET
  "naziv" = f."naziv",
  "skraceni_naziv" = left(f."naziv", 120),
  "ioppd_sifra_id" = ioppd."id",
  "vrsta_obracuna_id" = vrsta."id",
  "osnova_obracuna_id" = f."osnova_id",
  "koristi_porez" = f."koristi_porez",
  "koristi_zaposleni_pio" = f."koristi_zaposleni_pio",
  "koristi_zaposleni_zdravstvo" = f."koristi_zaposleni_zdravstvo",
  "koristi_zaposleni_nezaposleni" = f."koristi_zaposleni_nezaposleni",
  "koristi_poslodavac_pio" = f."koristi_poslodavac_pio",
  "koristi_poslodavac_zdravstvo" = f."koristi_poslodavac_zdravstvo",
  "koristi_poslodavac_nezaposleni" = f."koristi_poslodavac_nezaposleni",
  "koristi_fond_rada" = f."koristi_fond_rada",
  "updated_at" = CURRENT_TIMESTAMP
FROM flags f
JOIN "plate_ioppd_sifre" ioppd ON ioppd."sifra" = f."sifra" AND ioppd."aktivan" = true
JOIN "plate_vrste_obracuna" vrsta ON vrsta."sifra" = f."vrsta_sifra"
WHERE sp."agencija_id" IS NULL
  AND sp."firma_id" IS NULL
  AND sp."sifra" = f."sifra"
  AND sp."kategorija" = f."kategorija"
  AND sp."aktivan" = true;

WITH latest_rules AS (
  SELECT DISTINCT ON (o."id")
    o."id" AS "osnova_id",
    o."sifra",
    o."naziv",
    o."kategorija" AS "osnova_kategorija",
    p."id" AS "pravilo_id"
  FROM "plate_osnove_obracuna" o
  LEFT JOIN "plate_osnova_pravila" p ON p."osnova_id" = o."id" AND p."aktivan" = true
  WHERE o."aktivan" = true
  ORDER BY o."id", p."valid_from" DESC NULLS LAST, p."created_at" DESC NULLS LAST
),
mapped AS (
  SELECT
    lr.*,
    CASE
      WHEN lr."osnova_kategorija" = 'REDOVAN_RAD' THEN 'REDOVAN_RAD'
      WHEN lr."osnova_kategorija" = 'ZAKUP' THEN 'ZAKUP'
      WHEN lr."osnova_kategorija" = 'UGOVORI' THEN 'UGOVOR_O_DJELU'
      ELSE 'OSTALI_UGOVORI'
    END AS "kategorija",
    CASE
      WHEN lr."osnova_kategorija" = 'REDOVAN_RAD' THEN 'NET_WITHOUT_SENIORITY'
      ELSE 'NET_OTHER_INCOME'
    END AS "vrsta_sifra"
  FROM latest_rules lr
),
flags AS (
  SELECT
    m.*,
    EXISTS (
      SELECT 1 FROM "plate_osnova_stope" s
      WHERE s."pravilo_id" = m."pravilo_id" AND s."aktivan" = true AND s."tip" = 'POREZ'
    ) AS "koristi_porez",
    EXISTS (
      SELECT 1 FROM "plate_osnova_stope" s
      WHERE s."pravilo_id" = m."pravilo_id" AND s."aktivan" = true AND s."tip" = 'PIO' AND s."teret" = 'ZAPOSLENI'
    ) AS "koristi_zaposleni_pio",
    EXISTS (
      SELECT 1 FROM "plate_osnova_stope" s
      WHERE s."pravilo_id" = m."pravilo_id" AND s."aktivan" = true AND s."tip" = 'RFZO' AND s."teret" = 'ZAPOSLENI'
    ) AS "koristi_zaposleni_zdravstvo",
    EXISTS (
      SELECT 1 FROM "plate_osnova_stope" s
      WHERE s."pravilo_id" = m."pravilo_id" AND s."aktivan" = true AND s."tip" = 'ZZZ' AND s."teret" = 'ZAPOSLENI'
    ) AS "koristi_zaposleni_nezaposleni",
    EXISTS (
      SELECT 1 FROM "plate_osnova_stope" s
      WHERE s."pravilo_id" = m."pravilo_id" AND s."aktivan" = true AND s."tip" = 'PIO' AND s."teret" = 'POSLODAVAC'
    ) AS "koristi_poslodavac_pio",
    EXISTS (
      SELECT 1 FROM "plate_osnova_stope" s
      WHERE s."pravilo_id" = m."pravilo_id" AND s."aktivan" = true AND s."tip" = 'RFZO' AND s."teret" = 'POSLODAVAC'
    ) AS "koristi_poslodavac_zdravstvo",
    EXISTS (
      SELECT 1 FROM "plate_osnova_stope" s
      WHERE s."pravilo_id" = m."pravilo_id" AND s."aktivan" = true AND s."tip" = 'ZZZ' AND s."teret" = 'POSLODAVAC'
    ) AS "koristi_poslodavac_nezaposleni",
    EXISTS (
      SELECT 1 FROM "plate_osnova_stope" s
      WHERE s."pravilo_id" = m."pravilo_id" AND s."aktivan" = true AND s."tip" = 'FOND_RADA'
    ) AS "koristi_fond_rada"
  FROM mapped m
)
INSERT INTO "plate_sifre_primanja" (
  "agencija_id",
  "firma_id",
  "sifra",
  "naziv",
  "skraceni_naziv",
  "ioppd_sifra_id",
  "vrsta_obracuna_id",
  "osnova_obracuna_id",
  "kategorija",
  "osnovica_tip",
  "koristi_porez",
  "koristi_zaposleni_pio",
  "koristi_zaposleni_zdravstvo",
  "koristi_zaposleni_nezaposleni",
  "koristi_poslodavac_pio",
  "koristi_poslodavac_zdravstvo",
  "koristi_poslodavac_nezaposleni",
  "koristi_fond_rada",
  "koristi_sindikat",
  "koristi_privredna_komora",
  "valid_from",
  "updated_at"
)
SELECT
  NULL,
  NULL,
  f."sifra",
  f."naziv",
  left(f."naziv", 120),
  ioppd."id",
  vrsta."id",
  f."osnova_id",
  f."kategorija",
  'NETO',
  f."koristi_porez",
  f."koristi_zaposleni_pio",
  f."koristi_zaposleni_zdravstvo",
  f."koristi_zaposleni_nezaposleni",
  f."koristi_poslodavac_pio",
  f."koristi_poslodavac_zdravstvo",
  f."koristi_poslodavac_nezaposleni",
  f."koristi_fond_rada",
  false,
  false,
  DATE '2025-01-01',
  CURRENT_TIMESTAMP
FROM flags f
JOIN "plate_ioppd_sifre" ioppd ON ioppd."sifra" = f."sifra" AND ioppd."aktivan" = true
JOIN "plate_vrste_obracuna" vrsta ON vrsta."sifra" = f."vrsta_sifra"
WHERE NOT EXISTS (
  SELECT 1
  FROM "plate_sifre_primanja" existing
  WHERE existing."agencija_id" IS NULL
    AND existing."firma_id" IS NULL
    AND existing."sifra" = f."sifra"
    AND existing."kategorija" = f."kategorija"
    AND existing."aktivan" = true
);
