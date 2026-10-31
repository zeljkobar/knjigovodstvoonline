import "server-only";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { requireAnyRole } from "./auth";
import { readWorkContext } from "./work-context";
import { prisma } from "./prisma";
import { auditLogInTransaction } from "./audit";
import { decimalToScaled } from "./inventory-calculation";
import { BankStatementError, assertBankStatementAccess } from "./bank-statement-lifecycle";

export class AccountReplacementError extends Error {}
export type ReplacementFilter = { from: string; to: string; journalTypeId: string; dateFrom: string; dateTo: string };
type Actor = { userId: string; agencyId: string; companyId: string; yearId: string };
type Proof = { actor: Actor; filter: ReplacementFilter; digest: string; expires: number; id: string };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const cents = (value: { toString(): string }) => Number(decimalToScaled(value, 2));
function fail(message: string): never { throw new AccountReplacementError(message); }

function parseDate(value: string) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail("Unesite ispravan datum.");
  return date;
}
export function replacementFilter(form: FormData): ReplacementFilter {
  const text = (key: string) => String(form.get(key) ?? "").trim();
  const result = { from: text("from"), to: text("to"), journalTypeId: text("journalTypeId"), dateFrom: text("dateFrom"), dateTo: text("dateTo") };
  if (!result.from || !result.to || result.from.length > 64 || result.to.length > 64 || !uuid.test(result.journalTypeId)) fail("Izaberite trenutni konto, novi konto i vrstu naloga.");
  if (result.from === result.to) fail("Trenutni i novi konto moraju biti različiti.");
  const from = parseDate(result.dateFrom), to = parseDate(result.dateTo);
  if (from && to && from > to) fail("Datum od mora biti prije datuma do.");
  return result;
}

export async function replacementActor(): Promise<Actor> {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const context = await readWorkContext();
  if (!user.agencija_id || !context.firmaId || !context.poslovnaGodinaId) fail("Izaberite firmu i poslovnu godinu.");
  return { userId: user.id, agencyId: user.agencija_id, companyId: context.firmaId, yearId: context.poslovnaGodinaId };
}

async function assertAccess(tx: Prisma.TransactionClient, actor: Actor) {
  const user = await tx.korisnik.findFirst({ where: {
    id: actor.userId, agencija_id: actor.agencyId, aktivan: true, is_deleted: false,
    rola: { in: ["admin_agencije", "korisnik_agencije"] }, agencija: { aktivan: true, is_deleted: false }
  } });
  const company = await tx.firma.findFirst({ where: {
    id: actor.companyId, agencija_id: actor.agencyId, aktivan: true, is_deleted: false,
    ...(user?.rola === "admin_agencije" ? {} : { korisnici: { some: { korisnik_id: actor.userId, is_deleted: false } } })
  } });
  if (!user || !company) fail("Nemate pristup izabranoj firmi.");
  if (user.rola !== "admin_agencije") for (const akcija of ["view", "update", "post"]) {
    if (!await tx.korisnikPravo.findFirst({ where: {
      agencija_id: actor.agencyId, korisnik_id: actor.userId, firma_id: actor.companyId,
      modul: "nalozi", akcija, dozvoljeno: true
    } })) fail("Potrebna su prava pregleda, izmjene i knjiženja naloga.");
  }
  const year = await tx.poslovnaGodina.findFirst({ where: { id: actor.yearId, firma_id: actor.companyId } });
  if (!year) fail("Poslovna godina nije dostupna.");
  if (year.zakljucena) fail("Poslovna godina je zaključana.");
  return { company, year };
}

export async function replacementOptions() {
  const actor = await replacementActor();
  return prisma.$transaction(async tx => {
    const { company, year } = await assertAccess(tx, actor);
    const [baseAccounts, companyAccounts, journalTypes] = await Promise.all([
      tx.konto.findMany({ where: { tip_konta: "analiticko" }, orderBy: { sifra: "asc" } }),
      tx.firmaKonto.findMany({ where: { firma_id: actor.companyId }, orderBy: { sifra: "asc" } }),
      tx.vrstaNaloga.findMany({ where: { OR: [
        { agencija_id: null, firma_id: null }, { agencija_id: actor.agencyId, firma_id: null },
        { agencija_id: actor.agencyId, firma_id: actor.companyId }
      ] }, orderBy: { naziv: "asc" }, select: { id: true, naziv: true, prefiks: true } })
    ]);
    const accounts = new Map(baseAccounts.map(a => [a.sifra, { code: a.sifra, name: a.naziv, active: a.aktivan }]));
    for (const account of companyAccounts) accounts.set(account.sifra, { code: account.sifra, name: account.naziv,
      active: account.aktivan && account.override_type !== "DEACTIVATED" && account.tip_konta === "analiticko" });
    return { company: company.naziv, year: year.godina, companyId: company.id, yearId: year.id,
      accounts: [...accounts.values()].sort((a, b) => a.code.localeCompare(b.code)), journalTypes };
  });
}

