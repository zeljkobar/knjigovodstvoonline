"use server";

import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { fiscalAdminApi, FiscalAdminApiError } from "@/lib/fiscal-admin-api";
import { calculateOutgoingInvoiceLine } from "@/lib/outgoing-invoice";
import { scaledToDecimal } from "@/lib/inventory-calculation";
import { posModule, requirePosContext } from "@/lib/pos";
import { finalizePosTransferAccounting } from "@/lib/pos-transfer-accounting";
import { applyPosInventoryMovement, applyPosReturnInventoryMovement } from "@/lib/pos-inventory";
import { prisma } from "@/lib/prisma";

type PosLine = { itemId?: string; quantity?: number };
const paymentTypes: Record<string, string> = { CASH: "Cash", CARD: "Card", BANK_TRANSFER: "BankAccount", OTHER: "Other" };
function input(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }
function apiNumber(value: { toString(): string }) { return Number(value.toString()); }

async function finishTransferAccounting(input: { invoiceId: string; paymentMethod: string; enabled: boolean; ctx: Awaited<ReturnType<typeof requirePosContext>> }) {
  if (!input.enabled || input.paymentMethod !== "BANK_TRANSFER") return null;
  try {
    return await finalizePosTransferAccounting({ invoiceId: input.invoiceId, agencijaId: input.ctx.user.agencija_id!, firmaId: input.ctx.firma.id, poslovnaGodinaId: input.ctx.year.id, year: input.ctx.year.godina, userId: input.ctx.user.id });
  } catch {
    return { ok: false as const, reason: "neocekivano" };
  }
}

