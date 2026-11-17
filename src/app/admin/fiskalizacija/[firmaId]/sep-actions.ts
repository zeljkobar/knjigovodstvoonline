"use server";

import { createSecureContext } from "node:tls";
import { requireRole } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { fiscalAdminApi, FiscalAdminApiError, type FiscalActor } from "@/lib/fiscal-admin-api";
import { createFiscalTestProfile } from "@/lib/fiscal-company-onboarding";
import { SUMMA_FISCAL_SOFTWARE } from "@/lib/fiscal-setup";
import { prisma } from "@/lib/prisma";
import { withSepTransport, SepError, type SepEnvironment } from "@/lib/sep-transport";
import { MAX_SEP_PFX_BYTES } from "@/lib/sep-secrets";
import { readSepFiscalSnapshot, type SepFiscalResult, type SepFiscalResults } from "@/lib/sep-fiscal-setup";

function sepMessage(error: unknown) {
  const code = error instanceof SepError ? error.code : undefined;
  if (code === "COMPANY_CONTEXT_REQUIRED") return "SEP ovim sertifikatom nije direktno otvorio izabranu firmu. Provjeri da isti sertifikat u ovom okruženju otvara tu firmu kada izabereš „Nastavi kao korisnik“.";
  if (code === "HTTP_401" || code === "HTTP_403" || code === "LOGIN_FAILED") return "SEP nije prihvatio prijavu sertifikatom u ovom okruženju.";
  if (code === "TIMEOUT") return "SEP nije odgovorio na vrijeme. Pokušajte ponovo.";
  return "Podaci nijesu mogli da se preuzmu. Provjerite prijavu na SEP i pokušajte ponovo ili nastavite ručno.";
}

type SigningResult = { ok: boolean; message: string };

async function saveSigningCertificate(
  scope: { id: string; agencyId: string; pib: string },
  actor: FiscalActor,
  file: File,
  password: string,
): Promise<SigningResult> {
  try {
    const firma = await prisma.firma.findFirst({
      where: { id: scope.id, agencija_id: scope.agencyId, pib: scope.pib, is_deleted: false },
      select: { naziv: true, skraceni_naziv: true, adresa: true, grad: true, opstina: true, pdv_obveznik: true, fiscalCompanyLink: true },
    });
    const link = firma?.fiscalCompanyLink;
    if (!firma || !link || link.agencija_id !== scope.agencyId || link.is_suspended) {
      return { ok: false, message: "Sertifikat nije sačuvan. Provjeri da li je fiskalizacija za ovu firmu uključena i da li je pristup dozvoljen." };
    }
    const existingId = link.fiscal_api_company_id;
    const company = existingId ? (await fiscalAdminApi.getCompany(existingId, actor)).data
      : await createFiscalTestProfile(scope, {
        legalName: firma.naziv, shortName: firma.skraceni_naziv, address: firma.adresa,
        town: firma.grad ?? firma.opstina, isVatPayer: firma.pdv_obveznik,
        softwareCode: SUMMA_FISCAL_SOFTWARE.test.softwareCode,
        maintainerCode: SUMMA_FISCAL_SOFTWARE.test.maintainerCode,
      }, actor, "sep");
    if (!company.isActive || company.tin !== scope.pib || company.environment !== "Test" || (existingId && company.id !== existingId)) {
      return { ok: false, message: "Sertifikat nije sačuvan. Ova opcija je dostupna dok se firma podešava u testnom okruženju." };
    }
    const certificates = (await fiscalAdminApi.listCertificates(company.id, actor)).data;
    if (certificates.some(cert => cert.isActive)) {
      return { ok: true, message: "Firma već ima aktivan sertifikat za potpisivanje. Postojeći sertifikat nije mijenjan." };
    }

    const outbound = new FormData();
    outbound.set("file", file, file.name);
    outbound.set("password", password);
    try { await fiscalAdminApi.uploadCertificate(company.id, outbound, actor); }
    finally { outbound.delete("file"); outbound.delete("password"); }
    return { ok: true, message: "Sertifikat je sačuvan u šifrovanom trezoru Fiscal API-ja. U koraku „Sertifikat“ klikni „Aktiviraj sertifikat“." };
  } catch (error) {
    const code = error instanceof FiscalAdminApiError ? error.code : undefined;
    if (code === "CERT_UPLOAD_DUPLICATE_THUMBPRINT") {
      return { ok: true, message: "Ovaj sertifikat je već sačuvan. Provjeri njegov status u koraku „Sertifikat“." };
    }
    if (code === "FISCAL_PROFILE_ALREADY_EXISTS") {
      return { ok: false, message: "Sertifikat nije sačuvan. Fiscal API već ima profil za ovaj PIB koji nije povezan sa firmom u aplikaciji." };
    }
    const detail = code === "CERT_UPLOAD_EXPIRED" ? " Sertifikat je istekao." : "";
    const correlation = error instanceof FiscalAdminApiError && /^[a-f\d-]{16,64}$/i.test(error.correlationId ?? "") ? ` Correlation ID: ${error.correlationId}` : "";
    return { ok: false, message: `Sertifikat nije sačuvan za potpisivanje.${detail} Pokušaj ponovo ili ga dodaj u koraku „Sertifikat“.${correlation}` };
  }
}

