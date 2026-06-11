-- Modul 01: pretplate, granularna prava, soft delete i prosiren audit log.

ALTER TABLE "agencije"
  ADD COLUMN "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by" UUID,
  ADD COLUMN "delete_reason" TEXT,
  ADD COLUMN "created_by" UUID,
  ADD COLUMN "updated_by" UUID;

ALTER TABLE "korisnici"
  ADD COLUMN "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by" UUID,
  ADD COLUMN "delete_reason" TEXT,
  ADD COLUMN "created_by" UUID,
  ADD COLUMN "updated_by" UUID;

ALTER TABLE "firme"
  ADD COLUMN "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by" UUID,
  ADD COLUMN "delete_reason" TEXT,
  ADD COLUMN "created_by" UUID,
  ADD COLUMN "updated_by" UUID;

ALTER TABLE "korisnik_firma"
  ADD COLUMN "access_type" TEXT,
  ADD COLUMN "glavni_radnik" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "valid_from" TIMESTAMP(3),
  ADD COLUMN "valid_to" TIMESTAMP(3),
  ADD COLUMN "is_deleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by" UUID,
  ADD COLUMN "delete_reason" TEXT,
  ADD COLUMN "created_by" UUID,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_by" UUID;

ALTER TABLE "audit_log"
  ADD COLUMN "modul" TEXT,
  ADD COLUMN "user_agent" TEXT,
  ADD COLUMN "napomena" TEXT;

CREATE TABLE "agencija_pretplate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "paket" TEXT NOT NULL,
  "pocinje_at" DATE NOT NULL,
  "istice_at" DATE NOT NULL,
  "status" TEXT NOT NULL,
  "max_firmi" INTEGER,
  "max_korisnika" INTEGER,
  "napomena" TEXT,
  "zadnja_obnova_at" TIMESTAMP(3),
  "obnovio_korisnik_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" UUID,

  CONSTRAINT "agencija_pretplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "korisnik_prava" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID NOT NULL,
  "korisnik_id" UUID NOT NULL,
  "firma_id" UUID,
  "modul" TEXT NOT NULL,
  "akcija" TEXT NOT NULL,
  "dozvoljeno" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" UUID,

  CONSTRAINT "korisnik_prava_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "aktivnost_dogadjaji" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agencija_id" UUID,
  "firma_id" UUID,
  "korisnik_id" UUID,
  "modul" TEXT NOT NULL,
  "akcija" TEXT NOT NULL,
  "tip_entiteta" TEXT NOT NULL,
  "entitet_id" UUID,
  "activity_date" DATE NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "aktivnost_dogadjaji_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agencija_pretplate_agencija_id_status_idx" ON "agencija_pretplate"("agencija_id", "status");

CREATE UNIQUE INDEX "korisnik_prava_agencija_id_korisnik_id_firma_id_modul_akcija_key"
  ON "korisnik_prava"("agencija_id", "korisnik_id", "firma_id", "modul", "akcija");
CREATE INDEX "korisnik_prava_korisnik_id_firma_id_modul_idx" ON "korisnik_prava"("korisnik_id", "firma_id", "modul");

CREATE INDEX "aktivnost_dogadjaji_agencija_id_korisnik_id_activity_date_idx"
  ON "aktivnost_dogadjaji"("agencija_id", "korisnik_id", "activity_date");
CREATE INDEX "aktivnost_dogadjaji_agencija_id_firma_id_activity_date_idx"
  ON "aktivnost_dogadjaji"("agencija_id", "firma_id", "activity_date");
CREATE INDEX "aktivnost_dogadjaji_agencija_id_modul_akcija_idx"
  ON "aktivnost_dogadjaji"("agencija_id", "modul", "akcija");

CREATE INDEX "audit_log_agencija_id_created_at_idx" ON "audit_log"("agencija_id", "created_at");
CREATE INDEX "audit_log_korisnik_id_created_at_idx" ON "audit_log"("korisnik_id", "created_at");
CREATE INDEX "audit_log_firma_id_created_at_idx" ON "audit_log"("firma_id", "created_at");
CREATE INDEX "audit_log_modul_akcija_idx" ON "audit_log"("modul", "akcija");

ALTER TABLE "agencija_pretplate"
  ADD CONSTRAINT "agencija_pretplate_agencija_id_fkey"
  FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agencija_pretplate"
  ADD CONSTRAINT "agencija_pretplate_obnovio_korisnik_id_fkey"
  FOREIGN KEY ("obnovio_korisnik_id") REFERENCES "korisnici"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "korisnik_prava"
  ADD CONSTRAINT "korisnik_prava_agencija_id_fkey"
  FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "korisnik_prava"
  ADD CONSTRAINT "korisnik_prava_korisnik_id_fkey"
  FOREIGN KEY ("korisnik_id") REFERENCES "korisnici"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "korisnik_prava"
  ADD CONSTRAINT "korisnik_prava_firma_id_fkey"
  FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "aktivnost_dogadjaji"
  ADD CONSTRAINT "aktivnost_dogadjaji_agencija_id_fkey"
  FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "aktivnost_dogadjaji"
  ADD CONSTRAINT "aktivnost_dogadjaji_firma_id_fkey"
  FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "aktivnost_dogadjaji"
  ADD CONSTRAINT "aktivnost_dogadjaji_korisnik_id_fkey"
  FOREIGN KEY ("korisnik_id") REFERENCES "korisnici"("id") ON DELETE SET NULL ON UPDATE CASCADE;
