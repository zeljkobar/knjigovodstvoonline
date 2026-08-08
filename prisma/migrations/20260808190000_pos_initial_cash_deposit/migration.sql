ALTER TABLE "pos_registers"
  ADD COLUMN "cash_deposit_amount" DECIMAL(14,2),
  ADD COLUMN "cash_deposit_environment" TEXT,
  ADD COLUMN "cash_deposit_fcdc" TEXT,
  ADD COLUMN "cash_deposit_registered_at" TIMESTAMP(3),
  ADD COLUMN "cash_deposit_correlation_id" TEXT;
