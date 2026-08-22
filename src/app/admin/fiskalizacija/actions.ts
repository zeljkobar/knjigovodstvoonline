"use server";

import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { sendInvitationEmail } from "@/lib/email";
import { fiscalAdminApi, FiscalAdminApiError } from "@/lib/fiscal-admin-api";
import { createInvitationToken, createInvitationUrl } from "@/lib/invitations";
import { prisma } from "@/lib/prisma";
import { approveCompanyAgencyTransfer } from "@/lib/company-agency-transfer";
import {
  DIRECT_PORTAL_OWNER_PERMISSIONS,
  directPortalOperatorPermissions
} from "@/lib/direct-portal-policy";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function approveFiscalCompanyAgencyTransfer(formData: FormData) {
  const admin = await requireRole("admin");
  const requestId = text(formData, "request_id");
  if (!requestId) redirect("/admin/fiskalizacija/korisnici?poruka=TRANSFER_GRESKA");
  try {
    const result = await prisma.$transaction((tx) => approveCompanyAgencyTransfer(tx, requestId, admin.id), { timeout: 30000 });
    await auditLog({ korisnikId: admin.id, agencijaId: result.targetAgencyId, firmaId: result.firmaId, modul: "admin.fiskalizacija", akcija: "agency_transfer_approved", tipEntiteta: "Firma", entitetId: result.firmaId, upisiAktivnost: false });
  } catch (error) {
    console.error("approve fiscal company agency transfer failed", { requestId, error });
    redirect("/admin/fiskalizacija/korisnici?poruka=TRANSFER_GRESKA");
  }
  revalidatePath("/admin/fiskalizacija/korisnici");
  revalidatePath("/agencija/firme");
  redirect("/admin/fiskalizacija/korisnici?poruka=TRANSFER_ODOBREN");
}

export async function rejectFiscalCompanyAgencyTransfer(formData: FormData) {
  const admin = await requireRole("admin");
  const requestId = text(formData, "request_id");
  const reason = text(formData, "reason");
  const request = await prisma.firmaAgencyTransferRequest.findFirst({ where: { id: requestId, status: "PENDING" }, select: { id: true, firma_id: true, target_agencija_id: true } });
  if (!request) redirect("/admin/fiskalizacija/korisnici?poruka=TRANSFER_GRESKA");
  await prisma.firmaAgencyTransferRequest.update({ where: { id: request.id }, data: { status: "REJECTED", decided_by: admin.id, decided_at: new Date(), rejection_reason: reason || "Zahtjev odbijen nakon administratorske provjere." } });
  await auditLog({ korisnikId: admin.id, agencijaId: request.target_agencija_id, firmaId: request.firma_id, modul: "admin.fiskalizacija", akcija: "agency_transfer_rejected", tipEntiteta: "Firma", entitetId: request.firma_id, novaVrijednost: { razlog: reason || null }, upisiAktivnost: false });
  revalidatePath("/admin/fiskalizacija/korisnici");
  redirect("/admin/fiskalizacija/korisnici?poruka=TRANSFER_ODBIJEN");
}

function fail(firmaId: string, code: string, correlationId?: string): never {
  const params = new URLSearchParams({ poruka: code });
  if (correlationId) params.set("correlation", correlationId);
  redirect(`/admin/fiskalizacija/${firmaId}?${params}`);
}

export async function onboardFiscalCompany(formData: FormData) {
  const admin = await requireRole("admin");
  const firmaId = text(formData, "firma_id");
  const softwareCode = text(formData, "software_code");
  const maintainerCode = text(formData, "maintainer_code");

  const firma = await prisma.firma.findFirst({
    where: { id: firmaId, is_deleted: false },
    include: { fiscalCompanyLink: true }
  });
  if (!firma || !firma.pib) fail(firmaId, "FIRMA_ILI_PIB_NEDOSTAJE");
  if (!softwareCode || !maintainerCode) fail(firmaId, "KODOVI_NEDOSTAJU");

  try {
    const result = await fiscalAdminApi.upsertCompany(
      {
        tin: firma.pib,
        legalName: firma.naziv,
        shortName: firma.skraceni_naziv,
        address: firma.adresa,
        town: firma.grad ?? firma.opstina,
        country: "MNE",
        isVatPayer: firma.pdv_obveznik,
        environment: "Test",
        endpoint: process.env.FISCAL_API_TEST_ENDPOINT,
        softwareCode,
        maintainerCode
      },
      { id: admin.id, name: admin.korisnicko_ime }
    );

    await prisma.fiscalCompanyLink.upsert({
      where: { firma_id: firma.id },
      create: {
        agencija_id: firma.agencija_id,
        firma_id: firma.id,
        fiscal_api_company_id: result.data.id,
        onboarding_status: "IN_PROGRESS",
        fiscal_environment: result.data.environment,
        last_correlation_id: result.correlationId,
        created_by: admin.id,
        updated_by: admin.id
      },
      update: {
        fiscal_api_company_id: result.data.id,
        onboarding_status: "IN_PROGRESS",
        fiscal_environment: result.data.environment,
        last_correlation_id: result.correlationId,
        updated_by: admin.id
      }
    });

    await auditLog({
      korisnikId: admin.id,
      agencijaId: firma.agencija_id,
      firmaId: firma.id,
      modul: "admin.fiskalizacija",
      akcija: "fiscal_company_onboarded",
      tipEntiteta: "fiscal_company_link",
      entitetId: result.data.id,
      novaVrijednost: { environment: result.data.environment, correlationId: result.correlationId }
    });
  } catch (error) {
    if (error instanceof FiscalAdminApiError) fail(firmaId, error.code, error.correlationId);
    fail(firmaId, "FISCAL_API_GRESKA");
  }

  revalidatePath("/admin/fiskalizacija");
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=FIRMA_POVEZANA`);
}

export async function refreshFiscalReadiness(formData: FormData) {
  const admin = await requireRole("admin");
  const firmaId = text(formData, "firma_id");
  const link = await prisma.fiscalCompanyLink.findUnique({ where: { firma_id: firmaId } });
  if (!link?.fiscal_api_company_id) fail(firmaId, "FIRMA_NIJE_POVEZANA");

  try {
    const result = await fiscalAdminApi.getReadiness(
      link.fiscal_api_company_id,
      { id: admin.id, name: admin.korisnicko_ime }
    );
    await prisma.fiscalCompanyLink.update({
      where: { id: link.id },
      data: {
        onboarding_status: result.data.isReady ? "READY_FOR_TEST" : "IN_PROGRESS",
        last_readiness_check_at: new Date(),
        last_readiness_result: JSON.parse(JSON.stringify(result.data)),
        last_correlation_id: result.correlationId,
        updated_by: admin.id
      }
    });
  } catch (error) {
    if (error instanceof FiscalAdminApiError) fail(firmaId, error.code, error.correlationId);
    fail(firmaId, "FISCAL_API_GRESKA");
  }

  revalidatePath(`/admin/fiskalizacija/${firmaId}`);
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=READINESS_OSVJEZEN`);
}

