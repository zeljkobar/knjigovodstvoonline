ALTER TABLE "magacini"
ADD COLUMN "tip_prodaje" TEXT NOT NULL DEFAULT 'RETAIL';

ALTER TABLE "magacini"
ADD CONSTRAINT "magacini_tip_prodaje_check"
CHECK ("tip_prodaje" IN ('RETAIL', 'WHOLESALE'));
