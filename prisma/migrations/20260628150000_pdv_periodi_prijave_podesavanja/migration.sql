CREATE TABLE "pdv_periodi" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agencija_id" uuid NOT NULL REFERENCES "agencije"("id"),
  "firma_id" uuid NOT NULL REFERENCES "firme"("id"),
  "poslovna_godina_id" uuid NOT NULL REFERENCES "poslovne_godine"("id"),
  "mjesec" integer NOT NULL,
  "datum_od" date NOT NULL,
  "datum_do" date NOT NULL,
  "status" text NOT NULL DEFAULT 'OPEN',
  "ready_at" timestamp,
  "submitted_at" timestamp,
  "submitted_by" uuid,
  "locked_at" timestamp,
  "locked_by" uuid,
  "note" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "created_by" uuid,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "updated_by" uuid,
  CONSTRAINT "pdv_periodi_mjesec_check" CHECK ("mjesec" BETWEEN 1 AND 12),
  CONSTRAINT "pdv_periodi_status_check" CHECK ("status" IN ('OPEN', 'READY', 'SUBMITTED', 'LOCKED', 'REOPENED'))
);

CREATE UNIQUE INDEX "pdv_periodi_firma_id_poslovna_godina_id_mjesec_key"
  ON "pdv_periodi"("firma_id", "poslovna_godina_id", "mjesec");
CREATE INDEX "pdv_periodi_agencija_id_firma_id_poslovna_godina_id_status_idx"
  ON "pdv_periodi"("agencija_id", "firma_id", "poslovna_godina_id", "status");

CREATE TABLE "pdv_prijave" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agencija_id" uuid NOT NULL REFERENCES "agencije"("id"),
  "firma_id" uuid NOT NULL REFERENCES "firme"("id"),
  "poslovna_godina_id" uuid NOT NULL REFERENCES "poslovne_godine"("id"),
  "pdv_period_id" uuid NOT NULL REFERENCES "pdv_periodi"("id"),
  "status" text NOT NULL DEFAULT 'DRAFT',
  "total_output_vat" numeric(14,2) NOT NULL DEFAULT 0,
  "total_input_vat" numeric(14,2) NOT NULL DEFAULT 0,
  "deductible_vat" numeric(14,2) NOT NULL DEFAULT 0,
  "non_deductible_vat" numeric(14,2) NOT NULL DEFAULT 0,
  "payable_vat" numeric(14,2) NOT NULL DEFAULT 0,
  "credit_vat" numeric(14,2) NOT NULL DEFAULT 0,
  "xml_generated_at" timestamp,
  "posted_at" timestamp,
  "posted_by" uuid,
  "journal_id" uuid REFERENCES "nalozi"("id"),
  "note" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "created_by" uuid,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "updated_by" uuid,
  CONSTRAINT "pdv_prijave_status_check" CHECK ("status" IN ('DRAFT', 'READY', 'SUBMITTED', 'POSTED', 'LOCKED'))
);

CREATE UNIQUE INDEX "pdv_prijave_pdv_period_id_key"
  ON "pdv_prijave"("pdv_period_id");
CREATE INDEX "pdv_prijave_agencija_id_firma_id_poslovna_godina_id_status_idx"
  ON "pdv_prijave"("agencija_id", "firma_id", "poslovna_godina_id", "status");
CREATE INDEX "pdv_prijave_journal_id_idx"
  ON "pdv_prijave"("journal_id");

CREATE TABLE "pdv_prijava_stavke" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "pdv_prijava_id" uuid NOT NULL REFERENCES "pdv_prijave"("id") ON DELETE CASCADE,
  "sifra" text NOT NULL,
  "opis" text NOT NULL,
  "kolona" text NOT NULL,
  "redosljed" integer NOT NULL,
  "sistemska_vrijednost" numeric(14,2) NOT NULL DEFAULT 0,
  "rucna_vrijednost" numeric(14,2),
  "razlog_korekcije" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "pdv_prijava_stavke_kolona_check" CHECK ("kolona" IN ('OUTPUT', 'INPUT', 'CHECK'))
);

CREATE UNIQUE INDEX "pdv_prijava_stavke_pdv_prijava_id_sifra_kolona_key"
  ON "pdv_prijava_stavke"("pdv_prijava_id", "sifra", "kolona");
CREATE INDEX "pdv_prijava_stavke_pdv_prijava_id_redosljed_idx"
  ON "pdv_prijava_stavke"("pdv_prijava_id", "redosljed");

CREATE TABLE "pdv_podesavanja" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agencija_id" uuid NOT NULL REFERENCES "agencije"("id"),
  "firma_id" uuid NOT NULL REFERENCES "firme"("id"),
  "poslovna_godina_id" uuid NOT NULL REFERENCES "poslovne_godine"("id"),
  "vrsta_naloga_id" uuid REFERENCES "vrste_naloga"("id"),
  "izlazni_pdv_konto_id" uuid REFERENCES "firma_konta"("id"),
  "ulazni_pdv_konto_id" uuid REFERENCES "firma_konta"("id"),
  "obaveza_pdv_konto_id" uuid REFERENCES "firma_konta"("id"),
  "pdv_kredit_konto_id" uuid REFERENCES "firma_konta"("id"),
  "neodbitni_pdv_konto_id" uuid REFERENCES "firma_konta"("id"),
  "opis_naloga" text NOT NULL DEFAULT 'PDV prijava za period {period}',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "created_by" uuid,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "updated_by" uuid
);

CREATE UNIQUE INDEX "pdv_podesavanja_firma_id_poslovna_godina_id_key"
  ON "pdv_podesavanja"("firma_id", "poslovna_godina_id");
CREATE INDEX "pdv_podesavanja_agencija_id_firma_id_poslovna_godina_id_idx"
  ON "pdv_podesavanja"("agencija_id", "firma_id", "poslovna_godina_id");
