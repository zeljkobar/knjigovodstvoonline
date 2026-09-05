"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { fiscalAdminApi, FiscalAdminApiError } from "@/lib/fiscal-admin-api";
import { posModule, requirePosContext } from "@/lib/pos";
import {
  createAndFiscalizePosSale as createAndFiscalizePosSaleWithContext,
  PosSaleValidationError
} from "@/lib/pos-sale-service";
import { finalizePosTransferAccounting } from "@/lib/pos-transfer-accounting";
import {
  createAndFiscalizePosStorno as createPosStornoWithContext,
  PosStornoError
} from "@/lib/pos-storno-service";
import {
  applyPosInventoryMovement,
  applyPosReturnInventoryMovement
} from "@/lib/pos-inventory";
import { prisma } from "@/lib/prisma";

const paymentTypes: Record<string, string> = { CASH: "Cash", CARD: "Card", BANK_TRANSFER: "BankAccount", OTHER: "Other" };
function input(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }

async function finishTransferAccounting(input: { invoiceId: string; paymentMethod: string; enabled: boolean; ctx: Awaited<ReturnType<typeof requirePosContext>> }) {
  if (!input.enabled || input.paymentMethod !== "BANK_TRANSFER") return null;
  try {
    return await finalizePosTransferAccounting({ invoiceId: input.invoiceId, agencijaId: input.ctx.user.agencija_id!, firmaId: input.ctx.firma.id, poslovnaGodinaId: input.ctx.year.id, year: input.ctx.year.godina, userId: input.ctx.user.id });
  } catch {
    return { ok: false as const, reason: "neocekivano" };
  }
}

type ConfirmedPosActionResult = {
  fiscalInvoiceId: string;
  environment: "Test" | "Production";
  officialInvoiceNumber: string | null;
  iic: string;
  jikr: string;
  qrCodeData: string;
  correlationId: string | null;
};

async function preserveConfirmedPosActionResult(input: {
  invoiceId: string;
  originalInvoiceId?: string | null;
  attemptKey: string;
  userId: string;
  started: number;
  result: ConfirmedPosActionResult;
}) {
  const now = new Date();
  await prisma.fiskalniIzlazniRacun.update({
    where: { id: input.invoiceId },
    data: {
      fiscal_api_invoice_id: input.result.fiscalInvoiceId,
      fiscal_status: "Fiscalized",
      fiscal_environment: input.result.environment,
      official_invoice_number: input.result.officialInvoiceNumber,
      broj_racuna: input.result.officialInvoiceNumber ?? undefined,
      iic: input.result.iic,
      jikr: input.result.jikr,
      qr_code_data: input.result.qrCodeData,
      correlation_id: input.result.correlationId,
      fiscalized_at: now,
      last_fiscal_attempt_at: now,
      fiscal_error_code: "LOCAL_RECONCILIATION_REQUIRED",
      fiscal_error_message:
        "Fiskalizacija je potvrđena, ali lokalna obrada zahtijeva usklađivanje.",
      updated_by: input.userId
    }
  });
  if (input.originalInvoiceId) {
    await prisma.fiskalniIzlazniRacun.update({
      where: { id: input.originalInvoiceId },
      data: { fiscal_status: "StornoCreated", updated_by: input.userId }
    });
  }
  await prisma.fiscalizationAttempt.updateMany({
    where: { idempotency_key: input.attemptKey },
    data: {
      status: "SUCCEEDED",
      fiscal_api_invoice_id: input.result.fiscalInvoiceId,
      correlation_id: input.result.correlationId,
      error_code: "LOCAL_RECONCILIATION_REQUIRED",
      error_message:
        "Remote fiskalni rezultat je potvrđen; lokalna obrada nije kompletna.",
      finished_at: now,
      duration_ms: Date.now() - input.started
    }
  });
}

