ALTER TABLE "korisnici"
  ADD COLUMN "tema_paleta" TEXT NOT NULL DEFAULT 'blue',
  ADD COLUMN "tema_rezim" TEXT NOT NULL DEFAULT 'light',
  ADD CONSTRAINT "korisnici_tema_paleta_check" CHECK ("tema_paleta" IN ('blue', 'green', 'burgundy', 'graphite', 'purple')),
  ADD CONSTRAINT "korisnici_tema_rezim_check" CHECK ("tema_rezim" IN ('light', 'dark'));