export async function createAndFiscalizePosSale(formData: FormData) {
  const ctx = await requirePosContext("create");
  const registerId = input(formData, "register_id");
  const paymentMethod = input(formData, "payment_method");
  const buyerId = input(formData, "buyer_id");
  let submitted: PosLine[] = [];
  try { submitted = JSON.parse(input(formData, "lines_json")) as PosLine[]; } catch { redirect("/agencija/pos?poruka=stavke"); }
  const clean = submitted.filter((line) => line.itemId && Number(line.quantity) > 0);
  if (!clean.length || !paymentTypes[paymentMethod]) redirect("/agencija/pos?poruka=stavke");

  const [settings, register, items, selectedBuyer, bankAccount] = await Promise.all([
    prisma.posPodesavanje.findUnique({ where: { firma_id: ctx.firma.id } }),
    prisma.posRegister.findFirst({ where: { id: registerId, agencija_id: ctx.user.agencija_id!, firma_id: ctx.firma.id, aktivan: true, is_deleted: false }, include: { magacin: { select: { dozvoli_negativan_lager: true } } } }),
    prisma.artikal.findMany({
      where: { id: { in: clean.map((line) => line.itemId!) }, agencija_id: ctx.user.agencija_id!, firma_id: ctx.firma.id, aktivan: true, is_deleted: false },
      include: { jedinica_mjere: true, pdv_stopa: true, cijene: { where: { aktivna: true, is_deleted: false, tip: { in: ["RETAIL", "MALOPRODAJNA"] }, OR: [{ vazi_od: null }, { vazi_od: { lte: new Date() } }], AND: [{ OR: [{ vazi_do: null }, { vazi_do: { gte: new Date() } }] }] }, orderBy: [{ vazi_od: "desc" }, { created_at: "desc" }] } }
    }),
    buyerId ? prisma.komitent.findFirst({
      where: { id: buyerId, aktivan: true, OR: [{ scope: "GLOBAL" }, { scope: "AGENCY", agencija_id: ctx.user.agencija_id! }, { scope: "COMPANY", firma_id: ctx.firma.id }] },
      select: { id: true, naziv: true, pib: true, pdv_broj: true, adresa: true, grad: true, drzava: true, country_code: true, telefon: true, email: true, is_foreign: true }
    }) : null,
    prisma.firmaBankovniRacun.findFirst({ where: { firma_id: ctx.firma.id, aktivan: true, is_deleted: false }, orderBy: [{ glavni: "desc" }, { created_at: "asc" }], select: { naziv_banke: true, broj_racuna: true } })
  ]);
  if (!settings?.aktivan || !register || !ctx.firma.fiscalCompanyLink?.fiscal_api_company_id || ctx.firma.fiscalCompanyLink.is_suspended) redirect("/agencija/pos?poruka=podesavanje");
  if ((buyerId && !selectedBuyer) || (paymentMethod === "BANK_TRANSFER" && !selectedBuyer)) redirect("/agencija/pos?poruka=kupac");
  const byId = new Map(items.map((item) => [item.id, item]));
  const rows: Prisma.StavkaIzlazneFaktureCreateManyInput[] = [];
  let discount = BigInt(0), base = BigInt(0), vat = BigInt(0), total = BigInt(0);
  for (let index = 0; index < clean.length; index += 1) {
    const source = clean[index]; const item = byId.get(source.itemId!); const price = item?.cijene.find((candidate) => !candidate.magacin_id || candidate.magacin_id === register.magacin_id);
    if (!item?.pdv_stopa || !price) redirect("/agencija/pos?poruka=cijena");
    const calculated = calculateOutgoingInvoiceLine({ quantity: String(source.quantity), netUnitPrice: price.cijena_bez_pdv.toString(), discountPercent: "0", vatPercent: ctx.firma.pdv_obveznik ? item.pdv_stopa.procenat.toString() : "0" });
    if (!calculated) redirect("/agencija/pos?poruka=iznos");
    discount += calculated.discountCents; base += calculated.baseCents; vat += calculated.vatCents; total += calculated.totalCents;
    rows.push({ izlazna_faktura_id: "00000000-0000-0000-0000-000000000000", redni_broj: index + 1, artikal_id: item.id, sifra_artikla: item.sifra, naziv_artikla: item.naziv, jedinica_mjere: item.jedinica_mjere.oznaka, usluga: item.usluga, kolicina: calculated.quantity, jedinicna_cijena_bez_pdv: calculated.unitNet, rabat_procenat: calculated.discountPercent, rabat_iznos: calculated.discount, osnovica: calculated.base, pdv_stopa_id: item.pdv_stopa.id, pdv_stopa_sifra: item.pdv_stopa.sifra, pdv_stopa_naziv: item.pdv_stopa.naziv, pdv_stopa_procenat: ctx.firma.pdv_obveznik ? item.pdv_stopa.procenat : 0, pdv_iznos: calculated.vat, jedinicna_cijena_sa_pdv: calculated.unitGross, ukupno_sa_pdv: calculated.total, created_by: ctx.user.id, updated_by: ctx.user.id });
  }

  const now = new Date(); const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dueDate = new Date(day); if (paymentMethod === "BANK_TRANSFER") dueDate.setUTCDate(dueDate.getUTCDate() + 7);
  const idempotencyKey = `pos:${ctx.firma.id}:${randomUUID()}`;
  const invoice = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.firma.id}:${ctx.year.id}:sales`}))`;
    let buyer = selectedBuyer;
    buyer ??= await tx.komitent.findFirst({ where: { firma_id: ctx.firma.id, scope: "COMPANY", naziv: "KRAJNJI POTROŠAČ", aktivan: true } });
    buyer ??= await tx.komitent.create({ data: { naziv: "KRAJNJI POTROŠAČ", scope: "COMPANY", agencija_id: ctx.user.agencija_id!, firma_id: ctx.firma.id } });
    const last = await tx.fiskalniIzlazniRacun.findFirst({ where: { firma_id: ctx.firma.id, poslovna_godina_id: ctx.year.id }, orderBy: { broj: "desc" }, select: { broj: true } });
    const number = (last?.broj ?? 0) + 1; const internal = `POS-${ctx.year.godina}-${String(number).padStart(6, "0")}`;
    const accountingStatus = !settings.racunovodstvena_integracija ? "NOT_REQUIRED" : paymentMethod === "BANK_TRANSFER" ? "ACCOUNTING_PENDING" : "WAITING_PAZAR";
    const created = await tx.fiskalniIzlazniRacun.create({ data: { agencija_id: ctx.user.agencija_id!, firma_id: ctx.firma.id, poslovna_godina_id: ctx.year.id, kupac_id: buyer.id, magacin_id: register.magacin_id, pos_register_id: register.id, broj: number, interni_broj: internal, broj_racuna: internal, datum_racuna: day, datum_prometa: day, datum_valute: dueDate, vrsta_racuna: "NORMAL", document_type: "POS_RECEIPT", sales_channel: "POS", issued_at: now, status: "DRAFT", nacin_placanja: paymentMethod, fiskalizacija_rezim: "SUMMA", vat_transaction_type: buyer.is_foreign ? "EXPORT" : "DOMESTIC", ukupno_osnovica: scaledToDecimal(base, 2), ukupno_rabat: scaledToDecimal(discount, 2), ukupno_izlazni_pdv: scaledToDecimal(vat, 2), ukupno_sa_pdv: scaledToDecimal(total, 2), issuer_snapshot: { naziv: ctx.firma.naziv, skraceniNaziv: ctx.firma.skraceni_naziv, pib: ctx.firma.pib, pdvBroj: ctx.firma.pdv_broj, adresa: ctx.firma.adresa, grad: ctx.firma.grad, drzava: ctx.firma.drzava, telefon: ctx.firma.telefon, email: ctx.firma.email, webSajt: ctx.firma.web_sajt, banka: bankAccount?.naziv_banke ?? null, ziroRacun: bankAccount?.broj_racuna ?? null }, buyer_snapshot: { naziv: buyer.naziv, pib: buyer.pib, pdvBroj: buyer.pdv_broj, adresa: buyer.adresa, grad: buyer.grad, drzava: buyer.drzava, telefon: buyer.telefon, email: buyer.email }, idempotency_key: idempotencyKey, fiscal_status: "FiscalizationPending", kif_status: accountingStatus, created_by: ctx.user.id, updated_by: ctx.user.id } });
    await tx.stavkaIzlazneFakture.createMany({ data: rows.map((row) => ({ ...row, izlazna_faktura_id: created.id })) });
    await tx.salesDocumentPayment.create({ data: { fiskalni_izlazni_racun_id: created.id, payment_method: paymentMethod, amount: scaledToDecimal(total, 2), reference: internal, created_by: ctx.user.id } });
    await tx.fiscalizationAttempt.create({ data: { fiskalni_izlazni_racun_id: created.id, attempt_number: 1, idempotency_key: idempotencyKey, status: "PENDING", created_by: ctx.user.id } });
    return created;
  });

  const actor = { id: ctx.user.id, name: ctx.user.korisnicko_ime }; const started = Date.now();
  try {
    const companyResponse = await fiscalAdminApi.getCompany(ctx.firma.fiscalCompanyLink.fiscal_api_company_id, actor); const company = companyResponse.data;
    const created = await fiscalAdminApi.createInvoice({ companyId: ctx.firma.fiscalCompanyLink.fiscal_api_company_id, businessUnitId: register.fiscal_business_unit_id, deviceId: register.fiscal_device_id, operatorId: register.fiscal_operator_id, invoiceType: "Normal", invoiceNumber: "", issueDateTime: now.toISOString(), currency: "EUR", buyer: selectedBuyer?.pib ? { identificationType: "Tin", identificationNumber: selectedBuyer.pib, name: selectedBuyer.naziv, address: selectedBuyer.adresa ?? null, town: selectedBuyer.grad ?? null, country: selectedBuyer.drzava?.toUpperCase() === "CRNA GORA" ? "MNE" : selectedBuyer.country_code ?? "MNE", taxIdentificationCode: selectedBuyer.pdv_broj ?? null } : null, supplyPeriodStart: day.toISOString().slice(0, 10), supplyPeriodEnd: day.toISOString().slice(0, 10), paymentDeadline: dueDate.toISOString().slice(0, 10), items: rows.map((line) => ({ name: line.naziv_artikla, quantity: apiNumber(line.kolicina as Prisma.Decimal), unitPrice: apiNumber(line.jedinicna_cijena_sa_pdv as Prisma.Decimal), vatRate: apiNumber(line.pdv_stopa_procenat as Prisma.Decimal), itemCode: line.sifra_artikla, unitOfMeasure: line.jedinica_mjere, discountAmount: 0 })), payments: [{ paymentType: paymentTypes[paymentMethod], amount: Number(scaledToDecimal(total, 2)), reference: invoice.interni_broj }] }, idempotencyKey, actor);
    const confirmation = company.environment === "Production" ? `FISCALIZE_PRODUCTION:${ctx.firma.pib}:${created.data.id}` : `FISCALIZE_TEST:${created.data.id}`;
    const submittedResult = await fiscalAdminApi.fiscalizeInvoice(created.data.id, confirmation, actor);
    if (!submittedResult.data.isSuccess || submittedResult.data.status !== "Fiscalized" || !submittedResult.data.jikr) throw new FiscalAdminApiError(submittedResult.data.faultCode ?? "FISCALIZATION_FAILED", submittedResult.data.faultMessage ?? "Račun nije fiskalizovan.", submittedResult.correlationId);
    const finalInvoice = (await fiscalAdminApi.getInvoice(created.data.id, actor)).data;
    if (!finalInvoice.iic || !finalInvoice.jikr || !finalInvoice.qrCodeData) throw new FiscalAdminApiError("FISCAL_RESULT_INCOMPLETE", "Fiscal API nije vratio kompletan fiskalni rezultat.");
    await prisma.$transaction(async (tx) => {
      const groups = new Map<string, { name: string; percent: Prisma.Decimal; base: bigint; vat: bigint; total: bigint }>();
      for (const row of rows) { const code = String(row.pdv_stopa_sifra); const group = groups.get(code) ?? { name: String(row.pdv_stopa_naziv), percent: new Prisma.Decimal(String(row.pdv_stopa_procenat)), base: BigInt(0), vat: BigInt(0), total: BigInt(0) }; group.base += BigInt(Math.round(Number(row.osnovica) * 100)); group.vat += BigInt(Math.round(Number(row.pdv_iznos) * 100)); group.total += BigInt(Math.round(Number(row.ukupno_sa_pdv) * 100)); groups.set(code, group); }
      await tx.fiskalniIzlazniRacunPorez.createMany({ data: [...groups.entries()].map(([code, group]) => ({ fiskalni_izlazni_racun_id: invoice.id, vat_rate_code: code, vat_rate_name: group.name, vat_rate_percent: group.percent, tax_base: scaledToDecimal(group.base, 2), output_vat_amount: scaledToDecimal(group.vat, 2), total_with_vat: scaledToDecimal(group.total, 2), created_by: ctx.user.id })) });
      await tx.fiskalniIzlazniRacun.update({ where: { id: invoice.id }, data: { fiscal_api_invoice_id: created.data.id, fiscal_status: "Fiscalized", official_invoice_number: finalInvoice.officialInvoiceNumber, broj_racuna: finalInvoice.officialInvoiceNumber ?? invoice.broj_racuna, iic: finalInvoice.iic, jikr: finalInvoice.jikr, qr_code_data: finalInvoice.qrCodeData, correlation_id: submittedResult.correlationId, fiscalized_at: new Date(), last_fiscal_attempt_at: new Date(), updated_by: ctx.user.id } });
      await tx.fiscalizationAttempt.update({ where: { idempotency_key: idempotencyKey }, data: { status: "SUCCEEDED", fiscal_api_invoice_id: created.data.id, correlation_id: submittedResult.correlationId, finished_at: new Date(), duration_ms: Date.now() - started } });
      await applyPosInventoryMovement(tx, { agencijaId: ctx.user.agencija_id!, firmaId: ctx.firma.id, poslovnaGodinaId: ctx.year.id, magacinId: register.magacin_id, invoiceId: invoice.id, datumPrometa: day, allowNegative: register.magacin?.dozvoli_negativan_lager ?? false, userId: ctx.user.id });
    });
    const accounting = await finishTransferAccounting({ invoiceId: invoice.id, paymentMethod, enabled: settings.racunovodstvena_integracija, ctx });
    await auditLog({ korisnikId: ctx.user.id, agencijaId: ctx.user.agencija_id, firmaId: ctx.firma.id, modul: posModule, akcija: "pos_sale_fiscalized", tipEntiteta: "FiskalniIzlazniRacun", entitetId: invoice.id, novaVrijednost: { register: register.sifra, paymentMethod, total: scaledToDecimal(total, 2), jikr: finalInvoice.jikr } });
    redirect(`/agencija/pos?uspjeh=${invoice.id}${accounting && !accounting.ok ? `&obrada=${accounting.reason}` : ""}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    const fiscalError = error instanceof FiscalAdminApiError ? error : new FiscalAdminApiError("FISCALIZATION_FAILED", "Fiskalizacija nije uspjela.");
    await prisma.$transaction([
      prisma.fiskalniIzlazniRacun.update({ where: { id: invoice.id }, data: { fiscal_status: "FiscalizationFailed", fiscal_error_code: fiscalError.code, fiscal_error_message: fiscalError.message, correlation_id: fiscalError.correlationId, last_fiscal_attempt_at: new Date(), updated_by: ctx.user.id } }),
      prisma.fiscalizationAttempt.update({ where: { idempotency_key: idempotencyKey }, data: { status: "FAILED", error_code: fiscalError.code, error_message: fiscalError.message, correlation_id: fiscalError.correlationId, finished_at: new Date(), duration_ms: Date.now() - started } })
    ]);
    redirect(`/agencija/pos?greska=${invoice.id}`);
  }
}

export async function createAndFiscalizePosStorno(formData: FormData) {
  const ctx = await requirePosContext("manage");
  const originalId = input(formData, "invoice_id");
  const reason = input(formData, "reason");
  if (input(formData, "confirmation") !== "CONFIRM" || reason.length < 3) redirect(`/agencija/pos/racuni/${originalId}/storno?poruka=potvrda`);
  const link = ctx.firma.fiscalCompanyLink;
  if (!link?.fiscal_api_company_id || link.is_suspended) redirect(`/agencija/pos/racuni/${originalId}/storno?poruka=podesavanje`);

  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const prepared = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pos-storno:${originalId}`}))`;
    const original = await tx.fiskalniIzlazniRacun.findFirst({
      where: { id: originalId, agencija_id: ctx.user.agencija_id!, firma_id: ctx.firma.id, poslovna_godina_id: ctx.year.id, sales_channel: "POS", document_type: "POS_RECEIPT", fiscal_status: "Fiscalized", is_deleted: false },
      include: { pos_register: true, stavke: { orderBy: { redni_broj: "asc" } }, placanja: { orderBy: { redni_broj: "asc" } }, corrective_invoices: { where: { is_deleted: false }, select: { id: true } } }
    });
    if (!original?.fiscal_api_invoice_id || !original.jikr || !original.iic || !original.pos_register || original.corrective_invoices.length) return null;
    const period = await tx.pdvPeriod.findFirst({ where: { firma_id: ctx.firma.id, poslovna_godina_id: ctx.year.id, mjesec: day.getUTCMonth() + 1 }, select: { status: true } });
    if (period?.status === "LOCKED") return null;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.firma.id}:${ctx.year.id}:sales`}))`;
    const last = await tx.fiskalniIzlazniRacun.findFirst({ where: { firma_id: ctx.firma.id, poslovna_godina_id: ctx.year.id }, orderBy: { broj: "desc" }, select: { broj: true } });
    const number = (last?.broj ?? 0) + 1;
    const internal = `POS-ST-${ctx.year.godina}-${String(number).padStart(6, "0")}`;
    const idempotencyKey = `pos-storno:${original.id}`;
    const accountingStatus = original.kif_status === "NOT_REQUIRED" ? "NOT_REQUIRED" : original.nacin_placanja === "BANK_TRANSFER" ? "ACCOUNTING_PENDING" : "WAITING_PAZAR";
    const correction = await tx.fiskalniIzlazniRacun.create({ data: {
      agencija_id: original.agencija_id, firma_id: original.firma_id, poslovna_godina_id: original.poslovna_godina_id, kupac_id: original.kupac_id, magacin_id: original.magacin_id, pos_register_id: original.pos_register_id,
      original_invoice_id: original.id, correction_reason: reason, broj: number, interni_broj: internal, broj_racuna: internal, datum_racuna: day, datum_prometa: day, datum_valute: day,
      vrsta_racuna: "CORRECTIVE", document_type: "POS_RETURN", sales_channel: "POS", issued_at: now, status: "DRAFT", nacin_placanja: original.nacin_placanja, fiskalizacija_rezim: "SUMMA", vat_transaction_type: original.vat_transaction_type,
      valuta: original.valuta, kurs: original.kurs, ukupno_osnovica: original.ukupno_osnovica.negated(), ukupno_rabat: original.ukupno_rabat.negated(), ukupno_izlazni_pdv: original.ukupno_izlazni_pdv.negated(), ukupno_sa_pdv: original.ukupno_sa_pdv.negated(),
      issuer_snapshot: original.issuer_snapshot ?? Prisma.JsonNull, buyer_snapshot: original.buyer_snapshot ?? Prisma.JsonNull, idempotency_key: idempotencyKey, fiscal_status: "FiscalizationPending", kif_status: accountingStatus, napomena: `Potpuni storno računa ${original.broj_racuna}: ${reason}`, created_by: ctx.user.id, updated_by: ctx.user.id
    } });
    await tx.stavkaIzlazneFakture.createMany({ data: original.stavke.map((line) => ({ izlazna_faktura_id: correction.id, redni_broj: line.redni_broj, artikal_id: line.artikal_id, sifra_artikla: line.sifra_artikla, naziv_artikla: line.naziv_artikla, jedinica_mjere: line.jedinica_mjere, usluga: line.usluga, kolicina: line.kolicina.negated(), jedinicna_cijena_bez_pdv: line.jedinicna_cijena_bez_pdv, rabat_procenat: line.rabat_procenat, rabat_iznos: line.rabat_iznos.negated(), osnovica: line.osnovica.negated(), pdv_stopa_id: line.pdv_stopa_id, pdv_stopa_sifra: line.pdv_stopa_sifra, pdv_stopa_naziv: line.pdv_stopa_naziv, pdv_stopa_procenat: line.pdv_stopa_procenat, pdv_iznos: line.pdv_iznos.negated(), jedinicna_cijena_sa_pdv: line.jedinicna_cijena_sa_pdv, ukupno_sa_pdv: line.ukupno_sa_pdv.negated(), jedinicna_nabavna_cijena: line.jedinicna_nabavna_cijena, nabavna_vrijednost: line.nabavna_vrijednost?.negated(), created_by: ctx.user.id, updated_by: ctx.user.id })) });
    await tx.salesDocumentPayment.createMany({ data: original.placanja.map((payment) => ({ fiskalni_izlazni_racun_id: correction.id, redni_broj: payment.redni_broj, payment_method: payment.payment_method, amount: payment.amount.negated(), reference: internal, created_by: ctx.user.id })) });
    await tx.fiscalizationAttempt.create({ data: { fiskalni_izlazni_racun_id: correction.id, attempt_number: 1, idempotency_key: idempotencyKey, status: "PENDING", created_by: ctx.user.id } });
    return { original, correction, idempotencyKey };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (!prepared) redirect(`/agencija/pos/racuni/${originalId}/storno?poruka=nije_moguc`);

  const actor = { id: ctx.user.id, name: ctx.user.korisnicko_ime };
  const started = Date.now();
  let remoteInvoiceId: string | null = null;
  try {
    const company = (await fiscalAdminApi.getCompany(link.fiscal_api_company_id, actor)).data;
    const created = await fiscalAdminApi.createInvoiceStorno(prepared.original.fiscal_api_invoice_id!, { invoiceNumber: "", issueDateTime: now.toISOString(), reason, confirmation: `CREATE_STORNO:${prepared.original.fiscal_api_invoice_id}` }, prepared.idempotencyKey, actor);
    remoteInvoiceId = created.data.id;
    const confirmation = company.environment === "Production" ? `FISCALIZE_PRODUCTION:${ctx.firma.pib}:${created.data.id}` : `FISCALIZE_TEST:${created.data.id}`;
    const submitted = await fiscalAdminApi.fiscalizeInvoice(created.data.id, confirmation, actor);
    if (!submitted.data.isSuccess || submitted.data.status !== "Fiscalized" || !submitted.data.jikr) throw new FiscalAdminApiError(submitted.data.faultCode ?? "FISCALIZATION_FAILED", submitted.data.faultMessage ?? "Storno nije fiskalizovan.", submitted.correlationId);
    const finalInvoice = (await fiscalAdminApi.getInvoice(created.data.id, actor)).data;
    if (!finalInvoice.iic || !finalInvoice.jikr || !finalInvoice.qrCodeData) throw new FiscalAdminApiError("FISCAL_RESULT_INCOMPLETE", "Fiscal API nije vratio kompletan rezultat storna.");
    await prisma.$transaction(async (tx) => {
      await tx.fiskalniIzlazniRacunPorez.createMany({ data: prepared.original.stavke.reduce<Array<{ fiskalni_izlazni_racun_id: string; vat_rate_code: string; vat_rate_name: string; vat_rate_percent: Prisma.Decimal; tax_base: Prisma.Decimal; output_vat_amount: Prisma.Decimal; total_with_vat: Prisma.Decimal; created_by: string }>>((groups, line) => { const found = groups.find((group) => group.vat_rate_code === line.pdv_stopa_sifra); if (found) { found.tax_base = found.tax_base.minus(line.osnovica); found.output_vat_amount = found.output_vat_amount.minus(line.pdv_iznos); found.total_with_vat = found.total_with_vat.minus(line.ukupno_sa_pdv); } else groups.push({ fiskalni_izlazni_racun_id: prepared.correction.id, vat_rate_code: line.pdv_stopa_sifra, vat_rate_name: line.pdv_stopa_naziv, vat_rate_percent: line.pdv_stopa_procenat, tax_base: line.osnovica.negated(), output_vat_amount: line.pdv_iznos.negated(), total_with_vat: line.ukupno_sa_pdv.negated(), created_by: ctx.user.id }); return groups; }, []) });
      await tx.fiskalniIzlazniRacun.update({ where: { id: prepared.correction.id }, data: { fiscal_api_invoice_id: created.data.id, fiscal_status: "Fiscalized", official_invoice_number: finalInvoice.officialInvoiceNumber, broj_racuna: finalInvoice.officialInvoiceNumber ?? prepared.correction.broj_racuna, iic: finalInvoice.iic, jikr: finalInvoice.jikr, qr_code_data: finalInvoice.qrCodeData, correlation_id: submitted.correlationId, fiscalized_at: new Date(), last_fiscal_attempt_at: new Date(), updated_by: ctx.user.id } });
      await tx.fiskalniIzlazniRacun.update({ where: { id: prepared.original.id }, data: { fiscal_status: "StornoCreated", updated_by: ctx.user.id } });
      await tx.fiscalizationAttempt.update({ where: { idempotency_key: prepared.idempotencyKey }, data: { status: "SUCCEEDED", fiscal_api_invoice_id: created.data.id, correlation_id: submitted.correlationId, finished_at: new Date(), duration_ms: Date.now() - started } });
      await applyPosReturnInventoryMovement(tx, { agencijaId: ctx.user.agencija_id!, firmaId: ctx.firma.id, poslovnaGodinaId: ctx.year.id, magacinId: prepared.original.magacin_id, correctionInvoiceId: prepared.correction.id, originalInvoiceId: prepared.original.id, datumPrometa: day, userId: ctx.user.id });
    });
    const settings = await prisma.posPodesavanje.findUnique({ where: { firma_id: ctx.firma.id }, select: { racunovodstvena_integracija: true } });
    const accounting = await finishTransferAccounting({ invoiceId: prepared.correction.id, paymentMethod: prepared.original.nacin_placanja, enabled: settings?.racunovodstvena_integracija ?? false, ctx });
    await auditLog({ korisnikId: ctx.user.id, agencijaId: ctx.user.agencija_id, firmaId: ctx.firma.id, modul: posModule, akcija: "pos_full_storno_fiscalized", tipEntiteta: "FiskalniIzlazniRacun", entitetId: prepared.correction.id, novaVrijednost: { original_invoice_id: prepared.original.id, reason, jikr: finalInvoice.jikr } });
    redirect(`/agencija/pos/racuni?storno=${prepared.correction.id}${accounting && !accounting.ok ? `&obrada=${accounting.reason}` : ""}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    const fiscalError = error instanceof FiscalAdminApiError ? error : new FiscalAdminApiError("FISCALIZATION_FAILED", "Storno nije fiskalizovan.");
    await prisma.$transaction([prisma.fiskalniIzlazniRacun.update({ where: { id: prepared.correction.id }, data: { fiscal_api_invoice_id: remoteInvoiceId, fiscal_status: "FiscalizationFailed", fiscal_error_code: fiscalError.code, fiscal_error_message: fiscalError.message, correlation_id: fiscalError.correlationId, last_fiscal_attempt_at: new Date(), updated_by: ctx.user.id } }), prisma.fiscalizationAttempt.update({ where: { idempotency_key: prepared.idempotencyKey }, data: { status: "FAILED", fiscal_api_invoice_id: remoteInvoiceId, error_code: fiscalError.code, error_message: fiscalError.message, correlation_id: fiscalError.correlationId, finished_at: new Date(), duration_ms: Date.now() - started } })]);
    await auditLog({ korisnikId: ctx.user.id, agencijaId: ctx.user.agencija_id, firmaId: ctx.firma.id, modul: posModule, akcija: "pos_full_storno_failed", tipEntiteta: "FiskalniIzlazniRacun", entitetId: prepared.correction.id, novaVrijednost: { original_invoice_id: prepared.original.id, code: fiscalError.code } });
    redirect(`/agencija/pos/racuni?storno_greska=${prepared.correction.id}`);
  }
}

