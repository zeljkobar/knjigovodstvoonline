ALTER TABLE "firme"
  ADD COLUMN "dozvoli_negativan_lager" boolean NOT NULL DEFAULT false;

CREATE TABLE "jedinice_mjere" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sifra" text NOT NULL UNIQUE,
  "naziv" text NOT NULL,
  "oznaka" text NOT NULL,
  "decimalna_mjesta" integer NOT NULL DEFAULT 3,
  "redosljed" integer NOT NULL DEFAULT 0,
  "aktivna" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "jedinice_mjere_decimalna_mjesta_check"
    CHECK ("decimalna_mjesta" BETWEEN 0 AND 6)
);

CREATE INDEX "jedinice_mjere_aktivna_redosljed_idx"
  ON "jedinice_mjere"("aktivna", "redosljed");

INSERT INTO "jedinice_mjere"
  ("sifra", "naziv", "oznaka", "decimalna_mjesta", "redosljed")
VALUES
  ('KOM', 'Komad', 'kom', 0, 10),
  ('PAK', 'Pakovanje', 'pak', 0, 20),
  ('KG', 'Kilogram', 'kg', 3, 30),
  ('G', 'Gram', 'g', 3, 40),
  ('T', 'Tona', 't', 3, 50),
  ('L', 'Litar', 'l', 3, 60),
  ('ML', 'Mililitar', 'ml', 3, 70),
  ('M', 'Metar', 'm', 3, 80),
  ('M2', 'Kvadratni metar', 'm²', 3, 90),
  ('M3', 'Kubni metar', 'm³', 3, 100),
  ('SAT', 'Sat', 'sat', 2, 110),
  ('DAN', 'Dan', 'dan', 2, 120);

CREATE TABLE "grupe_artikala" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agencija_id" uuid NOT NULL REFERENCES "agencije"("id"),
  "firma_id" uuid NOT NULL REFERENCES "firme"("id"),
  "sifra" text NOT NULL,
  "naziv" text NOT NULL,
  "aktivna" boolean NOT NULL DEFAULT true,
  "napomena" text,
  "is_deleted" boolean NOT NULL DEFAULT false,
  "deleted_at" timestamp,
  "deleted_by" uuid,
  "delete_reason" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "created_by" uuid,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "updated_by" uuid
);

CREATE UNIQUE INDEX "grupe_artikala_firma_sifra_key"
  ON "grupe_artikala"("firma_id", "sifra");
CREATE INDEX "grupe_artikala_scope_idx"
  ON "grupe_artikala"("agencija_id", "firma_id", "aktivna", "is_deleted");
CREATE INDEX "grupe_artikala_firma_naziv_idx"
  ON "grupe_artikala"("firma_id", "naziv");

CREATE TABLE "magacini" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agencija_id" uuid NOT NULL REFERENCES "agencije"("id"),
  "firma_id" uuid NOT NULL REFERENCES "firme"("id"),
  "sifra" text NOT NULL,
  "naziv" text NOT NULL,
  "dozvoli_negativan_lager" boolean,
  "aktivan" boolean NOT NULL DEFAULT true,
  "napomena" text,
  "is_deleted" boolean NOT NULL DEFAULT false,
  "deleted_at" timestamp,
  "deleted_by" uuid,
  "delete_reason" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "created_by" uuid,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "updated_by" uuid
);

CREATE UNIQUE INDEX "magacini_firma_sifra_key"
  ON "magacini"("firma_id", "sifra");
CREATE INDEX "magacini_scope_idx"
  ON "magacini"("agencija_id", "firma_id", "aktivan", "is_deleted");
CREATE INDEX "magacini_firma_naziv_idx"
  ON "magacini"("firma_id", "naziv");

