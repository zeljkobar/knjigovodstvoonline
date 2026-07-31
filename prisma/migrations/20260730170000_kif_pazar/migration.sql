ALTER TABLE "kif_entries"
ADD COLUMN "entry_kind" TEXT NOT NULL DEFAULT 'INVOICE',
ADD COLUMN "pazar_period_type" TEXT,
ADD COLUMN "pazar_period_from" DATE,
ADD COLUMN "pazar_period_to" DATE,
ADD COLUMN "pazar_report_number" TEXT,
ADD COLUMN "pazar_cash_register" TEXT;

ALTER TABLE "kif_entries"
ADD CONSTRAINT "kif_entries_entry_kind_check"
CHECK ("entry_kind" IN ('INVOICE', 'PAZAR'));

ALTER TABLE "kif_entries"
ADD CONSTRAINT "kif_entries_pazar_period_type_check"
CHECK ("pazar_period_type" IS NULL OR "pazar_period_type" IN ('DAILY', 'MONTHLY'));

ALTER TABLE "kif_entries"
ADD CONSTRAINT "kif_entries_pazar_fields_check"
CHECK (
  ("entry_kind" = 'INVOICE' AND "pazar_period_type" IS NULL AND "pazar_period_from" IS NULL AND "pazar_period_to" IS NULL)
  OR
  (
    "entry_kind" = 'PAZAR'
    AND "pazar_period_type" IS NOT NULL
    AND "pazar_period_from" IS NOT NULL
    AND "pazar_period_to" IS NOT NULL
    AND "pazar_period_from" <= "pazar_period_to"
  )
);

CREATE INDEX "kif_entries_firma_id_entry_kind_pazar_period_from_pazar_period_to_idx"
ON "kif_entries"("firma_id", "entry_kind", "pazar_period_from", "pazar_period_to");

CREATE TABLE "kif_pazar_payments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "kif_entry_id" UUID NOT NULL,
  "payment_method" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID,

  CONSTRAINT "kif_pazar_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "kif_pazar_payments_method_check"
    CHECK ("payment_method" IN ('CASH', 'CARD', 'TRANSFER', 'OTHER')),
  CONSTRAINT "kif_pazar_payments_amount_check"
    CHECK ("amount" >= 0),
  CONSTRAINT "kif_pazar_payments_kif_entry_id_fkey"
    FOREIGN KEY ("kif_entry_id") REFERENCES "kif_entries"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "kif_pazar_payments_kif_entry_id_payment_method_key"
ON "kif_pazar_payments"("kif_entry_id", "payment_method");

CREATE INDEX "kif_pazar_payments_kif_entry_id_idx"
ON "kif_pazar_payments"("kif_entry_id");
