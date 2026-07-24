CREATE TABLE "plate_kontiranje_podesavanja" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agencija_id" uuid NOT NULL REFERENCES "agencije"("id"),
  "firma_id" uuid NOT NULL REFERENCES "firme"("id"),
  "poslovna_godina_id" uuid NOT NULL REFERENCES "poslovne_godine"("id"),
  "kategorija" text NOT NULL,
  "vrsta_naloga_id" uuid REFERENCES "vrste_naloga"("id") ON DELETE SET NULL,
  "opis_naloga" text NOT NULL DEFAULT 'Obračun {kategorija} za {mjesec}/{godina}',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "created_by" uuid,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "updated_by" uuid,
  CONSTRAINT "plate_kontiranje_podesavanja_kategorija_check"
    CHECK ("kategorija" IN ('REDOVAN_RAD', 'UGOVOR_O_DJELU', 'ZAKUP', 'OSTALI_UGOVORI'))
);

CREATE UNIQUE INDEX "plate_kontiranje_podesavanja_firma_godina_kategorija_key"
  ON "plate_kontiranje_podesavanja"("firma_id", "poslovna_godina_id", "kategorija");

CREATE INDEX "plate_kontiranje_podesavanja_scope_idx"
  ON "plate_kontiranje_podesavanja"("agencija_id", "firma_id", "poslovna_godina_id", "kategorija");

CREATE INDEX "plate_kontiranje_podesavanja_vrsta_naloga_id_idx"
  ON "plate_kontiranje_podesavanja"("vrsta_naloga_id");

CREATE TABLE "plate_kontiranje_pravila" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "podesavanje_id" uuid NOT NULL REFERENCES "plate_kontiranje_podesavanja"("id") ON DELETE CASCADE,
  "komponenta" text NOT NULL,
  "naziv" text NOT NULL,
  "grupa" text NOT NULL,
  "izvorno_polje" text NOT NULL,
  "duguje_konto_id" uuid REFERENCES "firma_konta"("id") ON DELETE SET NULL,
  "potrazuje_konto_id" uuid REFERENCES "firma_konta"("id") ON DELETE SET NULL,
  "aktivan" boolean NOT NULL DEFAULT true,
  "redosljed" integer NOT NULL,
  "napomena" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "created_by" uuid,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "updated_by" uuid
);

CREATE UNIQUE INDEX "plate_kontiranje_pravila_podesavanje_komponenta_key"
  ON "plate_kontiranje_pravila"("podesavanje_id", "komponenta");

CREATE INDEX "plate_kontiranje_pravila_duguje_konto_id_idx"
  ON "plate_kontiranje_pravila"("duguje_konto_id");

CREATE INDEX "plate_kontiranje_pravila_potrazuje_konto_id_idx"
  ON "plate_kontiranje_pravila"("potrazuje_konto_id");
