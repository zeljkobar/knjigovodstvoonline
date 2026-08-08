"use server";

import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { inventoryModule } from "@/lib/inventory";
import { calculateOutgoingInvoiceLine, outgoingInvoiceFiscalModes, outgoingInvoiceStatuses } from "@/lib/outgoing-invoice";
import { decimalToScaled, scaledToDecimal } from "@/lib/inventory-calculation";
import { accountOverrideTypes } from "@/lib/account-plan";
import { formatJournalCode, journalStatuses, standardJournalTypes } from "@/lib/journals";
import { outgoingInvoicePostingFields, outgoingInvoicePostingScope } from "@/lib/outgoing-invoice";
import { prisma } from "@/lib/prisma";
import { getInventoryContext } from "../_shared";
import { readWorkContext } from "@/lib/work-context";
import { fiscalAdminApi, FiscalAdminApiError } from "@/lib/fiscal-admin-api";

function text(value: FormDataEntryValue | null) { return String(value ?? "").trim(); }
function date(value: FormDataEntryValue | null) { const raw = text(value); return raw ? new Date(`${raw}T00:00:00.000Z`) : null; }
function addUtcDays(value: Date, days: number) { const result = new Date(value); result.setUTCDate(result.getUTCDate() + days); return result; }
function detail(id: string, message: string): never { redirect(`/agencija/robno/izlazne-fakture/${id}?poruka=${message}`); }

async function context(action: "create" | "update", firmaId: string) {
  const [ctx, work] = await Promise.all([getInventoryContext(action), readWorkContext()]);
  if (!ctx.allowed || !ctx.firma || !ctx.user.agencija_id || ctx.firma.id !== firmaId || !work.poslovnaGodinaId) redirect("/agencija/robno/izlazne-fakture?poruka=prava");
  const year = await prisma.poslovnaGodina.findFirst({ where: { id: work.poslovnaGodinaId, firma_id: firmaId }, select: { id: true, godina: true, zakljucena: true } });
  if (!year || year.zakljucena) redirect("/agencija/robno/izlazne-fakture?poruka=zakljucana");
  return { ...ctx, firma: ctx.firma, year };
}

export async function createOutgoingInvoice(formData: FormData) {
  const firmaId = text(formData.get("firma_id"));
  const ctx = await context("create", firmaId);
  const buyerId = text(formData.get("kupac_id"));
  const invoiceDate = date(formData.get("datum_racuna"));
  const dueDate = date(formData.get("datum_valute")) ?? (invoiceDate ? addUtcDays(invoiceDate, 7) : null);
  if (!buyerId || !invoiceDate) redirect("/agencija/robno/nova-izlazna-faktura?poruka=obavezno");
  const [buyer, fiscalLink, last, bankAccount] = await Promise.all([
    prisma.komitent.findFirst({ where: { id: buyerId, aktivan: true, OR: [{ scope: "GLOBAL" }, { scope: "AGENCY", agencija_id: ctx.user.agencija_id }, { scope: "COMPANY", firma_id: firmaId }] }, select: { id: true, naziv: true, pib: true, pdv_broj: true, adresa: true, grad: true, drzava: true, email: true, telefon: true, is_foreign: true } }),
    prisma.fiscalCompanyLink.findUnique({ where: { firma_id: firmaId }, select: { fiscal_api_company_id: true, is_suspended: true } }),
    prisma.fiskalniIzlazniRacun.findFirst({ where: { firma_id: firmaId, poslovna_godina_id: ctx.year.id }, orderBy: { broj: "desc" }, select: { broj: true } }),
    prisma.firmaBankovniRacun.findFirst({ where: { firma_id: firmaId, aktivan: true, is_deleted: false }, orderBy: [{ glavni: "desc" }, { created_at: "asc" }], select: { naziv_banke: true, broj_racuna: true } })
  ]);
  if (!buyer) redirect("/agencija/robno/nova-izlazna-faktura?poruka=kupac");
  const number = (last?.broj ?? 0) + 1;
  const internal = `IF-${ctx.year.godina}-${String(number).padStart(4, "0")}`;
  const mode = fiscalLink?.fiscal_api_company_id && !fiscalLink.is_suspended ? outgoingInvoiceFiscalModes.summa : outgoingInvoiceFiscalModes.externalOrNone;
  const invoice = await prisma.fiskalniIzlazniRacun.create({ data: {
    agencija_id: ctx.user.agencija_id!, firma_id: firmaId, poslovna_godina_id: ctx.year.id,
    kupac_id: buyer.id, broj: number, interni_broj: internal, broj_racuna: internal,
    datum_racuna: invoiceDate, datum_prometa: invoiceDate, datum_valute: dueDate,
    vat_transaction_type: buyer.is_foreign ? "EXPORT" : "DOMESTIC", fiskalizacija_rezim: mode,
    fiscal_status: mode === outgoingInvoiceFiscalModes.summa ? "DRAFT" : "NOT_REQUIRED",
    issuer_snapshot: { naziv: ctx.firma.naziv, skraceniNaziv: ctx.firma.skraceni_naziv, pib: ctx.firma.pib, pdvBroj: ctx.firma.pdv_broj, adresa: ctx.firma.adresa, grad: ctx.firma.grad, drzava: ctx.firma.drzava, telefon: ctx.firma.telefon, email: ctx.firma.email, webSajt: ctx.firma.web_sajt, banka: bankAccount?.naziv_banke ?? null, ziroRacun: bankAccount?.broj_racuna ?? null },
    buyer_snapshot: { naziv: buyer.naziv, pib: buyer.pib, pdvBroj: buyer.pdv_broj, adresa: buyer.adresa, grad: buyer.grad, drzava: buyer.drzava, telefon: buyer.telefon, email: buyer.email },
    idempotency_key: mode === outgoingInvoiceFiscalModes.summa ? `website:${firmaId}:${randomUUID()}` : null,
    kif_status: "DRAFT", created_by: ctx.user.id, updated_by: ctx.user.id
  } });
  await auditLog({ korisnikId: ctx.user.id, agencijaId: ctx.user.agencija_id, firmaId, modul: inventoryModule, akcija: "create_outgoing_invoice", tipEntiteta: "FiskalniIzlazniRacun", entitetId: invoice.id, novaVrijednost: { interni_broj: internal, fiskalizacija_rezim: mode } });
  redirect(`/agencija/robno/izlazne-fakture/${invoice.id}?poruka=kreirana`);
}