export async function setFiscalSuspension(formData: FormData) {
  const admin = await requireRole("admin");
  const firmaId = text(formData, "firma_id");
  const suspend = text(formData, "suspend") === "true";
  const reason = text(formData, "reason");
  const link = await prisma.fiscalCompanyLink.findUnique({ where: { firma_id: firmaId } });
  if (!link?.fiscal_api_company_id) fail(firmaId, "FIRMA_NIJE_POVEZANA");
  if (suspend && !reason) fail(firmaId, "RAZLOG_OBAVEZAN");

  try {
    const actor = { id: admin.id, name: admin.korisnicko_ime };
    const result = suspend
      ? await fiscalAdminApi.deactivateCompany(link.fiscal_api_company_id, actor)
      : await fiscalAdminApi.activateCompany(link.fiscal_api_company_id, actor);

    await prisma.fiscalCompanyLink.update({
      where: { id: link.id },
      data: {
        is_suspended: suspend,
        suspension_reason: suspend ? reason : null,
        suspended_at: suspend ? new Date() : null,
        suspended_by: suspend ? admin.id : null,
        onboarding_status: suspend ? "SUSPENDED" : "IN_PROGRESS",
        last_correlation_id: result.correlationId,
        updated_by: admin.id
      }
    });

    await auditLog({
      korisnikId: admin.id,
      agencijaId: link.agencija_id,
      firmaId,
      modul: "admin.fiskalizacija",
      akcija: suspend ? "fiscal_company_suspended" : "fiscal_company_reactivated",
      tipEntiteta: "fiscal_company_link",
      entitetId: link.id,
      novaVrijednost: { suspend, reason: suspend ? reason : null, correlationId: result.correlationId }
    });
  } catch (error) {
    if (error instanceof FiscalAdminApiError) fail(firmaId, error.code, error.correlationId);
    fail(firmaId, "FISCAL_API_GRESKA");
  }

  revalidatePath("/admin/fiskalizacija");
  revalidatePath(`/admin/fiskalizacija/${firmaId}`);
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=${suspend ? "FIRMA_SUSPENDOVANA" : "FIRMA_AKTIVIRANA"}`);
}

async function fiscalContext(firmaId: string) {
  const admin = await requireRole("admin");
  const link = await prisma.fiscalCompanyLink.findUnique({ where: { firma_id: firmaId } });
  if (!link?.fiscal_api_company_id) fail(firmaId, "FIRMA_NIJE_POVEZANA");
  return { admin, link, actor: { id: admin.id, name: admin.korisnicko_ime } };
}

function handleFiscalActionError(firmaId: string, error: unknown): never {
  if (error instanceof FiscalAdminApiError) fail(firmaId, error.code, error.correlationId);
  fail(firmaId, "FISCAL_API_GRESKA");
}

export async function createFiscalBusinessUnit(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const { actor, link } = await fiscalContext(firmaId);
  try {
    await fiscalAdminApi.createBusinessUnit(link.fiscal_api_company_id!, {
      code: text(formData, "code"), name: text(formData, "name"),
      address: text(formData, "address") || null, town: text(formData, "town") || null
    }, actor);
  } catch (error) { handleFiscalActionError(firmaId, error); }
  revalidatePath(`/admin/fiskalizacija/${firmaId}`);
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=JEDINICA_DODATA`);
}

export async function createFiscalDevice(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const { actor, link } = await fiscalContext(firmaId);
  try {
    await fiscalAdminApi.createDevice(link.fiscal_api_company_id!, {
      businessUnitId: text(formData, "business_unit_id"),
      tcrCode: text(formData, "tcr_code"), internalCode: text(formData, "internal_code")
    }, actor);
  } catch (error) { handleFiscalActionError(firmaId, error); }
  revalidatePath(`/admin/fiskalizacija/${firmaId}`);
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=ENU_DODAT`);
}

export async function createFiscalOperator(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const { actor, link } = await fiscalContext(firmaId);
  try {
    await fiscalAdminApi.createOperator(link.fiscal_api_company_id!, {
      operatorCode: text(formData, "operator_code"), firstName: text(formData, "first_name"), lastName: text(formData, "last_name")
    }, actor);
  } catch (error) { handleFiscalActionError(firmaId, error); }
  revalidatePath(`/admin/fiskalizacija/${firmaId}`);
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=OPERATER_DODAT`);
}

