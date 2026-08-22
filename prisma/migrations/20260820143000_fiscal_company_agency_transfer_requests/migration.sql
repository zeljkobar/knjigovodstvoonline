CREATE TABLE "firma_agency_transfer_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "firma_id" UUID NOT NULL,
    "source_agencija_id" UUID NOT NULL,
    "target_agencija_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accounting_start_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "firma_agency_transfer_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "firma_agency_transfer_requests_firma_id_fkey"
      FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "firma_agency_transfer_requests_source_agencija_id_fkey"
      FOREIGN KEY ("source_agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "firma_agency_transfer_requests_target_agencija_id_fkey"
      FOREIGN KEY ("target_agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "firma_agency_transfer_requests_requested_by_fkey"
      FOREIGN KEY ("requested_by") REFERENCES "korisnici"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "firma_agency_transfer_requests_decided_by_fkey"
      FOREIGN KEY ("decided_by") REFERENCES "korisnici"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "firma_agency_transfer_requests_firma_id_status_idx"
  ON "firma_agency_transfer_requests"("firma_id", "status");
CREATE INDEX "firma_agency_transfer_requests_target_agencija_id_status_idx"
  ON "firma_agency_transfer_requests"("target_agencija_id", "status");
CREATE UNIQUE INDEX "firma_agency_transfer_requests_one_pending_per_company"
  ON "firma_agency_transfer_requests"("firma_id") WHERE "status" = 'PENDING';