type SubmittedLine = { itemId?: string; quantity?: string; netUnitPrice?: string; discountPercent?: string; note?: string };

export async function saveOutgoingInvoiceDraft(formData: FormData) {
  const id = text(formData.get("faktura_id"));
  const firmaId = text(formData.get("firma_id"));
  const ctx = await context("update", firmaId);
  const raw = text(formData.get("stavke_json"));
  let submitted: SubmittedLine[];
  try { submitted = JSON.parse(raw) as SubmittedLine[]; } catch { detail(id, "stavke"); }
  const clean = submitted.filter((line) => line.itemId);
  if (!clean.length) detail(id, "stavke");

  const invoice = await prisma.fiskalniIzlazniRacun.findFirst({ where: { id, agencija_id: ctx.user.agencija_id!, firma_id: firmaId, poslovna_godina_id: ctx.year.id, status: outgoingInvoiceStatuses.draft, is_deleted: false }, select: { id: true } });
  if (!invoice) detail(id, "nije_nacrt");
  const items = await prisma.artikal.findMany({ where: { id: { in: clean.map((line) => line.itemId!) }, firma_id: firmaId, agencija_id: ctx.user.agencija_id!, aktivan: true, is_deleted: false }, include: { jedinica_mjere: true, pdv_stopa: true } });
  if (items.length !== new Set(clean.map((line) => line.itemId)).size) detail(id, "artikal");
  const byId = new Map(items.map((item) => [item.id, item]));
  const rows: Array<Omit<Prisma.StavkaIzlazneFaktureCreateManyInput, "izlazna_faktura_id">> = [];
  let discount = BigInt(0), base = BigInt(0), vat = BigInt(0), total = BigInt(0);
  for (let index = 0; index < clean.length; index += 1) {
    const source = clean[index]; const item = byId.get(source.itemId!);
    if (!item?.pdv_stopa) detail(id, "pdv");
    const amount = calculateOutgoingInvoiceLine({ quantity: source.quantity ?? "", netUnitPrice: source.netUnitPrice ?? "", discountPercent: source.discountPercent ?? "0", vatPercent: ctx.firma.pdv_obveznik ? item.pdv_stopa.procenat.toString() : "0" });
    if (!amount) detail(id, "iznosi");
    discount += amount.discountCents; base += amount.baseCents; vat += amount.vatCents; total += amount.totalCents;
    rows.push({ redni_broj: index + 1, artikal_id: item.id, sifra_artikla: item.sifra, naziv_artikla: item.naziv, jedinica_mjere: item.jedinica_mjere.oznaka, usluga: item.usluga,
      kolicina: amount.quantity, jedinicna_cijena_bez_pdv: amount.unitNet, rabat_procenat: amount.discountPercent, rabat_iznos: amount.discount,
      osnovica: amount.base, pdv_stopa_id: item.pdv_stopa.id, pdv_stopa_sifra: item.pdv_stopa.sifra, pdv_stopa_naziv: item.pdv_stopa.naziv,
      pdv_stopa_procenat: ctx.firma.pdv_obveznik ? item.pdv_stopa.procenat : 0, pdv_iznos: amount.vat, jedinicna_cijena_sa_pdv: amount.unitGross, ukupno_sa_pdv: amount.total,
      napomena: source.note?.trim() || null, created_by: ctx.user.id, updated_by: ctx.user.id });
  }
  await prisma.$transaction(async (tx) => {
    await tx.stavkaIzlazneFakture.deleteMany({ where: { izlazna_faktura_id: id } });
    await tx.stavkaIzlazneFakture.createMany({ data: rows.map((row) => ({ ...row, izlazna_faktura_id: id })) });
    await tx.fiskalniIzlazniRacun.update({ where: { id }, data: { ukupno_rabat: scaledToDecimal(discount, 2), ukupno_osnovica: scaledToDecimal(base, 2), ukupno_izlazni_pdv: scaledToDecimal(vat, 2), ukupno_sa_pdv: scaledToDecimal(total, 2), updated_by: ctx.user.id } });
  });
  await auditLog({ korisnikId: ctx.user.id, agencijaId: ctx.user.agencija_id, firmaId, modul: inventoryModule, akcija: "update_outgoing_invoice_lines", tipEntiteta: "FiskalniIzlazniRacun", entitetId: id, novaVrijednost: { broj_stavki: rows.length, ukupno: scaledToDecimal(total, 2) } });
  revalidatePath(`/agencija/robno/izlazne-fakture/${id}`); detail(id, "sacuvana");
}