export async function uploadFiscalCertificate(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const file = formData.get("file");
  const password = text(formData, "password");
  if (!(file instanceof File) || file.size === 0 || file.size > 5 * 1024 * 1024) fail(firmaId, "CERT_UPLOAD_INVALID_FILE");
  if (!/\.(pfx|p12)$/i.test(file.name) || !password) fail(firmaId, "CERT_UPLOAD_INVALID_FILE");
  const { actor, link } = await fiscalContext(firmaId);
  const outbound = new FormData();
  outbound.set("file", file, file.name);
  outbound.set("password", password);
  try {
    await fiscalAdminApi.uploadCertificate(link.fiscal_api_company_id!, outbound, actor);
  } catch (error) { handleFiscalActionError(firmaId, error); }
  revalidatePath(`/admin/fiskalizacija/${firmaId}`);
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=SERTIFIKAT_DODAT`);
}

export async function activateFiscalCertificate(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const certificateId = text(formData, "certificate_id");
  const { actor, link } = await fiscalContext(firmaId);
  try {
    await fiscalAdminApi.activateCertificate(link.fiscal_api_company_id!, certificateId, actor);
  } catch (error) { handleFiscalActionError(firmaId, error); }
  revalidatePath(`/admin/fiskalizacija/${firmaId}`);
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=SERTIFIKAT_AKTIVIRAN`);
}

export async function confirmFiscalTest(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const invoiceId = text(formData, "invoice_id");
  const confirmation = text(formData, "confirmation");
  const firma = await prisma.firma.findUnique({ where: { id: firmaId }, select: { pib: true } });
  if (!firma?.pib || confirmation !== `CONFIRM_TEST:${firma.pib}` || !invoiceId) fail(firmaId, "POTVRDA_NIJE_ISPRAVNA");
  const { admin, actor, link } = await fiscalContext(firmaId);
  try {
    const result = await fiscalAdminApi.confirmTest(link.fiscal_api_company_id!, invoiceId, confirmation, actor);
    await prisma.fiscalCompanyLink.update({ where: { id: link.id }, data: { onboarding_status: "TEST_ACTIVE", fiscal_environment: "Test", last_correlation_id: result.correlationId, updated_by: admin.id } });
  } catch (error) { handleFiscalActionError(firmaId, error); }
  revalidatePath(`/admin/fiskalizacija/${firmaId}`);
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=TEST_POTVRDJEN`);
}

export async function fiscalizeAndConfirmControlTest(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const idempotencyKey = text(formData, "idempotency_key");
  if (!idempotencyKey || idempotencyKey.length > 200) fail(firmaId, "CONTROL_TEST_INVALID");
  const firma = await prisma.firma.findFirst({
    where: { id: firmaId, is_deleted: false },
    select: { pib: true, pdv_obveznik: true, agencija_id: true }
  });
  if (!firma?.pib) fail(firmaId, "FIRMA_ILI_PIB_NEDOSTAJE");
  const { admin, actor, link } = await fiscalContext(firmaId);

  try {
    const companyId = link.fiscal_api_company_id!;
    const [company, readiness, units, devices, operators] = await Promise.all([
      fiscalAdminApi.getCompany(companyId, actor),
      fiscalAdminApi.getReadiness(companyId, actor),
      fiscalAdminApi.listBusinessUnits(companyId, actor),
      fiscalAdminApi.listDevices(companyId, actor),
      fiscalAdminApi.listOperators(companyId, actor)
    ]);
    if (company.data.environment !== "Test") throw new FiscalAdminApiError("TEST_ENVIRONMENT_REQUIRED", "Kontrolni račun se šalje samo u testnom okruženju.");
    if (!readiness.data.isReady) throw new FiscalAdminApiError("COMPANY_NOT_READY", "Firma nije spremna za kontrolni test.");
    const unit = units.data.find((item) => item.isActive);
    const device = devices.data.find((item) => item.isActive && item.businessUnitId === unit?.id);
    const operator = operators.data.find((item) => item.isActive);
    if (!unit || !device || !operator) throw new FiscalAdminApiError("CONTROL_TEST_CONFIGURATION_MISSING", "Nedostaje aktivna testna jedinica, ENU ili operater.");

    const today = new Date().toISOString().slice(0, 10);
    const created = await fiscalAdminApi.createInvoice({
      companyId,
      businessUnitId: unit.id,
      deviceId: device.id,
      operatorId: operator.id,
      invoiceType: "Normal",
      invoiceNumber: "",
      issueDateTime: new Date().toISOString(),
      currency: "EUR",
      buyer: {
        identificationType: "Tin",
        identificationNumber: "12345678",
        name: "KONTROLNI TEST KUPAC",
        address: "Testna adresa 1",
        town: "Podgorica",
        country: "MNE",
        taxIdentificationCode: null
      },
      supplyPeriodStart: today,
      supplyPeriodEnd: today,
      paymentDeadline: today,
      items: [{
        name: "Kontrolna testna usluga",
        quantity: 1,
        unitPrice: 1,
        vatRate: firma.pdv_obveznik ? 21 : 0,
        itemCode: "CONTROL-TEST",
        unitOfMeasure: "kom",
        discountAmount: 0
      }],
      payments: [{ paymentType: "BankAccount", amount: 1, reference: "CONTROL-TEST" }]
    }, idempotencyKey, actor);
    const submitted = await fiscalAdminApi.fiscalizeInvoice(
      created.data.id,
      `FISCALIZE_TEST:${created.data.id}`,
      actor
    );
    if (!submitted.data.isSuccess || submitted.data.status !== "Fiscalized" || !submitted.data.jikr) {
      throw new FiscalAdminApiError("CONTROL_TEST_NOT_FISCALIZED", "Kontrolni račun nije uspješno fiskalizovan.", submitted.correlationId);
    }
    const confirmed = await fiscalAdminApi.confirmTest(
      companyId,
      created.data.id,
      `CONFIRM_TEST:${firma.pib}`,
      actor
    );
    await prisma.fiscalCompanyLink.update({
      where: { id: link.id },
      data: {
        onboarding_status: "TEST_ACTIVE",
        fiscal_environment: "Test",
        last_correlation_id: confirmed.correlationId,
        updated_by: admin.id
      }
    });
    await auditLog({
      korisnikId: admin.id,
      agencijaId: firma.agencija_id,
      firmaId,
      modul: "admin.fiskalizacija",
      akcija: "fiscal_control_test_completed",
      tipEntiteta: "FiscalInvoice",
      entitetId: created.data.id,
      novaVrijednost: { iznos: "1.00", jikr: submitted.data.jikr, correlationId: confirmed.correlationId },
      upisiAktivnost: false
    });
  } catch (error) {
    handleFiscalActionError(firmaId, error);
  }
  revalidatePath(`/admin/fiskalizacija/${firmaId}`);
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=CONTROL_TEST_AUTOMATSKI_POTVRDJEN`);
}

