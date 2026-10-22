import "server-only";
import { Prisma } from "@prisma/client";
import { auditLogInTransaction } from "./audit";
import { decimalToScaled, scaledToDecimal } from "./inventory-calculation";
import { formatJournalCode } from "./journals";
import { effectiveDefaultAccounts, templateAccount } from "./posting-template";
import { calculateSupplierReturn, returnFail, supplierReturnFields, supplierReturnNumber, supplierReturnScope } from "./supplier-return";
import type { PermissionAction } from "./permission-policy";

export type ReturnContext = { userId: string; agencyId: string; companyId: string; yearId: string };
export const returnPath = "/agencija/robno/povrat-dobavljacu";
export const returnScope = (c: ReturnContext) => ({ agencija_id: c.agencyId, firma_id: c.companyId, poslovna_godina_id: c.yearId });
const money = (n: bigint) => scaledToDecimal(n, 2);
const q = (n: bigint) => scaledToDecimal(n, 3);
const price = (n: bigint) => scaledToDecimal(n, 4);

// Every mutation rechecks the live user, assignment and permissions within its transaction.
export async function guardReturn(tx: Prisma.TransactionClient, c: ReturnContext, action: PermissionAction, dates: Date[] = []) {
  await tx.$queryRaw`SELECT id FROM korisnici WHERE id=${c.userId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM firme WHERE id=${c.companyId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM poslovne_godine WHERE id=${c.yearId}::uuid FOR UPDATE`;
  const user = await tx.korisnik.findFirst({ where: { id: c.userId, agencija_id: c.agencyId, aktivan: true, is_deleted: false, rola: { in: ["admin_agencije", "korisnik_agencije"] }, agencija: { aktivan: true, is_deleted: false } } });
  const company = await tx.firma.findFirst({ where: { id: c.companyId, agencija_id: c.agencyId, aktivan: true, is_deleted: false } });
  const year = await tx.poslovnaGodina.findFirst({ where: { id: c.yearId, firma_id: c.companyId } });
  if (!user || !company || !year) returnFail("Nemate pristup izabranoj firmi i godini.");
  if (year.zakljucena) returnFail("Poslovna godina je zaključana.");
  if (user.rola !== "admin_agencije") {
    if (!await tx.korisnikFirma.findFirst({ where: { korisnik_id: c.userId, firma_id: c.companyId, is_deleted: false } })) returnFail("Nemate pristup firmi.");
    const checks = [["robno", "view"], ["robno", action], ...(action === "post" ? [["nalozi", "create"], ["nalozi", "post"], ["ulazni_racuni", "create"]] : [])];
    for (const [modul, akcija] of checks) {
      if (!await tx.korisnikPravo.findFirst({ where: { agencija_id: c.agencyId, korisnik_id: c.userId, firma_id: c.companyId, modul, akcija, dozvoljeno: true } })) returnFail("Nemate potrebna prava za povrat, nalog ili KUF.");
    }
  }
  for (const date of dates) {
    if (date < year.datum_od || date > year.datum_do) returnFail("Datum je van izabrane poslovne godine.");
    const periods = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM pdv_periodi WHERE firma_id=${c.companyId}::uuid AND datum_od<=${date}::date AND datum_do>=${date}::date FOR UPDATE`;
    if (periods.some(p => p.status === "LOCKED")) returnFail("PDV period je zaključan.");
  }
  return { user, company, year };
}

async function audit(tx: Prisma.TransactionClient, c: ReturnContext, action: string, id: string, oldValue: unknown, newValue: unknown) {
  await auditLogInTransaction(tx, { korisnikId: c.userId, agencijaId: c.agencyId, firmaId: c.companyId, modul: "robno", akcija: action, tipEntiteta: "PovratDobavljacu", entitetId: id, staraVrijednost: oldValue, novaVrijednost: newValue });
}
export type ReturnHeader = { date: Date; warehouseId: string; supplierId: string; calculationId: string | null; originalKufId: string | null; bookId: string | null; creditNumber: string; note: string | null };
async function validateHeader(tx: Prisma.TransactionClient, c: ReturnContext, h: ReturnHeader) {
  if (!h.creditNumber || h.creditNumber.length > 120 || (h.note?.length ?? 0) > 2000) returnFail("Unesite broj odobrenja/povrata i ispravnu napomenu.");
  const warehouse = await tx.magacin.findFirst({ where: { id: h.warehouseId, agencija_id: c.agencyId, firma_id: c.companyId, aktivan: true, is_deleted: false } });
  if (!warehouse) returnFail("Magacin nije dostupan.");
  if (warehouse.poslovna_jedinica_id && !await tx.poslovnaJedinica.findFirst({ where: { id: warehouse.poslovna_jedinica_id, agencija_id: c.agencyId, firma_id: c.companyId, aktivna: true, is_deleted: false } })) returnFail("Poslovna jedinica nije aktivna.");
  const supplier = await tx.komitent.findFirst({ where: { id: h.supplierId, aktivan: true, OR: [{ agencija_id: null, firma_id: null }, { agencija_id: c.agencyId, firma_id: null }, { agencija_id: c.agencyId, firma_id: c.companyId }] } });
  if (!supplier) returnFail("Dobavljač nije dostupan.");
  // Imports require customs correction, not domestic input-VAT reversal.
  if (supplier.is_foreign) returnFail("Za inostrani povrat potrebna je uvozna/carinska korekcija; ovaj tok podržava domaći povrat.");
  if (h.calculationId) {
    const calculation = await tx.kalkulacija.findFirst({ where: { id: h.calculationId, agencija_id: c.agencyId, firma_id: c.companyId, dobavljac_id: h.supplierId, magacin_id: h.warehouseId, status: { in: ["WAITING_KUF", "POSTED"] }, is_deleted: false, tip: "DOMESTIC" } });
    if (!calculation || calculation.datum_kalkulacije > h.date) returnFail("Izvorna kalkulacija ne odgovara dobavljaču, magacinu ili datumu.");
    if (h.originalKufId && calculation.kuf_entry_id !== h.originalKufId) returnFail("Izvorni račun ne pripada kalkulaciji.");
  }
  if (h.originalKufId) {
    const original = await tx.kufEntry.findFirst({ where: { id: h.originalKufId, agencija_id: c.agencyId, firma_id: c.companyId, dobavljac_id: h.supplierId, is_deleted: false, vat_transaction_type: "DOMESTIC", total_gross: { gt: 0 }, invoice_date: { lte: h.date } } });
    if (!original) returnFail("Izvorni KUF račun ne odgovara dobavljaču ili datumu.");
  }
  if (h.bookId) {
    const book = await tx.kufBook.findFirst({ where: { id: h.bookId, ...returnScope(c), is_deleted: false, mjesec: h.date.getUTCMonth() + 1, racun_vrsta: { aktivna: true } } });
    if (!book) returnFail("KUF knjiga mora pripadati mjesecu povrata.");
  }
  return warehouse;
}

export async function saveReturnHeader(tx: Prisma.TransactionClient, c: ReturnContext, h: ReturnHeader, id?: string) {
  await guardReturn(tx, c, id ? "update" : "create", [h.date]);
  const previous = id ? await editableReturn(tx, c, id) : null;
  const warehouse = await validateHeader(tx, c, h);
  if (previous?.stavke.length && (previous.magacin_id !== h.warehouseId || previous.dobavljac_id !== h.supplierId || previous.kalkulacija_id !== h.calculationId || previous.originalni_kuf_id !== h.originalKufId)) returnFail("Prije promjene magacina, dobavljača ili izvora uklonite stavke nacrta.");
  const data = { datum: h.date, magacin_id: h.warehouseId, dobavljac_id: h.supplierId, poslovna_jedinica_id: previous && previous.magacin_id === h.warehouseId ? previous.poslovna_jedinica_id : warehouse.poslovna_jedinica_id, kalkulacija_id: h.calculationId, originalni_kuf_id: h.originalKufId, kuf_book_id: h.bookId, broj_odobrenja: h.creditNumber, napomena: h.note, updated_by: c.userId };
  let saved;
  if (id) saved = await tx.povratDobavljacu.update({ where: { id }, data });
  else {
    const last = await tx.povratDobavljacu.findFirst({ where: { firma_id: c.companyId, poslovna_godina_id: c.yearId }, orderBy: { broj: "desc" } });
    const n = (last?.broj ?? 0) + 1;
    const year = await tx.poslovnaGodina.findUniqueOrThrow({ where: { id: c.yearId } });
    saved = await tx.povratDobavljacu.create({ data: { ...returnScope(c), ...data, broj: n, interni_broj: supplierReturnNumber(year.godina, n), created_by: c.userId } });
  }
  await audit(tx, c, id ? "update_supplier_return" : "create_supplier_return", saved.id, previous, saved);
  return saved.id;
}

async function editableReturn(tx: Prisma.TransactionClient, c: ReturnContext, id: string) {
  await tx.$queryRaw`SELECT id FROM povrati_dobavljacu WHERE id=${id}::uuid AND firma_id=${c.companyId}::uuid FOR UPDATE`;
  const doc = await tx.povratDobavljacu.findFirst({ where: { id, ...returnScope(c), is_deleted: false }, include: { stavke: { orderBy: { redni_broj: "asc" } } } });
  if (!doc || doc.status !== "DRAFT" || doc.nalog_id || doc.kuf_entry_id) returnFail("Dokument nije dostupan nacrt.");
  await guardReturn(tx, c, "view", [doc.datum]);
  return doc;
}
export type ReturnLine = { itemId: string; quantity: bigint; creditPrice: bigint; vatRateId: string; calculationLineId: string | null };
export async function saveReturnLine(tx: Prisma.TransactionClient, c: ReturnContext, id: string, line: ReturnLine, lineId?: string) {
  await guardReturn(tx, c, "update");
  const doc = await editableReturn(tx, c, id);
  const existing = lineId ? doc.stavke.find(l => l.id === lineId) : null;
  if (lineId && !existing) returnFail("Stavka nije pronađena.");
  const item = await tx.artikal.findFirst({ where: { id: line.itemId, firma_id: c.companyId, agencija_id: c.agencyId, aktivan: true, is_deleted: false, usluga: false, prati_zalihe: true } });
  const rate = await tx.pdvStopa.findFirst({ where: { id: line.vatRateId, agencija_id: c.agencyId, aktivna: true } });
  if (!item || !rate || line.quantity <= BigInt(0) || line.creditPrice <= BigInt(0)) returnFail("Izaberite aktivnu robu, stopu i pozitivnu količinu/cijenu.");
  if (doc.stavke.some(l => l.id !== lineId && l.artikal_id === line.itemId)) returnFail("Artikal je već dodat.");
  if (line.calculationLineId) {
    if (!doc.kalkulacija_id) returnFail("Prvo povežite kalkulaciju u zaglavlju.");
    const source = await tx.stavkaKalkulacije.findFirst({ where: { id: line.calculationLineId, kalkulacija_id: doc.kalkulacija_id, artikal_id: line.itemId } });
    if (!source || line.quantity > decimalToScaled(source.kolicina, 3)) returnFail("Izvorna stavka ili količina nije ispravna.");
  }
  const data = { artikal_id: line.itemId, kolicina: q(line.quantity), cijena_odobrenja: price(line.creditPrice), pdv_stopa_id: rate.id, pdv_procenat: rate.procenat, stavka_kalkulacije_id: line.calculationLineId, updated_by: c.userId };
  const saved = lineId ? await tx.stavkaPovrataDobavljacu.update({ where: { id: lineId }, data }) : await tx.stavkaPovrataDobavljacu.create({ data: { ...data, povrat_dobavljacu_id: id, redni_broj: Math.max(0, ...doc.stavke.map(l => l.redni_broj)) + 1, created_by: c.userId } });
  await audit(tx, c, "save_supplier_return_line", id, existing, saved);
}
export async function deleteReturnDraft(tx: Prisma.TransactionClient, c: ReturnContext, id: string, lineId?: string) {
  await guardReturn(tx, c, lineId ? "update" : "delete");
  const doc = await editableReturn(tx, c, id);
  if (lineId) {
    if (!doc.stavke.some(l => l.id === lineId)) returnFail("Stavka nije pronađena.");
    await tx.stavkaPovrataDobavljacu.delete({ where: { id: lineId } });
  } else {
    // The audit retains source references; a discarded draft must not pin an empty KUF book.
    await tx.stavkaPovrataDobavljacu.updateMany({ where: { povrat_dobavljacu_id: id }, data: { stavka_kalkulacije_id: null } });
    await tx.povratDobavljacu.update({ where: { id }, data: { status: "DELETED", is_deleted: true, deleted_at: new Date(), deleted_by: c.userId, delete_reason: "Brisanje nacrta povrata", kuf_book_id: null, originalni_kuf_id: null, kalkulacija_id: null, updated_by: c.userId } });
  }
  await audit(tx, c, lineId ? "delete_supplier_return_line" : "delete_supplier_return_draft", id, doc, { lineId, deleted: true });
}

async function resolveReturnAccount(tx: Prisma.TransactionClient, c: ReturnContext, code: string) {
  const account = await templateAccount(tx, c.companyId, code, true);
  if (!account) returnFail(`Konto ${code} nije dostupan.`);
  if (!account.aktivan || account.override_type === "DEACTIVATED" || account.tip_konta !== "analiticko" || code.length < 4) returnFail(`Konto ${code} nije aktivno analitičko konto.`);
  return account;
}

// Caller must use one serializable transaction. All failures throw: never commit partial stock.
export async function postSupplierReturn(tx: Prisma.TransactionClient, c: ReturnContext, id: string) {
  const { company, year } = await guardReturn(tx, c, "post");
  await tx.$queryRaw`SELECT id FROM povrati_dobavljacu WHERE id=${id}::uuid AND firma_id=${c.companyId}::uuid FOR UPDATE`;
  const done = await tx.povratDobavljacu.findFirst({ where: { id, ...returnScope(c), is_deleted: false } });
  if (done?.status === "POSTED" && done.nalog_id && done.kuf_entry_id) return id;
  const doc = await editableReturn(tx, c, id);
  if (!doc.stavke.length || !doc.kuf_book_id) returnFail("Dodajte stavke i izaberite KUF knjigu mjeseca povrata.");
  const warehouse = await validateHeader(tx, c, { date: doc.datum, warehouseId: doc.magacin_id, supplierId: doc.dobavljac_id, calculationId: doc.kalkulacija_id, originalKufId: doc.originalni_kuf_id, bookId: doc.kuf_book_id, creditNumber: doc.broj_odobrenja, note: doc.napomena });
  if (doc.poslovna_jedinica_id && !await tx.poslovnaJedinica.findFirst({ where: { id: doc.poslovna_jedinica_id, firma_id: c.companyId, agencija_id: c.agencyId, aktivna: true, is_deleted: false } })) returnFail("Poslovna jedinica dokumenta nije aktivna.");
  const settings = await effectiveDefaultAccounts(tx, { where: { firma_id: c.companyId, dokument_tip: supplierReturnScope.documentType, podvrsta: supplierReturnScope.subtype, pdv_stopa_sifra: "GENERAL" } });
  const signed = new Map<string, bigint>();
  const tax = new Map<string, { id: string; code: string; name: string; percent: Prisma.Decimal; base: bigint; vat: bigint }>();
  let cost = BigInt(0), retail = BigInt(0), margin = BigInt(0), included = BigInt(0), base = BigInt(0), vat = BigInt(0);
  for (const line of [...doc.stavke].sort((a, b) => a.artikal_id.localeCompare(b.artikal_id))) {
    const item = await tx.artikal.findFirst({ where: { id: line.artikal_id, firma_id: c.companyId, agencija_id: c.agencyId, aktivan: true, is_deleted: false, usluga: false, prati_zalihe: true } });
    const rate = await tx.pdvStopa.findFirst({ where: { id: line.pdv_stopa_id, agencija_id: c.agencyId, aktivna: true } });
    if (!item || !rate || !rate.procenat.equals(line.pdv_procenat)) returnFail("Artikal ili PDV stopa su promijenjeni. Provjerite stavke.");
    const quantity = decimalToScaled(line.kolicina, 3);
    if (line.stavka_kalkulacije_id) {
      const original = await tx.stavkaKalkulacije.findFirst({ where: { id: line.stavka_kalkulacije_id, kalkulacija_id: doc.kalkulacija_id ?? "00000000-0000-0000-0000-000000000000", artikal_id: line.artikal_id } });
      if (!original) returnFail("Veza sa izvornom stavkom nije ispravna.");
      const returned = await tx.stavkaPovrataDobavljacu.aggregate({ where: { stavka_kalkulacije_id: original.id, povrat_dobavljacu: { status: "POSTED", is_deleted: false } }, _sum: { kolicina: true } });
      if (quantity + decimalToScaled(returned._sum.kolicina ?? new Prisma.Decimal(0), 3) > decimalToScaled(original.kolicina, 3)) returnFail("Ukupni povrati prelaze količinu izvorne stavke.");
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stock:${c.companyId}:${c.yearId}:${line.artikal_id}`}))`;
    await tx.$queryRaw`SELECT id FROM stanja_zaliha WHERE firma_id=${c.companyId}::uuid AND poslovna_godina_id=${c.yearId}::uuid AND magacin_id=${doc.magacin_id}::uuid AND artikal_id=${line.artikal_id}::uuid FOR UPDATE`;
    const key = { firma_id: c.companyId, poslovna_godina_id: c.yearId, magacin_id: doc.magacin_id, artikal_id: line.artikal_id };
    const state = await tx.stanjeZaliha.findUnique({ where: { firma_id_poslovna_godina_id_magacin_id_artikal_id: key } });
    const value = (field: "kolicina" | "prosjecna_nabavna_cijena" | "nabavna_vrijednost" | "maloprodajna_vrijednost" | "razlika_u_cijeni" | "ukalkulisani_pdv", scale: number) => decimalToScaled(state?.[field] ?? new Prisma.Decimal(0), scale);
    const source = { quantityMilli: value("kolicina", 3), averageCostTenThousand: value("prosjecna_nabavna_cijena", 4), costCents: value("nabavna_vrijednost", 2), retailCents: value("maloprodajna_vrijednost", 2), marginCents: value("razlika_u_cijeni", 2), includedVatCents: value("ukalkulisani_pdv", 2) };
    if (!(warehouse.dozvoli_negativan_lager ?? company.dozvoli_negativan_lager) && quantity > source.quantityMilli) returnFail(`Nema dovoljno robe: ${item.sifra}.`);
    const amounts = calculateSupplierReturn({ source, quantity, creditPrice: decimalToScaled(line.cijena_odobrenja, 4), vatPercent: decimalToScaled(line.pdv_procenat, 2), deductible: company.pdv_obveznik, retail: warehouse.tip_prodaje === "RETAIL" });
    const slice = amounts.stock;
    const afterQty = source.quantityMilli - quantity;
    const afterCost = source.costCents - slice.costCents;
    // Preserve cost/quantity ratio after cent rounding; exact empty stock has zero average.
    const avg = afterQty > BigInt(0) && afterCost >= BigInt(0) ? (afterCost * BigInt(100000) + afterQty / BigInt(2)) / afterQty : afterQty === BigInt(0) ? BigInt(0) : source.averageCostTenThousand || slice.unitCostTenThousand;
    const stockData = { kolicina: q(afterQty), prosjecna_nabavna_cijena: price(avg), nabavna_vrijednost: money(afterCost), maloprodajna_vrijednost: money(source.retailCents - slice.retailCents), razlika_u_cijeni: money(source.marginCents - slice.marginCents), ukalkulisani_pdv: money(source.includedVatCents - slice.includedVatCents) };
    await tx.stanjeZaliha.upsert({ where: { firma_id_poslovna_godina_id_magacin_id_artikal_id: key }, create: { ...returnScope(c), ...key, ...stockData }, update: stockData });
    await tx.prometZaliha.create({ data: { ...returnScope(c), magacin_id: doc.magacin_id, artikal_id: line.artikal_id, tip_dokumenta: "SUPPLIER_RETURN", dokument_id: id, stavka_dokumenta_id: line.id, datum_prometa: doc.datum, smjer: "OUT", kolicina: q(quantity), jedinicna_nabavna_cijena: price(slice.unitCostTenThousand), nabavna_vrijednost: money(slice.costCents), prodajna_vrijednost: money(slice.retailCents), razlika_u_cijeni: money(slice.marginCents), ukalkulisani_pdv: money(slice.includedVatCents), prosjecna_cijena_nakon: price(avg), kolicina_nakon: q(afterQty), created_by: c.userId } });
    await tx.stavkaPovrataDobavljacu.update({ where: { id: line.id }, data: { osnovica: money(amounts.base), ulazni_pdv: money(amounts.vat), jedinicna_nabavna_cijena: price(slice.unitCostTenThousand), nabavna_vrijednost: money(slice.costCents), prodajna_cijena_sa_pdv: price(quantity ? slice.retailCents * BigInt(100000) / quantity : BigInt(0)), maloprodajna_vrijednost: money(slice.retailCents), razlika_u_cijeni: money(slice.marginCents), ukalkulisani_pdv: money(slice.includedVatCents), updated_by: c.userId } });
    for (const [purpose, amount] of amounts.signed) signed.set(purpose, (signed.get(purpose) ?? BigInt(0)) + amount);
    const group = tax.get(rate.id) ?? { id: rate.id, code: rate.sifra, name: rate.naziv, percent: rate.procenat, base: BigInt(0), vat: BigInt(0) };
    group.base += amounts.base; group.vat += amounts.vat; tax.set(rate.id, group);
    cost += slice.costCents; retail += slice.retailCents; margin += slice.marginCents; included += slice.includedVatCents; base += amounts.base; vat += amounts.vat;
  }
  if ([cost, retail, margin, included, base, vat, base + vat].some(amount => amount > BigInt("99999999999999") || amount < -BigInt("99999999999999"))) returnFail("Ukupan iznos prelazi dozvoljenu veličinu novčanog polja.");
  const journalLines: Prisma.StavkaNalogaUncheckedCreateWithoutNalogInput[] = [];
  for (const [purpose, amount] of signed) {
    if (!amount) continue;
    const field = supplierReturnFields.find(f => f.purpose === purpose)!;
    const setting = settings.find(s => s.namjena === purpose);
    if (!setting?.sifra_konta || setting.smjer !== field.direction) returnFail(`Podesite konto i smjer: ${field.label}.`);
    const account = await resolveReturnAccount(tx, c, setting.sifra_konta);
    if ((purpose === "RETURN_LOSS" && !account.sifra.startsWith("5")) || (purpose === "RETURN_GAIN" && !account.sifra.startsWith("6"))) returnFail("Konto razlike mora biti klasa 5/6.");
    if (account.analitika_obavezna && purpose !== "RETURN_SUPPLIER") returnFail(`Konto ${account.sifra} ne smije zahtijevati partnera.`);
    if (account.koristi_radnu_jedinicu && !doc.poslovna_jedinica_id) returnFail(`Konto ${account.sifra} zahtijeva poslovnu jedinicu.`);
    journalLines.push({ konto_id: account.id, komitent_id: purpose === "RETURN_SUPPLIER" ? doc.dobavljac_id : null, poslovna_jedinica_id: doc.poslovna_jedinica_id, duguje: money(amount > BigInt(0) ? amount : BigInt(0)), potrazuje: money(amount < BigInt(0) ? -amount : BigInt(0)), redni_broj: journalLines.length + 1, opis: `${field.label} · ${doc.interni_broj}`, broj_dokumenta: doc.broj_odobrenja, datum_dokumenta: doc.datum, created_by: c.userId, updated_by: c.userId });
  }
  if ([...signed.values()].reduce((sum, n) => sum + n, BigInt(0)) !== BigInt(0) || base + vat <= BigInt(0)) returnFail("Povrat nije izbalansiran ili je iznos nula.");
  const type = await tx.vrstaNaloga.findFirst({ where: { sifra: "SUPPLIER_RETURN", aktivan: true, OR: [{ sistemska: true, agencija_id: null, firma_id: null }, { agencija_id: c.agencyId, firma_id: null }, { agencija_id: c.agencyId, firma_id: c.companyId }] } });
  if (!type) returnFail("Nedostaje vrsta naloga za povrat dobavljaču.");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`journal-number:${c.companyId}:${c.yearId}:${type.id}`}))`;
  const last = await tx.nalog.findFirst({ where: { firma_id: c.companyId, poslovna_godina_id: c.yearId, vrsta_naloga_id: type.id }, orderBy: { broj: "desc" } });
  const number = (last?.broj ?? 0) + 1;
  const journal = await tx.nalog.create({ data: { ...returnScope(c), poslovna_jedinica_id: doc.poslovna_jedinica_id, vrsta_naloga_id: type.id, broj: number, sifra: formatJournalCode(type.prefiks, year.godina, number), datum: doc.datum, datum_knjizenja: doc.datum, opis: `Povrat dobavljaču ${doc.interni_broj}`, status: "POSTED", source_type: "SUPPLIER_RETURN", source_module: "SUPPLIER_RETURN", izvorni_dokument_id: id, proknjizen_at: new Date(), proknjizen_by: c.userId, created_by: c.userId, updated_by: c.userId, stavke: { create: journalLines } } });
  await tx.$queryRaw`SELECT id FROM kuf_books WHERE id=${doc.kuf_book_id}::uuid FOR UPDATE`;
  const lastKuf = await tx.kufEntry.findFirst({ where: { firma_id: c.companyId, poslovna_godina_id: c.yearId }, orderBy: { redni_broj: "desc" } });
  const kn = (lastKuf?.redni_broj ?? 0) + 1;
  const entry = await tx.kufEntry.create({ data: { ...returnScope(c), kuf_book_id: doc.kuf_book_id, poslovna_jedinica_id: doc.poslovna_jedinica_id, dobavljac_id: doc.dobavljac_id, redni_broj: kn, internal_kuf_number: `KUF-${year.godina}-${String(kn).padStart(4, "0")}`, supplier_invoice_number: doc.broj_odobrenja, invoice_date: doc.datum, receipt_date: doc.datum, vat_transaction_type: "DOMESTIC", total_base: money(-base), total_input_vat: money(-vat), deductible_vat: money(company.pdv_obveznik ? -vat : BigInt(0)), non_deductible_vat: money(company.pdv_obveznik ? BigInt(0) : -vat), total_gross: money(-base - vat), source_type: "SUPPLIER_RETURN", source_id: id, posting_mode: "SOURCE_DOCUMENT", posting_status: "POSTED", journal_id: journal.id, note: `Povrat dobavljaču ${doc.interni_broj}`, created_by: c.userId, updated_by: c.userId, tax_lines: { create: [...tax.values()].map(g => ({ vat_rate_id: g.id, vat_rate_code: g.code, vat_rate_name: g.name, vat_rate_percent: g.percent, tax_base: money(-g.base), input_vat_amount: money(-g.vat), deductible_vat_amount: money(company.pdv_obveznik ? -g.vat : BigInt(0)), non_deductible_vat_amount: money(company.pdv_obveznik ? BigInt(0) : -g.vat), total_with_vat: money(-g.base - g.vat), created_by: c.userId })) } } });
  const updated = await tx.povratDobavljacu.update({ where: { id }, data: { status: "POSTED", nalog_id: journal.id, kuf_entry_id: entry.id, ukupna_osnovica: money(base), ukupni_ulazni_pdv: money(vat), ukupno_odobrenje: money(base + vat), ukupna_nabavna_vrijednost: money(cost), ukupna_maloprodajna_vrijednost: money(retail), ukupna_razlika_u_cijeni: money(margin), ukupni_ukalkulisani_pdv: money(included), posted_at: new Date(), posted_by: c.userId, updated_by: c.userId } });
  await audit(tx, c, "post_supplier_return", id, doc, updated);
  return id;
}
