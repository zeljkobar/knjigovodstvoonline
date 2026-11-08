ALTER TABLE agencije
  ADD COLUMN porez_dobit_konta jsonb,
  ADD COLUMN porez_dobit_konta_verzija integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT agencije_porez_dobit_konta_verzija_check CHECK (porez_dobit_konta_verzija >= 0);
