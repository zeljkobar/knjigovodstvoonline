UPDATE "plate_prirez_stope"
SET "valid_from" = DATE '2000-01-01',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "valid_from" = DATE '2026-01-01'
  AND "opstina" IN ('BAR', 'PODGORICA');
