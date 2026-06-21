ALTER TABLE "kuf_entries"
ADD COLUMN "expense_account_id" UUID;

CREATE INDEX "kuf_entries_expense_account_id_idx"
ON "kuf_entries"("expense_account_id");

ALTER TABLE "kuf_entries"
ADD CONSTRAINT "kuf_entries_expense_account_id_fkey"
FOREIGN KEY ("expense_account_id") REFERENCES "firma_konta"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
