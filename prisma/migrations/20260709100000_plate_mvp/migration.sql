CREATE TABLE "plate_ioppd_sifre" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sifra" TEXT NOT NULL,
  "naziv" TEXT NOT NULL,
  "opis" TEXT,
  "kategorija" TEXT,
  "aktivan" BOOLEAN NOT NULL DEFAULT true,
  "valid_from" DATE NOT NULL,
  "valid_to" DATE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plate_ioppd_sifre_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plate_ioppd_sifre_sifra_valid_from_key"
  ON "plate_ioppd_sifre"("sifra", "valid_from");
CREATE INDEX "plate_ioppd_sifre_sifra_aktivan_idx"
  ON "plate_ioppd_sifre"("sifra", "aktivan");

CREATE TABLE "plate_vrste_obracuna" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sifra" TEXT NOT NULL,
  "naziv" TEXT NOT NULL,
  "input_type" TEXT NOT NULL,
  "koristi_neto" BOOLEAN NOT NULL DEFAULT false,
  "koristi_bruto" BOOLEAN NOT NULL DEFAULT false,
  "koristi_koeficijent" BOOLEAN NOT NULL DEFAULT false,
  "koristi_minuli_rad" BOOLEAN NOT NULL DEFAULT false,
  "seniority_mode" TEXT NOT NULL DEFAULT 'INCLUDED_IN_NET',
  "algoritam" TEXT NOT NULL,
  "aktivan" BOOLEAN NOT NULL DEFAULT true,
  "valid_from" DATE NOT NULL,
  "valid_to" DATE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plate_vrste_obracuna_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plate_vrste_obracuna_sifra_key"
  ON "plate_vrste_obracuna"("sifra");

CREATE TABLE "plate_porez_razredi" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sifra" TEXT NOT NULL,
  "naziv" TEXT NOT NULL,
  "bruto_od" INTEGER NOT NULL,
  "bruto_do" INTEGER,
  "stopa" DECIMAL(8,6) NOT NULL,
  "aktivan" BOOLEAN NOT NULL DEFAULT true,
  "valid_from" DATE NOT NULL,
  "valid_to" DATE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plate_porez_razredi_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "plate_porez_razredi_sifra_aktivan_valid_from_idx"
  ON "plate_porez_razredi"("sifra", "aktivan", "valid_from");

CREATE TABLE "plate_doprinos_stope" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sifra" TEXT NOT NULL,
  "naziv" TEXT NOT NULL,
  "payer_type" TEXT NOT NULL,
  "stopa" DECIMAL(8,6) NOT NULL,
  "aktivan" BOOLEAN NOT NULL DEFAULT true,
  "valid_from" DATE NOT NULL,
  "valid_to" DATE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plate_doprinos_stope_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plate_doprinos_stope_sifra_valid_from_key"
  ON "plate_doprinos_stope"("sifra", "valid_from");
CREATE INDEX "plate_doprinos_stope_payer_type_aktivan_valid_from_idx"
  ON "plate_doprinos_stope"("payer_type", "aktivan", "valid_from");

CREATE TABLE "plate_prirez_stope" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "opstina" TEXT NOT NULL,
  "stopa" DECIMAL(8,6) NOT NULL,
  "aktivan" BOOLEAN NOT NULL DEFAULT true,
  "valid_from" DATE NOT NULL,
  "valid_to" DATE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plate_prirez_stope_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plate_prirez_stope_opstina_valid_from_key"
  ON "plate_prirez_stope"("opstina", "valid_from");
CREATE INDEX "plate_prirez_stope_opstina_aktivan_valid_from_idx"
  ON "plate_prirez_stope"("opstina", "aktivan", "valid_from");

