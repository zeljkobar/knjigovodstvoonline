ALTER TABLE "plate_prirez_stope"
  ADD COLUMN "djp_sifra" VARCHAR(3),
  ADD COLUMN "prirez_ziro_racun" TEXT,
  ADD COLUMN "prirez_sifra_placanja" VARCHAR(3),
  ADD COLUMN "porez_ziro_racun" TEXT,
  ADD COLUMN "porez_sifra_placanja" VARCHAR(3);

ALTER TABLE "plate_prirez_stope"
  ADD CONSTRAINT "plate_prirez_stope_djp_sifra_check"
    CHECK ("djp_sifra" IS NULL OR "djp_sifra" ~ '^[0-9]{3}$'),
  ADD CONSTRAINT "plate_prirez_stope_prirez_sifra_placanja_check"
    CHECK ("prirez_sifra_placanja" IS NULL OR "prirez_sifra_placanja" ~ '^[0-9]{3}$'),
  ADD CONSTRAINT "plate_prirez_stope_porez_sifra_placanja_check"
    CHECK ("porez_sifra_placanja" IS NULL OR "porez_sifra_placanja" ~ '^[0-9]{3}$');

CREATE UNIQUE INDEX "plate_prirez_stope_djp_sifra_valid_from_key"
  ON "plate_prirez_stope"("djp_sifra", "valid_from");

INSERT INTO "plate_prirez_stope" (
  "opstina",
  "djp_sifra",
  "stopa",
  "prirez_ziro_racun",
  "prirez_sifra_placanja",
  "porez_ziro_racun",
  "porez_sifra_placanja",
  "aktivan",
  "valid_from",
  "updated_at"
)
VALUES
  ('PODGORICA', '302', 0.150000, '550-3028009-09', '140', '820-11111-93', '127', true, DATE '2000-01-01', CURRENT_TIMESTAMP),
  ('CETINJE', '310', 0.150000, NULL,              '140', '820-11111-93', '127', true, DATE '2000-01-01', CURRENT_TIMESTAMP),
  ('DANILOVGRAD', '329', 0.130000, '510-3298009-13', '140', '820-11111-93', '127', true, DATE '2000-01-01', CURRENT_TIMESTAMP),
  ('NIKŠIĆ', '400', 0.130000, '535-4008009-75', '140', '820-11111-93', '127', true, DATE '2000-01-01', CURRENT_TIMESTAMP),
  ('ŠAVNIK', '418', 0.130000, NULL,              '140', '820-11111-93', '127', true, DATE '2000-01-01', CURRENT_TIMESTAMP),
  ('PLUŽINE', '426', 0.130000, NULL,              '140', '820-11111-93', '127', true, DATE '2000-01-01', CURRENT_TIMESTAMP),
  ('PLJEVLJA', '507', 0.130000, '510-5078009-57', '140', '820-11111-93', '127', true, DATE '2000-01-01', CURRENT_TIMESTAMP),
  ('ŽABLJAK', '515', 0.130000, NULL,              '140', '820-11111-93', '127', true, DATE '2000-01-01', CURRENT_TIMESTAMP),
  ('BERANE', '604', 0.130000, '505-6048009-88', '140', '820-11111-93', '127', true, DATE '2000-01-01', CURRENT_TIMESTAMP),
  ('PLAV', '612', 0.130000, NULL,              '140', '820-11111-93', '127', true, DATE '2000-01-01', CURRENT_TIMESTAMP),
  ('ROŽAJE', '620', 0.130000, NULL,              '140', '820-11111-93', '127', true, DATE '2000-01-01', CURRENT_TIMESTAMP),
  ('ANDRIJEVICA', '639', 0.130000, NULL,              '140', '820-11111-93', '127', true, DATE '2000-01-01', CURRENT_TIMESTAMP),
  ('BIJELO POLJE', '701', 0.130000, '550-7018009-03', '140', '820-11111-93', '127', true, DATE '2000-01-01', CURRENT_TIMESTAMP),
  ('MOJKOVAC', '710', 0.130000, NULL,              '140', '820-11111-93', '127', true, DATE '2000-01-01', CURRENT_TIMESTAMP),
  ('KOLAŠIN', '728', 0.130000, NULL,              '140', '820-11111-93', '127', true, DATE '2000-01-01', CURRENT_TIMESTAMP),
  ('BAR', '809', 0.130000, '510-8098009-51', '140', '820-11111-93', '127', true, DATE '2000-01-01', CURRENT_TIMESTAMP),
  ('BUDVA', '817', 0.100000, '510-8178009-29', '140', '820-11111-93', '127', true, DATE '2000-01-01', CURRENT_TIMESTAMP),
  ('ULCINJ', '825', 0.130000, '535-8258009-46', '140', '820-11111-93', '127', true, DATE '2000-01-01', CURRENT_TIMESTAMP),
  ('HERCEG NOVI', '906', 0.130000, '510-9068009-51', '140', '820-11111-93', '127', true, DATE '2000-01-01', CURRENT_TIMESTAMP),
  ('TIVAT', '914', 0.130000, NULL,              '140', '820-11111-93', '127', true, DATE '2000-01-01', CURRENT_TIMESTAMP),
  ('KOTOR', '922', 0.130000, NULL,              '140', '820-11111-93', '127', true, DATE '2000-01-01', CURRENT_TIMESTAMP)
ON CONFLICT ("opstina", "valid_from") DO UPDATE
SET
  "djp_sifra" = EXCLUDED."djp_sifra",
  "stopa" = EXCLUDED."stopa",
  "prirez_ziro_racun" = EXCLUDED."prirez_ziro_racun",
  "prirez_sifra_placanja" = EXCLUDED."prirez_sifra_placanja",
  "porez_ziro_racun" = EXCLUDED."porez_ziro_racun",
  "porez_sifra_placanja" = EXCLUDED."porez_sifra_placanja",
  "aktivan" = EXCLUDED."aktivan",
  "updated_at" = CURRENT_TIMESTAMP;
