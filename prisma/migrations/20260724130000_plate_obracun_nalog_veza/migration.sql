UPDATE "plate_obracuni" AS "obracun"
SET "nalog_id" = NULL
WHERE "nalog_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "nalozi" AS "nalog"
    WHERE "nalog"."id" = "obracun"."nalog_id"
  );

CREATE UNIQUE INDEX "plate_obracuni_nalog_id_key"
  ON "plate_obracuni"("nalog_id");

ALTER TABLE "plate_obracuni"
  ADD CONSTRAINT "plate_obracuni_nalog_id_fkey"
  FOREIGN KEY ("nalog_id")
  REFERENCES "nalozi"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