CREATE TABLE "plate_sifre_primanja" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID,
  "firma_id" UUID,
  "sifra" TEXT NOT NULL,
  "naziv" TEXT NOT NULL,
  "skraceni_naziv" TEXT,
  "ioppd_sifra_id" UUID NOT NULL,
  "vrsta_obracuna_id" UUID NOT NULL,
  "kategorija" TEXT NOT NULL DEFAULT 'REDOVAN_RAD',
  "osnovica_tip" TEXT NOT NULL DEFAULT 'NETO',
  "procenat_osnovice" DECIMAL(8,2) NOT NULL DEFAULT 100,
  "koristi_porez" BOOLEAN NOT NULL DEFAULT true,
  "koristi_zaposleni_pio" BOOLEAN NOT NULL DEFAULT true,
  "koristi_zaposleni_zdravstvo" BOOLEAN NOT NULL DEFAULT false,
  "koristi_zaposleni_nezaposleni" BOOLEAN NOT NULL DEFAULT true,
  "koristi_poslodavac_pio" BOOLEAN NOT NULL DEFAULT false,
  "koristi_poslodavac_zdravstvo" BOOLEAN NOT NULL DEFAULT false,
  "koristi_poslodavac_nezaposleni" BOOLEAN NOT NULL DEFAULT true,
  "koristi_fond_rada" BOOLEAN NOT NULL DEFAULT true,
  "koristi_sindikat" BOOLEAN NOT NULL DEFAULT true,
  "koristi_privredna_komora" BOOLEAN NOT NULL DEFAULT true,
  "prikazi_na_ioppd" BOOLEAN NOT NULL DEFAULT true,
  "bez_bruto_iznosa" BOOLEAN NOT NULL DEFAULT false,
  "bez_neto_iznosa" BOOLEAN NOT NULL DEFAULT false,
  "aktivan" BOOLEAN NOT NULL DEFAULT true,
  "valid_from" DATE NOT NULL,
  "valid_to" DATE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" UUID,
  CONSTRAINT "plate_sifre_primanja_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plate_sifre_primanja_agencija_id_firma_id_sifra_valid_from_key"
  ON "plate_sifre_primanja"("agencija_id", "firma_id", "sifra", "valid_from");
CREATE INDEX "plate_sifre_primanja_agencija_id_firma_id_aktivan_idx"
  ON "plate_sifre_primanja"("agencija_id", "firma_id", "aktivan");

CREATE TABLE "plate_radnici" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "redni_broj" INTEGER,
  "ime" TEXT NOT NULL,
  "prezime" TEXT NOT NULL,
  "ime_roditelja" TEXT,
  "jmbg" TEXT,
  "datum_rodjenja" DATE,
  "pol" TEXT,
  "adresa" TEXT,
  "opstina" TEXT,
  "poreska_opstina" TEXT,
  "email" TEXT,
  "telefon" TEXT,
  "tekuci_racun" TEXT,
  "datum_pocetka" DATE,
  "datum_prestanka" DATE,
  "razlog_prestanka" TEXT,
  "aktivan" BOOLEAN NOT NULL DEFAULT true,
  "zaposlen" BOOLEAN NOT NULL DEFAULT true,
  "radno_mjesto" TEXT,
  "organizaciona_jedinica" TEXT,
  "vrsta_radnog_vremena" TEXT,
  "procenat_radnog_vremena" DECIMAL(8,2) NOT NULL DEFAULT 100,
  "mjesecni_sati" INTEGER,
  "koristi_minuli_rad" BOOLEAN NOT NULL DEFAULT false,
  "minuli_rad_godina" INTEGER NOT NULL DEFAULT 0,
  "minuli_rad_mjeseci" INTEGER NOT NULL DEFAULT 0,
  "minuli_rad_dana" INTEGER NOT NULL DEFAULT 0,
  "koeficijent_minuli_rad" DECIMAL(8,4) NOT NULL DEFAULT 0,
  "koeficijent_slozenosti" DECIMAL(14,6),
  "fiksni_dio_cent" INTEGER NOT NULL DEFAULT 0,
  "neto_iznos_cent" INTEGER NOT NULL DEFAULT 0,
  "bruto_iznos_cent" INTEGER NOT NULL DEFAULT 0,
  "podrazumijevana_sifra_id" UUID,
  "podrazumijevana_vrsta_id" UUID,
  "isplata_gotovina" BOOLEAN NOT NULL DEFAULT false,
  "clan_sindikata" BOOLEAN NOT NULL DEFAULT false,
  "invalid" BOOLEAN NOT NULL DEFAULT false,
  "sezonski_rad" BOOLEAN NOT NULL DEFAULT false,
  "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  "deleted_at" TIMESTAMP(3),
  "deleted_by" UUID,
  "delete_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" UUID,
  CONSTRAINT "plate_radnici_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "plate_radnici_agencija_id_firma_id_aktivan_is_deleted_idx"
  ON "plate_radnici"("agencija_id", "firma_id", "aktivan", "is_deleted");
CREATE INDEX "plate_radnici_agencija_id_firma_id_prezime_ime_idx"
  ON "plate_radnici"("agencija_id", "firma_id", "prezime", "ime");