async function resolveAccount(tx: Prisma.TransactionClient, firmaId: string, code: string) {
  const existing = await tx.firmaKonto.findUnique({ where: { firma_id_sifra: { firma_id: firmaId, sifra: code } } });
  if (existing) return existing.aktivan && existing.override_type !== accountOverrideTypes.deactivated && existing.tip_konta === "analiticko" ? existing : null;
  const base = await tx.konto.findFirst({ where: { sifra: code, aktivan: true, tip_konta: "analiticko" } });
  if (!base) return null;
  return tx.firmaKonto.create({ data: { firma_id: firmaId, konto_id: base.id, sifra: base.sifra, naziv: base.naziv, tip_konta: base.tip_konta, analitika_obavezna: base.analitika_obavezna, sinteticki_konto: base.sinteticki_konto, normalni_saldo: base.normalni_saldo, koristi_radnu_jedinicu: base.koristi_radnu_jedinicu, override_type: accountOverrideTypes.baseLink, aktivan: true } });
}

export async function updateOutgoingInvoiceHeader(formData: FormData) {
  const id = text(formData.get("faktura_id")); const firmaId = text(formData.get("firma_id")); const ctx = await context("update", firmaId);
  const warehouseId = text(formData.get("magacin_id")) || null; const payment = text(formData.get("nacin_placanja")); const note = text(formData.get("napomena")) || null;
  if (warehouseId) { const warehouse = await prisma.magacin.findFirst({ where: { id: warehouseId, agencija_id: ctx.user.agencija_id!, firma_id: firmaId, aktivan: true, is_deleted: false } }); if (!warehouse) detail(id, "magacin"); }
  const result = await prisma.fiskalniIzlazniRacun.updateMany({ where: { id, agencija_id: ctx.user.agencija_id!, firma_id: firmaId, poslovna_godina_id: ctx.year.id, status: outgoingInvoiceStatuses.draft, is_deleted: false }, data: { magacin_id: warehouseId, nacin_placanja: payment || "BANK_TRANSFER", napomena: note, updated_by: ctx.user.id } });
  if (!result.count) detail(id, "nije_nacrt"); revalidatePath(`/agencija/robno/izlazne-fakture/${id}`); detail(id, "zaglavlje");
}

