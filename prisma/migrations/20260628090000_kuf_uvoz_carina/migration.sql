-- Uvoz (import) — dodatna carinska polja za Model A (jedan unos = cio uvoz)
ALTER TABLE "kuf_entries"
  ADD COLUMN "goods_value" DECIMAL(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "customs_base_amount" DECIMAL(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "customs_duty_amount" DECIMAL(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "customs_vat_rate_percent" DECIMAL(5, 2);
