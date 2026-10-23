import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { auditLogInTransaction } from "./audit";
import { AdvanceWorkflowError, settlementState, type AdvanceAccountingSnapshot } from "./advance-invoice";
import { advanceInvoicePostingScope, buildAdvancePostingLines } from "./advance-invoice-posting";
import { decimalToScaled } from "./inventory-calculation";
import { scaledToDecimal } from "./inventory-calculation";
import { effectiveDefaultAccounts, templateAccount } from "./posting-template";
import { formatJournalCode, standardJournalTypes } from "./journals";
import type { InvoicePostingRule } from "./outgoing-invoice";
import type { OutgoingInvoiceServiceContext } from "./outgoing-invoice-service";
const scope = (c: OutgoingInvoiceServiceContext) => ({ agencija_id: c.agencijaId, firma_id: c.firmaId, is_deleted: false });
function fail(message: string): never { throw new AdvanceWorkflowError(message); }
const lock = (tx: Prisma.TransactionClient, id: string) => tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext(${`outgoing-invoice:${id}`}))`;
const audit = (tx: Prisma.TransactionClient, c: OutgoingInvoiceServiceContext, id: string, action: string, value: unknown) => auditLogInTransaction(tx, { korisnikId: c.userId, agencijaId: c.agencijaId, firmaId: c.firmaId, modul: "robno", akcija: action, tipEntiteta: "FiskalniIzlazniRacun", entitetId: id, novaVrijednost: value });
export function advanceAccountingDate(instant: string) {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime()))
    return fail("Nedostaje ispravan fiskalni datum umanjenja.");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Podgorica", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (key: string) => parts.find(p => p.type === key)!.value;
  return new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
}
async function guard(tx: Prisma.TransactionClient, c: OutgoingInvoiceServiceContext, date: Date) {
  await tx.$queryRaw `SELECT id FROM korisnici WHERE id=${c.userId}::uuid FOR UPDATE`;
  await tx.$queryRaw `SELECT id FROM firme WHERE id=${c.firmaId}::uuid FOR UPDATE`;
  await tx.$queryRaw `SELECT id FROM poslovne_godine WHERE id=${c.poslovnaGodinaId}::uuid FOR UPDATE`;
  const user = await tx.korisnik.findFirst({ where: { id: c.userId, agencija_id: c.agencijaId, aktivan: true, is_deleted: false, rola: { in: ["admin_agencije", "korisnik_agencije"] }, agencija: { aktivan: true, is_deleted: false } } });
  const firm = await tx.firma.findFirst({ where: { id: c.firmaId, agencija_id: c.agencijaId, aktivan: true, is_deleted: false } });
  const year = await tx.poslovnaGodina.findFirst({ where: { id: c.poslovnaGodinaId, firma_id: c.firmaId } });
  if (!user || !firm || !year)
    fail("Nemate pristup knjiženju avansa ove firme.");
  if (year.zakljucena || date < year.datum_od || date > year.datum_do)
    fail("Godina je zaključana ili datum nije u aktivnoj godini.");
  if (user.rola !== "admin_agencije") {
    if (!await tx.korisnikFirma.findFirst({ where: { korisnik_id: user.id, firma_id: firm.id, is_deleted: false } }))
      fail("Nemate pristup firmi.");
    for (const [modul, akcija] of [["robno", "post"], ["nalozi", "create"]])
      if (!await tx.korisnikPravo.findFirst({ where: { agencija_id: c.agencijaId, korisnik_id: c.userId, firma_id: c.firmaId, modul, akcija, dozvoljeno: true } }))
        fail("Za knjiženje avansa potrebna su prava Robno/knjiženje i Nalozi/kreiranje.");
  }
  const periods = await tx.$queryRaw<Array<{
    status: string;
  }>> `SELECT status FROM pdv_periodi WHERE firma_id=${c.firmaId}::uuid AND datum_od<=${date}::date AND datum_do>=${date}::date FOR UPDATE`;
  if (periods.some(p => p.status === "LOCKED"))
    fail("PDV period dokumenta je zaključan.");
  return year;
}
export async function finishAdvanceAccounting(c: OutgoingInvoiceServiceContext, id: string) {
  return prisma.$transaction(async (tx) => {
    const source = await tx.fiskalniIzlazniRacun.findFirst({ where: { id, ...scope(c), poslovna_godina_id: c.poslovnaGodinaId, vrsta_racuna: "ADVANCE", sales_channel: "OFFICE", document_type: { in: ["INVOICE", "ADVANCE_SETTLEMENT"] } } });
    if (!source)
      fail("Avansni dokument nije dostupan.");
    const year = await guard(tx, c, source.datum_racuna);
    await lock(tx, id);
    const invoice = await tx.fiskalniIzlazniRacun.findFirstOrThrow({ where: { id, ...scope(c) }, include: { poreske_stavke: true } });
    if (invoice.fiscal_status !== "Fiscalized" || !invoice.fiscal_api_invoice_id || !invoice.iic || !invoice.jikr)
      fail("Prvo je potrebna uspješna fiskalizacija avansnog dokumenta.");
    if (invoice.nalog_id) {
      const journal = await tx.nalog.findFirst({ where: { id: invoice.nalog_id, ...scope(c), izvorni_dokument_id: id, status: { in: ["DRAFT", "POSTED"] } } });
      if (!journal)
        fail("Povezani nalog nije dostupan za nastavak.");
      return { id: invoice.id, journalId: journal.id, journalCode: journal.sifra, existing: true };
    }
    if (!invoice.poreske_stavke.length)
      fail("Nedostaje potvrđena poreska razrada avansa.");
    let rules: InvoicePostingRule[];
    if (invoice.document_type === "ADVANCE_SETTLEMENT") {
      const original = await tx.fiskalniIzlazniRacun.findFirst({ where: { id: invoice.original_invoice_id ?? "", ...scope(c), vrsta_racuna: "ADVANCE", document_type: "INVOICE" } });
      const snapshot = original?.avans_kontiranje_snapshot as {
        rules?: InvoicePostingRule[];
      } | null;
      if (!original?.nalog_id || !snapshot?.rules)
        fail("Prvo završite knjiženje izvornog avansa.");
      const journal = await tx.nalog.findFirst({ where: { id: original.nalog_id, ...scope(c), izvorni_dokument_id: original.id, status: { in: ["DRAFT", "POSTED"] } } });
      if (!journal)
        fail("Nalog izvornog avansa nije dostupan.");
      rules = snapshot.rules;
    }
    else
      rules = await effectiveDefaultAccounts(tx, { where: { firma_id: c.firmaId, dokument_tip: advanceInvoicePostingScope.documentType, podvrsta: advanceInvoicePostingScope.subtype } });
    const taxes = invoice.poreske_stavke.map(t => ({ code: t.vat_rate_code, base: t.tax_base.toString(), vat: t.output_vat_amount.toString() }));
    const sum = (key: "tax_base" | "output_vat_amount" | "total_with_vat") => invoice.poreske_stavke.reduce((s, t) => s + decimalToScaled(t[key], 2), BigInt(0));
    if (sum("tax_base") !== decimalToScaled(invoice.ukupno_osnovica, 2) || sum("output_vat_amount") !== decimalToScaled(invoice.ukupno_izlazni_pdv, 2) || sum("total_with_vat") !== decimalToScaled(invoice.ukupno_sa_pdv, 2))
      fail("Razrada avansa ne odgovara ukupnim iznosima.");
    const lines = buildAdvancePostingLines(rules, taxes, invoice.ukupno_sa_pdv.toString());
    if (!lines)
      fail("Dopunite šemu avansnih računa: kupac, primljeni avansi i izlazni PDV; duguje i potražuje moraju biti jednaki.");
    const accounts: Array<NonNullable<Awaited<ReturnType<typeof templateAccount>>>> = [];
    for (const line of lines) {
      const account = await templateAccount(tx, c.firmaId, line.code, true);
      if (!account?.aktivan || account.override_type === "DEACTIVATED" || account.tip_konta !== "analiticko" || account.sifra.length < 4)
        fail("Konto iz šeme avansa nije dostupno analitičko konto.");
      accounts.push(account);
    }
    const type = await tx.vrstaNaloga.findFirst({ where: { sifra: standardJournalTypes[2][0], aktivan: true, OR: [{ agencija_id: null, firma_id: null, sistemska: true }, { agencija_id: c.agencijaId, firma_id: null }, { agencija_id: c.agencijaId, firma_id: c.firmaId }] } });
    if (!type)
      fail("Nedostaje dostupna vrsta naloga Izlazni računi.");
    await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext(${`${c.firmaId}:${c.poslovnaGodinaId}:${type.id}:journal-number`}))`;
    const last = await tx.nalog.findFirst({ where: { firma_id: c.firmaId, poslovna_godina_id: c.poslovnaGodinaId, vrsta_naloga_id: type.id }, orderBy: { broj: "desc" }, select: { broj: true } });
    const number = (last?.broj ?? 0) + 1;
    const journal = await tx.nalog.create({ data: { agencija_id: c.agencijaId, firma_id: c.firmaId, poslovna_godina_id: c.poslovnaGodinaId, poslovna_jedinica_id: invoice.poslovna_jedinica_id, vrsta_naloga_id: type.id, broj: number, sifra: formatJournalCode(type.prefiks, year.godina, number), datum: invoice.datum_racuna, opis: `${invoice.document_type === "ADVANCE_SETTLEMENT" ? "Umanjenje avansa" : "Avansni račun"} ${invoice.broj_racuna}`, status: "DRAFT", source_type: "OUTGOING_INVOICE", source_module: "agencija.robno.avansni-racuni", izvorni_dokument_id: id, kreirao_korisnik_id: c.userId, created_by: c.userId, updated_by: c.userId, stavke: { create: lines.map((line, index) => ({ konto_id: accounts[index].id, komitent_id: accounts[index].analitika_obavezna ? invoice.kupac_id : null, poslovna_jedinica_id: invoice.poslovna_jedinica_id, duguje: line.direction === "D" ? scaledToDecimal(line.amount, 2) : "0.00", potrazuje: line.direction === "P" ? scaledToDecimal(line.amount, 2) : "0.00", redni_broj: index + 1, broj_dokumenta: invoice.broj_racuna, datum_dokumenta: invoice.datum_racuna, datum_valute: invoice.datum_valute, opis: invoice.interni_broj, created_by: c.userId, updated_by: c.userId })) } } });
    const cleanRules = rules.map(({ namjena, pdv_stopa_sifra, sifra_konta, smjer }) => ({ namjena, pdv_stopa_sifra, sifra_konta, smjer }));
    await tx.fiskalniIzlazniRacun.update({ where: { id }, data: { nalog_id: journal.id, status: "WAITING_KIF", kif_status: "WAITING_KIF", avans_kontiranje_snapshot: { rules: cleanRules }, posted_at: new Date(), posted_by: c.userId, updated_by: c.userId } });
    await audit(tx, c, id, "advance_accounting_completed", { journalId: journal.id, rules: cleanRules });
    return { id, journalId: journal.id, journalCode: journal.sifra, existing: false };
  });
}
// Materialize the confirmed negative fiscal document for the existing KIF source-document flow.
export async function materializeAdvanceSettlement(c: OutgoingInvoiceServiceContext, finalId: string, snapshot: AdvanceAccountingSnapshot) {
  return prisma.$transaction(async (tx) => {
    await lock(tx, finalId);
    const final = await tx.fiskalniIzlazniRacun.findFirst({ where: { id: finalId, ...scope(c) }, include: { avansni_racun: { include: { poreske_stavke: true } } } });
    const state = settlementState(final?.avans_umanjenje), source = final?.avansni_racun;
    if (!final || !state?.remoteId || state.status !== "Fiscalized" || !state.iic || !state.jikr || !state.qrCodeData || !source || source.firma_id !== c.firmaId || source.agencija_id !== c.agencijaId)
      fail("Umanjenje još nema potvrđen fiskalni rezultat.");
    if (decimalToScaled(snapshot.gross, 2) !== -decimalToScaled(final.iznos_avansa, 2))
      fail("Iznos umanjenja nije jednak iskorišćenom avansu.");
    const existing = await tx.fiskalniIzlazniRacun.findFirst({ where: { fiscal_api_invoice_id: state.remoteId } });
    if (existing) {
      if (existing.firma_id !== c.firmaId || existing.agencija_id !== c.agencijaId || existing.original_invoice_id !== source.id || existing.document_type !== "ADVANCE_SETTLEMENT")
        fail("Fiskalno umanjenje je povezano sa drugim dokumentom.");
      return existing.id;
    }
    const day = advanceAccountingDate(snapshot.issueDateTime);
    const year = await tx.poslovnaGodina.findFirst({ where: { firma_id: c.firmaId, datum_od: { lte: day }, datum_do: { gte: day } } });
    if (!year)
      fail("Otvorite poslovnu godinu datuma umanjenja prije knjiženja.");
    const rates = await tx.pdvStopa.findMany({ where: { agencija_id: c.agencijaId } });
    const taxes = snapshot.taxes.map(t => { const original = source.poreske_stavke.find(r => decimalToScaled(r.vat_rate_percent, 2) === decimalToScaled(t.rate, 2)); const rate = rates.find(r => decimalToScaled(r.procenat, 2) === decimalToScaled(t.rate, 2)); if (!rate)
      fail("Nedostaje PDV stopa umanjenja u agenciji."); return { vat_rate_code: original?.vat_rate_code ?? rate.sifra, vat_rate_name: original?.vat_rate_name ?? rate.naziv, vat_rate_percent: rate.procenat, tax_base: t.base, output_vat_amount: t.vat, total_with_vat: t.gross, created_by: c.userId }; });
    await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext(${`${c.firmaId}:${year.id}:sales`}))`;
    const last = await tx.fiskalniIzlazniRacun.findFirst({ where: { firma_id: c.firmaId, poslovna_godina_id: year.id }, orderBy: { broj: "desc" }, select: { broj: true } });
    const number = (last?.broj ?? 0) + 1, internal = `AV-U-${year.godina}-${String(number).padStart(4, "0")}`;
    const invoice = await tx.fiskalniIzlazniRacun.create({ data: { agencija_id: c.agencijaId, firma_id: c.firmaId, poslovna_godina_id: year.id, kupac_id: source.kupac_id, poslovna_jedinica_id: source.poslovna_jedinica_id, broj: number, interni_broj: internal, broj_racuna: state.officialInvoiceNumber ?? internal, official_invoice_number: state.officialInvoiceNumber, datum_racuna: day, datum_prometa: day, datum_valute: day, issued_at: new Date(snapshot.issueDateTime), vrsta_racuna: "ADVANCE", document_type: "ADVANCE_SETTLEMENT", sales_channel: "OFFICE", original_invoice_id: source.id, correction_reason: `Umanjenje po konačnom računu ${final.broj_racuna}`, status: "FINALIZED", kif_status: "ACCOUNTING_PENDING", nacin_placanja: "BANK_TRANSFER", fiskalizacija_rezim: "SUMMA", vat_transaction_type: source.vat_transaction_type, valuta: source.valuta, kurs: source.kurs, ukupno_osnovica: snapshot.net, ukupno_izlazni_pdv: snapshot.vat, ukupno_sa_pdv: snapshot.gross, fiscal_api_invoice_id: state.remoteId, idempotency_key: `advance-settlement-document:${final.id}`, fiscal_status: "Fiscalized", fiscal_environment: final.fiscal_environment, iic: state.iic, jikr: state.jikr, qr_code_data: state.qrCodeData, issuer_snapshot: source.issuer_snapshot ?? Prisma.JsonNull, buyer_snapshot: source.buyer_snapshot ?? Prisma.JsonNull, fiscalized_at: new Date(), napomena: `Izvorni avans ${source.broj_racuna}; konačni račun ${final.broj_racuna}`, created_by: c.userId, updated_by: c.userId, poreske_stavke: { create: taxes } } });
    await tx.fiskalniIzlazniRacun.update({ where: { id: final.id }, data: { avans_umanjenje: JSON.parse(JSON.stringify({ ...state, localInvoiceId: invoice.id, accountingSnapshot: snapshot })) } });
    await audit(tx, c, invoice.id, "advance_settlement_document_created", { finalId, sourceId: source.id, remoteId: state.remoteId });
    return invoice.id;
  });
}