export async function configureFiscalProductionProfile(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const payload = {
    producerCode: text(formData, "producer_code"),
    softwareName: text(formData, "software_name"),
    softwareVersion: text(formData, "software_version"),
    softwareCode: text(formData, "software_code"),
    maintainerCode: text(formData, "maintainer_code"),
    isSoftwareCertified: text(formData, "is_software_certified") === "true",
    businessUnitCode: text(formData, "business_unit_code"),
    businessUnitName: text(formData, "business_unit_name"),
    businessUnitAddress: text(formData, "business_unit_address") || null,
    businessUnitTown: text(formData, "business_unit_town") || null,
    operatorCode: text(formData, "operator_code"),
    operatorFirstName: text(formData, "operator_first_name") || null,
    operatorLastName: text(formData, "operator_last_name") || null
  };
  if (!payload.producerCode || !payload.softwareName || !payload.softwareVersion ||
      !payload.softwareCode || !payload.maintainerCode || !payload.businessUnitCode ||
      !payload.businessUnitName || !payload.operatorCode || !payload.isSoftwareCertified) {
    fail(firmaId, "PRODUCTION_PROFILE_REQUIRED_FIELDS");
  }
  const { actor, link } = await fiscalContext(firmaId);
  try {
    await fiscalAdminApi.updateProductionProfile(link.fiscal_api_company_id!, payload, actor);
  } catch (error) { handleFiscalActionError(firmaId, error); }
  revalidatePath(`/admin/fiskalizacija/${firmaId}`);
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=PRODUKCIONI_PROFIL_SACUVAN`);
}

export async function activateFiscalProduction(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const confirmation = text(formData, "confirmation");
  const firma = await prisma.firma.findUnique({ where: { id: firmaId }, select: { pib: true } });
  if (!firma?.pib || confirmation !== `ACTIVATE_PRODUCTION:${firma.pib}`) fail(firmaId, "POTVRDA_NIJE_ISPRAVNA");
  const { admin, actor, link } = await fiscalContext(firmaId);
  try {
    const result = await fiscalAdminApi.activateProduction(link.fiscal_api_company_id!, confirmation, actor);
    await prisma.fiscalCompanyLink.update({ where: { id: link.id }, data: { onboarding_status: "PRODUCTION_ACTIVE", fiscal_environment: "Production", last_correlation_id: result.correlationId, updated_by: admin.id } });
  } catch (error) { handleFiscalActionError(firmaId, error); }
  revalidatePath(`/admin/fiskalizacija/${firmaId}`);
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=PRODUKCIJA_AKTIVIRANA`);
}

export async function returnFiscalCompanyToTest(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const confirmation = text(formData, "confirmation");
  const firma = await prisma.firma.findUnique({ where: { id: firmaId }, select: { pib: true } });
  if (!firma?.pib || confirmation !== `RETURN_TO_TEST:${firma.pib}`) fail(firmaId, "POTVRDA_NIJE_ISPRAVNA");
  const { admin, actor, link } = await fiscalContext(firmaId);
  try {
    const result = await fiscalAdminApi.returnToTest(link.fiscal_api_company_id!, confirmation, actor);
    await prisma.fiscalCompanyLink.update({ where: { id: link.id }, data: { onboarding_status: "IN_PROGRESS", fiscal_environment: "Test", last_correlation_id: result.correlationId, updated_by: admin.id } });
  } catch (error) { handleFiscalActionError(firmaId, error); }
  revalidatePath(`/admin/fiskalizacija/${firmaId}`);
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=VRACENO_U_TEST`);
}

export async function registerFiscalProductionEnu(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const internalCode = text(formData, "internal_code");
  const confirmation = text(formData, "confirmation");
  const validFrom = text(formData, "valid_from");
  const firma = await prisma.firma.findUnique({ where: { id: firmaId }, select: { pib: true } });
  if (!firma?.pib || !internalCode || !validFrom || confirmation !== `REGISTER_PRODUCTION_ENU:${firma.pib}:${internalCode}`) fail(firmaId, "POTVRDA_NIJE_ISPRAVNA");
  const { actor, link } = await fiscalContext(firmaId);
  try {
    await fiscalAdminApi.registerProductionEnu(link.fiscal_api_company_id!, { internalCode, validFrom, confirmation }, actor);
  } catch (error) { handleFiscalActionError(firmaId, error); }
  revalidatePath(`/admin/fiskalizacija/${firmaId}`);
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=PRODUKCIONI_ENU_REGISTROVAN`);
}