CREATE TABLE "artikli" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agencija_id" uuid NOT NULL REFERENCES "agencije"("id"),
  "firma_id" uuid NOT NULL REFERENCES "firme"("id"),
  "grupa_artikla_id" uuid REFERENCES "grupe_artikala"("id") ON DELETE SET NULL,
  "jedinica_mjere_id" uuid NOT NULL REFERENCES "jedinice_mjere"("id"),
  "pdv_stopa_id" uuid REFERENCES "pdv_stope"("id") ON DELETE SET NULL,
  "sifra" text NOT NULL,
  "naziv" text NOT NULL,
  "barkod" text,
  "usluga" boolean NOT NULL DEFAULT false,
  "prati_zalihe" boolean NOT NULL DEFAULT true,
  "posljednja_nabavna_cijena" numeric(14,2),
  "aktivan" boolean NOT NULL DEFAULT true,
  "napomena" text,
  "is_deleted" boolean NOT NULL DEFAULT false,
  "deleted_at" timestamp,
  "deleted_by" uuid,
  "delete_reason" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "created_by" uuid,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "updated_by" uuid,
  CONSTRAINT "artikli_usluga_bez_lagera_check"
    CHECK (NOT "usluga" OR NOT "prati_zalihe"),
  CONSTRAINT "artikli_nabavna_cijena_check"
    CHECK ("posljednja_nabavna_cijena" IS NULL OR "posljednja_nabavna_cijena" >= 0)
);

CREATE UNIQUE INDEX "artikli_firma_sifra_key"
  ON "artikli"("firma_id", "sifra");
CREATE UNIQUE INDEX "artikli_firma_barkod_key"
  ON "artikli"("firma_id", "barkod");
CREATE INDEX "artikli_scope_idx"
  ON "artikli"("agencija_id", "firma_id", "aktivan", "is_deleted");
CREATE INDEX "artikli_firma_naziv_idx"
  ON "artikli"("firma_id", "naziv");
CREATE INDEX "artikli_grupa_artikla_id_idx"
  ON "artikli"("grupa_artikla_id");
CREATE INDEX "artikli_jedinica_mjere_id_idx"
  ON "artikli"("jedinica_mjere_id");
CREATE INDEX "artikli_pdv_stopa_id_idx"
  ON "artikli"("pdv_stopa_id");

CREATE TABLE "cijene_artikala" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agencija_id" uuid NOT NULL REFERENCES "agencije"("id"),
  "firma_id" uuid NOT NULL REFERENCES "firme"("id"),
  "artikal_id" uuid NOT NULL REFERENCES "artikli"("id"),
  "tip" text NOT NULL,
  "cijena_bez_pdv" numeric(14,2) NOT NULL,
  "cijena_sa_pdv" numeric(14,2) NOT NULL,
  "pdv_stopa_procenat" numeric(5,2) NOT NULL DEFAULT 0,
  "valuta" text NOT NULL DEFAULT 'EUR',
  "magacin_id" uuid REFERENCES "magacini"("id") ON DELETE SET NULL,
  "komitent_id" uuid REFERENCES "komitenti"("id") ON DELETE SET NULL,
  "vazi_od" date,
  "vazi_do" date,
  "aktivna" boolean NOT NULL DEFAULT true,
  "napomena" text,
  "is_deleted" boolean NOT NULL DEFAULT false,
  "deleted_at" timestamp,
  "deleted_by" uuid,
  "delete_reason" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "created_by" uuid,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "updated_by" uuid,
  CONSTRAINT "cijene_artikala_tip_check"
    CHECK ("tip" IN (
      'NABAVNA',
      'VELEPRODAJNA',
      'MALOPRODAJNA',
      'AKCIJSKA',
      'PO_KUPCU',
      'PO_MAGACINU'
    )),
  CONSTRAINT "cijene_artikala_iznosi_check"
    CHECK ("cijena_bez_pdv" >= 0 AND "cijena_sa_pdv" >= 0),
  CONSTRAINT "cijene_artikala_vazenje_check"
    CHECK ("vazi_od" IS NULL OR "vazi_do" IS NULL OR "vazi_do" >= "vazi_od")
);

CREATE INDEX "cijene_artikala_scope_idx"
  ON "cijene_artikala"("agencija_id", "firma_id", "aktivna", "is_deleted");
CREATE INDEX "cijene_artikala_artikal_tip_vazenje_idx"
  ON "cijene_artikala"("artikal_id", "tip", "vazi_od", "vazi_do");
CREATE INDEX "cijene_artikala_magacin_id_idx"
  ON "cijene_artikala"("magacin_id");
CREATE INDEX "cijene_artikala_komitent_id_idx"
  ON "cijene_artikala"("komitent_id");
