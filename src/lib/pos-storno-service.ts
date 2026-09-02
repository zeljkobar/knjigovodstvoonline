import { Prisma } from "@prisma/client";
import { auditLog } from "./audit";
import { fiscalAdminApi, FiscalAdminApiError } from "./fiscal-admin-api";
import { applyPosReturnInventoryMovement } from "./pos-inventory";
import { finalizePosTransferAccounting } from "./pos-transfer-accounting";
import { posModule } from "./pos";
import { prisma } from "./prisma";

export type PosStornoContext = {
  agencijaId: string;
  firmaId: string;
  poslovnaGodinaId: string;
  year: number;
  userId: string;
  userName: string;
};

export class PosStornoError extends Error {
  constructor(readonly code: "potvrda" | "podesavanje" | "nije_moguc") {
    super(`POS storno nije izvršen: ${code}`);
    this.name = "PosStornoError";
  }
}

export type PosStornoResult = {
  status: "fiscalized" | "failed";
  correctionInvoiceId: string;
  accountingIssue: string | null;
};

type ConfirmedResult = {
  fiscalInvoiceId: string;
  environment: "Test" | "Production";
  officialInvoiceNumber: string | null;
  iic: string;
  jikr: string;
  qrCodeData: string;
  correlationId: string | null;
};

