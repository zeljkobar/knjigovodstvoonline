ALTER TABLE "vrste_naloga" ADD COLUMN "agencija_id" UUID;
ALTER TABLE "vrste_naloga" ADD COLUMN "firma_id" UUID;
ALTER TABLE "vrste_naloga" ADD COLUMN "sistemska" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "vrste_naloga" ADD COLUMN "prefiks" TEXT;
ALTER TABLE "vrste_naloga" ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "vrste_naloga" ADD COLUMN "created_by" UUID;
ALTER TABLE "vrste_naloga" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "vrste_naloga" ADD COLUMN "updated_by" UUID;

ALTER TABLE "nalozi" ADD COLUMN "agencija_id" UUID;
ALTER TABLE "nalozi" ADD COLUMN "sifra" TEXT;
ALTER TABLE "nalozi" ADD COLUMN "datum_knjizenja" DATE;
ALTER TABLE "nalozi" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "nalozi" ADD COLUMN "source_type" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "nalozi" ADD COLUMN "source_module" TEXT;
ALTER TABLE "nalozi" ADD COLUMN "source_sync_status" TEXT;
ALTER TABLE "nalozi" ADD COLUMN "created_by" UUID;
ALTER TABLE "nalozi" ADD COLUMN "updated_by" UUID;
ALTER TABLE "nalozi" ADD COLUMN "proknjizen_at" TIMESTAMP(3);
ALTER TABLE "nalozi" ADD COLUMN "proknjizen_by" UUID;
ALTER TABLE "nalozi" ADD COLUMN "vracen_u_nacrt_at" TIMESTAMP(3);
ALTER TABLE "nalozi" ADD COLUMN "vracen_u_nacrt_by" UUID;
ALTER TABLE "nalozi" ADD COLUMN "is_deleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "nalozi" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "nalozi" ADD COLUMN "deleted_by" UUID;
ALTER TABLE "nalozi" ADD COLUMN "delete_reason" TEXT;

UPDATE "nalozi"
SET "agencija_id" = "firme"."agencija_id",
    "created_by" = "nalozi"."kreirao_korisnik_id"
FROM "firme"
WHERE "nalozi"."firma_id" = "firme"."id";

ALTER TABLE "stavke_naloga" ADD COLUMN "created_by" UUID;
ALTER TABLE "stavke_naloga" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "stavke_naloga" ADD COLUMN "updated_by" UUID;

DROP INDEX IF EXISTS "nalozi_firma_id_poslovna_godina_id_broj_key";
CREATE UNIQUE INDEX "nalozi_firma_id_poslovna_godina_id_vrsta_naloga_id_broj_key"
ON "nalozi"("firma_id", "poslovna_godina_id", "vrsta_naloga_id", "broj");

CREATE INDEX "nalozi_agencija_id_firma_id_poslovna_godina_id_status_idx"
ON "nalozi"("agencija_id", "firma_id", "poslovna_godina_id", "status");

CREATE UNIQUE INDEX "stavke_naloga_nalog_id_redni_broj_key"
ON "stavke_naloga"("nalog_id", "redni_broj");

INSERT INTO "vrste_naloga" ("sifra", "naziv", "opis", "sistemska", "prefiks", "aktivan", "created_at", "updated_at")
VALUES
  ('OPENING_BALANCE', 'Početno stanje', 'Početno stanje poslovne godine.', true, 'PS', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('INCOMING_INVOICE', 'Ulazni računi', 'Knjiženje ulaznih računa.', true, 'UR', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('OUTGOING_INVOICE', 'Izlazni računi', 'Knjiženje izlaznih računa.', true, 'IR', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('CALCULATION', 'Kalkulacije', 'Knjiženje kalkulacija i robnih dokumenata.', true, 'KAL', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('BANK_STATEMENT', 'Izvodi', 'Knjiženje bankovnih izvoda.', true, 'IZV', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('PAYROLL', 'Plate', 'Knjiženje obračuna plata.', true, 'PL', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('CASH_REGISTER', 'Blagajna', 'Knjiženje blagajne.', true, 'BLG', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('DEPRECIATION', 'Amortizacija', 'Knjiženje amortizacije.', true, 'AM', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('FINAL_ACCOUNT', 'Završni račun', 'Zaključna knjiženja završnog računa.', true, 'ZR', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('MANUAL', 'Ručni nalog', 'Ručni nalog za knjiženje.', true, 'RN', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('CORRECTION', 'Korektivni nalog', 'Korektivna knjiženja.', true, 'KOR', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("sifra") DO UPDATE SET
  "naziv" = EXCLUDED."naziv",
  "opis" = EXCLUDED."opis",
  "sistemska" = true,
  "prefiks" = EXCLUDED."prefiks",
  "aktivan" = true,
  "updated_at" = CURRENT_TIMESTAMP;
