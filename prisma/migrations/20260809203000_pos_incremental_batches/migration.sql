DROP INDEX IF EXISTS "pos_kif_batches_period_key";
DROP INDEX IF EXISTS "pos_accounting_batches_period_key";

CREATE INDEX "pos_kif_batches_firma_id_aggregation_mode_period_from_period_idx"
  ON "pos_kif_batches"("firma_id", "aggregation_mode", "period_from", "period_to");

CREATE INDEX "pos_accounting_batches_firma_id_aggregation_mode_period_from_period_idx"
  ON "pos_accounting_batches"("firma_id", "aggregation_mode", "period_from", "period_to");