export async function acknowledgeFiscalCertificateAlert(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const alertId = text(formData, "alert_id");
  const { actor, link } = await fiscalContext(firmaId);
  try { await fiscalAdminApi.acknowledgeCertificateAlert(link.fiscal_api_company_id!, alertId, actor); }
  catch (error) { handleFiscalActionError(firmaId, error); }
  revalidatePath(`/admin/fiskalizacija/${firmaId}`);
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=ALERT_POTVRDJEN`);
}

export async function updateFiscalIdentity(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const { actor, link } = await fiscalContext(firmaId);
  const payload = {
    legalName: text(formData, "legal_name"),
    shortName: text(formData, "short_name") || null,
    address: text(formData, "address") || null,
    town: text(formData, "town") || null,
    country: text(formData, "country") || "MNE",
    isVatPayer: text(formData, "is_vat_payer") === "true",
    confirmation: text(formData, "confirmation")
  };
  if (!payload.legalName || !payload.confirmation) fail(firmaId, "FISKALNI_IDENTITET_OBAVEZNA_POLJA");
  try { await fiscalAdminApi.updateFiscalIdentity(link.fiscal_api_company_id!, payload, actor); }
  catch (error) { handleFiscalActionError(firmaId, error); }
  revalidatePath(`/admin/fiskalizacija/${firmaId}`);
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=FISKALNI_IDENTITET_SACUVAN`);
}

export async function updateFiscalBusinessUnit(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const id = text(formData, "resource_id");
  const { actor, link } = await fiscalContext(firmaId);
  try { await fiscalAdminApi.updateBusinessUnit(link.fiscal_api_company_id!, id, { code: text(formData, "code"), name: text(formData, "name"), address: text(formData, "address") || null, town: text(formData, "town") || null }, actor); }
  catch (error) { handleFiscalActionError(firmaId, error); }
  revalidatePath(`/admin/fiskalizacija/${firmaId}`);
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=JEDINICA_SACUVANA`);
}

export async function toggleFiscalBusinessUnit(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const { actor, link } = await fiscalContext(firmaId);
  try { await fiscalAdminApi.setBusinessUnitActive(link.fiscal_api_company_id!, text(formData, "resource_id"), text(formData, "active") === "true", actor); }
  catch (error) { handleFiscalActionError(firmaId, error); }
  revalidatePath(`/admin/fiskalizacija/${firmaId}`);
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=JEDINICA_STATUS_SACUVAN`);
}

export async function updateFiscalDevice(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const { actor, link } = await fiscalContext(firmaId);
  try { await fiscalAdminApi.updateDevice(link.fiscal_api_company_id!, text(formData, "resource_id"), { businessUnitId: text(formData, "business_unit_id"), tcrCode: text(formData, "tcr_code"), internalCode: text(formData, "internal_code") }, actor); }
  catch (error) { handleFiscalActionError(firmaId, error); }
  revalidatePath(`/admin/fiskalizacija/${firmaId}`);
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=ENU_SACUVAN`);
}

export async function toggleFiscalDevice(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const { actor, link } = await fiscalContext(firmaId);
  try { await fiscalAdminApi.setDeviceActive(link.fiscal_api_company_id!, text(formData, "resource_id"), text(formData, "active") === "true", actor); }
  catch (error) { handleFiscalActionError(firmaId, error); }
  revalidatePath(`/admin/fiskalizacija/${firmaId}`);
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=ENU_STATUS_SACUVAN`);
}

export async function updateFiscalOperator(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const { actor, link } = await fiscalContext(firmaId);
  try { await fiscalAdminApi.updateOperator(link.fiscal_api_company_id!, text(formData, "resource_id"), { operatorCode: text(formData, "operator_code"), firstName: text(formData, "first_name") || null, lastName: text(formData, "last_name") || null }, actor); }
  catch (error) { handleFiscalActionError(firmaId, error); }
  revalidatePath(`/admin/fiskalizacija/${firmaId}`);
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=OPERATER_SACUVAN`);
}

export async function toggleFiscalOperator(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const { actor, link } = await fiscalContext(firmaId);
  try { await fiscalAdminApi.setOperatorActive(link.fiscal_api_company_id!, text(formData, "resource_id"), text(formData, "active") === "true", actor); }
  catch (error) { handleFiscalActionError(firmaId, error); }
  revalidatePath(`/admin/fiskalizacija/${firmaId}`);
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=OPERATER_STATUS_SACUVAN`);
}

export async function deactivateFiscalCertificate(formData: FormData) {
  const firmaId = text(formData, "firma_id");
  const { actor, link } = await fiscalContext(firmaId);
  try { await fiscalAdminApi.deactivateCertificate(link.fiscal_api_company_id!, text(formData, "certificate_id"), actor); }
  catch (error) { handleFiscalActionError(firmaId, error); }
  revalidatePath(`/admin/fiskalizacija/${firmaId}`);
  redirect(`/admin/fiskalizacija/${firmaId}?poruka=SERTIFIKAT_DEAKTIVIRAN`);
}

export async function scanFiscalCertificateExpirations() {
  const admin = await requireRole("admin");
  try { await fiscalAdminApi.scanCertificateExpirations({ id: admin.id, name: admin.korisnicko_ime }); }
  catch (error) {
    const code = error instanceof FiscalAdminApiError ? error.code : "FISCAL_API_GRESKA";
    redirect(`/admin/fiskalizacija?poruka=${encodeURIComponent(code)}`);
  }
  revalidatePath("/admin/fiskalizacija");
  redirect("/admin/fiskalizacija?poruka=ISTEK_SERTIFIKATA_PROVJEREN");
}

export type ApiClientActionState = { error?: string; apiKey?: string; clientId?: string };

