CREATE TABLE "dokumenta_onedrive" (
    "agencija_id" UUID PRIMARY KEY REFERENCES "agencije"("id") ON DELETE CASCADE,
    "drive_id" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "dokumenta_folderi" (
    "firma_id" UUID PRIMARY KEY REFERENCES "firme"("id") ON DELETE CASCADE,
    "agencija_id" UUID NOT NULL,
    "drive_id" TEXT NOT NULL,
    "folder_id" TEXT NOT NULL,
    UNIQUE ("drive_id", "folder_id")
);

CREATE TABLE "primljeni_dokumenti" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "agencija_id" UUID NOT NULL,
    "firma_id" UUID NOT NULL REFERENCES "firme"("id"),
    "poslovna_godina_id" UUID NOT NULL REFERENCES "poslovne_godine"("id"),
    "poslao_id" UUID,
    "kuf_entry_id" UUID REFERENCES "kuf_entries"("id") ON DELETE SET NULL,
    "dopuna_za_id" UUID,
    "drive_id" TEXT NOT NULL,
    "item_id" TEXT,
    "parent_id" TEXT,
    "naziv" TEXT NOT NULL,
    "naziv_u_oblaku" TEXT,
    "velicina" INTEGER,
    "kategorija" TEXT NOT NULL,
    "napomena" TEXT,
    "qr_link" TEXT,
    "qr_status" TEXT,
    "izvor" TEXT NOT NULL CHECK ("izvor" IN ('PORTAL', 'ONEDRIVE')),
    "status" TEXT NOT NULL CHECK ("status" IN ('UPLOAD', 'PRIMLJENO', 'DOPUNA', 'ARHIVIRANO')),
    "zahtjev_dopune" TEXT,
    "greska_arhive" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    UNIQUE ("drive_id", "item_id"),
    UNIQUE ("drive_id", "naziv_u_oblaku")
);
CREATE INDEX "primljeni_dokumenti_scope_idx" ON "primljeni_dokumenti" ("agencija_id", "firma_id", "poslovna_godina_id", "status");
CREATE INDEX "primljeni_dokumenti_kuf_idx" ON "primljeni_dokumenti" ("kuf_entry_id");
