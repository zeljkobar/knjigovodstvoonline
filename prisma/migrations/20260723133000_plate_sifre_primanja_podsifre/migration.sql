ALTER TABLE "plate_sifre_primanja"
  ADD COLUMN "nadredjena_sifra_id" uuid,
  ADD COLUMN "osnovica_porez_proc_override" decimal(8,2),
  ADD COLUMN "obracunski_koeficijent" decimal(14,9) NOT NULL DEFAULT 1,
  ADD COLUMN "koeficijent_tip" text NOT NULL DEFAULT 'NE_PRIMJENJUJE',
  ADD COLUMN "ulazi_u_fond_sati" boolean NOT NULL DEFAULT false,
  ADD COLUMN "podrazumijevana_stavka" boolean NOT NULL DEFAULT false,
  ADD COLUMN "refundacija_tip" integer,
  ADD COLUMN "ulazi_u_osnovicu_bolovanja" boolean NOT NULL DEFAULT false,
  ADD COLUMN "izvorni_podaci" jsonb;

ALTER TABLE "plate_sifre_primanja"
  ADD CONSTRAINT "plate_sifre_primanja_nadredjena_sifra_id_fkey"
    FOREIGN KEY ("nadredjena_sifra_id") REFERENCES "plate_sifre_primanja"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "plate_sifre_primanja_koeficijent_tip_check"
    CHECK ("koeficijent_tip" IN ('NE_PRIMJENJUJE', 'IZNOS', 'STAZ')),
  ADD CONSTRAINT "plate_sifre_primanja_obracunski_koeficijent_check"
    CHECK ("obracunski_koeficijent" >= 0),
  ADD CONSTRAINT "plate_sifre_primanja_osnovica_override_check"
    CHECK (
      "osnovica_porez_proc_override" IS NULL
      OR "osnovica_porez_proc_override" BETWEEN 0 AND 100
    );

CREATE INDEX "plate_sifre_primanja_nadredjena_sifra_id_idx"
  ON "plate_sifre_primanja"("nadredjena_sifra_id");

-- A_SifR je istorijski izvor obračunskih parametara, ne izvor važećih stopa.
-- Koeficijenti tipa IZNOS utiču na iznos stavke, dok koeficijenti tipa STAZ
-- samo opisuju uvećano trajanje i ne smiju množiti zaradu.
WITH legacy_main (
  "sifra",
  "koeficijent",
  "koeficijent_tip",
  "fond_sati",
  "osnovica_bolovanja"
) AS (
  VALUES
    ('001', 1.000000000, 'NE_PRIMJENJUJE', true,  true),
    ('002', 1.000000000, 'NE_PRIMJENJUJE', false, true),
    ('003', 1.000000000, 'NE_PRIMJENJUJE', false, true),
    ('004', 1.000000000, 'NE_PRIMJENJUJE', false, true),
    ('005', 1.000000000, 'NE_PRIMJENJUJE', false, true),
    ('006', 0.700000000, 'IZNOS',            true,  true),
    ('007', 0.700000000, 'IZNOS',            true,  true),
    ('008', 1.000000000, 'NE_PRIMJENJUJE', true,  true),
    ('009', 1.000000000, 'NE_PRIMJENJUJE', true,  true),
    ('051', 1.166666667, 'STAZ',            false, false),
    ('052', 1.250000000, 'STAZ',            false, false),
    ('053', 1.333333333, 'STAZ',            false, false),
    ('054', 1.500000000, 'STAZ',            false, false),
    ('070', 1.000000000, 'NE_PRIMJENJUJE', true,  false),
    ('071', 1.166666667, 'STAZ',            false, false),
    ('072', 1.333333333, 'STAZ',            false, false),
    ('073', 1.500000000, 'STAZ',            false, false),
    ('074', 1.166666667, 'STAZ',            false, false),
    ('075', 1.250000000, 'STAZ',            false, false),
    ('076', 1.333333333, 'STAZ',            false, false),
    ('077', 1.500000000, 'STAZ',            false, false),
    ('078', 2.000000000, 'STAZ',            false, false)
)
UPDATE "plate_sifre_primanja" sp
SET
  "obracunski_koeficijent" = source."koeficijent",
  "koeficijent_tip" = source."koeficijent_tip",
  "ulazi_u_fond_sati" = source."fond_sati",
  "ulazi_u_osnovicu_bolovanja" = source."osnovica_bolovanja",
  "izvorni_podaci" = COALESCE(sp."izvorni_podaci", '{}'::jsonb) || jsonb_build_object(
    'source', 'zadaci/plate/001LP.mdb/A_SifR',
    'koefLP', source."koeficijent",
    'fondH', source."fond_sati",
    'ynOsnBOL', source."osnovica_bolovanja",
    'ratesAuthoritative', false
  ),
  "updated_at" = CURRENT_TIMESTAMP