const journalInclude = {
  stavke: { orderBy: { redni_broj: "asc" as const }, include: { komitent: { select: { naziv: true, agencija_id: true, firma_id: true } }, poslovna_jedinica: { select: { firma_id: true, agencija_id: true, aktivna: true, is_deleted: true } } } },
  bankStatements: { include: { lines: { orderBy: { line_number: "asc" as const }, include: { debit_account: true, credit_account: true } } } },
  _count: { select: { pdvPrijave: true, plateObracuni: true, posAccountingBatches: true, prenosiRobe: true, popisiRobe: true, otpisiRobe: true, nivelacijeCijena: true, osPromjene: true } },
  osObracun: { select: { id: true } }, putniNalog: { select: { id: true } }, povratDobavljacu: { select: { id: true } }
} satisfies Prisma.NalogInclude;
type Journal = Prisma.NalogGetPayload<{ include: typeof journalInclude }>;
type BankChange = { statementId: string; header: boolean; debitIds: string[]; creditIds: string[] };

function bankChange(journal: Journal, fromId: string): BankChange {
  const statement = journal.bankStatements[0];
  if (journal.bankStatements.length !== 1 || statement.is_deleted || statement.status !== "POSTED" ||
      statement.firma_id !== journal.firma_id || statement.agencija_id !== journal.agencija_id ||
      statement.poslovna_godina_id !== journal.poslovna_godina_id || statement.id !== journal.izvorni_dokument_id ||
      journal.source_module !== "IZVODI" || journal.source_type !== "BANK_STATEMENT") fail("Veza naloga i izvoda nije ispravna.");
  const result: BankChange = { statementId: statement.id, header: false, debitIds: [], creditIds: [] };
  let index = 0;
  function expect(accountId: string | null, debit: number, credit: number, partnerId: string | null) {
    const line = journal.stavke[index++];
    if (!line || line.redni_broj !== index || line.konto_id !== accountId || cents(line.duguje) !== debit ||
        cents(line.potrazuje) !== credit || line.komitent_id !== partnerId) fail("Stavke naloga odstupaju od izvoda. Prvo uskladite izvod kroz vraćanje u nacrt i ponovno knjiženje.");
    return line.konto_id === fromId;
  }
  if (cents(statement.total_inflow) > 0 && expect(statement.bank_account_konto_id, cents(statement.total_inflow), 0, null)) result.header = true;
  if (cents(statement.total_outflow) > 0 && expect(statement.bank_account_konto_id, 0, cents(statement.total_outflow), null)) result.header = true;
  for (const line of statement.lines.filter(line => line.posting_status !== "IGNORED")) {
    const inflow = line.direction === "INFLOW";
    const account = inflow ? line.credit_account : line.debit_account;
    const amount = cents(line.inflow_amount) || cents(line.outflow_amount);
    if (expect(account?.id ?? null, inflow ? 0 : amount, inflow ? amount : 0, account?.analitika_obavezna ? line.partner_id : null)) {
      (inflow ? result.creditIds : result.debitIds).push(line.id);
    }
  }
  if (index !== journal.stavke.length) fail("Nalog sadrži stavke koje ne pripadaju izvodu.");
  return result;
}