export async function createAndFiscalizePosSale(formData: FormData) {
  const ctx = await requirePosContext(["create", "post"]);
  let result;

  try {
    result = await createAndFiscalizePosSaleWithContext({
      context: {
        agencijaId: ctx.user.agencija_id!,
        firmaId: ctx.firma.id,
        poslovnaGodinaId: ctx.year.id,
        userId: ctx.user.id,
        userName: ctx.user.korisnicko_ime
      },
      formData,
      accountingMode: "CONFIGURED",
      partnerAccess: "AGENCY"
    });
  } catch (error) {
    if (error instanceof PosSaleValidationError) {
      redirect(`/agencija/pos?poruka=${error.code}`);
    }
    throw error;
  }

  if (result.status === "fiscalized") {
    redirect(
      `/agencija/pos?uspjeh=${result.invoiceId}${
        result.accountingIssue
          ? `&obrada=${result.accountingIssue}`
          : ""
      }`
    );
  }

  if (result.status === "pending") {
    redirect(`/agencija/pos?poruka=u_toku&racun=${result.invoiceId}`);
  }

  redirect(`/agencija/pos?greska=${result.invoiceId}`);
}

export async function createAndFiscalizePosStorno(formData: FormData) {
  const ctx = await requirePosContext("cancel");
  const originalId = input(formData, "invoice_id");
  try {
    const result = await createPosStornoWithContext({
      context: { agencijaId: ctx.user.agencija_id!, firmaId: ctx.firma.id, poslovnaGodinaId: ctx.year.id, year: ctx.year.godina, userId: ctx.user.id, userName: ctx.user.korisnicko_ime },
      originalInvoiceId: originalId,
      reason: input(formData, "reason"),
      confirmed: input(formData, "confirmation") === "CONFIRM",
      accountingMode: "CONFIGURED"
    });
    if (result.status === "failed") redirect(`/agencija/pos/racuni?storno_greska=${result.correctionInvoiceId}`);
    redirect(`/agencija/pos/racuni?storno=${result.correctionInvoiceId}${result.accountingIssue ? `&obrada=${result.accountingIssue}` : ""}`);
  } catch (error) {
    if (error instanceof PosStornoError) redirect(`/agencija/pos/racuni/${originalId}/storno?poruka=${error.code}`);
    throw error;
  }
}