async function preflightOutgoingInvoice(id: string, firmaId: string, ctx: Awaited<ReturnType<typeof context>>, includePosting = true) {
  const invoice = await prisma.fiskalniIzlazniRacun.findFirst({
    where: { id, agencija_id: ctx.user.agencija_id!, firma_id: firmaId, poslovna_godina_id: ctx.year.id, status: outgoingInvoiceStatuses.draft, is_deleted: false },
    include: { stavke: true, kupac: true, magacin: true, firma: { select: { pib: true, fiscalCompanyLink: true } } }
  });
  if (!invoice) return { ok: false as const, reason: "nije_nacrt" };
  if (!invoice.stavke.length || decimalToScaled(invoice.ukupno_sa_pdv, 2) <= BigInt(0)) return { ok: false as const, reason: "stavke" };
  const goods = invoice.stavke.filter((line) => !line.usluga);
  if (goods.length && !invoice.magacin_id) return { ok: false as const, reason: "magacin_obavezan" };
  const period = await prisma.pdvPeriod.findFirst({ where: { firma_id: firmaId, poslovna_godina_id: ctx.year.id, mjesec: invoice.datum_racuna.getUTCMonth() + 1 }, select: { status: true } });
  if (period?.status === "LOCKED") return { ok: false as const, reason: "pdv_period" };

  if (includePosting) {
  const [settings, journalType] = await Promise.all([
    prisma.firmaPodrazumijevanoKonto.findMany({ where: { firma_id: firmaId, dokument_tip: outgoingInvoicePostingScope.documentType, podvrsta: outgoingInvoicePostingScope.subtype, pdv_stopa_sifra: outgoingInvoicePostingScope.vatRate } }),
    prisma.vrstaNaloga.findFirst({ where: { sifra: standardJournalTypes[2][0], aktivan: true, OR: [{ sistemska: true }, { agencija_id: ctx.user.agencija_id }, { firma_id: firmaId }] }, select: { id: true } })
  ]);
  if (!journalType) return { ok: false as const, reason: "vrsta_naloga" };
  const requiredPurposes = new Set(["INVOICE_CUSTOMER", "INVOICE_REVENUE"]);
  if (decimalToScaled(invoice.ukupno_izlazni_pdv, 2) > BigInt(0)) requiredPurposes.add("INVOICE_OUTPUT_VAT");
  if (goods.length) { requiredPurposes.add("INVOICE_COGS"); requiredPurposes.add("INVOICE_INVENTORY"); }
  const settingMap = new Map(settings.map((setting) => [setting.namjena, setting]));
  for (const purpose of requiredPurposes) {
    const code = settingMap.get(purpose)?.sifra_konta;
    if (!code) return { ok: false as const, reason: "podesavanja" };
    const [companyAccount, baseAccount] = await Promise.all([
      prisma.firmaKonto.findUnique({ where: { firma_id_sifra: { firma_id: firmaId, sifra: code } }, select: { aktivan: true, override_type: true, tip_konta: true } }),
      prisma.konto.findFirst({ where: { sifra: code, aktivan: true, tip_konta: "analiticko" }, select: { id: true } })
    ]);
    if (companyAccount ? !companyAccount.aktivan || companyAccount.override_type === accountOverrideTypes.deactivated || companyAccount.tip_konta !== "analiticko" : !baseAccount) return { ok: false as const, reason: "konto" };
  }
  }
  for (const line of goods) {
    const state = await prisma.stanjeZaliha.findUnique({ where: { firma_id_poslovna_godina_id_magacin_id_artikal_id: { firma_id: firmaId, poslovna_godina_id: ctx.year.id, magacin_id: invoice.magacin_id!, artikal_id: line.artikal_id } } });
    const quantity = decimalToScaled(line.kolicina, 3); const available = decimalToScaled(state?.kolicina ?? 0, 3);
    const allowNegative = invoice.magacin?.dozvoli_negativan_lager ?? ctx.firma.dozvoli_negativan_lager;
    if (!allowNegative && available < quantity) return { ok: false as const, reason: `lager:${line.naziv_artikla}:${Number(available) / 1000}` };
    if (decimalToScaled(state?.prosjecna_nabavna_cijena ?? 0, 4) <= BigInt(0)) return { ok: false as const, reason: `nabavna:${line.naziv_artikla}` };
  }
  return { ok: true as const, invoice };
}

function apiNumber(value: { toString(): string }) { return Number(value.toString()); }