CREATE TABLE "plate_obracuni" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "poslovna_godina_id" UUID NOT NULL,
  "kategorija" TEXT NOT NULL DEFAULT 'REDOVAN_RAD',
  "broj" INTEGER NOT NULL,
  "oznaka" TEXT,
  "godina" INTEGER NOT NULL,
  "mjesec" INTEGER NOT NULL,
  "datum_od" DATE NOT NULL,
  "datum_do" DATE NOT NULL,
  "datum_obracuna" DATE NOT NULL,
  "datum_isplate" DATE,
  "fond_sati" INTEGER NOT NULL,
  "koristi_minuli_rad" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "napomena" TEXT,
  "nalog_id" UUID,
  "calculated_at" TIMESTAMP(3),
  "calculated_by" UUID,
  "posted_at" TIMESTAMP(3),
  "posted_by" UUID,
  "locked_at" TIMESTAMP(3),
  "locked_by" UUID,
  "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  "deleted_at" TIMESTAMP(3),
  "deleted_by" UUID,
  "delete_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" UUID,
  CONSTRAINT "plate_obracuni_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plate_obracuni_firma_id_poslovna_godina_id_kategorija_broj_key"
  ON "plate_obracuni"("firma_id", "poslovna_godina_id", "kategorija", "broj");
CREATE INDEX "plate_obracuni_agencija_id_firma_id_poslovna_godina_id_status_idx"
  ON "plate_obracuni"("agencija_id", "firma_id", "poslovna_godina_id", "status");

CREATE TABLE "plate_obracun_radnici" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "obracun_id" UUID NOT NULL,
  "radnik_id" UUID NOT NULL,
  "snapshot" JSONB NOT NULL,
  "minuli_rad_godina" INTEGER NOT NULL DEFAULT 0,
  "minuli_rad_mjeseci" INTEGER NOT NULL DEFAULT 0,
  "minuli_rad_dana" INTEGER NOT NULL DEFAULT 0,
  "fond_sati" INTEGER NOT NULL,
  "ukupno_sati" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "email_sent" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" UUID,
  CONSTRAINT "plate_obracun_radnici_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plate_obracun_radnici_obracun_id_radnik_id_key"
  ON "plate_obracun_radnici"("obracun_id", "radnik_id");
CREATE INDEX "plate_obracun_radnici_agencija_id_firma_id_obracun_id_idx"
  ON "plate_obracun_radnici"("agencija_id", "firma_id", "obracun_id");

CREATE TABLE "plate_obracun_stavke" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "firma_id" UUID NOT NULL,
  "obracun_id" UUID NOT NULL,
  "radnik_id" UUID NOT NULL,
  "obracun_radnik_id" UUID,
  "redni_broj" INTEGER NOT NULL,
  "sifra_primanja_id" UUID NOT NULL,
  "ioppd_sifra_id" UUID NOT NULL,
  "vrsta_obracuna_id" UUID NOT NULL,
  "sifra_primanja" TEXT NOT NULL,
  "naziv_primanja" TEXT NOT NULL,
  "datum_od" DATE NOT NULL,
  "datum_do" DATE NOT NULL,
  "fond_sati" INTEGER NOT NULL,
  "ukupno_sati" INTEGER NOT NULL,
  "procenat" DECIMAL(8,2) NOT NULL DEFAULT 100,
  "osnovica_cent" INTEGER NOT NULL DEFAULT 0,
  "input_neto_cent" INTEGER NOT NULL DEFAULT 0,
  "input_bruto_cent" INTEGER NOT NULL DEFAULT 0,
  "fiksni_dio_cent" INTEGER NOT NULL DEFAULT 0,
  "koeficijent_slozenosti" DECIMAL(14,6),
  "koeficijent_minuli_rad" DECIMAL(8,4) NOT NULL DEFAULT 0,
  "koristi_minuli_rad" BOOLEAN NOT NULL DEFAULT false,
  "iznos_za_obracun_cent" INTEGER NOT NULL DEFAULT 0,
  "neto_cent" INTEGER NOT NULL DEFAULT 0,
  "bruto_cent" INTEGER NOT NULL DEFAULT 0,
  "oporezivi_bruto_cent" INTEGER NOT NULL DEFAULT 0,
  "porez_cent" INTEGER NOT NULL DEFAULT 0,
  "prirez_cent" INTEGER NOT NULL DEFAULT 0,
  "zaposleni_pio_cent" INTEGER NOT NULL DEFAULT 0,
  "zaposleni_zdravstvo_cent" INTEGER NOT NULL DEFAULT 0,
  "zaposleni_nezaposleni_cent" INTEGER NOT NULL DEFAULT 0,
  "poslodavac_pio_cent" INTEGER NOT NULL DEFAULT 0,
  "poslodavac_zdravstvo_cent" INTEGER NOT NULL DEFAULT 0,
  "poslodavac_nezaposleni_cent" INTEGER NOT NULL DEFAULT 0,
  "fond_rada_cent" INTEGER NOT NULL DEFAULT 0,
  "sindikat_cent" INTEGER NOT NULL DEFAULT 0,
  "privredna_komora_cent" INTEGER NOT NULL DEFAULT 0,
  "doprinosi_zaposleni_cent" INTEGER NOT NULL DEFAULT 0,
  "doprinosi_poslodavac_cent" INTEGER NOT NULL DEFAULT 0,
  "ukupni_trosak_cent" INTEGER NOT NULL DEFAULT 0,
  "neto_za_isplatu_cent" INTEGER NOT NULL DEFAULT 0,
  "stopa_prireza" DECIMAL(8,6) NOT NULL DEFAULT 0,
  "detalji" JSONB,
  "status" TEXT NOT NULL DEFAULT 'CALCULATED',
  "warning_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" UUID,
  CONSTRAINT "plate_obracun_stavke_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "plate_obracun_stavke_agencija_id_firma_id_obracun_id_idx"
  ON "plate_obracun_stavke"("agencija_id", "firma_id", "obracun_id");
