ALTER TABLE "agencije"
ADD COLUMN "is_fiscal_direct_container" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "agencije_single_fiscal_direct_container"
ON "agencije" ("is_fiscal_direct_container")
WHERE "is_fiscal_direct_container" = true AND "is_deleted" = false;
