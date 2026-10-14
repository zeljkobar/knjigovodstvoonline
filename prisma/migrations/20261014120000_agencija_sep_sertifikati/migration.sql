CREATE TABLE "agencija_sep_sertifikati" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL REFERENCES "agencije"("id") ON DELETE RESTRICT,
  "korisnik_id" UUID NOT NULL REFERENCES "korisnici"("id") ON DELETE RESTRICT,
  "naziv" TEXT NOT NULL,
  "sifrovani_podaci" TEXT,
  "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  "deleted_at" TIMESTAMP(3),
  "deleted_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agencija_sep_sertifikati_agencija_id_korisnik_id_key" UNIQUE ("agencija_id", "korisnik_id")
);