async function replacementSnapshot(tx: Prisma.TransactionClient, actor: Actor, filter: ReplacementFilter) {
  const { year } = await assertAccess(tx, actor);
  const dateFrom = parseDate(filter.dateFrom), dateTo = parseDate(filter.dateTo);
  if ((dateFrom && (dateFrom < year.datum_od || dateFrom > year.datum_do)) ||
      (dateTo && (dateTo < year.datum_od || dateTo > year.datum_do))) fail("Period mora biti unutar aktivne poslovne godine.");
  const type = await tx.vrstaNaloga.findFirst({ where: { id: filter.journalTypeId, OR: [
    { agencija_id: null, firma_id: null }, { agencija_id: actor.agencyId, firma_id: null },
    { agencija_id: actor.agencyId, firma_id: actor.companyId }
  ] } });
  if (!type) fail("Vrsta naloga nije dostupna ovoj firmi.");
  const source = await tx.firmaKonto.findUnique({ where: { firma_id_sifra: { firma_id: actor.companyId, sifra: filter.from } } });
  if (!source) fail("Trenutni konto nema knjiženja u kontnom planu aktivne firme.");
  const targetOverride = await tx.firmaKonto.findUnique({ where: { firma_id_sifra: { firma_id: actor.companyId, sifra: filter.to } } });
  const target = targetOverride ?? await tx.konto.findUnique({ where: { sifra: filter.to } });
  if (!target || !target.aktivan || target.tip_konta !== "analiticko" || target.sifra.length < 4 ||
      targetOverride?.override_type === "DEACTIVATED") fail("Novi konto mora biti aktivan analitički konto sa najmanje četiri znaka.");
  const journals = await tx.nalog.findMany({ where: {
    agencija_id: actor.agencyId, firma_id: actor.companyId, poslovna_godina_id: actor.yearId,
    vrsta_naloga_id: type.id, status: "POSTED", is_deleted: false,
    datum: { gte: dateFrom ?? year.datum_od, lte: dateTo ?? year.datum_do },
    stavke: { some: { konto_id: source.id } }
  }, include: journalInclude, orderBy: [{ datum: "asc" }, { id: "asc" }] });
  const lockedPeriods = await tx.pdvPeriod.findMany({ where: { firma_id: actor.companyId, status: "LOCKED" }, orderBy: { id: "asc" } });
  const linkedInvoices = journals.length ? await tx.kifEntry.findMany({ where: { journal_id: { in: journals.map(j => j.id) } }, select: { id: true, journal_id: true }, orderBy: { id: "asc" } }) : [];
  const linkedPurchases = journals.length ? await tx.kufEntry.findMany({ where: { journal_id: { in: journals.map(j => j.id) } }, select: { id: true, journal_id: true }, orderBy: { id: "asc" } }) : [];
  const blocked: Array<{ journalId: string; message: string }> = [];
  const bankChanges: BankChange[] = [];
  for (const journal of journals) {
    const block = (message: string) => blocked.push({ journalId: journal.id, message });
    const selected = journal.stavke.filter(line => line.konto_id === source.id);
    if (lockedPeriods.some(p => (journal.datum >= p.datum_od && journal.datum <= p.datum_do) ||
        journal.bankStatements.some(s => s.statement_date >= p.datum_od && s.statement_date <= p.datum_do))) block("PDV period je zaključan.");
    const debit = journal.stavke.reduce((sum, line) => sum + cents(line.duguje), 0);
    const credit = journal.stavke.reduce((sum, line) => sum + cents(line.potrazuje), 0);
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit) || debit !== credit) block("Nalog nije izbalansiran.");
    if (selected.some(line => target.analitika_obavezna && !line.komitent_id)) block("Novi konto zahtijeva partnera koji nedostaje na stavci.");
    if (selected.some(line => line.komitent && line.komitent.agencija_id !== null &&
        (line.komitent.agencija_id !== actor.agencyId || (line.komitent.firma_id !== null && line.komitent.firma_id !== actor.companyId)))) block("Partner stavke nije dostupan aktivnoj firmi.");
    if (selected.some(line => target.koristi_radnu_jedinicu && (!line.poslovna_jedinica || line.poslovna_jedinica.firma_id !== actor.companyId ||
        line.poslovna_jedinica.agencija_id !== actor.agencyId || !line.poslovna_jedinica.aktivna || line.poslovna_jedinica.is_deleted))) block("Novi konto zahtijeva aktivnu poslovnu jedinicu na stavci.");
    const hasDependencies = Object.values(journal._count).some(count => count > 0) || journal.osObracun || journal.putniNalog || journal.povratDobavljacu ||
      linkedInvoices.some(e => e.journal_id === journal.id) || linkedPurchases.some(e => e.journal_id === journal.id) || journal.stavke.some(line => line.kuf_entry_id);
    if (hasDependencies) { block("Nalog je povezan sa drugim poslovnim dokumentom. Ispravka se radi u njegovom modulu."); continue; }
    if (journal.bankStatements.length || journal.source_type === "BANK_STATEMENT" || journal.source_module === "IZVODI") {
      try {
        await assertBankStatementAccess(tx, { userId: actor.userId, agencyId: actor.agencyId }, actor.companyId, ["update", "post"]);
        bankChanges.push(bankChange(journal, source.id));
      } catch (error) {
        if (error instanceof BankStatementError) block("Potrebna su prava izmjene i knjiženja izvoda.");
        else if (error instanceof AccountReplacementError) block(error.message);
        else throw error;
      }
    } else if (journal.source_type !== "MANUAL" || ![null, "MANUAL"].includes(journal.source_module)) {
      block("Automatski nalog se ispravlja u modulu izvornog dokumenta.");
    }
  }
  const digest = createHash("sha256").update(JSON.stringify({ source, target, type, journals, lockedPeriods, linkedInvoices, linkedPurchases, bankChanges, blocked })).digest("hex");
  return { source, target, targetOverride, type, journals, bankChanges, blocked, digest };
}

