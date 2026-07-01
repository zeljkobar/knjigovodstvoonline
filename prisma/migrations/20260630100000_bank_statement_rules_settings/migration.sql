CREATE TABLE "bank_statement_account_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "company_bank_account_id" UUID NOT NULL,
  "bank_account_konto_id" UUID,
  "journal_type_id" UUID,
  "last_used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID,

  CONSTRAINT "bank_statement_account_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bank_posting_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "rule_type" TEXT NOT NULL DEFAULT 'BANK_ACCOUNT',
  "direction" TEXT NOT NULL,
  "counterparty_account_number" TEXT NOT NULL,
  "counterparty_account_number_normalized" TEXT NOT NULL,
  "account_id" UUID NOT NULL,
  "partner_id" UUID,
  "times_used" INTEGER NOT NULL DEFAULT 0,
  "last_used_at" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID,

  CONSTRAINT "bank_posting_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bank_statement_account_settings_firma_id_company_bank_account_id_key"
  ON "bank_statement_account_settings"("firma_id", "company_bank_account_id");

CREATE INDEX "bank_statement_account_settings_agencija_id_firma_id_idx"
  ON "bank_statement_account_settings"("agencija_id", "firma_id");

CREATE UNIQUE INDEX "bank_posting_rules_firma_id_rule_type_direction_counterparty_account_number_normalized_key"
  ON "bank_posting_rules"("firma_id", "rule_type", "direction", "counterparty_account_number_normalized");

CREATE INDEX "bank_posting_rules_agencija_id_firma_id_active_idx"
  ON "bank_posting_rules"("agencija_id", "firma_id", "active");

ALTER TABLE "bank_statement_account_settings"
  ADD CONSTRAINT "bank_statement_account_settings_firma_id_fkey"
  FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bank_statement_account_settings"
  ADD CONSTRAINT "bank_statement_account_settings_company_bank_account_id_fkey"
  FOREIGN KEY ("company_bank_account_id") REFERENCES "firma_bankovni_racuni"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bank_statement_account_settings"
  ADD CONSTRAINT "bank_statement_account_settings_bank_account_konto_id_fkey"
  FOREIGN KEY ("bank_account_konto_id") REFERENCES "firma_konta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bank_statement_account_settings"
  ADD CONSTRAINT "bank_statement_account_settings_journal_type_id_fkey"
  FOREIGN KEY ("journal_type_id") REFERENCES "vrste_naloga"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bank_posting_rules"
  ADD CONSTRAINT "bank_posting_rules_firma_id_fkey"
  FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bank_posting_rules"
  ADD CONSTRAINT "bank_posting_rules_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "firma_konta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bank_posting_rules"
  ADD CONSTRAINT "bank_posting_rules_partner_id_fkey"
  FOREIGN KEY ("partner_id") REFERENCES "komitenti"("id") ON DELETE SET NULL ON UPDATE CASCADE;
