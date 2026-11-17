import "server-only";
import { auditLog } from "./audit";
import { fiscalAdminApi, FiscalAdminApiError, type FiscalActor } from "./fiscal-admin-api";
import { prisma } from "./prisma";

type TestProfile = {
  legalName: string;
  shortName: string | null;
  address: string | null;
  town: string | null;
  isVatPayer: boolean;
  softwareCode: string;
  maintainerCode: string;
};

export async function createFiscalTestProfile(
  scope: { id: string; agencyId: string; pib: string },
  profile: TestProfile,
  actor: FiscalActor,
  mode: "manual" | "sep",
) {
  const result = await prisma.$transaction(async tx => {
    const key = `fiscal-company-onboarding:${scope.pib}`;
    const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS acquired`;
    if (!lock?.acquired) throw new FiscalAdminApiError("FISCAL_SETUP_IN_PROGRESS", "Kreiranje fiskalnog profila je već u toku.");
    const firma = await tx.firma.findFirst({
      where: { id: scope.id, agencija_id: scope.agencyId, pib: scope.pib, is_deleted: false },
      select: { fiscalCompanyLink: true },
    });
    if (!firma || (mode === "sep" && (!firma.fiscalCompanyLink || firma.fiscalCompanyLink.is_suspended ||
      firma.fiscalCompanyLink.agencija_id !== scope.agencyId))) {
      throw new FiscalAdminApiError("FISCAL_SETUP_UNAVAILABLE", "Prvo omogućite fiskalizaciju za ovu firmu.");
    }
    if (firma.fiscalCompanyLink?.fiscal_api_company_id) {
      throw new FiscalAdminApiError("FIRMA_VEC_POSTOJI", "Firma već ima fiskalni profil.");
    }
    // POST /companies is an upsert. The SEP shortcut must not replace an existing remote profile.
    if (mode === "sep" && (await fiscalAdminApi.listCompanies(actor)).data.some(company => company.tin === scope.pib)) {
      throw new FiscalAdminApiError("FISCAL_PROFILE_ALREADY_EXISTS", "Fiscal API već ima profil za ovaj PIB.");
    }
    const created = await fiscalAdminApi.upsertCompany({
      ...profile, tin: scope.pib, country: "MNE", environment: "Test", endpoint: process.env.FISCAL_API_TEST_ENDPOINT,
    }, actor);
    if (created.data.tin !== scope.pib || created.data.environment !== "Test") {
      throw new FiscalAdminApiError("FISCAL_SETUP_UNAVAILABLE", "Fiscal API nije vratio odgovarajući testni profil.", created.correlationId);
    }
    const data = {
      fiscal_api_company_id: created.data.id,
      onboarding_status: "IN_PROGRESS",
      fiscal_environment: created.data.environment,
      last_correlation_id: created.correlationId,
      updated_by: actor.id,
    };
    await tx.fiscalCompanyLink.upsert({
      where: { firma_id: scope.id },
      create: { ...data, agencija_id: scope.agencyId, firma_id: scope.id, created_by: actor.id },
      update: data,
    });
    return created;
  }, { timeout: 35_000 });

  await auditLog({
    korisnikId: actor.id, agencijaId: scope.agencyId, firmaId: scope.id, modul: "admin.fiskalizacija",
    akcija: "fiscal_company_onboarded", tipEntiteta: "fiscal_company_link", entitetId: result.data.id,
    novaVrijednost: { environment: result.data.environment, correlationId: result.correlationId },
  });
  return result.data;
}