export async function createFiscalApiClient(_previous: ApiClientActionState, formData: FormData): Promise<ApiClientActionState> {
  const admin = await requireRole("admin");
  const permissions = formData.getAll("permissions").map(String);
  const companyIds = formData.getAll("company_ids").map(String);
  const name = text(formData, "name");
  if (!name || !permissions.length) return { error: "Naziv i najmanje jedna dozvola su obavezni." };
  try {
    const expiresRaw = text(formData, "expires_at");
    const result = await fiscalAdminApi.createApiClient({ name, permissions, companyIds, expiresAt: expiresRaw ? new Date(expiresRaw).toISOString() : null }, { id: admin.id, name: admin.korisnicko_ime });
    revalidatePath("/admin/fiskalizacija/aplikacije");
    return { apiKey: result.data.apiKey, clientId: result.data.client.clientId };
  } catch (error) {
    return { error: error instanceof FiscalAdminApiError ? `${error.message}${error.correlationId ? ` (${error.correlationId})` : ""}` : "Kreiranje API aplikacije nije uspjelo." };
  }
}

export async function rotateFiscalApiClientKey(_previous: ApiClientActionState, formData: FormData): Promise<ApiClientActionState> {
  const admin = await requireRole("admin");
  try {
    const actor = { id: admin.id, name: admin.korisnicko_ime };
    const clientId = text(formData, "client_id");
    const clients = await fiscalAdminApi.listApiClients(actor);
    if (clients.data.find((x) => x.id === clientId)?.clientId === process.env.FISCAL_API_CLIENT_ID) return { error: "Ključ aplikacije koju ovaj sajt trenutno koristi ne rotira se iz njenog sopstvenog panela." };
    const result = await fiscalAdminApi.rotateApiClientKey(clientId, actor);
    revalidatePath("/admin/fiskalizacija/aplikacije");
    return { apiKey: result.data.apiKey, clientId: result.data.client.clientId };
  } catch (error) {
    return { error: error instanceof FiscalAdminApiError ? error.message : "Rotacija ključa nije uspjela." };
  }
}

export async function deactivateFiscalApiClient(formData: FormData) {
  const admin = await requireRole("admin");
  try {
    const actor = { id: admin.id, name: admin.korisnicko_ime };
    const clientId = text(formData, "client_id");
    const clients = await fiscalAdminApi.listApiClients(actor);
    if (clients.data.find((x) => x.id === clientId)?.clientId === process.env.FISCAL_API_CLIENT_ID) redirect("/admin/fiskalizacija/aplikacije?poruka=TRENUTNI_API_KLIJENT_ZASTICEN");
    await fiscalAdminApi.deactivateApiClient(clientId, actor);
  }
  catch { redirect("/admin/fiskalizacija/aplikacije?poruka=API_KLIJENT_GRESKA"); }
  revalidatePath("/admin/fiskalizacija/aplikacije");
  redirect("/admin/fiskalizacija/aplikacije?poruka=API_KLIJENT_DEAKTIVIRAN");
}

const fiscalPermissionActions = ["view", "create", "post", "cancel"] as const;

async function getDirectFiscalContainer(adminId: string) {
  const existing = await prisma.agencija.findFirst({
    where: { is_fiscal_direct_container: true, is_deleted: false },
    select: { id: true, naziv: true }
  });
  if (existing) return existing;
  try {
    return await prisma.agencija.create({
      data: {
        naziv: "Direktni fiskalni klijenti",
        aktivan: true,
        is_fiscal_direct_container: true,
        created_by: adminId,
        updated_by: adminId
      },
      select: { id: true, naziv: true }
    });
  } catch {
    const concurrent = await prisma.agencija.findFirst({
      where: { is_fiscal_direct_container: true, is_deleted: false },
      select: { id: true, naziv: true }
    });
    if (!concurrent) throw new Error("Direct fiscal tenant could not be created.");
    return concurrent;
  }
}

