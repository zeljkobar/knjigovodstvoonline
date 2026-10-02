import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { fiscalAdminApi, FiscalAdminApiError, type FiscalInvoice } from "./fiscal-admin-api";
import { auditLogInTransaction } from "./audit";
import { decimalToScaled, roundDivision, scaledToDecimal } from "./inventory-calculation";
import { formatJournalCode } from "./journals";

export type OfficeStornoContext = {
  agencijaId: string; firmaId: string; yearId: string; userId: string; userName: string;
};
export class OfficeStornoError extends Error {
  constructor(readonly code: string) { super(code); }
}
function fail(code: string): never { throw new OfficeStornoError(code); }
const scope = (ctx: OfficeStornoContext) => ({ agencija_id: ctx.agencijaId, firma_id: ctx.firmaId });
const lock = (tx: Prisma.TransactionClient, id: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outgoing-invoice:${id}`}))`;
function localDay(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Podgorica", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (key: string) => parts.find((p) => p.type === key)!.value;
  return new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
}
async function openPeriod(tx: Prisma.TransactionClient, ctx: OfficeStornoContext, date: Date) {
  const year = await tx.poslovnaGodina.findFirst({ where: { id: ctx.yearId, firma_id: ctx.firmaId, firma: { agencija_id: ctx.agencijaId, is_deleted: false } } });
  if (!year || year.zakljucena || date < year.datum_od || date > year.datum_do) fail("storno_godina");
  const period = await tx.pdvPeriod.findFirst({ where: { firma_id: ctx.firmaId, poslovna_godina_id: ctx.yearId, mjesec: date.getUTCMonth() + 1 } });
  if (period?.status === "LOCKED") fail("storno_period");
  return year;
}
function audit(tx: Prisma.TransactionClient, ctx: OfficeStornoContext, id: string, action: string, data: Record<string, unknown>) {
  return auditLogInTransaction(tx, { korisnikId: ctx.userId, agencijaId: ctx.agencijaId, firmaId: ctx.firmaId, modul: "robno", akcija: action, tipEntiteta: "FiskalniIzlazniRacun", entitetId: id, novaVrijednost: data });
}

async function prepare(ctx: OfficeStornoContext, originalId: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    await lock(tx, originalId);
    const original = await tx.fiskalniIzlazniRacun.findFirst({ where: { id: originalId, ...scope(ctx), sales_channel: "OFFICE", document_type: "INVOICE", original_invoice_id: null, is_deleted: false }, include: { stavke: { orderBy: { redni_broj: "asc" } }, placanja: true, corrective_invoices: true } });
    if (!original || original.fiscal_status !== "Fiscalized" || !original.iic || !original.jikr || !original.fiscal_api_invoice_id || !["Test", "Production"].includes(original.fiscal_environment ?? "") || !original.stavke.length) return fail("storno_original");
    let correction = original.corrective_invoices[0];
    if (original.corrective_invoices.length > 1 || (correction && (correction.is_deleted || correction.document_type !== "OFFICE_STORNO" || correction.poslovna_godina_id !== ctx.yearId))) fail("storno_postoji");
    // A confirmed correction can finish bookkeeping without another fiscal request.
    if (correction?.fiscal_status === "Fiscalized") return { original, correction, attemptKey: null, busy: false };
    const now = new Date();
    const day = correction?.datum_racuna ?? localDay(now);
    const year = correction ? null : await openPeriod(tx, ctx, day);
    if (correction?.fiscal_status === "FiscalizationPending" && correction.last_fiscal_attempt_at && now.getTime() - correction.last_fiscal_attempt_at.getTime() < 120000) return { original, correction, attemptKey: null, busy: true };
    if (!correction) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.firmaId}:${ctx.yearId}:sales`}))`;
      const last = await tx.fiskalniIzlazniRacun.findFirst({ where: { firma_id: ctx.firmaId, poslovna_godina_id: ctx.yearId }, orderBy: { broj: "desc" }, select: { broj: true } });
      const number = (last?.broj ?? 0) + 1;
      const internal = `IF-ST-${year!.godina}-${String(number).padStart(4, "0")}`;
      correction = await tx.fiskalniIzlazniRacun.create({ data: {
        ...scope(ctx), poslovna_godina_id: ctx.yearId, kupac_id: original.kupac_id, magacin_id: original.magacin_id, poslovna_jedinica_id: original.poslovna_jedinica_id,
        original_invoice_id: original.id, correction_reason: reason, broj: number, interni_broj: internal, broj_racuna: internal,
        datum_racuna: day, datum_prometa: day, datum_valute: day, issued_at: now, vrsta_racuna: "CORRECTIVE", document_type: "OFFICE_STORNO", sales_channel: "OFFICE",
        status: "DRAFT", nacin_placanja: original.nacin_placanja, fiskalizacija_rezim: "SUMMA", vat_transaction_type: original.vat_transaction_type, valuta: original.valuta, kurs: original.kurs,
        ukupno_osnovica: original.ukupno_osnovica.negated(), ukupno_rabat: original.ukupno_rabat.negated(), ukupno_izlazni_pdv: original.ukupno_izlazni_pdv.negated(), ukupno_sa_pdv: original.ukupno_sa_pdv.negated(),
        issuer_snapshot: original.issuer_snapshot ?? Prisma.JsonNull, buyer_snapshot: original.buyer_snapshot ?? Prisma.JsonNull,
        idempotency_key: `office-storno:${original.id}`, fiscal_status: "DRAFT", fiscal_environment: original.fiscal_environment, kif_status: "ACCOUNTING_PENDING",
        napomena: `Potpuni storno ${original.broj_racuna}: ${reason}`, created_by: ctx.userId, updated_by: ctx.userId
      } });
      await tx.stavkaIzlazneFakture.createMany({ data: original.stavke.map((line) => ({
        izlazna_faktura_id: correction.id, redni_broj: line.redni_broj, artikal_id: line.artikal_id, sifra_artikla: line.sifra_artikla, naziv_artikla: line.naziv_artikla, jedinica_mjere: line.jedinica_mjere,
        usluga: line.usluga, kolicina: line.kolicina.negated(), jedinicna_cijena_bez_pdv: line.jedinicna_cijena_bez_pdv, jedinicna_cijena_sa_pdv: line.jedinicna_cijena_sa_pdv,
        rabat_procenat: line.rabat_procenat, rabat_iznos: line.rabat_iznos.negated(), osnovica: line.osnovica.negated(), pdv_iznos: line.pdv_iznos.negated(), ukupno_sa_pdv: line.ukupno_sa_pdv.negated(),
        pdv_stopa_id: line.pdv_stopa_id, pdv_stopa_sifra: line.pdv_stopa_sifra, pdv_stopa_naziv: line.pdv_stopa_naziv, pdv_stopa_procenat: line.pdv_stopa_procenat,
        jedinicna_nabavna_cijena: line.jedinicna_nabavna_cijena, nabavna_vrijednost: line.nabavna_vrijednost?.negated(), created_by: ctx.userId, updated_by: ctx.userId
      })) });
      if (original.placanja.length) await tx.salesDocumentPayment.createMany({ data: original.placanja.map((payment) => ({ fiskalni_izlazni_racun_id: correction.id, redni_broj: payment.redni_broj, payment_method: payment.payment_method, amount: payment.amount.negated(), reference: internal, created_by: ctx.userId })) });
      const taxes = new Map<string, { name: string; percent: Prisma.Decimal; base: bigint; vat: bigint; total: bigint }>();
      for (const line of original.stavke) {
        const tax = taxes.get(line.pdv_stopa_sifra) ?? { name: line.pdv_stopa_naziv, percent: line.pdv_stopa_procenat, base: BigInt(0), vat: BigInt(0), total: BigInt(0) };
        tax.base -= decimalToScaled(line.osnovica, 2); tax.vat -= decimalToScaled(line.pdv_iznos, 2); tax.total -= decimalToScaled(line.ukupno_sa_pdv, 2); taxes.set(line.pdv_stopa_sifra, tax);
      }
      await tx.fiskalniIzlazniRacunPorez.createMany({ data: [...taxes].map(([code, tax]) => ({ fiskalni_izlazni_racun_id: correction.id, vat_rate_code: code, vat_rate_name: tax.name, vat_rate_percent: tax.percent, tax_base: scaledToDecimal(tax.base, 2), output_vat_amount: scaledToDecimal(tax.vat, 2), total_with_vat: scaledToDecimal(tax.total, 2), created_by: ctx.userId })) });
      await audit(tx, ctx, correction.id, "office_storno_created", { original_invoice_id: original.id, reason });
    }
    const attemptNumber = await tx.fiscalizationAttempt.count({ where: { fiskalni_izlazni_racun_id: correction.id } }) + 1;
    const attemptKey = `${correction.idempotency_key}:attempt:${attemptNumber}`;
    await tx.fiscalizationAttempt.create({ data: { fiskalni_izlazni_racun_id: correction.id, attempt_number: attemptNumber, idempotency_key: attemptKey, status: "PENDING", created_by: ctx.userId } });
    correction = await tx.fiskalniIzlazniRacun.update({ where: { id: correction.id }, data: { fiscal_status: "FiscalizationPending", last_fiscal_attempt_at: now, updated_by: ctx.userId } });
    return { original, correction, attemptKey, busy: false };
  });
}

