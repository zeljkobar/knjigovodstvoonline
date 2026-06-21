CREATE TABLE "kuf_books" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agencija_id" UUID NOT NULL,
    "firma_id" UUID NOT NULL,
    "poslovna_godina_id" UUID NOT NULL,
    "redni_broj" INTEGER NOT NULL,
    "internal_kuf_number" TEXT NOT NULL,
    "mjesec" INTEGER NOT NULL,
    "kuf_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "kuf_books_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "kuf_entries"
ADD COLUMN "kuf_book_id" UUID;

CREATE UNIQUE INDEX "kuf_books_firma_id_poslovna_godina_id_redni_broj_key"
ON "kuf_books"("firma_id", "poslovna_godina_id", "redni_broj");

CREATE INDEX "kuf_books_agencija_id_firma_id_poslovna_godina_id_status_idx"
ON "kuf_books"("agencija_id", "firma_id", "poslovna_godina_id", "status");

CREATE INDEX "kuf_books_firma_id_poslovna_godina_id_mjesec_idx"
ON "kuf_books"("firma_id", "poslovna_godina_id", "mjesec");

CREATE INDEX "kuf_entries_kuf_book_id_idx"
ON "kuf_entries"("kuf_book_id");

ALTER TABLE "kuf_books"
ADD CONSTRAINT "kuf_books_agencija_id_fkey"
FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "kuf_books"
ADD CONSTRAINT "kuf_books_firma_id_fkey"
FOREIGN KEY ("firma_id") REFERENCES "firme"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "kuf_books"
ADD CONSTRAINT "kuf_books_poslovna_godina_id_fkey"
FOREIGN KEY ("poslovna_godina_id") REFERENCES "poslovne_godine"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "kuf_entries"
ADD CONSTRAINT "kuf_entries_kuf_book_id_fkey"
FOREIGN KEY ("kuf_book_id") REFERENCES "kuf_books"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