export async function createFiscalClient(formData: FormData) {
  const admin = await requireRole("admin");
  const clientType = text(formData, "client_type");
  const agencijaId = text(formData, "agencija_id");
  const existingFirmaId = text(formData, "firma_id");
  const naziv = text(formData, "naziv");
  const pib = text(formData, "pib");
  const email = text(formData, "email");
  const username = text(formData, "korisnicko_ime");
  const createLogin = Boolean(email || username);

  if (clientType === "AGENCY") {
    if (!agencijaId || !existingFirmaId) redirect("/admin/fiskalizacija/korisnici?poruka=KLIJENT_OBAVEZNA_POLJA");
    const firma = await prisma.firma.findFirst({
      where: { id: existingFirmaId, agencija_id: agencijaId, aktivan: true, is_deleted: false, agencija: { aktivan: true, is_deleted: false, is_fiscal_direct_container: false } },
      select: { id: true, naziv: true, fiscalCompanyLink: { select: { id: true } } }
    });
    if (!firma) redirect("/admin/fiskalizacija/korisnici?poruka=AGENCIJA_NIJE_PRONADJENA");
    if (firma.fiscalCompanyLink) redirect(`/admin/fiskalizacija/${firma.id}?poruka=FIRMA_VEC_POSTOJI`);
    await prisma.fiscalCompanyLink.create({ data: { agencija_id: agencijaId, firma_id: firma.id, created_by: admin.id, updated_by: admin.id } });
    await auditLog({ korisnikId: admin.id, agencijaId, firmaId: firma.id, modul: "admin.fiskalizacija", akcija: "fiscalization_enabled_for_agency_company", tipEntiteta: "Firma", entitetId: firma.id, novaVrijednost: { naziv: firma.naziv, tip_klijenta: "AGENCY" }, upisiAktivnost: false });
    revalidatePath("/admin/fiskalizacija");
    revalidatePath("/admin/fiskalizacija/korisnici");
    redirect(`/admin/fiskalizacija/${firma.id}?poruka=KLIJENT_KREIRAN`);
  }

  if (clientType !== "DIRECT" || !naziv || !pib) redirect("/admin/fiskalizacija/korisnici?poruka=KLIJENT_OBAVEZNA_POLJA");
  if (createLogin && (!email || !username)) redirect("/admin/fiskalizacija/korisnici?poruka=PRISTUP_OBAVEZNA_POLJA");

  const [agencija, existingCompany] = await Promise.all([
    clientType === "DIRECT"
      ? getDirectFiscalContainer(admin.id)
      : prisma.agencija.findFirst({
          where: { id: agencijaId, aktivan: true, is_deleted: false, is_fiscal_direct_container: false },
          select: { id: true, naziv: true }
        }),
    prisma.firma.findFirst({ where: { pib, is_deleted: false }, select: { id: true } })
  ]);
  if (!agencija) redirect("/admin/fiskalizacija/korisnici?poruka=AGENCIJA_NIJE_PRONADJENA");
  if (existingCompany) redirect(`/admin/fiskalizacija/${existingCompany.id}?poruka=FIRMA_VEC_POSTOJI`);

  const invitation = createLogin ? createInvitationToken() : null;
  const passwordHash = createLogin ? await bcrypt.hash(randomUUID(), 12) : null;
  let result!: { firmaId: string; user: { id: string; korisnicko_ime: string; email: string | null } | null };

  try {
    result = await prisma.$transaction(async (tx) => {
      const currentYear = new Date().getFullYear();
      const firma = await tx.firma.create({
        data: {
          agencija_id: agencija.id, naziv, skraceni_naziv: text(formData, "skraceni_naziv") || null,
          pib, adresa: text(formData, "adresa") || null, grad: text(formData, "grad") || null,
          email: email || null, pdv_obveznik: text(formData, "pdv_obveznik") === "true",
          status_firme: "ACTIVE", created_by: admin.id, updated_by: admin.id
        },
        select: { id: true }
      });
      await tx.poslovnaGodina.create({ data: {
        firma_id: firma.id, godina: currentYear,
        datum_od: new Date(Date.UTC(currentYear, 0, 1)), datum_do: new Date(Date.UTC(currentYear, 11, 31))
      }});
      await tx.fiscalCompanyLink.create({ data: {
        agencija_id: agencija.id, firma_id: firma.id, created_by: admin.id, updated_by: admin.id
      }});

      if (!createLogin || !passwordHash || !invitation) return { firmaId: firma.id, user: null };
      const user = await tx.korisnik.create({ data: {
        korisnicko_ime: username, email, lozinka_hash: passwordHash, rola: "korisnik_agencije",
        agencija_id: agencija.id, created_by: admin.id, updated_by: admin.id
      }, select: { id: true, korisnicko_ime: true, email: true } });
      await tx.korisnikFirma.create({ data: {
        korisnik_id: user.id, firma_id: firma.id, moze_da_gleda: true, moze_da_unosi: true,
        moze_da_mijenja: clientType === "DIRECT",
        access_type: "FISCAL_CLIENT", created_by: admin.id, updated_by: admin.id
      }});
      const ownerPermissions = clientType === "DIRECT"
        ? DIRECT_PORTAL_OWNER_PERMISSIONS
        : fiscalPermissionActions.map((action) => ({ modul: "fiskalizacija", akcija: action }));
      await tx.korisnikPravo.createMany({ data: ownerPermissions.map((permission) => ({
        agencija_id: agencija.id, korisnik_id: user.id, firma_id: firma.id,
        modul: permission.modul, akcija: permission.akcija, dozvoljeno: true,
        created_by: admin.id, updated_by: admin.id
      })) });
      await tx.pozivnica.create({ data: {
        korisnik_id: user.id, token_hash: invitation.tokenHash,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }});
      return { firmaId: firma.id, user };
    });
  } catch (error) {
    console.error("createFiscalClient transaction failed", {
      clientType,
      hasEmail: Boolean(email),
      hasUsername: Boolean(username),
      error
    });
    redirect("/admin/fiskalizacija/korisnici?poruka=KLIJENT_GRESKA");
  }

  await auditLog({
    korisnikId: admin.id, agencijaId: agencija.id, firmaId: result.firmaId,
    modul: "admin.fiskalizacija", akcija: "fiscal_client_created",
    tipEntiteta: "Firma", entitetId: result.firmaId,
    novaVrijednost: { naziv, pib, tip_klijenta: clientType === "DIRECT" ? "DIRECT" : "AGENCY", agencija: clientType === "DIRECT" ? null : agencija.naziv, pristup_klijenta: Boolean(result.user) },
    upisiAktivnost: false
  });
  if (result.user && invitation) {
    try {
      await sendInvitationEmail({
        to: result.user.email ?? email, korisnickoIme: result.user.korisnicko_ime,
        inviteUrl: createInvitationUrl(invitation.token)
      });
    } catch {
      redirect(`/admin/fiskalizacija/${result.firmaId}?poruka=KLIJENT_KREIRAN_EMAIL_GRESKA`);
    }
  }
  revalidatePath("/admin/fiskalizacija");
  revalidatePath("/admin/fiskalizacija/korisnici");
  redirect(`/admin/fiskalizacija/${result.firmaId}?poruka=KLIJENT_KREIRAN`);
}