export async function fiscalizeOutgoingInvoice(formData: FormData) {
  const id = text(formData.get("faktura_id")); const firmaId = text(formData.get("firma_id")); const ctx = await context("update", firmaId);
  const preflight = await preflightOutgoingInvoice(id, firmaId, ctx, false);
  if (!preflight.ok) detail(id, preflight.reason);
  const invoice = preflight.invoice;
  if (invoice.fiskalizacija_rezim !== outgoingInvoiceFiscalModes.summa) detail(id, "fiskalizacija_nije_summa");
  const link = invoice.firma.fiscalCompanyLink;
  if (!link?.fiscal_api_company_id || link.is_suspended) detail(id, link?.is_suspended ? "fiskalizacija_suspendovana" : "fiskalizacija_nije_podesena");
  if (!invoice.firma.pib) detail(id, "fiskalizacija_pib");
  const actor = { id: ctx.user.id, name: ctx.user.korisnicko_ime };
  const issueDateTime = new Date();
  const issueDate = new Date(Date.UTC(issueDateTime.getUTCFullYear(), issueDateTime.getUTCMonth(), issueDateTime.getUTCDate()));
  const paymentDeadlineDate = invoice.datum_valute && invoice.datum_valute >= issueDate ? invoice.datum_valute : addUtcDays(issueDate, 7);

  if (invoice.fiscal_status === "Fiscalized") return finalizeOutgoingInvoice(formData);
  const staleAttemptBefore = new Date(Date.now() - 2 * 60 * 1000);
  let idempotencyKey = invoice.idempotency_key ?? `website:${firmaId}:${invoice.id}`;
  const claimed = await prisma.fiskalniIzlazniRacun.updateMany({
    where: { id, firma_id: firmaId, status: outgoingInvoiceStatuses.draft, OR: [{ fiscal_status: { not: "FiscalizationPending" } }, { fiscal_status: "FiscalizationPending", last_fiscal_attempt_at: { lt: staleAttemptBefore } }] },
    data: { fiscal_status: "FiscalizationPending", idempotency_key: idempotencyKey, datum_valute: paymentDeadlineDate, last_fiscal_attempt_at: new Date(), updated_by: ctx.user.id }
  });
  if (!claimed.count) detail(id, "fiskalizacija_u_toku");

  try {
    let fiscalInvoiceId = invoice.fiscal_api_invoice_id;
    let finalInvoice = fiscalInvoiceId ? (await fiscalAdminApi.getInvoice(fiscalInvoiceId, actor)).data : null;
    if (finalInvoice && !/^\d+(?:\/|$)/.test(finalInvoice.invoiceNumber)) {
      fiscalInvoiceId = null;
      finalInvoice = null;
      idempotencyKey = `website:${firmaId}:${invoice.id}:retry:${randomUUID()}`;
      await prisma.fiskalniIzlazniRacun.update({ where: { id }, data: { fiscal_api_invoice_id: null, idempotency_key: idempotencyKey, updated_by: ctx.user.id } });
    }
    const [company, readiness, units, devices, operators] = await Promise.all([
      fiscalAdminApi.getCompany(link.fiscal_api_company_id, actor),
      fiscalAdminApi.getReadiness(link.fiscal_api_company_id, actor),
      fiscalAdminApi.listBusinessUnits(link.fiscal_api_company_id, actor),
      fiscalAdminApi.listDevices(link.fiscal_api_company_id, actor),
      fiscalAdminApi.listOperators(link.fiscal_api_company_id, actor)
    ]);
    if (!company.data.isActive || !readiness.data.isReady) throw new FiscalAdminApiError("COMPANY_NOT_READY", "Firma nije spremna za fiskalizaciju.");
    const unit = units.data.find((item) => item.isActive && (!item.environment || item.environment === company.data.environment));
    const device = devices.data.find((item) => item.isActive && item.businessUnitId === unit?.id);
    const operator = operators.data.find((item) => item.isActive && (!item.environment || item.environment === company.data.environment));
    if (!unit || !device || !operator) throw new FiscalAdminApiError("FISCAL_CONFIGURATION_MISSING", "Nedostaje aktivna poslovna jedinica, ENU ili operater.");

    if (!fiscalInvoiceId) {
      const created = await fiscalAdminApi.createInvoice({
        companyId: link.fiscal_api_company_id, businessUnitId: unit.id, deviceId: device.id, operatorId: operator.id,
        invoiceType: "Normal", invoiceNumber: "", issueDateTime: issueDateTime.toISOString(), currency: "EUR",
        buyer: invoice.kupac.pib ? { identificationType: "Tin", identificationNumber: invoice.kupac.pib, name: invoice.kupac.naziv, address: invoice.kupac.adresa ?? null, town: invoice.kupac.grad ?? null, country: invoice.kupac.drzava?.toUpperCase() === "CRNA GORA" ? "MNE" : invoice.kupac.country_code ?? "MNE", taxIdentificationCode: invoice.kupac.pdv_broj ?? null } : null,
        supplyPeriodStart: invoice.datum_prometa.toISOString().slice(0, 10), supplyPeriodEnd: invoice.datum_prometa.toISOString().slice(0, 10), paymentDeadline: paymentDeadlineDate.toISOString().slice(0, 10),
        items: invoice.stavke.map((line) => ({ name: line.naziv_artikla, quantity: apiNumber(line.kolicina), unitPrice: apiNumber(line.jedinicna_cijena_sa_pdv), vatRate: apiNumber(line.pdv_stopa_procenat), itemCode: line.sifra_artikla, unitOfMeasure: line.jedinica_mjere, discountAmount: Number((apiNumber(line.kolicina) * apiNumber(line.jedinicna_cijena_sa_pdv) - apiNumber(line.ukupno_sa_pdv)).toFixed(2)) })),
        payments: [{ paymentType: invoice.nacin_placanja === "CASH" ? "Cash" : invoice.nacin_placanja === "CARD" ? "Card" : invoice.nacin_placanja === "BANK_TRANSFER" ? "BankAccount" : "Other", amount: apiNumber(invoice.ukupno_sa_pdv), reference: invoice.interni_broj }]
      }, idempotencyKey, actor);
      fiscalInvoiceId = created.data.id; finalInvoice = created.data;
      await prisma.fiskalniIzlazniRacun.update({ where: { id }, data: { fiscal_api_invoice_id: fiscalInvoiceId, fiscal_status: "FiscalizationPending", official_invoice_number: created.data.officialInvoiceNumber, correlation_id: created.correlationId, last_fiscal_attempt_at: new Date(), updated_by: ctx.user.id } });
    }
    if (finalInvoice?.status !== "Fiscalized") {
      const confirmation = company.data.environment === "Production" ? `FISCALIZE_PRODUCTION:${invoice.firma.pib}:${fiscalInvoiceId}` : `FISCALIZE_TEST:${fiscalInvoiceId}`;
      const submitted = await fiscalAdminApi.fiscalizeInvoice(fiscalInvoiceId!, confirmation, actor);
      if (!submitted.data.isSuccess || submitted.data.status !== "Fiscalized" || !submitted.data.jikr) throw new FiscalAdminApiError(submitted.data.faultCode ?? "FISCALIZATION_FAILED", submitted.data.faultMessage ?? "Račun nije fiskalizovan.", submitted.correlationId);
      finalInvoice = (await fiscalAdminApi.getInvoice(fiscalInvoiceId!, actor)).data;
    }
    if (finalInvoice.status !== "Fiscalized" || !finalInvoice.iic || !finalInvoice.jikr || !finalInvoice.qrCodeData) throw new FiscalAdminApiError("FISCAL_RESULT_INCOMPLETE", "Fiscal API nije vratio kompletan IKOF, JIKR i QR podatak.");
    const taxGroups = new Map<string, { code: string; name: string; percent: Prisma.Decimal; base: bigint; vat: bigint; total: bigint }>();
    for (const line of invoice.stavke) { const group = taxGroups.get(line.pdv_stopa_sifra) ?? { code: line.pdv_stopa_sifra, name: line.pdv_stopa_naziv, percent: line.pdv_stopa_procenat, base: BigInt(0), vat: BigInt(0), total: BigInt(0) }; group.base += decimalToScaled(line.osnovica, 2); group.vat += decimalToScaled(line.pdv_iznos, 2); group.total += decimalToScaled(line.ukupno_sa_pdv, 2); taxGroups.set(line.pdv_stopa_sifra, group); }
    await prisma.$transaction(async (tx) => {
      await tx.fiskalniIzlazniRacunPorez.deleteMany({ where: { fiskalni_izlazni_racun_id: id } });
      await tx.fiskalniIzlazniRacunPorez.createMany({ data: [...taxGroups.values()].map((group) => ({ fiskalni_izlazni_racun_id: id, vat_rate_code: group.code, vat_rate_name: group.name, vat_rate_percent: group.percent, tax_base: scaledToDecimal(group.base, 2), output_vat_amount: scaledToDecimal(group.vat, 2), total_with_vat: scaledToDecimal(group.total, 2), created_by: ctx.user.id })) });
      await tx.fiskalniIzlazniRacun.update({ where: { id }, data: { fiscal_status: "Fiscalized", official_invoice_number: finalInvoice.officialInvoiceNumber, broj_racuna: finalInvoice.officialInvoiceNumber ?? invoice.broj_racuna, iic: finalInvoice.iic, jikr: finalInvoice.jikr, qr_code_data: finalInvoice.qrCodeData, fiscalized_at: new Date(), last_fiscal_attempt_at: new Date(), fiscal_error_code: null, fiscal_error_message: null, updated_by: ctx.user.id } });
    });
    await auditLog({ korisnikId: ctx.user.id, agencijaId: ctx.user.agencija_id, firmaId, modul: inventoryModule, akcija: "fiscalize_outgoing_invoice", tipEntiteta: "FiskalniIzlazniRacun", entitetId: id, novaVrijednost: { fiscalInvoiceId, environment: company.data.environment, officialInvoiceNumber: finalInvoice.officialInvoiceNumber, iic: finalInvoice.iic, jikr: finalInvoice.jikr } });
  } catch (error) {
    const fiscalError = error instanceof FiscalAdminApiError ? error : new FiscalAdminApiError("FISCALIZATION_FAILED", "Fiscalizacija nije uspjela.");
    await prisma.fiskalniIzlazniRacun.updateMany({ where: { id, firma_id: firmaId }, data: { fiscal_status: "FiscalizationFailed", fiscal_error_code: fiscalError.code, fiscal_error_message: fiscalError.message, correlation_id: fiscalError.correlationId, last_fiscal_attempt_at: new Date(), updated_by: ctx.user.id } });
    detail(id, "fiskalizacija_greska");
  }
  return finalizeOutgoingInvoice(formData);
}

