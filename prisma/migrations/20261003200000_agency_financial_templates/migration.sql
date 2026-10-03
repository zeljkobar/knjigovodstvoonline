BEGIN;
-- Promote the single existing custom template without losing its mappings.
-- Ambiguous company templates require explicit reconciliation, never silent selection.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM finansijski_izvjestaj_sabloni
    WHERE agencija_id IS NOT NULL AND sistemski = false
    GROUP BY agencija_id, tip_sifra HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Više prilagođenih šema istog tipa u agenciji: uskladite ih prije migracije.';
  END IF;
END $$;
UPDATE finansijski_izvjestaj_sabloni SET firma_id = NULL, updated_at = NOW()
WHERE agencija_id IS NOT NULL AND sistemski = false;
CREATE UNIQUE INDEX financial_template_agency_type ON finansijski_izvjestaj_sabloni (agencija_id, tip_sifra)
WHERE agencija_id IS NOT NULL AND firma_id IS NULL AND sistemski = false;
COMMIT;