export async function createAndFiscalizePosStorno(input: {
  context: PosStornoContext;
  originalInvoiceId: string;
  reason: string;
  confirmed: boolean;
  accountingMode: "CONFIGURED" | "FISCAL_ONLY";
}): Promise<PosStornoResult> {
  const { context } = input;
  if (!input.confirmed || input.reason.trim().length < 3) throw new PosStornoError("potvrda");
  const link = await prisma.fiscalCompanyLink.findUnique({ where: { firma_id: context.firmaId } });
  if (!link?.fiscal_api_company_id || link.is_suspended) throw new PosStornoError("podesavanje");
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const prepared = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pos-storno:${input.originalInvoiceId}`}))`;
    const original = await tx.fiskalniIzlazniRacun.findFirst({
      where: { id: input.originalInvoiceId, agencija_id: context.agencijaId, firma_id: context.firmaId, poslovna_godina_id: context.poslovnaGodinaId, sales_channel: "POS", document_type: "POS_RECEIPT", fiscal_status: "Fiscalized", is_deleted: false },
      include: { pos_register: true, stavke: { orderBy: { redni_broj: "asc" } }, placanja: { orderBy: { redni_broj: "asc" } }, corrective_invoices: { where: { is_deleted: false }, select: { id: true } } }
    });
    if (!original?.fiscal_api_invoice_id || !original.jikr || !original.iic || !original.pos_register || original.corrective_invoices.length) return null;
    const period = await tx.pdvPeriod.findFirst({ where: { firma_id: context.firmaId, poslovna_godina_id: context.poslovnaGodinaId, mjesec: day.getUTCMonth() + 1 }, select: { status: true } });
    if (period?.status === "LOCKED") return null;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${context.firmaId}:${context.poslovnaGodinaId}:sales`}))`;
    const last = await tx.fiskalniIzlazniRacun.findFirst({ where: { firma_id: context.firmaId, poslovna_godina_id: context.poslovnaGodinaId }, orderBy: { broj: "desc" }, select: { broj: true } });
    const number = (last?.broj ?? 0) + 1;
    const internal = `POS-ST-${context.year}-${String(number).padStart(6, "0")}`;
    const idempotencyKey = `pos-storno:${original.id}`;
    const correction = await tx.fiskalniIzlazniRacun.create({ data: {
      agencija_id: original.agencija_id, firma_id: original.firma_id, poslovna_godina_id: original.poslovna_godina_id, kupac_id: original.kupac_id, magacin_id: original.magacin_id, poslovna_jedinica_id: original.poslovna_jedinica_id, pos_register_id: original.pos_register_id,
      original_invoice_id: original.id, correction_reason: input.reason.trim(), broj: number, interni_broj: internal, broj_racuna: internal, datum_racuna: day, datum_prometa: day, datum_valute: day,
      vrsta_racuna: "CORRECTIVE", document_type: "POS_RETURN", sales_channel: "POS", issued_at: now, status: "DRAFT", nacin_placanja: original.nacin_placanja, fiskalizacija_rezim: "SUMMA", vat_transaction_type: original.vat_transaction_type,
      valuta: original.valuta, kurs: original.kurs, ukupno_osnovica: original.ukupno_osnovica.negated(), ukupno_rabat: original.ukupno_rabat.negated(), ukupno_izlazni_pdv: original.ukupno_izlazni_pdv.negated(), ukupno_sa_pdv: original.ukupno_sa_pdv.negated(),
      issuer_snapshot: original.issuer_snapshot ?? Prisma.JsonNull, buyer_snapshot: original.buyer_snapshot ?? Prisma.JsonNull, idempotency_key: idempotencyKey, fiscal_status: "FiscalizationPending", fiscal_environment: original.fiscal_environment,
      kif_status: input.accountingMode === "FISCAL_ONLY" ? "NOT_REQUIRED" : original.nacin_placanja === "BANK_TRANSFER" ? "ACCOUNTING_PENDING" : "WAITING_PAZAR",
      napomena: `Potpuni storno računa ${original.broj_racuna}: ${input.reason.trim()}`, created_by: context.userId, updated_by: context.userId
    } });
    await tx.stavkaIzlazneFakture.createMany({ data: original.stavke.map((line) => ({ izlazna_faktura_id: correction.id, redni_broj: line.redni_broj, artikal_id: line.artikal_id, sifra_artikla: line.sifra_artikla, naziv_artikla: line.naziv_artikla, jedinica_mjere: line.jedinica_mjere, usluga: line.usluga, kolicina: line.kolicina.negated(), jedinicna_cijena_bez_pdv: line.jedinicna_cijena_bez_pdv, rabat_procenat: line.rabat_procenat, rabat_iznos: line.rabat_iznos.negated(), osnovica: line.osnovica.negated(), pdv_stopa_id: line.pdv_stopa_id, pdv_stopa_sifra: line.pdv_stopa_sifra, pdv_stopa_naziv: line.pdv_stopa_naziv, pdv_stopa_procenat: line.pdv_stopa_procenat, pdv_iznos: line.pdv_iznos.negated(), jedinicna_cijena_sa_pdv: line.jedinicna_cijena_sa_pdv, ukupno_sa_pdv: line.ukupno_sa_pdv.negated(), jedinicna_nabavna_cijena: line.jedinicna_nabavna_cijena, nabavna_vrijednost: line.nabavna_vrijednost?.negated(), created_by: context.userId, updated_by: context.userId })) });
    await tx.salesDocumentPayment.createMany({ data: original.placanja.map((payment) => ({ fiskalni_izlazni_racun_id: correction.id, redni_broj: payment.redni_broj, payment_method: payment.payment_method, amount: payment.amount.negated(), reference: internal, created_by: context.userId })) });
    await tx.fiscalizationAttempt.create({ data: { fiskalni_izlazni_racun_id: correction.id, attempt_number: 1, idempotency_key: idempotencyKey, status: "PENDING", created_by: context.userId } });
    return { original, correction, idempotencyKey };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (!prepared) throw new PosStornoError("nije_moguc");

  const actor = { id: context.userId, name: context.userName };
  const started = Date.now();
  let remoteInvoiceId: string | null = null;
  let confirmedResult: ConfirmedResult | null = null;
  try {
    const [companyResponse, firm] = await Promise.all([
      fiscalAdminApi.getCompany(link.fiscal_api_company_id, actor),
      prisma.firma.findFirst({
        where: { id: context.firmaId, agencija_id: context.agencijaId },
        select: { pib: true }
      })
    ]);
    if (!firm?.pib) throw new PosStornoError("podesavanje");
    const company = companyResponse.data;
    if (prepared.original.fiscal_environment && prepared.original.fiscal_environment !== company.environment) throw new FiscalAdminApiError("FISCAL_ENVIRONMENT_CHANGED", "Fiskalno okruženje originalnog računa se razlikuje od aktivnog okruženja.");
    const created = await fiscalAdminApi.createInvoiceStorno(prepared.original.fiscal_api_invoice_id!, { invoiceNumber: "", issueDateTime: now.toISOString(), reason: input.reason.trim(), confirmation: `CREATE_STORNO:${prepared.original.fiscal_api_invoice_id}` }, prepared.idempotencyKey, actor);
    remoteInvoiceId = created.data.id;
    const confirmation = company.environment === "Production"
      ? `FISCALIZE_PRODUCTION:${firm.pib}:${remoteInvoiceId}`
      : `FISCALIZE_TEST:${remoteInvoiceId}`;
    const submitted = await fiscalAdminApi.fiscalizeInvoice(remoteInvoiceId, confirmation, actor);
    if (!submitted.data.isSuccess || submitted.data.status !== "Fiscalized" || !submitted.data.jikr) throw new FiscalAdminApiError(submitted.data.faultCode ?? "FISCALIZATION_FAILED", submitted.data.faultMessage ?? "Storno nije fiskalizovan.", submitted.correlationId);
    const finalInvoice = (await fiscalAdminApi.getInvoice(remoteInvoiceId, actor)).data;
    if (!finalInvoice.iic || !finalInvoice.jikr || !finalInvoice.qrCodeData) throw new FiscalAdminApiError("FISCAL_RESULT_INCOMPLETE", "Fiscal API nije vratio kompletan rezultat storna.");
    confirmedResult = { fiscalInvoiceId: remoteInvoiceId, environment: company.environment, officialInvoiceNumber: finalInvoice.officialInvoiceNumber ?? null, iic: finalInvoice.iic, jikr: finalInvoice.jikr, qrCodeData: finalInvoice.qrCodeData, correlationId: submitted.correlationId ?? null };
    await prisma.$transaction(async (tx) => {
      const taxes = prepared.original.stavke.reduce<Array<{ fiskalni_izlazni_racun_id: string; vat_rate_code: string; vat_rate_name: string; vat_rate_percent: Prisma.Decimal; tax_base: Prisma.Decimal; output_vat_amount: Prisma.Decimal; total_with_vat: Prisma.Decimal; created_by: string }>>((groups, line) => { const found = groups.find((group) => group.vat_rate_code === line.pdv_stopa_sifra); if (found) { found.tax_base = found.tax_base.minus(line.osnovica); found.output_vat_amount = found.output_vat_amount.minus(line.pdv_iznos); found.total_with_vat = found.total_with_vat.minus(line.ukupno_sa_pdv); } else groups.push({ fiskalni_izlazni_racun_id: prepared.correction.id, vat_rate_code: line.pdv_stopa_sifra, vat_rate_name: line.pdv_stopa_naziv, vat_rate_percent: line.pdv_stopa_procenat, tax_base: line.osnovica.negated(), output_vat_amount: line.pdv_iznos.negated(), total_with_vat: line.ukupno_sa_pdv.negated(), created_by: context.userId }); return groups; }, []);
      await tx.fiskalniIzlazniRacunPorez.createMany({ data: taxes });
      await applyPosReturnInventoryMovement(tx, { agencijaId: context.agencijaId, firmaId: context.firmaId, poslovnaGodinaId: context.poslovnaGodinaId, magacinId: prepared.original.magacin_id, correctionInvoiceId: prepared.correction.id, originalInvoiceId: prepared.original.id, datumPrometa: day, userId: context.userId });
      await tx.fiskalniIzlazniRacun.update({ where: { id: prepared.correction.id }, data: { fiscal_api_invoice_id: remoteInvoiceId, fiscal_status: "Fiscalized", fiscal_environment: company.environment, official_invoice_number: finalInvoice.officialInvoiceNumber, broj_racuna: finalInvoice.officialInvoiceNumber ?? prepared.correction.broj_racuna, iic: finalInvoice.iic, jikr: finalInvoice.jikr, qr_code_data: finalInvoice.qrCodeData, correlation_id: submitted.correlationId, fiscalized_at: new Date(), last_fiscal_attempt_at: new Date(), fiscal_error_code: null, fiscal_error_message: null, ...(input.accountingMode === "FISCAL_ONLY" ? { status: "FINALIZED", kif_status: "NOT_REQUIRED", nalog_id: null, kif_entry_id: null } : {}), updated_by: context.userId } });
      await tx.fiskalniIzlazniRacun.update({ where: { id: prepared.original.id }, data: { fiscal_status: "StornoCreated", updated_by: context.userId } });
      await tx.fiscalizationAttempt.update({ where: { idempotency_key: prepared.idempotencyKey }, data: { status: "SUCCEEDED", fiscal_api_invoice_id: remoteInvoiceId, correlation_id: submitted.correlationId, finished_at: new Date(), duration_ms: Date.now() - started } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    let accountingIssue: string | null = null;
    if (input.accountingMode === "CONFIGURED") {
      const settings = await prisma.posPodesavanje.findUnique({ where: { firma_id: context.firmaId }, select: { racunovodstvena_integracija: true } });
      if (settings?.racunovodstvena_integracija && prepared.original.nacin_placanja === "BANK_TRANSFER") {
        try { const result = await finalizePosTransferAccounting({ invoiceId: prepared.correction.id, agencijaId: context.agencijaId, firmaId: context.firmaId, poslovnaGodinaId: context.poslovnaGodinaId, year: context.year, userId: context.userId }); if (!result.ok) accountingIssue = result.reason; } catch { accountingIssue = "neocekivano"; }
      }
    }
    await auditLog({ korisnikId: context.userId, agencijaId: context.agencijaId, firmaId: context.firmaId, modul: posModule, akcija: "pos_full_storno_fiscalized", tipEntiteta: "FiskalniIzlazniRacun", entitetId: prepared.correction.id, novaVrijednost: { original_invoice_id: prepared.original.id, reason: input.reason.trim(), jikr: finalInvoice.jikr, accountingMode: input.accountingMode } });
    return { status: "fiscalized", correctionInvoiceId: prepared.correction.id, accountingIssue };
  } catch (error) {
    const fiscalError = error instanceof FiscalAdminApiError ? error : new FiscalAdminApiError("FISCALIZATION_FAILED", "Storno nije fiskalizovan.");
    if (confirmedResult) {
      const reconciledAt = new Date();
      await prisma.$transaction([
        prisma.fiskalniIzlazniRacun.update({ where: { id: prepared.correction.id }, data: { fiscal_api_invoice_id: confirmedResult.fiscalInvoiceId, fiscal_status: "Fiscalized", fiscal_environment: confirmedResult.environment, official_invoice_number: confirmedResult.officialInvoiceNumber, broj_racuna: confirmedResult.officialInvoiceNumber ?? undefined, iic: confirmedResult.iic, jikr: confirmedResult.jikr, qr_code_data: confirmedResult.qrCodeData, correlation_id: confirmedResult.correlationId, fiscalized_at: reconciledAt, last_fiscal_attempt_at: reconciledAt, fiscal_error_code: "LOCAL_RECONCILIATION_REQUIRED", fiscal_error_message: "Fiskalizacija je potvrđena, ali lokalna obrada zahtijeva usklađivanje.", ...(input.accountingMode === "FISCAL_ONLY" ? { status: "FINALIZED", kif_status: "NOT_REQUIRED" } : {}), updated_by: context.userId } }),
        prisma.fiskalniIzlazniRacun.update({ where: { id: prepared.original.id }, data: { fiscal_status: "StornoCreated", updated_by: context.userId } }),
        prisma.fiscalizationAttempt.update({ where: { idempotency_key: prepared.idempotencyKey }, data: { status: "SUCCEEDED", fiscal_api_invoice_id: confirmedResult.fiscalInvoiceId, correlation_id: confirmedResult.correlationId, error_code: "LOCAL_RECONCILIATION_REQUIRED", error_message: "Remote storno je potvrđen; lokalna obrada nije kompletna.", finished_at: reconciledAt, duration_ms: Date.now() - started } })
      ]);
      await auditLog({ korisnikId: context.userId, agencijaId: context.agencijaId, firmaId: context.firmaId, modul: posModule, akcija: "pos_full_storno_local_reconciliation_required", tipEntiteta: "FiskalniIzlazniRacun", entitetId: prepared.correction.id, novaVrijednost: { original_invoice_id: prepared.original.id, fiscalInvoiceId: confirmedResult.fiscalInvoiceId, environment: confirmedResult.environment } });
      return { status: "fiscalized", correctionInvoiceId: prepared.correction.id, accountingIssue: "lokalno_uskladjivanje" };
    }
    await prisma.$transaction([prisma.fiskalniIzlazniRacun.updateMany({ where: { id: prepared.correction.id, fiscal_status: { not: "Fiscalized" } }, data: { fiscal_api_invoice_id: remoteInvoiceId, fiscal_status: "FiscalizationFailed", fiscal_error_code: fiscalError.code, fiscal_error_message: fiscalError.message, correlation_id: fiscalError.correlationId, last_fiscal_attempt_at: new Date(), updated_by: context.userId } }), prisma.fiscalizationAttempt.update({ where: { idempotency_key: prepared.idempotencyKey }, data: { status: "FAILED", fiscal_api_invoice_id: remoteInvoiceId, error_code: fiscalError.code, error_message: fiscalError.message, correlation_id: fiscalError.correlationId, finished_at: new Date(), duration_ms: Date.now() - started } })]);
    await auditLog({ korisnikId: context.userId, agencijaId: context.agencijaId, firmaId: context.firmaId, modul: posModule, akcija: "pos_full_storno_failed", tipEntiteta: "FiskalniIzlazniRacun", entitetId: prepared.correction.id, novaVrijednost: { original_invoice_id: prepared.original.id, code: fiscalError.code } });
    return { status: "failed", correctionInvoiceId: prepared.correction.id, accountingIssue: null };
  }
}