function signature(payload: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) fail("Ključ sesije nije podešen.");
  return createHmac("sha256", secret).update(`journal-account-replacement:v1:${payload}`).digest("base64url");
}
function readProof(token: string): Proof {
  if (!token || token.length > 6000) fail("Prvo prikažite stavke za zamjenu.");
  const [payload, signed, extra] = token.split(".");
  const expected = Buffer.from(signature(payload ?? "")), actual = Buffer.from(signed ?? "");
  if (extra || expected.length !== actual.length || !timingSafeEqual(expected, actual)) fail("Pregled zamjene nije ispravan. Ponovo prikažite stavke.");
  try {
    const proof = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Proof;
    if (!uuid.test(proof.id) || !Number.isFinite(proof.expires) || proof.expires < Date.now()) fail("Pregled je istekao. Ponovo prikažite stavke.");
    return proof;
  } catch (error) {
    if (error instanceof AccountReplacementError) throw error;
    return fail("Pregled zamjene nije ispravan.");
  }
}

export async function previewAccountReplacement(form: FormData) {
  const actor = await replacementActor(), filter = replacementFilter(form);
  return prisma.$transaction(async tx => {
    const snapshot = await replacementSnapshot(tx, actor, filter);
    const rows = snapshot.journals.flatMap(journal => journal.stavke.filter(line => line.konto_id === snapshot.source.id).map(line => ({
      id: line.id, journalId: journal.id, journal: journal.sifra ?? String(journal.broj), date: journal.datum.toISOString().slice(0, 10),
      number: line.redni_broj, partner: line.komitent?.naziv ?? "—", description: line.opis ?? "", document: line.broj_dokumenta ?? "",
      debit: cents(line.duguje), credit: cents(line.potrazuje),
      blocker: snapshot.blocked.filter(item => item.journalId === journal.id).map(item => item.message).join(" ")
    })));
    const proof: Proof = { actor, filter, digest: snapshot.digest, expires: Date.now() + 20 * 60 * 1000, id: randomUUID() };
    const payload = Buffer.from(JSON.stringify(proof)).toString("base64url");
    const debit = rows.reduce((sum, row) => sum + row.debit, 0), credit = rows.reduce((sum, row) => sum + row.credit, 0);
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit)) fail("Zbir iznosa je prevelik. Izaberite uži period.");
    return { token: rows.length && !snapshot.blocked.length ? `${payload}.${signature(payload)}` : "", filter,
      from: `${snapshot.source.sifra} — ${snapshot.source.naziv}`, to: `${snapshot.target.sifra} — ${snapshot.target.naziv}`, journalType: snapshot.type.naziv,
      companyId: actor.companyId, yearId: actor.yearId, count: rows.length, journalCount: snapshot.journals.length,
      debit, credit,
      bankCount: snapshot.bankChanges.length, blocked: snapshot.blocked, rows: rows.slice(0, 250),
      journals: snapshot.journals.map(journal => ({ id: journal.id, code: journal.sifra ?? String(journal.broj),
        date: journal.datum.toISOString().slice(0, 10), count: journal.stavke.filter(line => line.konto_id === snapshot.source.id).length })) };
  }, { isolationLevel: "RepeatableRead", timeout: 30000 });
}