// No current prices or posting schemes: reverse the original journal and actual stock outflow.
export async function finishOfficeStornoAccounting(ctx: OfficeStornoContext, correctionId: string) {
  return prisma.$transaction(async (tx) => {
    const source = await tx.fiskalniIzlazniRacun.findFirst({ where: { id: correctionId, ...scope(ctx), poslovna_godina_id: ctx.yearId, document_type: "OFFICE_STORNO", is_deleted: false } });
    if (!source?.original_invoice_id) return fail("storno_original");
    await lock(tx, source.original_invoice_id);
    const correction = await tx.fiskalniIzlazniRacun.findUniqueOrThrow({ where: { id: source.id }, include: { stavke: true } });
    if (correction.fiscal_status !== "Fiscalized") return fail("storno_nepotvrdjen");
    if (correction.nalog_id) return;
    const year = await openPeriod(tx, ctx, correction.datum_racuna);
    const original = await tx.fiskalniIzlazniRacun.findFirst({ where: { id: source.original_invoice_id, ...scope(ctx), is_deleted: false } });
    if (!original?.nalog_id) return fail("storno_original_knjizenje");
    const journal = await tx.nalog.findFirst({ where: { id: original.nalog_id, ...scope(ctx), is_deleted: false, status: { in: ["DRAFT", "POSTED"] } }, include: { stavke: { orderBy: { redni_broj: "asc" }, include: { firma_konto: true } }, vrsta_naloga: true } });
    if (!journal?.stavke.length || journal.izvorni_dokument_id !== original.id) return fail("storno_original_knjizenje");
    const balance = journal.stavke.reduce((sum, line) => sum + decimalToScaled(line.duguje, 2) - decimalToScaled(line.potrazuje, 2), BigInt(0));
    if (balance !== BigInt(0) || journal.stavke.some((line) => line.firma_konto.firma_id !== ctx.firmaId || (line.firma_konto.analitika_obavezna && !line.komitent_id))) fail("storno_nalog");
    const movements = await tx.prometZaliha.findMany({ where: { ...scope(ctx), dokument_id: original.id, tip_dokumenta: "OUTGOING_INVOICE", smjer: "OUT" } });
    for (const line of correction.stavke.filter((line) => !line.usluga)) {
      const originalLine = await tx.stavkaIzlazneFakture.findFirst({ where: { izlazna_faktura_id: original.id, redni_broj: line.redni_broj } });
      const movement = movements.find((item) => item.stavka_dokumenta_id === originalLine?.id);
      if (!movement || !original.magacin_id || decimalToScaled(movement.kolicina, 3) !== -decimalToScaled(line.kolicina, 3)) fail("storno_lager");
      const warehouseId = original.magacin_id!;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.firmaId}:${ctx.yearId}:${warehouseId}:${line.artikal_id}`}))`;
      await tx.$queryRaw`SELECT id FROM stanja_zaliha WHERE firma_id=${ctx.firmaId}::uuid AND poslovna_godina_id=${ctx.yearId}::uuid AND magacin_id=${warehouseId}::uuid AND artikal_id=${line.artikal_id}::uuid FOR UPDATE`;
      const key = { firma_id: ctx.firmaId, poslovna_godina_id: ctx.yearId, magacin_id: warehouseId, artikal_id: line.artikal_id };
      const state = await tx.stanjeZaliha.findUnique({ where: { firma_id_poslovna_godina_id_magacin_id_artikal_id: key } });
      const quantity = decimalToScaled(movement!.kolicina, 3), cost = decimalToScaled(movement!.nabavna_vrijednost, 2);
      const newQuantity = decimalToScaled(state?.kolicina ?? 0, 3) + quantity;
      const newValue = decimalToScaled(state?.nabavna_vrijednost ?? 0, 2) + cost;
      const average = newQuantity > BigInt(0) ? roundDivision(newValue * BigInt(100000), newQuantity) : decimalToScaled(state?.prosjecna_nabavna_cijena ?? movement!.jedinicna_nabavna_cijena, 4);
      const base = -decimalToScaled(line.osnovica, 2), difference = base > cost ? base - cost : BigInt(0);
      await tx.stanjeZaliha.upsert({ where: { firma_id_poslovna_godina_id_magacin_id_artikal_id: key }, create: { ...key, agencija_id: ctx.agencijaId, kolicina: scaledToDecimal(newQuantity, 3), nabavna_vrijednost: scaledToDecimal(newValue, 2), prosjecna_nabavna_cijena: scaledToDecimal(average, 4), maloprodajna_vrijednost: line.ukupno_sa_pdv.negated(), razlika_u_cijeni: scaledToDecimal(difference, 2), ukalkulisani_pdv: line.pdv_iznos.negated() }, update: { kolicina: scaledToDecimal(newQuantity, 3), nabavna_vrijednost: scaledToDecimal(newValue, 2), prosjecna_nabavna_cijena: scaledToDecimal(average, 4), maloprodajna_vrijednost: { decrement: line.ukupno_sa_pdv }, razlika_u_cijeni: { increment: scaledToDecimal(difference, 2) }, ukalkulisani_pdv: { decrement: line.pdv_iznos } } });
      await tx.prometZaliha.create({ data: { ...scope(ctx), ...key, dokument_id: correction.id, stavka_dokumenta_id: line.id, tip_dokumenta: "OUTGOING_INVOICE_STORNO", datum_prometa: correction.datum_prometa, smjer: "IN", kolicina: movement!.kolicina, jedinicna_nabavna_cijena: movement!.jedinicna_nabavna_cijena, nabavna_vrijednost: movement!.nabavna_vrijednost, prodajna_cijena_sa_pdv: line.jedinicna_cijena_sa_pdv, prodajna_vrijednost: line.ukupno_sa_pdv.negated(), razlika_u_cijeni: scaledToDecimal(difference, 2), ukalkulisani_pdv: line.pdv_iznos.negated(), prosjecna_cijena_nakon: scaledToDecimal(average, 4), kolicina_nakon: scaledToDecimal(newQuantity, 3), created_by: ctx.userId } });
      await tx.stavkaIzlazneFakture.update({ where: { id: line.id }, data: { jedinicna_nabavna_cijena: movement!.jedinicna_nabavna_cijena, nabavna_vrijednost: movement!.nabavna_vrijednost.negated() } });
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.firmaId}:${ctx.yearId}:${journal.vrsta_naloga_id}:journal-number`}))`;
    const last = await tx.nalog.findFirst({ where: { firma_id: ctx.firmaId, poslovna_godina_id: ctx.yearId, vrsta_naloga_id: journal.vrsta_naloga_id }, orderBy: { broj: "desc" }, select: { broj: true } });
    const number = (last?.broj ?? 0) + 1;
    const reversal = await tx.nalog.create({ data: { ...scope(ctx), poslovna_godina_id: ctx.yearId, poslovna_jedinica_id: original.poslovna_jedinica_id, vrsta_naloga_id: journal.vrsta_naloga_id, broj: number, sifra: formatJournalCode(journal.vrsta_naloga.prefiks, year.godina, number), datum: correction.datum_racuna, opis: `Storno ${original.broj_racuna}`, status: "DRAFT", source_type: "OUTGOING_INVOICE", source_module: "agencija.robno.izlazne-fakture", izvorni_dokument_id: correction.id, kreirao_korisnik_id: ctx.userId, created_by: ctx.userId, updated_by: ctx.userId, stavke: { create: journal.stavke.map((line) => ({ konto_id: line.konto_id, komitent_id: line.komitent_id, poslovna_jedinica_id: line.poslovna_jedinica_id, duguje: line.duguje.negated(), potrazuje: line.potrazuje.negated(), opis: `Storno ${original.broj_racuna}`, broj_dokumenta: correction.broj_racuna, datum_dokumenta: correction.datum_racuna, redni_broj: line.redni_broj, created_by: ctx.userId, updated_by: ctx.userId })) } } });
    await tx.fiskalniIzlazniRacun.update({ where: { id: correction.id }, data: { nalog_id: reversal.id, status: "WAITING_KIF", kif_status: "WAITING_KIF", posted_at: new Date(), posted_by: ctx.userId, updated_by: ctx.userId, fiscal_error_code: null, fiscal_error_message: null } });
    await audit(tx, ctx, correction.id, "office_storno_accounting_completed", { original_invoice_id: original.id, nalog_id: reversal.id });
  });
}

