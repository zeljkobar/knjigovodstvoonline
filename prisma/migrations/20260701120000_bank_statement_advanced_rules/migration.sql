ALTER TABLE "bank_statement_lines"
  ADD COLUMN "payment_code" TEXT;

DROP INDEX IF EXISTS "bank_posting_rules_firma_id_rule_type_direction_counterparty_account_number_normalized_key";

ALTER TABLE "bank_posting_rules"
  ALTER COLUMN "counterparty_account_number" DROP NOT NULL,
  ALTER COLUMN "counterparty_account_number_normalized" DROP NOT NULL,
  ADD COLUMN "description_contains" TEXT,
  ADD COLUMN "reference_contains" TEXT,
  ADD COLUMN "payment_code" TEXT,
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "auto_apply" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "requires_review" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "bank_posting_rules_match_idx"
  ON "bank_posting_rules"("firma_id", "direction", "active", "priority");

CREATE INDEX "bank_statement_lines_payment_code_idx"
  ON "bank_statement_lines"("payment_code");
