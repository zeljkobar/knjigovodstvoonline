-- Granularna prava u korisnik_prava su jedini izvor dozvola po modulu i akciji.
-- korisnik_firma ostaje isključivo veza korisnika sa firmom i nosilac podataka
-- o vrsti, glavnom radniku i periodu pristupa.
ALTER TABLE "korisnik_firma"
  DROP COLUMN IF EXISTS "moze_da_gleda",
  DROP COLUMN IF EXISTS "moze_da_unosi",
  DROP COLUMN IF EXISTS "moze_da_mijenja",
  DROP COLUMN IF EXISTS "moze_da_brise";