export async function retryPosFiscalization(formData: FormData) {
  const ctx = await requirePosContext("post");
  const invoiceId = input(formData, "invoice_id");
  const settings = await prisma.posPodesavanje.findUnique({ where: { firma_id: ctx.firma.id }, select: { racunovodstvena_integracija: true } });
  const link = ctx.firma.fiscalCompanyLink;
  if (!link?.fiscal_api_company_id || link.is_suspended) redirect("/agencija/pos/racuni?poruka=podesavanje");
  const prepared = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pos-retry:${invoiceId}`}))`;
    const invoice = await tx.fiskalniIzlazniRacun.findFirst({
      where: { id: invoiceId, agencija_id: ctx.user.agencija_id!, firma_id: ctx.firma.id, poslovna_godina_id: ctx.year.id, sales_channel: "POS", fiscal_status: "FiscalizationFailed", is_deleted: false },
      include: { pos_register: { include: { magacin: { select: { dozvoli_negativan_lager: true } } } }, kupac: true, original_invoice: { select: { id: true, fiscal_api_invoice_id: true, magacin_id: true } }, stavke: { orderBy: { redni_broj: "asc" } }, placanja: { orderBy: { redni_broj: "asc" } }, fiskalni_pokusaji: { orderBy: { attempt_number: "desc" }, take: 1 } }
    });
    if (!invoice?.pos_register || !invoice.idempotency_key || !invoice.issued_at || !invoice.placanja.length || !invoice.stavke.length || (invoice.document_type === "POS_RETURN" && !invoice.original_invoice?.fiscal_api_invoice_id)) return null;
    const attemptNumber = (invoice.fiskalni_pokusaji[0]?.attempt_number ?? 0) + 1;
    const attemptKey = `${invoice.idempotency_key}:retry:${attemptNumber}`;
    const retryIssuedAt = new Date();
    await tx.fiscalizationAttempt.create({ data: { fiskalni_izlazni_racun_id: invoice.id, attempt_number: attemptNumber, idempotency_key: attemptKey, status: "PENDING", created_by: ctx.user.id } });
    await tx.fiskalniIzlazniRacun.update({ where: { id: invoice.id }, data: { issued_at: retryIssuedAt, fiscal_status: "FiscalizationPending", fiscal_error_code: null, fiscal_error_message: null, updated_by: ctx.user.id } });
    return { invoice, attemptKey, retryIssuedAt };
  });
  if (!prepared) redirect("/agencija/pos/racuni?poruka=retry_nije_moguc");

  const { invoice, attemptKey, retryIssuedAt } = prepared;
  const actor = { id: ctx.user.id, name: ctx.user.korisnicko_ime };
  const started = Date.now();
  let remoteInvoiceId: string | null = invoice.fiscal_api_invoice_id;
  let confirmedResult: ConfirmedPosActionResult | null = null;
  try {
    const company = (await fiscalAdminApi.getCompany(link.fiscal_api_company_id, actor)).data;
    if (invoice.fiscal_environment && invoice.fiscal_environment !== company.environment) throw new FiscalAdminApiError("FISCAL_ENVIRONMENT_CHANGED", "Fiskalno okruženje dokumenta se razlikuje od aktivnog okruženja.");
    const created = invoice.document_type === "POS_RETURN"
      ? (remoteInvoiceId
        ? await fiscalAdminApi.getInvoice(remoteInvoiceId, actor)
        : await fiscalAdminApi.createInvoiceStorno(invoice.original_invoice?.fiscal_api_invoice_id ?? "", { invoiceNumber: "", issueDateTime: retryIssuedAt.toISOString(), reason: invoice.correction_reason ?? "Ponovni pokušaj storna", confirmation: `CREATE_STORNO:${invoice.original_invoice?.fiscal_api_invoice_id}` }, attemptKey, actor))
      : await fiscalAdminApi.createInvoice({
      companyId: link.fiscal_api_company_id,
      businessUnitId: invoice.pos_register!.fiscal_business_unit_id,
      deviceId: invoice.pos_register!.fiscal_device_id,
      operatorId: invoice.pos_register!.fiscal_operator_id,
      invoiceType: "Normal",
      invoiceNumber: "",
      issueDateTime: retryIssuedAt.toISOString(),
      currency: invoice.valuta,
      buyer: invoice.kupac.pib ? { identificationType: "Tin", identificationNumber: invoice.kupac.pib, name: invoice.kupac.naziv, address: invoice.kupac.adresa ?? null, town: invoice.kupac.grad ?? null, country: invoice.kupac.drzava?.toUpperCase() === "CRNA GORA" ? "MNE" : invoice.kupac.country_code ?? "MNE", taxIdentificationCode: invoice.kupac.pdv_broj ?? null } : null,
      supplyPeriodStart: invoice.datum_prometa.toISOString().slice(0, 10),
      supplyPeriodEnd: invoice.datum_prometa.toISOString().slice(0, 10),
      paymentDeadline: (invoice.datum_valute ?? invoice.datum_racuna).toISOString().slice(0, 10),
      items: invoice.stavke.map((line) => ({ name: line.naziv_artikla, quantity: Number(line.kolicina), unitPrice: Number(line.jedinicna_cijena_sa_pdv), vatRate: Number(line.pdv_stopa_procenat), itemCode: line.sifra_artikla, unitOfMeasure: line.jedinica_mjere, discountAmount: Number(line.rabat_iznos) })),
      payments: invoice.placanja.map((payment) => ({ paymentType: paymentTypes[payment.payment_method] ?? "Other", amount: Number(payment.amount), reference: payment.reference ?? invoice.interni_broj }))
    }, attemptKey, actor);
    remoteInvoiceId = created.data.id;
    const confirmation = company.environment === "Production" ? `FISCALIZE_PRODUCTION:${ctx.firma.pib}:${created.data.id}` : `FISCALIZE_TEST:${created.data.id}`;
    const submitted = await fiscalAdminApi.fiscalizeInvoice(created.data.id, confirmation, actor);
    if (!submitted.data.isSuccess || submitted.data.status !== "Fiscalized" || !submitted.data.jikr) throw new FiscalAdminApiError(submitted.data.faultCode ?? "FISCALIZATION_FAILED", submitted.data.faultMessage ?? "Račun nije fiskalizovan.", submitted.correlationId);
    const finalInvoice = (await fiscalAdminApi.getInvoice(created.data.id, actor)).data;
    if (!finalInvoice.iic || !finalInvoice.jikr || !finalInvoice.qrCodeData) throw new FiscalAdminApiError("FISCAL_RESULT_INCOMPLETE", "Fiscal API nije vratio kompletan fiskalni rezultat.");
    confirmedResult = {
      fiscalInvoiceId: created.data.id,
      environment: company.environment,
      officialInvoiceNumber: finalInvoice.officialInvoiceNumber ?? null,
      iic: finalInvoice.iic,
      jikr: finalInvoice.jikr,
      qrCodeData: finalInvoice.qrCodeData,
      correlationId: submitted.correlationId ?? null
    };

    const groups = new Map<string, { name: string; percent: Prisma.Decimal; base: Prisma.Decimal; vat: Prisma.Decimal; total: Prisma.Decimal }>();
    for (const row of invoice.stavke) {
      const code = row.pdv_stopa_sifra; const current = groups.get(code) ?? { name: row.pdv_stopa_naziv, percent: row.pdv_stopa_procenat, base: new Prisma.Decimal(0), vat: new Prisma.Decimal(0), total: new Prisma.Decimal(0) };
      current.base = current.base.plus(row.osnovica); current.vat = current.vat.plus(row.pdv_iznos); current.total = current.total.plus(row.ukupno_sa_pdv); groups.set(code, current);
    }
    await prisma.$transaction(async (tx) => {
      await tx.fiskalniIzlazniRacunPorez.deleteMany({ where: { fiskalni_izlazni_racun_id: invoice.id } });
      await tx.fiskalniIzlazniRacunPorez.createMany({ data: [...groups.entries()].map(([code, group]) => ({ fiskalni_izlazni_racun_id: invoice.id, vat_rate_code: code, vat_rate_name: group.name, vat_rate_percent: group.percent, tax_base: group.base, output_vat_amount: group.vat, total_with_vat: group.total, created_by: ctx.user.id })) });
      await tx.fiskalniIzlazniRacun.update({ where: { id: invoice.id }, data: { fiscal_api_invoice_id: created.data.id, fiscal_status: "Fiscalized", fiscal_environment: company.environment, official_invoice_number: finalInvoice.officialInvoiceNumber, broj_racuna: finalInvoice.officialInvoiceNumber ?? invoice.broj_racuna, iic: finalInvoice.iic, jikr: finalInvoice.jikr, qr_code_data: finalInvoice.qrCodeData, correlation_id: submitted.correlationId, fiscalized_at: new Date(), last_fiscal_attempt_at: new Date(), fiscal_error_code: null, fiscal_error_message: null, updated_by: ctx.user.id } });
      if (invoice.document_type === "POS_RETURN" && invoice.original_invoice_id) await tx.fiskalniIzlazniRacun.update({ where: { id: invoice.original_invoice_id }, data: { fiscal_status: "StornoCreated", updated_by: ctx.user.id } });
      await tx.fiscalizationAttempt.update({ where: { idempotency_key: attemptKey }, data: { status: "SUCCEEDED", fiscal_api_invoice_id: created.data.id, correlation_id: submitted.correlationId, finished_at: new Date(), duration_ms: Date.now() - started } });
      if (invoice.document_type === "POS_RETURN" && invoice.original_invoice_id) await applyPosReturnInventoryMovement(tx, { agencijaId: ctx.user.agencija_id!, firmaId: ctx.firma.id, poslovnaGodinaId: ctx.year.id, magacinId: invoice.original_invoice?.magacin_id ?? invoice.magacin_id, correctionInvoiceId: invoice.id, originalInvoiceId: invoice.original_invoice_id, datumPrometa: invoice.datum_prometa, userId: ctx.user.id });
      else await applyPosInventoryMovement(tx, { agencijaId: ctx.user.agencija_id!, firmaId: ctx.firma.id, poslovnaGodinaId: ctx.year.id, magacinId: invoice.magacin_id, invoiceId: invoice.id, datumPrometa: invoice.datum_prometa, allowNegative: invoice.pos_register?.magacin?.dozvoli_negativan_lager ?? ctx.firma.dozvoli_negativan_lager, userId: ctx.user.id });
    });
    const accounting = await finishTransferAccounting({ invoiceId: invoice.id, paymentMethod: invoice.nacin_placanja, enabled: settings?.racunovodstvena_integracija ?? false, ctx });
    await auditLog({ korisnikId: ctx.user.id, agencijaId: ctx.user.agencija_id, firmaId: ctx.firma.id, modul: posModule, akcija: "retry_pos_fiscalization_succeeded", tipEntiteta: "FiskalniIzlazniRacun", entitetId: invoice.id, novaVrijednost: { attemptKey, jikr: finalInvoice.jikr } });
    redirect(`/agencija/pos/racuni?uspjeh=${invoice.id}${accounting && !accounting.ok ? `&obrada=${accounting.reason}` : ""}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    if (confirmedResult) {
      await preserveConfirmedPosActionResult({
        invoiceId: invoice.id,
        originalInvoiceId:
          invoice.document_type === "POS_RETURN"
            ? invoice.original_invoice_id
            : null,
        attemptKey,
        userId: ctx.user.id,
        started,
        result: confirmedResult
      });
      try {
        await auditLog({ korisnikId: ctx.user.id, agencijaId: ctx.user.agencija_id, firmaId: ctx.firma.id, modul: posModule, akcija: "retry_pos_local_reconciliation_required", tipEntiteta: "FiskalniIzlazniRacun", entitetId: invoice.id, novaVrijednost: { attemptKey, fiscalInvoiceId: confirmedResult.fiscalInvoiceId, environment: confirmedResult.environment, correlationId: confirmedResult.correlationId } });
      } catch {}
      redirect(`/agencija/pos/racuni?uspjeh=${invoice.id}&obrada=lokalno_uskladjivanje`);
    }
    const fiscalError = error instanceof FiscalAdminApiError ? error : new FiscalAdminApiError("FISCALIZATION_FAILED", "Fiskalizacija nije uspjela.");
    await prisma.$transaction([
      prisma.fiskalniIzlazniRacun.updateMany({ where: { id: invoice.id, fiscal_status: { not: "Fiscalized" } }, data: { fiscal_api_invoice_id: remoteInvoiceId, fiscal_status: "FiscalizationFailed", fiscal_error_code: fiscalError.code, fiscal_error_message: fiscalError.message, correlation_id: fiscalError.correlationId, last_fiscal_attempt_at: new Date(), updated_by: ctx.user.id } }),
      prisma.fiscalizationAttempt.update({ where: { idempotency_key: attemptKey }, data: { status: "FAILED", fiscal_api_invoice_id: remoteInvoiceId, error_code: fiscalError.code, error_message: fiscalError.message, correlation_id: fiscalError.correlationId, finished_at: new Date(), duration_ms: Date.now() - started } })
    ]);
    await auditLog({ korisnikId: ctx.user.id, agencijaId: ctx.user.agencija_id, firmaId: ctx.firma.id, modul: posModule, akcija: "retry_pos_fiscalization_failed", tipEntiteta: "FiskalniIzlazniRacun", entitetId: invoice.id, novaVrijednost: { attemptKey, code: fiscalError.code } });
    redirect(`/agencija/pos/racuni?greska=${invoice.id}`);
  }
}

export async function completePosTransferAccounting(formData: FormData) {
  const ctx = await requirePosContext("post");
  const invoiceId = input(formData, "invoice_id");
  const result = await finishTransferAccounting({ invoiceId, paymentMethod: "BANK_TRANSFER", enabled: true, ctx });
  await auditLog({ korisnikId: ctx.user.id, agencijaId: ctx.user.agencija_id, firmaId: ctx.firma.id, modul: posModule, akcija: result?.ok ? "pos_transfer_accounting_completed" : "pos_transfer_accounting_failed", tipEntiteta: "FiskalniIzlazniRacun", entitetId: invoiceId, novaVrijednost: result });
  if (!result?.ok) redirect(`/agencija/pos/racuni?obrada=${result?.reason ?? "racun"}`);
  redirect(`/agencija/pos/racuni?knjizenje=${invoiceId}`);
}
