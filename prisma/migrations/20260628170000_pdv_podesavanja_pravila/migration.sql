CREATE TABLE "pdv_podesavanja_pravila" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "pdv_podesavanja_id" uuid NOT NULL REFERENCES "pdv_podesavanja"("id") ON DELETE CASCADE,
  "polje_sifra" text NOT NULL,
  "polje_naziv" text NOT NULL,
  "pdv_stopa_sifra" text,
  "smjer" text NOT NULL DEFAULT 'D',
  "konto_id" uuid REFERENCES "firma_konta"("id"),
  "redosljed" integer NOT NULL DEFAULT 0,
  "aktivno" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "pdv_podesavanja_pravila_smjer_check" CHECK ("smjer" IN ('D', 'P'))
);

CREATE UNIQUE INDEX "pdv_podesavanja_pravila_pdv_podesavanja_id_polje_sifra_key"
  ON "pdv_podesavanja_pravila"("pdv_podesavanja_id", "polje_sifra");
CREATE INDEX "pdv_podesavanja_pravila_konto_id_idx"
  ON "pdv_podesavanja_pravila"("konto_id");
