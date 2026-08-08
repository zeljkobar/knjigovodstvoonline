CREATE TABLE "fiscal_company_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agencija_id" UUID NOT NULL,
    "firma_id" UUID NOT NULL,
    "fiscal_api_company_id" UUID,
    "onboarding_status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    "fiscal_environment" TEXT,
    "is_suspended" BOOLEAN NOT NULL DEFAULT false,
    "suspension_reason" TEXT,
    "suspended_at" TIMESTAMP(3),
    "suspended_by" UUID,
    "last_readiness_check_at" TIMESTAMP(3),
    "last_readiness_result" JSONB,
    "last_correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "fiscal_company_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiscal_company_links_firma_id_key" ON "fiscal_company_links"("firma_id");
CREATE UNIQUE INDEX "fiscal_company_links_fiscal_api_company_id_key" ON "fiscal_company_links"("fiscal_api_company_id");
CREATE INDEX "fiscal_company_links_agencija_id_onboarding_status_idx" ON "fiscal_company_links"("agencija_id", "onboarding_status");
CREATE INDEX "fiscal_company_links_is_suspended_idx" ON "fiscal_company_links"("is_suspended");

ALTER TABLE "fiscal_company_links"
ADD CONSTRAINT "fiscal_company_links_agencija_id_fkey"
FOREIGN KEY ("agencija_id") REFERENCES "agencije"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fiscal_company_links"
ADD CONSTRAINT "fiscal_company_links_firma_id_fkey"
FOREIGN KEY ("firma_id") REFERENCES "firme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
