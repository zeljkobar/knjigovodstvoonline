-- Immutable diagnostic evidence from the confirmed Fiscal API first-send context.
-- Existing documents remain NULL; no inference from current register configuration.
ALTER TABLE "fiskalni_izlazni_racuni" ADD COLUMN "fiscal_context_snapshot" JSONB;