export async function finalizeOutgoingInvoice(formData: FormData) {
  const id = text(formData.get("faktura_id")); const firmaId = text(formData.get("firma_id")); const ctx = await context("update", firmaId);
  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.fiskalniIzlazniRacun.findFirst({ where: { id, agencija_id: ctx.user.agencija_id!, firma_id: firmaId, poslovna_godina_id: ctx.year.id, status: outgoingInvoiceStatuses.draft, is_deleted: false }, include: { stavke: true, magacin: true } });
    if (!invoice) return { ok: false as const, reason: "nije_nacrt" };
    if (invoice.fiskalizacija_rezim === outgoingInvoiceFiscalModes.summa && invoice.fiscal_status !== "Fiscalized") return { ok: false as const, reason: "fiskalizacija_obavezna" };
    if (!invoice.stavke.length) return { ok: false as const, reason: "stavke" };
    const goods = invoice.stavke.filter((line) => !line.usluga); if (goods.length && !invoice.magacin_id) return { ok: false as const, reason: "magacin_obavezan" };
    const period = await tx.pdvPeriod.findFirst({ where: { firma_id: firmaId, poslovna_godina_id: ctx.year.id, mjesec: invoice.datum_racuna.getUTCMonth() + 1 }, select: { status: true } });
    if (period?.status === "LOCKED") return { ok: false as const, reason: "pdv_period" };
    const [settings, journalType] = await Promise.all([
      tx.firmaPodrazumijevanoKonto.findMany({ where: { firma_id: firmaId, dokument_tip: outgoingInvoicePostingScope.documentType, podvrsta: outgoingInvoicePostingScope.subtype, pdv_stopa_sifra: outgoingInvoicePostingScope.vatRate } }),
      tx.vrstaNaloga.findFirst({ where: { sifra: standardJournalTypes[2][0], aktivan: true, OR: [{ sistemska: true }, { agencija_id: ctx.user.agencija_id }, { firma_id: firmaId }] }, select: { id: true, prefiks: true } })
    ]);
    if (!journalType) return { ok: false as const, reason: "vrsta_naloga" };
    let cogs = BigInt(0);
    for (const line of goods) {
      await tx.$queryRaw`SELECT "id" FROM "stanja_zaliha" WHERE "firma_id"=${firmaId}::uuid AND "poslovna_godina_id"=${ctx.year.id}::uuid AND "magacin_id"=${invoice.magacin_id}::uuid AND "artikal_id"=${line.artikal_id}::uuid FOR UPDATE`;
      const state = await tx.stanjeZaliha.findUnique({ where: { firma_id_poslovna_godina_id_magacin_id_artikal_id: { firma_id: firmaId, poslovna_godina_id: ctx.year.id, magacin_id: invoice.magacin_id!, artikal_id: line.artikal_id } } });
      const quantity = decimalToScaled(line.kolicina, 3); const available = decimalToScaled(state?.kolicina ?? 0, 3);
      const allowNegative = invoice.magacin?.dozvoli_negativan_lager ?? ctx.firma.dozvoli_negativan_lager;
      if (!allowNegative && available < quantity) return { ok: false as const, reason: `lager:${line.naziv_artikla}:${Number(available) / 1000}` };
      const unitCost = decimalToScaled(state?.prosjecna_nabavna_cijena ?? 0, 4);
      if (unitCost <= BigInt(0) && !line.usluga) return { ok: false as const, reason: `nabavna:${line.naziv_artikla}` };
      const lineCost = (quantity * unitCost + BigInt(50000)) / BigInt(100000); cogs += lineCost;
      const newQuantity = available - quantity; const oldValue = decimalToScaled(state?.nabavna_vrijednost ?? 0, 2); const newValue = oldValue - lineCost;
      const lineBase = decimalToScaled(line.osnovica, 2); const priceDifference = lineBase > lineCost ? lineBase - lineCost : BigInt(0);
      if (state) await tx.stanjeZaliha.update({ where: { id: state.id }, data: { kolicina: scaledToDecimal(newQuantity, 3), nabavna_vrijednost: scaledToDecimal(newValue, 2), maloprodajna_vrijednost: { decrement: line.ukupno_sa_pdv }, razlika_u_cijeni: { decrement: scaledToDecimal(priceDifference, 2) }, ukalkulisani_pdv: { decrement: line.pdv_iznos } } });
      else await tx.stanjeZaliha.create({ data: { agencija_id: ctx.user.agencija_id!, firma_id: firmaId, poslovna_godina_id: ctx.year.id, magacin_id: invoice.magacin_id!, artikal_id: line.artikal_id, kolicina: scaledToDecimal(newQuantity, 3), prosjecna_nabavna_cijena: scaledToDecimal(unitCost, 4), nabavna_vrijednost: scaledToDecimal(newValue, 2) } });
      await tx.stavkaIzlazneFakture.update({ where: { id: line.id }, data: { jedinicna_nabavna_cijena: scaledToDecimal(unitCost, 4), nabavna_vrijednost: scaledToDecimal(lineCost, 2), updated_by: ctx.user.id } });
      await tx.prometZaliha.create({ data: { agencija_id: ctx.user.agencija_id!, firma_id: firmaId, poslovna_godina_id: ctx.year.id, magacin_id: invoice.magacin_id!, artikal_id: line.artikal_id, tip_dokumenta: "OUTGOING_INVOICE", dokument_id: invoice.id, stavka_dokumenta_id: line.id, datum_prometa: invoice.datum_prometa, smjer: "OUT", kolicina: line.kolicina, jedinicna_nabavna_cijena: scaledToDecimal(unitCost, 4), nabavna_vrijednost: scaledToDecimal(lineCost, 2), prodajna_cijena_sa_pdv: line.jedinicna_cijena_sa_pdv, prodajna_vrijednost: line.ukupno_sa_pdv, prosjecna_cijena_nakon: scaledToDecimal(unitCost, 4), kolicina_nakon: scaledToDecimal(newQuantity, 3), created_by: ctx.user.id } });
    }
    const amounts = new Map<string, bigint>([["INVOICE_CUSTOMER", decimalToScaled(invoice.ukupno_sa_pdv, 2)], ["INVOICE_REVENUE", decimalToScaled(invoice.ukupno_osnovica, 2)], ["INVOICE_OUTPUT_VAT", decimalToScaled(invoice.ukupno_izlazni_pdv, 2)], ["INVOICE_COGS", cogs], ["INVOICE_INVENTORY", cogs]]);
    const settingMap = new Map(settings.map((setting) => [setting.namjena, setting])); const lines = [];
    for (const field of outgoingInvoicePostingFields) { const amount = amounts.get(field.purpose) ?? BigInt(0); if (!amount) continue; const setting = settingMap.get(field.purpose); if (!setting?.sifra_konta) return { ok: false as const, reason: "podesavanja" }; lines.push({ amount, direction: setting.smjer === "P" ? "P" as const : "D" as const, code: setting.sifra_konta }); }
    const debit = lines.filter((line) => line.direction === "D").reduce((sum, line) => sum + line.amount, BigInt(0)); const credit = lines.filter((line) => line.direction === "P").reduce((sum, line) => sum + line.amount, BigInt(0)); if (debit !== credit) return { ok: false as const, reason: "balans" };
    const lastJournal = await tx.nalog.findFirst({ where: { firma_id: firmaId, poslovna_godina_id: ctx.year.id, vrsta_naloga_id: journalType.id }, orderBy: { broj: "desc" }, select: { broj: true } }); const number = (lastJournal?.broj ?? 0) + 1;
    const journal = await tx.nalog.create({ data: { agencija_id: ctx.user.agencija_id!, firma_id: firmaId, poslovna_godina_id: ctx.year.id, vrsta_naloga_id: journalType.id, broj: number, sifra: formatJournalCode(journalType.prefiks, ctx.year.godina, number), datum: invoice.datum_racuna, opis: `Izlazna faktura ${invoice.interni_broj}`, status: journalStatuses.draft, source_type: "OUTGOING_INVOICE", source_module: "agencija.robno.izlazne-fakture", izvorni_dokument_id: invoice.id, kreirao_korisnik_id: ctx.user.id, created_by: ctx.user.id, updated_by: ctx.user.id } });
    let order = 1; for (const line of lines) { const account = await resolveAccount(tx, firmaId, line.code); if (!account) return { ok: false as const, reason: "konto" }; await tx.stavkaNaloga.create({ data: { nalog_id: journal.id, konto_id: account.id, komitent_id: account.analitika_obavezna ? invoice.kupac_id : null, duguje: line.direction === "D" ? scaledToDecimal(line.amount, 2) : "0.00", potrazuje: line.direction === "P" ? scaledToDecimal(line.amount, 2) : "0.00", opis: `Faktura ${invoice.interni_broj}`, broj_dokumenta: invoice.broj_racuna, datum_dokumenta: invoice.datum_racuna, datum_valute: invoice.datum_valute, redni_broj: order++, created_by: ctx.user.id, updated_by: ctx.user.id } }); }
    const taxGroups = new Map<string, { code: string; name: string; percent: Prisma.Decimal; base: bigint; vat: bigint; total: bigint }>();
    for (const line of invoice.stavke) { const group = taxGroups.get(line.pdv_stopa_sifra) ?? { code: line.pdv_stopa_sifra, name: line.pdv_stopa_naziv, percent: line.pdv_stopa_procenat, base: BigInt(0), vat: BigInt(0), total: BigInt(0) }; group.base += decimalToScaled(line.osnovica, 2); group.vat += decimalToScaled(line.pdv_iznos, 2); group.total += decimalToScaled(line.ukupno_sa_pdv, 2); taxGroups.set(line.pdv_stopa_sifra, group); }
    await tx.fiskalniIzlazniRacunPorez.deleteMany({ where: { fiskalni_izlazni_racun_id: invoice.id } }); await tx.fiskalniIzlazniRacunPorez.createMany({ data: [...taxGroups.values()].map((group) => ({ fiskalni_izlazni_racun_id: invoice.id, vat_rate_code: group.code, vat_rate_name: group.name, vat_rate_percent: group.percent, tax_base: scaledToDecimal(group.base, 2), output_vat_amount: scaledToDecimal(group.vat, 2), total_with_vat: scaledToDecimal(group.total, 2), created_by: ctx.user.id })) });
    await tx.fiskalniIzlazniRacun.update({ where: { id: invoice.id }, data: { status: outgoingInvoiceStatuses.waitingKif, kif_status: "WAITING_KIF", nalog_id: journal.id, posted_at: new Date(), posted_by: ctx.user.id, updated_by: ctx.user.id } });
    return { ok: true as const, journal: journal.sifra };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (!result.ok) detail(id, result.reason); await auditLog({ korisnikId: ctx.user.id, agencijaId: ctx.user.agencija_id, firmaId, modul: inventoryModule, akcija: "finalize_outgoing_invoice", tipEntiteta: "FiskalniIzlazniRacun", entitetId: id, novaVrijednost: result }); revalidatePath(`/agencija/robno/izlazne-fakture/${id}`); detail(id, `zavrsena:${result.journal}`);
}
