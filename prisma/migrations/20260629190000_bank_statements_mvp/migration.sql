CREATE TABLE "bank_statements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "poslovna_godina_id" UUID NOT NULL,
  "company_bank_account_id" UUID NOT NULL,
  "bank_account_konto_id" UUID,
  "journal_id" UUID,
  "statement_number" TEXT NOT NULL,
  "statement_date" DATE NOT NULL,
  "opening_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total_inflow" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total_outflow" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "closing_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'IMPORTED',
  "file_name" TEXT,
  "file_type" TEXT,
  "raw_text" TEXT,
  "parse_notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID,
  "posted_at" TIMESTAMP(3),
  "posted_by" UUID,
  "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  "deleted_at" TIMESTAMP(3),
  "deleted_by" UUID,
  "delete_reason" TEXT,

  CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bank_statement_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "bank_statement_id" UUID NOT NULL,
  "line_number" INTEGER NOT NULL,
  "posting_date" DATE NOT NULL,
  "value_date" DATE,
  "description" TEXT NOT NULL,
  "reference_number" TEXT,
  "counterparty_account_number" TEXT,
  "counterparty_account_number_normalized" TEXT,
  "counterparty_name" TEXT,
  "inflow_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "outflow_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "direction" TEXT NOT NULL,
  "partner_id" UUID,
  "debit_account_id" UUID,
  "credit_account_id" UUID,
  "match_status" TEXT NOT NULL DEFAULT 'UNMATCHED',
  "posting_status" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
  "confidence_score" INTEGER NOT NULL DEFAULT 0,
  "raw_text" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID,

  CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "partner_bank_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID,
  "partner_id" UUID NOT NULL,
  "bank_name" TEXT,
  "account_number" TEXT NOT NULL,
  "normalized_account_number" TEXT NOT NULL,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID,

  CONSTRAINT "partner_bank_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bank_statements_firma_id_poslovna_godina_id_company_bank_account_id_statement_number_key"
  ON "bank_statements"("firma_id", "poslovna_godina_id", "company_bank_account_id", "statement_number");

CREATE INDEX "bank_statements_agencija_id_firma_id_poslovna_godina_id_status_idx"
  ON "bank_statements"("agencija_id", "firma_id", "poslovna_godina_id", "status");

CREATE UNIQUE INDEX "bank_statement_lines_bank_statement_id_line_number_key"
  ON "bank_statement_lines"("bank_statement_id", "line_number");

CREATE INDEX "bank_statement_lines_counterparty_account_number_normalized_idx"
  ON "bank_statement_lines"("counterparty_account_number_normalized");

CREATE INDEX "bank_statement_lines_partner_id_idx"
  ON "bank_statement_lines"("partner_id");

CREATE UNIQUE INDEX "partner_bank_accounts_agencija_id_firma_id_normalized_account_number_key"
  ON "partner_bank_accounts"("agencija_id", "firma_id", "normalized_account_number");

CREATE INDEX "partner_bank_accounts_partner_id_idx"
  ON "partner_bank_accounts"("partner_id");

ALTER TABLE "bank_statements"
  ADD CONSTRAINT "bank_statements_firma_id_fkey"
  FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bank_statements"
  ADD CONSTRAINT "bank_statements_poslovna_godina_id_fkey"
  FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bank_statements"
  ADD CONSTRAINT "bank_statements_company_bank_account_id_fkey"
  FOREIGN KEY ("company_bank_account_id") REFERENCES "firma_bankovni_racuni"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bank_statements"
  ADD CONSTRAINT "bank_statements_bank_account_konto_id_fkey"
  FOREIGN KEY ("bank_account_konto_id") REFERENCES "firma_konta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bank_statements"
  ADD CONSTRAINT "bank_statements_journal_id_fkey"
  FOREIGN KEY ("journal_id") REFERENCES "nalozi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bank_statement_lines"
  ADD CONSTRAINT "bank_statement_lines_bank_statement_id_fkey"
  FOREIGN KEY ("bank_statement_id") REFERENCES "bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bank_statement_lines"
  ADD CONSTRAINT "bank_statement_lines_partner_id_fkey"
  FOREIGN KEY ("partner_id") REFERENCES "komitenti"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bank_statement_lines"
  ADD CONSTRAINT "bank_statement_lines_debit_account_id_fkey"
  FOREIGN KEY ("debit_account_id") REFERENCES "firma_konta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bank_statement_lines"
  ADD CONSTRAINT "bank_statement_lines_credit_account_id_fkey"
  FOREIGN KEY ("credit_account_id") REFERENCES "firma_konta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "partner_bank_accounts"
  ADD CONSTRAINT "partner_bank_accounts_firma_id_fkey"
  FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "partner_bank_accounts"
  ADD CONSTRAINT "partner_bank_accounts_partner_id_fkey"
  FOREIGN KEY ("partner_id") REFERENCES "komitenti"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
