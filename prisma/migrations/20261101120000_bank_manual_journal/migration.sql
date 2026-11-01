ALTER TABLE "bank_statements" ADD COLUMN "journal_mode" TEXT NOT NULL DEFAULT 'AUTO';
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_journal_mode_check"
  CHECK ("journal_mode" IN ('AUTO', 'MANUAL'));