export async function importFiscalSetupFromSep(firmaId: string, form: FormData): Promise<{ error: string } | { results: SepFiscalResults; signing?: SigningResult }> {
  const admin = await requireRole("admin");
  const firma = await prisma.firma.findFirst({
    where: { id: firmaId, is_deleted: false },
    select: { id: true, agencija_id: true, pib: true },
  });
  const pib = firma?.pib?.trim();
  if (!firma || !pib || !/^\d{8}$/.test(pib)) return { error: "Firma mora imati PIB od osam cifara." };
  const file = form.get("certificate");
  const password = form.get("password");
  const saveForSigning = form.get("save_for_signing") === "on";
  if (!(file instanceof File) || !/\.p(fx|12)$/i.test(file.name) || !file.size ||
      file.size > MAX_SEP_PFX_BYTES || typeof password !== "string" || !password.length || password.length > 1024) {
    return { error: "Izaberite PFX/P12 fajl do 512 KB i unesite njegovu lozinku." };
  }
  const pfx = Buffer.from(await file.arrayBuffer());
  form.delete("certificate");
  form.delete("password");
  try {
    try { createSecureContext({ pfx, passphrase: password }); }
    catch { return { error: "Sertifikat se ne može otvoriti. Provjerite fajl i njegovu lozinku." }; }
    const read = async (environment: SepEnvironment): Promise<SepFiscalResult> => {
      try {
        return { data: await withSepTransport(environment, pfx, password, transport => readSepFiscalSnapshot(transport, pib, environment), 25000) };
      } catch (error) {
        return { error: sepMessage(error) };
      }
    };
    const [test, production] = await Promise.all([read("test"), read("production")]);
    const signing: SigningResult | undefined = saveForSigning
      ? "data" in production
        ? await saveSigningCertificate({ id: firma.id, agencyId: firma.agencija_id, pib }, { id: admin.id, name: admin.korisnicko_ime }, file, password)
        : { ok: false, message: "Sertifikat nije sačuvan za potpisivanje jer produkcioni SEP nije potvrdio direktnu prijavu za ovu firmu." }
      : undefined;
    await auditLog({
      korisnikId: admin.id, agencijaId: firma.agencija_id, firmaId: firma.id, modul: "admin.fiskalizacija",
      akcija: "SEP_PREUZIMANJE_PODESAVANJA", tipEntiteta: "firma", entitetId: firma.id,
      novaVrijednost: { testProcitan: "data" in test, produkcijaProcitana: "data" in production },
      upisiAktivnost: false,
    });
    return { results: { test, production }, signing };
  } finally { pfx.fill(0); }
}
