-- Uskladi postojeće direktne fiskalne vlasnike sa portal paketom prava.
-- Migracija je idempotentna: postojeće eksplicitne redove ažurira na dozvoljeno.

UPDATE "korisnik_firma" AS kf
SET
  "moze_da_gleda" = true,
  "moze_da_unosi" = true,
  "moze_da_mijenja" = true,
  "updated_at" = CURRENT_TIMESTAMP
FROM "korisnici" AS k
JOIN "agencije" AS a ON a."id" = k."agencija_id"
WHERE kf."korisnik_id" = k."id"
  AND a."is_fiscal_direct_container" = true
  AND a."aktivan" = true
  AND a."is_deleted" = false
  AND k."aktivan" = true
  AND k."is_deleted" = false
  AND kf."access_type" = 'FISCAL_CLIENT'
  AND kf."is_deleted" = false;

INSERT INTO "korisnik_prava" (
  "id",
  "agencija_id",
  "korisnik_id",
  "firma_id",
  "modul",
  "akcija",
  "dozvoljeno",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  k."agencija_id",
  k."id",
  kf."firma_id",
  permission."modul",
  permission."akcija",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "korisnik_firma" AS kf
JOIN "korisnici" AS k ON k."id" = kf."korisnik_id"
JOIN "agencije" AS a ON a."id" = k."agencija_id"
CROSS JOIN (
  VALUES
    ('fiskalizacija', 'view'),
    ('fiskalizacija', 'create'),
    ('fiskalizacija', 'post'),
    ('fiskalizacija', 'cancel'),
    ('pos', 'view'),
    ('pos', 'create'),
    ('pos', 'cancel'),
    ('pos', 'export'),
    ('pos', 'manage'),
    ('robno', 'view'),
    ('robno', 'create'),
    ('robno', 'update'),
    ('robno', 'manage'),
    ('izvjestaji', 'view'),
    ('izvjestaji', 'export')
) AS permission("modul", "akcija")
WHERE a."is_fiscal_direct_container" = true
  AND a."aktivan" = true
  AND a."is_deleted" = false
  AND k."aktivan" = true
  AND k."is_deleted" = false
  AND kf."access_type" = 'FISCAL_CLIENT'
  AND kf."is_deleted" = false
ON CONFLICT (
  "agencija_id",
  "korisnik_id",
  "firma_id",
  "modul",
  "akcija"
)
DO UPDATE SET
  "dozvoljeno" = true,
  "updated_at" = CURRENT_TIMESTAMP;

-- Postojećem direktnom operateru preslikaj samo eksplicitno dodijeljene
-- operativne fiskalne akcije. Manage/export se ne dodjeljuju implicitno.
INSERT INTO "korisnik_prava" (
  "id",
  "agencija_id",
  "korisnik_id",
  "firma_id",
  "modul",
  "akcija",
  "dozvoljeno",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  k."agencija_id",
  k."id",
  kf."firma_id",
  'pos',
  mapped."pos_akcija",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "korisnik_firma" AS kf
JOIN "korisnici" AS k ON k."id" = kf."korisnik_id"
JOIN "agencije" AS a ON a."id" = k."agencija_id"
JOIN "korisnik_prava" AS fiscal_permission
  ON fiscal_permission."agencija_id" = k."agencija_id"
  AND fiscal_permission."korisnik_id" = k."id"
  AND fiscal_permission."firma_id" = kf."firma_id"
  AND fiscal_permission."modul" = 'fiskalizacija'
  AND fiscal_permission."dozvoljeno" = true
JOIN (
  VALUES
    ('view', 'view'),
    ('post', 'create'),
    ('cancel', 'cancel')
) AS mapped("fiskalna_akcija", "pos_akcija")
  ON mapped."fiskalna_akcija" = fiscal_permission."akcija"
WHERE a."is_fiscal_direct_container" = true
  AND a."aktivan" = true
  AND a."is_deleted" = false
  AND k."aktivan" = true
  AND k."is_deleted" = false
  AND kf."access_type" = 'FISCAL_OPERATOR'
  AND kf."is_deleted" = false
  AND (
    mapped."pos_akcija" <> 'create'
    OR EXISTS (
      SELECT 1
      FROM "korisnik_prava" AS create_permission
      WHERE create_permission."agencija_id" = k."agencija_id"
        AND create_permission."korisnik_id" = k."id"
        AND create_permission."firma_id" = kf."firma_id"
        AND create_permission."modul" = 'fiskalizacija'
        AND create_permission."akcija" = 'create'
        AND create_permission."dozvoljeno" = true
    )
  )
ON CONFLICT (
  "agencija_id",
  "korisnik_id",
  "firma_id",
  "modul",
  "akcija"
)
DO UPDATE SET
  "dozvoljeno" = true,
  "updated_at" = CURRENT_TIMESTAMP;
