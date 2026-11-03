ALTER TABLE zatvaranja_stavki ADD COLUMN ponisteno_datum date;
ALTER TABLE zatvaranja_stavki ADD CONSTRAINT zatvaranja_datum_ponistavanja CHECK (ponisteno_datum IS NULL OR ponisteno_datum >= datum);
