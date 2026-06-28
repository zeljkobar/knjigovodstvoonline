-- Brza pretraga partnera (naziv ILIKE) preko trigram GIN indeksa
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "komitenti_naziv_trgm_idx"
  ON "komitenti" USING gin ("naziv" gin_trgm_ops);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "komitenti_pib_idx" ON "komitenti"("pib");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "komitenti_scope_idx" ON "komitenti"("scope");