function validateRemote(remote: FiscalInvoice, companyId: string, total: Prisma.Decimal) {
  if (remote.companyId !== companyId || decimalToScaled(remote.totalGrossAmount, 2) !== decimalToScaled(total, 2)) fail("storno_remote_podaci");
}
export async function createAndFiscalizeOfficeStorno(input: { context: OfficeStornoContext; originalId: string; reason: string; confirmed: boolean }) {
  const ctx = input.context;
  if (!input.confirmed || input.reason.trim().length < 3 || input.reason.trim().length > 500) return fail("storno_potvrda");
  const prepared = await prepare(ctx, input.originalId, input.reason.trim());
  const { correction, original, attemptKey } = prepared;
  if (prepared.busy) return { id: correction.id, state: "pending" as const, issue: null };
  if (correction.fiscal_status !== "Fiscalized") {
    try {
      const link = await prisma.fiscalCompanyLink.findUnique({ where: { firma_id: ctx.firmaId } });
      if (!link?.fiscal_api_company_id || link.is_suspended) fail("storno_podesavanja");
      const actor = { id: ctx.userId, name: ctx.userName };
      const company = (await fiscalAdminApi.getCompany(link.fiscal_api_company_id!, actor)).data;
      const firm = await prisma.firma.findFirst({ where: { id: ctx.firmaId, agencija_id: ctx.agencijaId }, select: { pib: true } });
      if (!firm?.pib || company.tin !== firm.pib || company.environment !== correction.fiscal_environment) fail("storno_okruzenje");
      const remoteOriginal = (await fiscalAdminApi.getInvoice(original.fiscal_api_invoice_id!, actor)).data;
      validateRemote(remoteOriginal, link.fiscal_api_company_id!, original.ukupno_sa_pdv);
      if (!["Fiscalized", "StornoCreated"].includes(remoteOriginal.status)) fail("storno_original");
      if (remoteOriginal.iic !== original.iic || remoteOriginal.jikr !== original.jikr) fail("storno_remote_podaci");
      // Same payload and idempotency key recover a create whose response was lost.
      let remote = correction.fiscal_api_invoice_id
        ? (await fiscalAdminApi.getInvoice(correction.fiscal_api_invoice_id, actor)).data
        : (await fiscalAdminApi.createInvoiceStorno(original.fiscal_api_invoice_id!, { invoiceNumber: "", issueDateTime: correction.issued_at!.toISOString(), reason: correction.correction_reason, confirmation: `CREATE_STORNO:${original.fiscal_api_invoice_id}` }, correction.idempotency_key!, actor)).data;
      validateRemote(remote, link.fiscal_api_company_id!, correction.ukupno_sa_pdv);
      if (typeof remote.originalInvoiceId === "string" && remote.originalInvoiceId !== original.fiscal_api_invoice_id) fail("storno_remote_podaci");
      await prisma.fiskalniIzlazniRacun.update({ where: { id: correction.id }, data: { fiscal_api_invoice_id: remote.id } });
      await prisma.fiscalizationAttempt.update({ where: { idempotency_key: attemptKey! }, data: { fiscal_api_invoice_id: remote.id } });
      if (remote.status !== "Fiscalized") {
        if (remote.status === "FiscalizationPending") fail("storno_u_toku");
        if (!["Draft", "ReadyForFiscalization"].includes(remote.status)) fail("storno_servis_provjera");
        if (correction.datum_racuna.getTime() !== localDay(new Date()).getTime()) fail("storno_stari_zahtjev");
        await prisma.$transaction((tx) => openPeriod(tx, ctx, correction.datum_racuna));
        const confirmation = company.environment === "Production" ? `FISCALIZE_PRODUCTION:${firm!.pib}:${remote.id}` : `FISCALIZE_TEST:${remote.id}`;
        const submitted = await fiscalAdminApi.fiscalizeInvoice(remote.id, confirmation, actor);
        // Always read authoritative status after submit; no duplicate invoice is made.
        remote = (await fiscalAdminApi.getInvoice(remote.id, actor)).data;
        if (!submitted.data.isSuccess && remote.status !== "Fiscalized") throw new FiscalAdminApiError(submitted.data.faultCode ?? "FISCALIZATION_FAILED", submitted.data.faultMessage ?? "Fiskalni servis nije potvrdio storno.");
      }
      validateRemote(remote, link.fiscal_api_company_id!, correction.ukupno_sa_pdv);
      if (remote.status !== "Fiscalized" || !remote.iic || !remote.jikr || !remote.qrCodeData) fail("storno_nepotvrdjen");
      await prisma.$transaction(async (tx) => {
        await lock(tx, original.id);
        await tx.fiskalniIzlazniRacun.update({ where: { id: correction.id }, data: { fiscal_status: "Fiscalized", fiscal_api_invoice_id: remote.id, official_invoice_number: remote.officialInvoiceNumber, broj_racuna: remote.officialInvoiceNumber ?? remote.invoiceNumber, iic: remote.iic, jikr: remote.jikr, qr_code_data: remote.qrCodeData, fiscalized_at: new Date(), fiscal_error_code: null, fiscal_error_message: null, updated_by: ctx.userId } });
        await tx.fiscalizationAttempt.update({ where: { idempotency_key: attemptKey! }, data: { status: "SUCCEEDED", finished_at: new Date(), fiscal_api_invoice_id: remote.id } });
        // Preserve original KIF/accounting status; the confirmed correction marks it as reversed in the UI.
        await audit(tx, ctx, correction.id, "office_storno_fiscalized", { original_invoice_id: original.id, fiscal_api_invoice_id: remote.id, environment: correction.fiscal_environment });
      });
    } catch (error) {
      const code = error instanceof OfficeStornoError ? error.code : error instanceof FiscalAdminApiError ? error.code : "storno_provjera";
      await prisma.$transaction(async (tx) => {
        await lock(tx, original.id);
        // A late failing worker must never overwrite another worker's confirmed result.
        await tx.fiskalniIzlazniRacun.updateMany({ where: { id: correction.id, fiscal_status: { not: "Fiscalized" }, last_fiscal_attempt_at: correction.last_fiscal_attempt_at }, data: { fiscal_status: "FiscalizationFailed", fiscal_error_code: code, fiscal_error_message: error instanceof FiscalAdminApiError ? error.message : "Ishod storna nije potvrđen. Nastavite provjeru istog dokumenta.", updated_by: ctx.userId } });
        await tx.fiscalizationAttempt.updateMany({ where: { idempotency_key: attemptKey!, status: "PENDING" }, data: { status: "FAILED", error_code: code, finished_at: new Date() } });
        await audit(tx, ctx, correction.id, "office_storno_check_required", { code });
      });
      return { id: correction.id, state: "pending" as const, issue: code };
    }
  }
  try {
    await finishOfficeStornoAccounting(ctx, correction.id);
    return { id: correction.id, state: "complete" as const, issue: null };
  } catch (error) {
    const issue = error instanceof OfficeStornoError ? error.code : "storno_knjizenje";
    return { id: correction.id, state: "accounting" as const, issue };
  }
}
