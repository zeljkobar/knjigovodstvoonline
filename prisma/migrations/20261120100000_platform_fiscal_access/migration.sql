ALTER TABLE "korisnik_firma"
  ADD COLUMN "fiscal_portal_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "fiscal_portal_permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
-- Preserve explicitly assigned legacy fiscal accounts. Ordinary client rights do not grant portal access.
UPDATE korisnik_firma k
SET fiscal_portal_enabled = true,
    fiscal_portal_permissions = ARRAY(
      SELECT DISTINCT p.modul || ':' || p.akcija FROM korisnik_prava p
      JOIN firme f ON f.id = k.firma_id
      WHERE p.korisnik_id = k.korisnik_id AND p.firma_id = k.firma_id
        AND p.agencija_id = f.agencija_id AND p.dozvoljeno
        AND p.modul IN ('fiskalizacija', 'pos', 'robno', 'izvjestaji')
      ORDER BY 1
    )
WHERE k.access_type IN ('FISCAL_CLIENT','FISCAL_OPERATOR') AND NOT k.is_deleted;
CREATE INDEX "korisnik_firma_fiscal_portal_idx" ON "korisnik_firma" ("korisnik_id", "fiscal_portal_enabled");
