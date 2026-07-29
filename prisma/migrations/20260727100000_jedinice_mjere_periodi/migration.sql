INSERT INTO "jedinice_mjere"
  ("sifra", "naziv", "oznaka", "decimalna_mjesta", "redosljed")
VALUES
  ('MJE', 'Mjesec', 'mj.', 0, 130),
  ('GOD', 'Godina', 'god.', 0, 140),
  ('KVT', 'Kvartal', 'kv.', 0, 150)
ON CONFLICT ("sifra") DO NOTHING;
