-- One editable annual corporate-tax return belongs to its existing scoped year.
ALTER TABLE poslovne_godine
  ADD COLUMN porez_dobit_podaci jsonb,
  ADD COLUMN porez_dobit_verzija integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT poslovne_godine_porez_dobit_verzija_check CHECK (porez_dobit_verzija >= 0);