FROM legacy_main source
WHERE sp."agencija_id" IS NULL
  AND sp."firma_id" IS NULL
  AND sp."sifra" = source."sifra"
  AND sp."aktivan" = true;

WITH legacy_subcodes (
  "sifra",
  "osnovna_sifra",
  "pomocna_sifra",
  "naziv",
  "koeficijent",
  "koeficijent_tip",
  "osnovica_porez_proc",
  "fond_sati",
  "podrazumijevana",
  "osnovica_bolovanja"
) AS (
  VALUES
    ('001.00', '001', 1, 'Zarada - startni dio (topli obrok + 1/12 regresa)', 1.000000000, 'NE_PRIMJENJUJE', 100.00, false, true,  true),
    ('001.01', '001', 1, 'Zarada - redovan rad',                            1.000000000, 'NE_PRIMJENJUJE', 100.00, true,  true,  true),
    ('001.02', '001', 2, 'Zarada - godišnji odmor',                         1.000000000, 'NE_PRIMJENJUJE', 100.00, true,  false, true),
    ('001.03', '001', 3, 'Zarada - prekovremeni rad',                       1.400000000, 'IZNOS',            100.00, false, false, false),
    ('001.04', '001', 4, 'Zarada - rad noću',                               0.400000000, 'IZNOS',            100.00, false, false, true),
    ('001.05', '001', 5, 'Zarada - rad u vrijeme praznika',                 1.500000000, 'IZNOS',            100.00, false, false, true),
    ('001.06', '001', 6, 'Zarada - dežurstvo',                              0.100000000, 'IZNOS',            100.00, false, false, false),
    ('001.07', '001', 7, 'Zarada - stimulans',                              1.000000000, 'NE_PRIMJENJUJE', 100.00, false, false, false),
    ('001.08', '001', 8, 'Zarada - razlika',                                1.000000000, 'NE_PRIMJENJUJE', 100.00, false, false, true),
    ('001.09', '001', 9, 'Zarada - rad nedjeljom',                          0.800000000, 'IZNOS',            100.00, false, false, false),
    ('001.82', '001', 1, 'Zarada - dodatak za kolektivno pregovaranje',      1.000000000, 'NE_PRIMJENJUJE', 100.00, false, false, true),
    ('001.88', '001', 1, 'Zarada - minuli rad',                             1.000000000, 'NE_PRIMJENJUJE', 100.00, false, true,  true),
    ('001.90', '001', 1, 'Zarada - topli obrok',                            1.000000000, 'NE_PRIMJENJUJE', 100.00, false, true,  true),
    ('001.95', '001', 1, 'Zarada - regres',                                 1.000000000, 'NE_PRIMJENJUJE', 100.00, false, true,  true),
    ('024.01', '024', 1, 'Jubilarna nagrada za 10 godina',                  1.000000000, 'NE_PRIMJENJUJE', 100.00, false, false, false),
    ('024.02', '024', 2, 'Jubilarna nagrada za 20 godina',                  1.000000000, 'NE_PRIMJENJUJE', 100.00, false, false, false),
    ('024.03', '024', 3, 'Jubilarna nagrada za 30 godina',                  1.000000000, 'NE_PRIMJENJUJE', 100.00, false, false, false),
    ('024.04', '024', 4, 'Jubilarna nagrada za 40 godina',                  1.000000000, 'NE_PRIMJENJUJE', 100.00, false, false, false),
    ('065.01', '065', 1, 'Izdavanje u zakup imovine',                       1.000000000, 'NE_PRIMJENJUJE',  70.00, false, false, false),
    ('065.02', '065', 2, 'Vremenski ograničeno ustupanje autorskih prava i prava industrijske svojine', 1.000000000, 'NE_PRIMJENJUJE', 60.00, false, false, false),
    ('065.03', '065', 3, 'Iznajmljivanje soba i apartmana sa boravišnom taksom', 1.000000000, 'NE_PRIMJENJUJE', 50.00, false, false, false),
    ('066.01', '066', 1, 'Prihod od kapitala - kamate',                     1.000000000, 'NE_PRIMJENJUJE', 100.00, false, false, false),
    ('066.02', '066', 2, 'Prihod od kapitala - dobit u novcu ili akcijama', 1.000000000, 'NE_PRIMJENJUJE', 100.00, false, false, false),
    ('066.03', '066', 3, 'Prihod od kapitala - korišćenje imovine u privatne svrhe', 1.000000000, 'NE_PRIMJENJUJE', 100.00, false, false, false),
    ('066.04', '066', 4, 'Prihod od kapitala - kupovina akcija po povlašćenim uslovima', 1.000000000, 'NE_PRIMJENJUJE', 100.00, false, false, false)
)
INSERT INTO "plate_sifre_primanja" (
  "agencija_id",
  "firma_id",
  "sifra",
  "naziv",
  "skraceni_naziv",
  "ioppd_sifra_id",
  "vrsta_obracuna_id",
  "osnova_obracuna_id",
  "nadredjena_sifra_id",
  "kategorija",
  "osnovica_tip",
  "procenat_osnovice",
  "osnovica_porez_proc_override",
  "obracunski_koeficijent",
  "koeficijent_tip",
  "ulazi_u_fond_sati",
  "podrazumijevana_stavka",
  "ulazi_u_osnovicu_bolovanja",
  "izvorni_podaci",
  "koristi_porez",
  "koristi_zaposleni_pio",
  "koristi_zaposleni_zdravstvo",
  "koristi_zaposleni_nezaposleni",
  "koristi_poslodavac_pio",
  "koristi_poslodavac_zdravstvo",
  "koristi_poslodavac_nezaposleni",
  "koristi_fond_rada",
  "koristi_sindikat",
  "koristi_privredna_komora",
  "prikazi_na_ioppd",
  "bez_bruto_iznosa",
  "bez_neto_iznosa",
  "aktivan",
  "valid_from",
  "valid_to",
  "updated_at"
)
SELECT
  NULL,
  NULL,
  source."sifra",
  source."naziv",
  left(source."naziv", 120),
  parent."ioppd_sifra_id",
  parent."vrsta_obracuna_id",
  parent."osnova_obracuna_id",
  parent."id",
  parent."kategorija",
  parent."osnovica_tip",
  source."osnovica_porez_proc",
  source."osnovica_porez_proc",
  source."koeficijent",
  source."koeficijent_tip",
  source."fond_sati",
  source."podrazumijevana",
  source."osnovica_bolovanja",
  jsonb_build_object(
    'source', 'zadaci/plate/001LP.mdb/A_SifR',
    'osnS', source."osnovna_sifra",
    'pomS', source."pomocna_sifra",
    'koefLP', source."koeficijent",
    'opOSN', source."osnovica_porez_proc",
    'fondH', source."fond_sati",
    'defaultZaObracLP', source."podrazumijevana",
    'ynOsnBOL', source."osnovica_bolovanja",
    'ratesAuthoritative', false
  ),
  parent."koristi_porez",
  parent."koristi_zaposleni_pio",
  parent."koristi_zaposleni_zdravstvo",
  parent."koristi_zaposleni_nezaposleni",
  parent."koristi_poslodavac_pio",
  parent."koristi_poslodavac_zdravstvo",
  parent."koristi_poslodavac_nezaposleni",
  parent."koristi_fond_rada",
  parent."koristi_sindikat",
  parent."koristi_privredna_komora",
  parent."prikazi_na_ioppd",
  parent."bez_bruto_iznosa",
  parent."bez_neto_iznosa",
  true,
  parent."valid_from",
  parent."valid_to",
  CURRENT_TIMESTAMP
FROM legacy_subcodes source
JOIN LATERAL (
  SELECT parent_row.*
  FROM "plate_sifre_primanja" parent_row
  WHERE parent_row."agencija_id" IS NULL
    AND parent_row."firma_id" IS NULL
    AND parent_row."sifra" = source."osnovna_sifra"
    AND parent_row."aktivan" = true
  ORDER BY parent_row."valid_from" DESC, parent_row."created_at" DESC
  LIMIT 1
) parent ON true
WHERE NOT EXISTS (
  SELECT 1
  FROM "plate_sifre_primanja" existing
  WHERE existing."agencija_id" IS NULL
    AND existing."firma_id" IS NULL
    AND existing."sifra" = source."sifra"
    AND existing."aktivan" = true
);