export async function applyAccountReplacement(token: string) {
  const actor = await replacementActor(), proof = readProof(token);
  if (JSON.stringify(actor) !== JSON.stringify(proof.actor)) fail("Firma, godina ili korisnik su promijenjeni. Ponovo prikažite stavke.");
  try {
    return await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM firme WHERE id=${actor.companyId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM poslovne_godine WHERE id=${actor.yearId}::uuid FOR UPDATE`;
      await assertAccess(tx, actor);
      if (proof.expires < Date.now()) fail("Pregled je istekao. Ponovo prikažite stavke.");
      if (await tx.auditLog.findFirst({ where: { entitet_id: proof.id, akcija: "replace_journal_account", korisnik_id: actor.userId, agencija_id: actor.agencyId, firma_id: actor.companyId } })) fail("Ova zamjena je već izvršena.");
      const initial = await replacementSnapshot(tx, actor, proof.filter);
      for (const id of initial.bankChanges.map(change => change.statementId).sort()) await tx.$queryRaw`SELECT id FROM bank_statements WHERE id=${id}::uuid FOR UPDATE`;
      for (const journal of [...initial.journals].sort((a, b) => a.id.localeCompare(b.id))) await tx.$queryRaw`SELECT id FROM nalozi WHERE id=${journal.id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM pdv_periodi WHERE firma_id=${actor.companyId}::uuid ORDER BY id FOR UPDATE`;
      const snapshot = await replacementSnapshot(tx, actor, proof.filter);
      if (snapshot.digest !== proof.digest) fail("Podaci su promijenjeni nakon pregleda. Ponovo prikažite stavke.");
      if (snapshot.blocked.length || !snapshot.journals.length) fail("Zamjena je blokirana. Ponovo prikažite stavke i provjerite razloge.");
      const target = snapshot.targetOverride ?? await tx.firmaKonto.create({ data: {
        firma_id: actor.companyId, konto_id: snapshot.target.id, sifra: snapshot.target.sifra,
        naziv: snapshot.target.naziv, tip_konta: snapshot.target.tip_konta,
        analitika_obavezna: snapshot.target.analitika_obavezna, koristi_radnu_jedinicu: snapshot.target.koristi_radnu_jedinicu,
        sinteticki_konto: snapshot.target.sinteticki_konto, normalni_saldo: snapshot.target.normalni_saldo, override_type: "BASE_LINK", aktivan: true
      } });
      let changed = 0;
      for (const journal of snapshot.journals) {
        const ids = journal.stavke.filter(line => line.konto_id === snapshot.source.id).map(line => line.id);
        // Draft/edit/post is entirely inside this transaction; original posting metadata stays intact.
        await tx.nalog.update({ where: { id: journal.id }, data: { status: "DRAFT" } });
        const update = await tx.stavkaNaloga.updateMany({ where: { id: { in: ids }, nalog_id: journal.id, konto_id: snapshot.source.id }, data: { konto_id: target.id, updated_by: actor.userId } });
        if (update.count !== ids.length) fail("Stavke su promijenjene tokom zamjene. Ponovo prikažite stavke.");
        changed += update.count;
        await tx.nalog.update({ where: { id: journal.id }, data: { status: "POSTED", updated_by: actor.userId } });
      }
      for (const change of snapshot.bankChanges) {
        if (change.header) await tx.bankStatement.update({ where: { id: change.statementId }, data: { bank_account_konto_id: target.id, updated_by: actor.userId } });
        else await tx.bankStatement.update({ where: { id: change.statementId }, data: { updated_by: actor.userId } });
        for (const [ids, field] of [[change.debitIds, "debit_account_id"], [change.creditIds, "credit_account_id"]] as const) {
          if (ids.length) await tx.bankStatementLine.updateMany({ where: { id: { in: ids }, bank_statement_id: change.statementId }, data: { [field]: target.id, updated_by: actor.userId } });
        }
      }
      await auditLogInTransaction(tx, { korisnikId: actor.userId, agencijaId: actor.agencyId, firmaId: actor.companyId,
        modul: "agencija.nalozi", akcija: "replace_journal_account", tipEntiteta: "JournalAccountReplacement", entitetId: proof.id,
        staraVrijednost: { filter: proof.filter, journals: snapshot.journals, sourceAccount: snapshot.source },
        novaVrijednost: { targetAccount: target, changed, journalIds: snapshot.journals.map(j => j.id), bankChanges: snapshot.bankChanges }
      });
      return { changed, journals: snapshot.journals.length };
    }, { isolationLevel: "Serializable", timeout: 60000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") fail("Podaci su istovremeno promijenjeni. Ponovo prikažite stavke.");
    throw error;
  }
}
