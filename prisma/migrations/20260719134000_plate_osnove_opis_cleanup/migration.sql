UPDATE "plate_osnove_obracuna"
SET "opis" = NULL
WHERE "source" = 'zadaci/plate/specifikacija-osnova-za-obracun-oktobar-2024-novine-pio-i-od-01012025.xls'
  AND "opis" LIKE '{"sifra":%';
