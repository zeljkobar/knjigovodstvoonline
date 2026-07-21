-- Sifra 001 (Zarada) mora imati PIO na teret zaposlenog od 10%.
-- Full import osnova je preskocio tekstualnu stopu iz zvanicnog dokumenta
-- ("od 01.10.2024 stopa je 10%"), pa je flag na sifri primanja bio iskljucen.

WITH latest_rule AS (
  SELECT DISTINCT ON (o."sifra")
    p."id" AS "pravilo_id"
  FROM "plate_osnove_obracuna" o
  JOIN "plate_osnova_pravila" p ON p."osnova_id" = o."id"
  WHERE o."sifra" = '001'
    AND o."aktivan" = true
    AND p."aktivan" = true
  ORDER BY o."sifra", p."valid_from" DESC, p."created_at" DESC
)
DELETE FROM "plate_osnova_stope" s
USING latest_rule lr
WHERE s."pravilo_id" = lr."pravilo_id"
  AND s."tip" = 'PIO'
  AND s."teret" = 'ZAPOSLENI';

WITH latest_rule AS (
  SELECT DISTINCT ON (o."sifra")
    p."id" AS "pravilo_id"
  FROM "plate_osnove_obracuna" o
  JOIN "plate_osnova_pravila" p ON p."osnova_id" = o."id"
  WHERE o."sifra" = '001'
    AND o."aktivan" = true
    AND p."aktivan" = true
  ORDER BY o."sifra", p."valid_from" DESC, p."created_at" DESC
)
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
  lr."pravilo_id",
  'PIO',
  'ZAPOSLENI',
  0.100000,
  'BRUTO',
  DATE '2025-01-01',
  'Sifra 001: od 01.10.2024 stopa PIO na teret zaposlenog je 10%.'
FROM latest_rule lr;

INSERT INTO "plate_doprinos_stope" (
  "sifra",
  "naziv",
  "payer_type",
  "stopa",
  "valid_from",
  "updated_at"
)
VALUES (
  'EMPLOYEE_PIO',
  'PIO doprinos zaposlenog',
  'EMPLOYEE',
  0.100000,
  DATE '2026-01-01',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("sifra", "valid_from")
DO UPDATE SET
  "stopa" = EXCLUDED."stopa",
  "aktivan" = true,
  "valid_to" = NULL,
  "updated_at" = CURRENT_TIMESTAMP;

UPDATE "plate_sifre_primanja"
SET
  "koristi_porez" = true,
  "koristi_zaposleni_pio" = true,
  "koristi_zaposleni_zdravstvo" = false,
  "koristi_zaposleni_nezaposleni" = true,
  "koristi_poslodavac_pio" = false,
  "koristi_poslodavac_zdravstvo" = false,
  "koristi_poslodavac_nezaposleni" = true,
  "koristi_fond_rada" = true,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "sifra" = '001'
  AND "kategorija" = 'REDOVAN_RAD'
  AND "aktivan" = true;
