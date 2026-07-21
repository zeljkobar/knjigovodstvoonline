INSERT INTO "plate_vrste_obracuna" (
  "sifra",
  "naziv",
  "input_type",
  "koristi_neto",
  "koristi_bruto",
  "koristi_koeficijent",
  "koristi_minuli_rad",
  "seniority_mode",
  "algoritam",
  "valid_from",
  "updated_at"
)
SELECT
  data."sifra",
  data."naziv",
  data."input_type",
  data."koristi_neto",
  data."koristi_bruto",
  data."koristi_koeficijent",
  false,
  'INCLUDED_IN_NET',
  data."algoritam",
  DATE '2026-01-01',
  CURRENT_TIMESTAMP
FROM (
  VALUES
    ('NET_OTHER_INCOME', 'Neto, ostali obračuni', 'NET', true, false, false, 'NET_TO_GROSS'),
    ('GROSS_OTHER_INCOME', 'Bruto, ostali obračuni', 'GROSS', false, true, false, 'GROSS_TO_NET'),
    ('GROSS2_OTHER_INCOME', 'Bruto 2, ostali obračuni', 'GROSS', false, true, false, 'GROSS_TO_NET')
) AS data("sifra", "naziv", "input_type", "koristi_neto", "koristi_bruto", "koristi_koeficijent", "algoritam")
WHERE NOT EXISTS (
  SELECT 1
  FROM "plate_vrste_obracuna" existing
  WHERE existing."sifra" = data."sifra"
);

INSERT INTO "plate_sifre_primanja" (
  "agencija_id",
  "firma_id",
  "sifra",
  "naziv",
  "skraceni_naziv",
  "ioppd_sifra_id",
  "vrsta_obracuna_id",
  "kategorija",
  "osnovica_tip",
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
  "valid_from",
  "updated_at"
)
SELECT
  NULL,
  NULL,
  data."sifra",
  data."naziv",
  data."skraceni_naziv",
  ioppd."id",
  vrsta."id",
  data."kategorija",
  'NETO',
  true,
  false,
  false,
  false,
  false,
  false,
  false,
  false,
  false,
  false,
  DATE '2026-01-01',
  CURRENT_TIMESTAMP
FROM (
  VALUES
    ('047', 'Ugovorena naknada', 'Ugovorena naknada', 'UGOVOR_O_DJELU', 'NET_OTHER_INCOME'),
    ('065', 'Prihod od imovine i imovinskih prava', 'Zakup', 'ZAKUP', 'NET_OTHER_INCOME'),
    ('047', 'Ugovorena naknada', 'Ugovorena naknada', 'OSTALI_UGOVORI', 'NET_OTHER_INCOME')
) AS data("sifra", "naziv", "skraceni_naziv", "kategorija", "vrsta_sifra")
JOIN "plate_ioppd_sifre" ioppd ON ioppd."sifra" = data."sifra"
JOIN "plate_vrste_obracuna" vrsta ON vrsta."sifra" = data."vrsta_sifra"
WHERE NOT EXISTS (
  SELECT 1
  FROM "plate_sifre_primanja" existing
  WHERE existing."agencija_id" IS NULL
    AND existing."firma_id" IS NULL
    AND existing."sifra" = data."sifra"
    AND existing."kategorija" = data."kategorija"
    AND existing."valid_from" = DATE '2026-01-01'
);