CREATE INDEX "plate_obracun_stavke_obracun_id_radnik_id_idx"
  ON "plate_obracun_stavke"("obracun_id", "radnik_id");

ALTER TABLE "plate_obracun_radnici"
  ADD CONSTRAINT "plate_obracun_radnici_obracun_id_fkey"
  FOREIGN KEY ("obracun_id") REFERENCES "plate_obracuni"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "plate_obracun_stavke"
  ADD CONSTRAINT "plate_obracun_stavke_obracun_id_fkey"
  FOREIGN KEY ("obracun_id") REFERENCES "plate_obracuni"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "plate_ioppd_sifre" ("sifra", "naziv", "kategorija", "valid_from", "updated_at")
VALUES
  ('001', 'Zarada', 'REDOVAN_RAD', '2026-01-01', CURRENT_TIMESTAMP),
  ('006', 'Naknada zarade za vrijeme privremene spriječenosti za rad (bolovanje) do 60 dana', 'BOLOVANJE', '2026-01-01', CURRENT_TIMESTAMP),
  ('007', 'Naknada zarade za vrijeme privremene spriječenosti za rad (bolovanje) preko 60 dana', 'BOLOVANJE', '2026-01-01', CURRENT_TIMESTAMP),
  ('047', 'Ugovorena naknada (ugovor o djelu, autorski ugovor i dr.)', 'UGOVOR_O_DJELU', '2026-01-01', CURRENT_TIMESTAMP),
  ('065', 'Prihod od imovine i imovinskih prava', 'ZAKUP', '2026-01-01', CURRENT_TIMESTAMP),
  ('066', 'Prihod od kapitala', 'KAPITAL', '2026-01-01', CURRENT_TIMESTAMP),
  ('097', 'Lična primanja čiji ukupni bruto iznos je iznad iznosa od 700 EUR', 'REDOVAN_RAD', '2026-01-01', CURRENT_TIMESTAMP);

INSERT INTO "plate_vrste_obracuna" (
  "sifra", "naziv", "input_type", "koristi_neto", "koristi_bruto",
  "koristi_koeficijent", "koristi_minuli_rad", "algoritam", "valid_from", "updated_at"
)
VALUES
  ('GROSS_WITHOUT_SENIORITY', 'Bruto bez minulog rada', 'GROSS', false, true, false, false, 'GROSS_TO_NET', '2026-01-01', CURRENT_TIMESTAMP),
  ('GROSS_WITH_SENIORITY', 'Bruto sa minulim radom', 'GROSS', false, true, false, true, 'GROSS_TO_NET', '2026-01-01', CURRENT_TIMESTAMP),
  ('NET_WITHOUT_SENIORITY', 'Neto bez minulog rada', 'NET', true, false, false, false, 'NET_TO_GROSS', '2026-01-01', CURRENT_TIMESTAMP),
  ('NET_WITH_SENIORITY', 'Neto sa minulim radom', 'NET', true, false, false, true, 'NET_TO_GROSS', '2026-01-01', CURRENT_TIMESTAMP),
  ('COEFFICIENT_WITH_SENIORITY', 'Bruto iz koeficijenata i minulog rada', 'COEFFICIENT', false, false, true, true, 'COEFFICIENT_TO_GROSS', '2026-01-01', CURRENT_TIMESTAMP),
  ('COEFFICIENT_NET_RECALCULATION', 'Preračunati neto iz koeficijenata', 'COEFFICIENT', true, false, true, false, 'COEFFICIENT_TO_NET', '2026-01-01', CURRENT_TIMESTAMP),
  ('COEFFICIENT_WITHOUT_SENIORITY', 'Bruto iz koeficijenata bez minulog rada', 'COEFFICIENT', false, false, true, false, 'COEFFICIENT_TO_GROSS', '2026-01-01', CURRENT_TIMESTAMP);