export async function createFiscalUser(formData: FormData) {
  const admin = await requireRole("admin");
  const firmaId = text(formData, "firma_id");
  const username = text(formData, "korisnicko_ime");
  const email = text(formData, "email");
  if (!firmaId || !username || !email) redirect("/admin/fiskalizacija/korisnici?poruka=OBAVEZNA_POLJA");

  const firma = await prisma.firma.findFirst({
    where: { id: firmaId, is_deleted: false, fiscalCompanyLink: { isNot: null } },
    select: {
      id: true,
      agencija_id: true,
      naziv: true,
      agencija: { select: { is_fiscal_direct_container: true } }
    }
  });
  if (!firma) redirect("/admin/fiskalizacija/korisnici?poruka=FIRMA_NIJE_FISKALNA");

  const enabled = new Set(fiscalPermissionActions.filter((action) => formData.get(`permission_${action}`) === "true"));
  enabled.add("view");
  const passwordHash = await bcrypt.hash(randomUUID(), 12);
  const { token, tokenHash } = createInvitationToken();
  const inviteUrl = createInvitationUrl(token);

  let user: { id: string; korisnicko_ime: string; email: string | null };
  try {
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.korisnik.create({ data: {
        korisnicko_ime: username, email, lozinka_hash: passwordHash,
        rola: "korisnik_agencije", agencija_id: firma.agencija_id,
        created_by: admin.id, updated_by: admin.id
      }, select: { id: true, korisnicko_ime: true, email: true } });
      await tx.korisnikFirma.create({ data: {
        korisnik_id: created.id, firma_id: firma.id,
        moze_da_gleda: true, moze_da_unosi: enabled.has("create"),
        moze_da_mijenja: false, moze_da_brise: false,
        access_type: "FISCAL_OPERATOR", created_by: admin.id, updated_by: admin.id
      }});
      const permissionRows = [
        ...fiscalPermissionActions.map((action) => ({
          modul: "fiskalizacija",
          akcija: action,
          dozvoljeno: enabled.has(action)
        })),
        ...(firma.agencija.is_fiscal_direct_container
          ? directPortalOperatorPermissions(enabled).map((permission) => ({
              ...permission,
              dozvoljeno: true
            }))
          : [])
      ];
      await tx.korisnikPravo.createMany({ data: permissionRows.map((permission) => ({
        agencija_id: firma.agencija_id, korisnik_id: created.id, firma_id: firma.id,
        modul: permission.modul, akcija: permission.akcija, dozvoljeno: permission.dozvoljeno,
        created_by: admin.id, updated_by: admin.id
      })) });
      await tx.pozivnica.create({ data: { korisnik_id: created.id, token_hash: tokenHash, expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });
      return created;
    });
  } catch {
    redirect("/admin/fiskalizacija/korisnici?poruka=KORISNIK_GRESKA");
  }

  await auditLog({
    korisnikId: admin.id, agencijaId: firma.agencija_id, firmaId: firma.id,
    modul: "admin.fiskalizacija", akcija: "fiscal_user_created", tipEntiteta: "Korisnik", entitetId: user.id,
    novaVrijednost: { username: user.korisnicko_ime, email: user.email, firma: firma.naziv, permissions: [...enabled] }, upisiAktivnost: false
  });
  try { await sendInvitationEmail({ to: user.email ?? email, korisnickoIme: user.korisnicko_ime, inviteUrl }); }
  catch { redirect("/admin/fiskalizacija/korisnici?poruka=KORISNIK_KREIRAN_EMAIL_GRESKA"); }
  revalidatePath("/admin/fiskalizacija/korisnici");
  redirect("/admin/fiskalizacija/korisnici?poruka=POZIVNICA_POSLATA");
}

export async function toggleFiscalUser(formData: FormData) {
  const admin = await requireRole("admin");
  const userId = text(formData, "korisnik_id");
  const active = text(formData, "aktivan") === "true";
  const user = await prisma.korisnik.findFirst({
    where: { id: userId, rola: "korisnik_agencije", firme: { some: { access_type: "FISCAL_OPERATOR", is_deleted: false } } },
    select: { id: true, korisnicko_ime: true, agencija_id: true, aktivan: true, firme: { where: { access_type: "FISCAL_OPERATOR", is_deleted: false }, select: { firma_id: true }, take: 1 } }
  });
  if (!user) redirect("/admin/fiskalizacija/korisnici?poruka=KORISNIK_NIJE_PRONADJEN");
  await prisma.korisnik.update({ where: { id: user.id }, data: { aktivan: active, updated_by: admin.id } });
  await auditLog({
    korisnikId: admin.id, agencijaId: user.agencija_id, firmaId: user.firme[0]?.firma_id,
    modul: "admin.fiskalizacija", akcija: active ? "fiscal_user_activated" : "fiscal_user_suspended",
    tipEntiteta: "Korisnik", entitetId: user.id, staraVrijednost: { aktivan: user.aktivan }, novaVrijednost: { aktivan: active }, upisiAktivnost: false
  });
  revalidatePath("/admin/fiskalizacija/korisnici");
  redirect(`/admin/fiskalizacija/korisnici?poruka=${active ? "KORISNIK_AKTIVIRAN" : "KORISNIK_SUSPENDOVAN"}`);
}

export async function resendFiscalUserInvitation(formData: FormData) {
  const admin = await requireRole("admin");
  const userId = text(formData, "korisnik_id");
  const user = await prisma.korisnik.findFirst({
    where: { id: userId, rola: "korisnik_agencije", firme: { some: { access_type: "FISCAL_OPERATOR", is_deleted: false } } },
    select: { id: true, korisnicko_ime: true, email: true, agencija_id: true, firme: { where: { access_type: "FISCAL_OPERATOR", is_deleted: false }, select: { firma_id: true }, take: 1 } }
  });
  if (!user?.email) redirect("/admin/fiskalizacija/korisnici?poruka=EMAIL_NEDOSTAJE");
  const { token, tokenHash } = createInvitationToken();
  await prisma.pozivnica.create({ data: { korisnik_id: user.id, token_hash: tokenHash, expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });
  await sendInvitationEmail({ to: user.email, korisnickoIme: user.korisnicko_ime, inviteUrl: createInvitationUrl(token) });
  await auditLog({ korisnikId: admin.id, agencijaId: user.agencija_id, firmaId: user.firme[0]?.firma_id, modul: "admin.fiskalizacija", akcija: "fiscal_user_invitation_resent", tipEntiteta: "Korisnik", entitetId: user.id, upisiAktivnost: false });
  revalidatePath("/admin/fiskalizacija/korisnici");
  redirect("/admin/fiskalizacija/korisnici?poruka=POZIVNICA_POSLATA");
}