export async function retryPosFiscalization(formData: FormData) {
  const ctx = await requirePosContext("create");
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
  try {
    const company = (await fiscalAdminApi.getCompany(link.fiscal_api_company_id, actor)).data;
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

    const groups = new Map<string, { name: string; percent: Prisma.Decimal; base: Prisma.Decimal; vat: Prisma.Decimal; total: Prisma.Decimal }>();
    for (const row of invoice.stavke) {
      const code = row.pdv_stopa_sifra; const current = groups.get(code) ?? { name: row.pdv_stopa_naziv, percent: row.pdv_stopa_procenat, base: new Prisma.Decimal(0), vat: new Prisma.Decimal(0), total: new Prisma.Decimal(0) };
      current.base = current.base.plus(row.osnovica); current.vat = current.vat.plus(row.pdv_iznos); current.total = current.total.plus(row.ukupno_sa_pdv); groups.set(code, current);
    }
    await prisma.$transaction(async (tx) => {
      await tx.fiskalniIzlazniRacunPorez.deleteMany({ where: { fiskalni_izlazni_racun_id: invoice.id } });
      await tx.fiskalniIzlazniRacunPorez.createMany({ data: [...groups.entries()].map(([code, group]) => ({ fiskalni_izlazni_racun_id: invoice.id, vat_rate_code: code, vat_rate_name: group.name, vat_rate_percent: group.percent, tax_base: group.base, output_vat_amount: group.vat, total_with_vat: group.total, created_by: ctx.user.id })) });
      await tx.fiskalniIzlazniRacun.update({ where: { id: invoice.id }, data: { fiscal_api_invoice_id: created.data.id, fiscal_status: "Fiscalized", official_invoice_number: finalInvoice.officialInvoiceNumber, broj_racuna: finalInvoice.officialInvoiceNumber ?? invoice.broj_racuna, iic: finalInvoice.iic, jikr: finalInvoice.jikr, qr_code_data: finalInvoice.qrCodeData, correlation_id: submitted.correlationId, fiscalized_at: new Date(), last_fiscal_attempt_at: new Date(), updated_by: ctx.user.id } });
      if (invoice.document_type === "POS_RETURN" && invoice.original_invoice_id) await tx.fiskalniIzlazniRacun.update({ where: { id: invoice.original_invoice_id }, data: { fiscal_status: "StornoCreated", updated_by: ctx.user.id } });
      await tx.fiscalizationAttempt.update({ where: { idempotency_key: attemptKey }, data: { status: "SUCCEEDED", fiscal_api_invoice_id: created.data.id, correlation_id: submitted.correlationId, finished_at: new Date(), duration_ms: Date.now() - started } });
      if (invoice.document_type === "POS_RETURN" && invoice.original_invoice_id) await applyPosReturnInventoryMovement(tx, { agencijaId: ctx.user.agencija_id!, firmaId: ctx.firma.id, poslovnaGodinaId: ctx.year.id, magacinId: invoice.original_invoice?.magacin_id ?? invoice.magacin_id, correctionInvoiceId: invoice.id, originalInvoiceId: invoice.original_invoice_id, datumPrometa: invoice.datum_prometa, userId: ctx.user.id });
      else await applyPosInventoryMovement(tx, { agencijaId: ctx.user.agencija_id!, firmaId: ctx.firma.id, poslovnaGodinaId: ctx.year.id, magacinId: invoice.magacin_id, invoiceId: invoice.id, datumPrometa: invoice.datum_prometa, allowNegative: invoice.pos_register?.magacin?.dozvoli_negativan_lager ?? false, userId: ctx.user.id });
    });
    const accounting = await finishTransferAccounting({ invoiceId: invoice.id, paymentMethod: invoice.nacin_placanja, enabled: settings?.racunovodstvena_integracija ?? false, ctx });
    await auditLog({ korisnikId: ctx.user.id, agencijaId: ctx.user.agencija_id, firmaId: ctx.firma.id, modul: posModule, akcija: "retry_pos_fiscalization_succeeded", tipEntiteta: "FiskalniIzlazniRacun", entitetId: invoice.id, novaVrijednost: { attemptKey, jikr: finalInvoice.jikr } });
    redirect(`/agencija/pos/racuni?uspjeh=${invoice.id}${accounting && !accounting.ok ? `&obrada=${accounting.reason}` : ""}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    const fiscalError = error instanceof FiscalAdminApiError ? error : new FiscalAdminApiError("FISCALIZATION_FAILED", "Fiskalizacija nije uspjela.");
    await prisma.$transaction([
      prisma.fiskalniIzlazniRacun.update({ where: { id: invoice.id }, data: { fiscal_api_invoice_id: remoteInvoiceId, fiscal_status: "FiscalizationFailed", fiscal_error_code: fiscalError.code, fiscal_error_message: fiscalError.message, correlation_id: fiscalError.correlationId, last_fiscal_attempt_at: new Date(), updated_by: ctx.user.id } }),
      prisma.fiscalizationAttempt.update({ where: { idempotency_key: attemptKey }, data: { status: "FAILED", fiscal_api_invoice_id: remoteInvoiceId, error_code: fiscalError.code, error_message: fiscalError.message, correlation_id: fiscalError.correlationId, finished_at: new Date(), duration_ms: Date.now() - started } })
    ]);
    await auditLog({ korisnikId: ctx.user.id, agencijaId: ctx.user.agencija_id, firmaId: ctx.firma.id, modul: posModule, akcija: "retry_pos_fiscalization_failed", tipEntiteta: "FiskalniIzlazniRacun", entitetId: invoice.id, novaVrijednost: { attemptKey, code: fiscalError.code } });
    redirect(`/agencija/pos/racuni?greska=${invoice.id}`);
  }
}

export async function completePosTransferAccounting(formData: FormData) {
  const ctx = await requirePosContext("create");
  const invoiceId = input(formData, "invoice_id");
  const result = await finishTransferAccounting({ invoiceId, paymentMethod: "BANK_TRANSFER", enabled: true, ctx });
  await auditLog({ korisnikId: ctx.user.id, agencijaId: ctx.user.agencija_id, firmaId: ctx.firma.id, modul: posModule, akcija: result?.ok ? "pos_transfer_accounting_completed" : "pos_transfer_accounting_failed", tipEntiteta: "FiskalniIzlazniRacun", entitetId: invoiceId, novaVrijednost: result });
  if (!result?.ok) redirect(`/agencija/pos/racuni?obrada=${result?.reason ?? "racun"}`);
  redirect(`/agencija/pos/racuni?knjizenje=${invoiceId}`);
}