INSERT INTO "plate_porez_razredi" ("sifra", "naziv", "bruto_od", "bruto_do", "stopa", "valid_from", "updated_at")
VALUES
  ('REGULAR_SALARY', 'Porez 0% do 700 EUR bruto', 0, 70000, 0.000000, '2026-01-01', CURRENT_TIMESTAMP),
  ('REGULAR_SALARY', 'Porez 9% od 700 do 1000 EUR bruto', 70000, 100000, 0.090000, '2026-01-01', CURRENT_TIMESTAMP),
  ('REGULAR_SALARY', 'Porez 15% preko 1000 EUR bruto', 100000, NULL, 0.150000, '2026-01-01', CURRENT_TIMESTAMP);

INSERT INTO "plate_doprinos_stope" ("sifra", "naziv", "payer_type", "stopa", "valid_from", "updated_at")
VALUES
  ('EMPLOYEE_PIO', 'PIO na teret zaposlenog', 'EMPLOYEE', 0.100000, '2026-01-01', CURRENT_TIMESTAMP),
  ('EMPLOYEE_HEALTH', 'Zdravstvo na teret zaposlenog', 'EMPLOYEE', 0.000000, '2026-01-01', CURRENT_TIMESTAMP),
  ('EMPLOYEE_UNEMPLOYMENT', 'Nezaposlenost na teret zaposlenog', 'EMPLOYEE', 0.005000, '2026-01-01', CURRENT_TIMESTAMP),
  ('EMPLOYER_PIO', 'PIO na teret poslodavca', 'EMPLOYER', 0.000000, '2026-01-01', CURRENT_TIMESTAMP),
  ('EMPLOYER_HEALTH', 'Zdravstvo na teret poslodavca', 'EMPLOYER', 0.000000, '2026-01-01', CURRENT_TIMESTAMP),
  ('EMPLOYER_UNEMPLOYMENT', 'Nezaposlenost na teret poslodavca', 'EMPLOYER', 0.005000, '2026-01-01', CURRENT_TIMESTAMP),
  ('LABOR_FUND', 'Fond rada', 'OTHER', 0.002000, '2026-01-01', CURRENT_TIMESTAMP),
  ('UNION', 'Sindikat', 'OTHER', 0.002000, '2026-01-01', CURRENT_TIMESTAMP),
  ('CHAMBER', 'Privredna komora', 'OTHER', 0.002700, '2026-01-01', CURRENT_TIMESTAMP);

INSERT INTO "plate_prirez_stope" ("opstina", "stopa", "valid_from", "updated_at")
VALUES
  ('BAR', 0.130000, '2026-01-01', CURRENT_TIMESTAMP),
  ('PODGORICA', 0.150000, '2026-01-01', CURRENT_TIMESTAMP);

INSERT INTO "plate_sifre_primanja" (
  "agencija_id", "firma_id", "sifra", "naziv", "skraceni_naziv",
  "ioppd_sifra_id", "vrsta_obracuna_id", "kategorija", "osnovica_tip",
  "valid_from", "updated_at"
)
SELECT
  NULL,
  NULL,
  '001',
  'Zarada',
  'Zarada',
  ioppd.id,
  vrsta.id,
  'REDOVAN_RAD',
  'NETO',
  '2026-01-01',
  CURRENT_TIMESTAMP
FROM "plate_ioppd_sifre" ioppd
CROSS JOIN "plate_vrste_obracuna" vrsta
WHERE ioppd.sifra = '001'
  AND vrsta.sifra = 'NET_WITHOUT_SENIORITY';
