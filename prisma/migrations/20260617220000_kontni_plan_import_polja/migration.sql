ALTER TABLE "konta" ADD COLUMN "normalni_saldo" TEXT;
ALTER TABLE "konta" ADD COLUMN "koristi_radnu_jedinicu" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "agencija_konta" ADD COLUMN "normalni_saldo" TEXT;
ALTER TABLE "agencija_konta" ADD COLUMN "koristi_radnu_jedinicu" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "firma_konta" ADD COLUMN "normalni_saldo" TEXT;
ALTER TABLE "firma_konta" ADD COLUMN "koristi_radnu_jedinicu" BOOLEAN NOT NULL DEFAULT false;
