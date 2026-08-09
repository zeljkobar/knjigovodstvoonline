DROP INDEX IF EXISTS "pos_accounting_batches_journal_id_key";
CREATE INDEX "pos_accounting_batches_journal_id_idx" ON "pos_accounting_batches"("journal_id");
