import { postBankSettlements } from "./bank-settlements";
import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { requireAnyRole } from "./auth";
import { readWorkContext } from "./work-context";
import { auditLogInTransaction } from "./audit";
import { mergeCompanyAccountPlan } from "./account-plan";
import { effectiveBankSetting } from "./posting-template";
import { formatJournalCode } from "./journals";
import { BankStatementError, assertBankStatementAccess, assertBankJournalOwnership, lockBankStatement, refreshBankInvoicePayment, refreshBankPaymentStatuses, syncLegacyBankStatementDraft } from "./bank-statement-lifecycle";
import { manualCents as cents, manualDecimal as decimal, manualDate, manualText as text, parseManualBankLines } from "./bank-manual-journal-input";

export type ManualBankActor = { userId: string; agencyId: string; companyId: string; yearId: string };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function fail(code: string): never { throw new BankStatementError(code); }

export async function manualBankActor(): Promise<ManualBankActor> {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const context = await readWorkContext();
  if (!user.agencija_id || !context.firmaId || !context.poslovnaGodinaId) fail("izvod_greska");
  return { userId: user.id, agencyId: user.agencija_id, companyId: context.firmaId, yearId: context.poslovnaGodinaId };
}

async function access(tx: Prisma.TransactionClient, actor: ManualBankActor, action: "view" | "update" | "post") {
  await assertBankStatementAccess(tx, actor, actor.companyId, action === "view" ? [] : [action]);
  const user = await tx.korisnik.findUniqueOrThrow({ where: { id: actor.userId } });
  if (user.rola !== "admin_agencije") for (const check of [
    { modul: "izvodi", akcija: "view" }, { modul: "nalozi", akcija: "view" },
    ...(action === "view" ? [] : [{ modul: "nalozi", akcija: action }])
  ]) if (!await tx.korisnikPravo.findFirst({ where: { agencija_id: actor.agencyId, firma_id: actor.companyId, korisnik_id: actor.userId, ...check, dozvoljeno: true } })) fail("prava");
}

async function locked(tx: Prisma.TransactionClient, actor: ManualBankActor, id: string, action: "update" | "post") {
  if (!uuid.test(id)) fail("izvod_greska");
  const current = await lockBankStatement(tx, actor, { id, firma_id: actor.companyId, poslovna_godina_id: actor.yearId }, [action], true);
  await access(tx, actor, action);
  return current;
}

function checkVersion(form: FormData, current: Awaited<ReturnType<typeof locked>>) {
  if (text(form, "statement_version") !== current.statement.updated_at.toISOString()
    || text(form, "journal_id") !== (current.journal?.id ?? "")
    || text(form, "journal_version") !== (current.journal?.updated_at.toISOString() ?? "")) fail("izvod_promijenjen");
}

async function checkDate(tx: Prisma.TransactionClient, actor: ManualBankActor, date: Date) {
  const year = await tx.poslovnaGodina.findFirst({ where: { id: actor.yearId, firma_id: actor.companyId } });
  if (!year || year.zakljucena) fail("godina_zakljucena");
  if (date < year.datum_od || date > year.datum_do) fail("nalog_datum");
  const periods = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM pdv_periodi WHERE firma_id=${actor.companyId}::uuid AND datum_od<=${date}::date AND datum_do>=${date}::date FOR UPDATE`;
  if (periods.some(p => p.status === "LOCKED")) fail("pdv_period_zakljucan");
}

async function account(tx: Prisma.TransactionClient, actor: ManualBankActor, code: string) {
  const local = await tx.firmaKonto.findUnique({ where: { firma_id_sifra: { firma_id: actor.companyId, sifra: code } } });
  if (local) {
    if (!local.aktivan || local.override_type === "DEACTIVATED" || local.tip_konta !== "analiticko" || local.sifra.length < 4) fail("konto_nevalidno");
    return local;
  }
  const base = await tx.konto.findUnique({ where: { sifra: code } });
  if (!base || !base.aktivan || base.tip_konta !== "analiticko" || base.sifra.length < 4) fail("konto_nevalidno");
  return tx.firmaKonto.create({ data: {
    firma_id: actor.companyId, konto_id: base.id, sifra: base.sifra, naziv: base.naziv,
    tip_konta: base.tip_konta, analitika_obavezna: base.analitika_obavezna,
    sinteticki_konto: base.sinteticki_konto, normalni_saldo: base.normalni_saldo,
    koristi_radnu_jedinicu: base.koristi_radnu_jedinicu, aktivan: true, override_type: "BASE_LINK"
  } });
}

type LedgerLine = { konto_id: string; komitent_id: string | null; duguje: { toString(): string }; potrazuje: { toString(): string } };

// Preserve existing invoice settlements only while the reviewed ledger still
// supports the same account/partner/net settlement. The UI offers explicit removal.
export async function manualBankAllocationsValid(tx: Prisma.TransactionClient, actor: ManualBankActor, statementId: string, rows: LedgerLine[]) {
  const allocations = await tx.bankStatementLineAllocation.findMany({ where: { bank_statement_line: { bank_statement_id: statementId } },
    include: { bank_statement_line: true, kif_entry: true, kuf_entry: true } });
  const groups = new Map<string, { amount: bigint; side: "D" | "P"; accountId: string; partnerId: string }>();
  for (const a of allocations) {
    const source = a.bank_statement_line;
    const kif = a.document_type === "KIF";
    const entry = kif ? a.kif_entry : a.kuf_entry;
    const partnerId = kif ? a.kif_entry?.kupac_id : a.kuf_entry?.dobavljac_id;
    const accountId = kif ? source.credit_account_id : source.debit_account_id;
    if (!["KIF", "KUF"].includes(a.document_type) || a.agencija_id !== actor.agencyId || a.firma_id !== actor.companyId || a.poslovna_godina_id !== actor.yearId
      || !entry || entry.is_deleted || entry.agencija_id !== actor.agencyId || entry.firma_id !== actor.companyId || entry.poslovna_godina_id !== actor.yearId
      || !partnerId || partnerId !== source.partner_id || !accountId || source.direction !== (kif ? "INFLOW" : "OUTFLOW") || source.posting_status === "IGNORED" || cents(a.amount) <= BigInt(0)) return false;
    const key = `${accountId}:${partnerId}:${kif}`;
    const group = groups.get(key) ?? { amount: BigInt(0), side: kif ? "P" : "D", accountId, partnerId };
    group.amount += cents(a.amount); groups.set(key, group);
  }
  for (const group of groups.values()) {
    const net = rows.filter(r => r.konto_id === group.accountId && r.komitent_id === group.partnerId)
      .reduce((sum, r) => sum + (group.side === "D" ? cents(r.duguje) - cents(r.potrazuje) : cents(r.potrazuje) - cents(r.duguje)), BigInt(0));
    if (net < group.amount) return false;
  }
  return true;
}

export async function loadManualBankEditor(actor: ManualBankActor, id: string) {
  if (!uuid.test(id)) fail("izvod_greska");
  return prisma.$transaction(async tx => {
    await access(tx, actor, "update");
    const statement = await tx.bankStatement.findFirst({ where: { id, agencija_id: actor.agencyId, firma_id: actor.companyId, poslovna_godina_id: actor.yearId, is_deleted: false }, include: {
      firma: true, poslovna_godina: true, bank_account_konto: true,
      journal: { include: { stavke: { orderBy: { redni_broj: "asc" }, include: { firma_konto: true, komitent: true } } } },
      lines: { orderBy: { line_number: "asc" }, include: { partner: true, debit_account: true, credit_account: true, allocations: true } }
    } });
    if (!statement) fail("izvod_greska");
    if (statement.poslovna_godina.firma_id !== actor.companyId) fail("izvod_greska");
    if (statement.journal_id) await assertBankJournalOwnership(tx, statement);
    if (statement.poslovna_godina.zakljucena) fail("godina_zakljucena");
    if (statement.status === "POSTED" && statement.journal?.status !== "DRAFT" || statement.journal && (statement.journal.is_deleted || statement.journal.status !== "DRAFT")) fail("izvod_greska");
    const [base, overrides, units] = await Promise.all([
      tx.konto.findMany({ where: { aktivan: true, tip_konta: "analiticko" }, orderBy: { sifra: "asc" } }),
      tx.firmaKonto.findMany({ where: { firma_id: actor.companyId }, orderBy: { sifra: "asc" } }),
      tx.poslovnaJedinica.findMany({ where: { firma_id: actor.companyId, agencija_id: actor.agencyId, aktivna: true, is_deleted: false }, orderBy: { sifra: "asc" }, select: { id: true, sifra: true, naziv: true } })
    ]);
    return { statement, accounts: mergeCompanyAccountPlan(base, overrides).filter(a => a.aktivan && a.tip_konta === "analiticko"), units };
  }, { isolationLevel: "RepeatableRead" });
}

export async function saveManualBankJournal(actor: ManualBankActor, form: FormData) {
  let input: ReturnType<typeof parseManualBankLines>;
  try { input = parseManualBankLines(form); } catch (error) { fail(error instanceof Error ? error.message : "stavke_nevalidne"); }
  const date = manualDate(text(form, "datum"));
  if (!date) fail("nalog_datum");
  const description = text(form, "opis");
  if (description.length > 4000) fail("stavke_nevalidne");
  return prisma.$transaction(async tx => {
    const current = await locked(tx, actor, text(form, "statement_id"), "update");
    checkVersion(form, current);
    await checkDate(tx, actor, date);
    await syncLegacyBankStatementDraft(tx, actor, current);
    const unitId = text(form, "poslovna_jedinica_id") || null;
    if (unitId && (!uuid.test(unitId) || !await tx.poslovnaJedinica.findFirst({ where: { id: unitId, firma_id: actor.companyId, agencija_id: actor.agencyId, aktivna: true, is_deleted: false } }))) fail("poslovna_jedinica_obavezna");
    const rows: Array<Prisma.StavkaNalogaCreateManyInput> = [];
    for (const line of input) {
      const acct = await account(tx, actor, line.accountCode);
      if (acct.koristi_radnu_jedinicu && !unitId) fail("poslovna_jedinica_obavezna");
      if (acct.analitika_obavezna && !line.partnerId) fail("partner_obavezan");
      if (line.partnerId && (!uuid.test(line.partnerId) || !await tx.komitent.findFirst({ where: { id: line.partnerId, aktivan: true, OR: [
        { scope: "GLOBAL" }, { scope: "AGENCY", agencija_id: actor.agencyId }, { scope: "COMPANY", agencija_id: actor.agencyId, firma_id: actor.companyId }
      ] } }))) fail("partner_obavezan");
      rows.push({ nalog_id: "", konto_id: acct.id, komitent_id: line.partnerId, poslovna_jedinica_id: unitId,
        duguje: decimal(line.debit), potrazuje: decimal(line.credit), opis: line.description,
        broj_dokumenta: line.documentNumber, datum_dokumenta: line.documentDate, datum_valute: line.dueDate,
        redni_broj: rows.length + 1, created_by: actor.userId, updated_by: actor.userId });
    }
    const before = current;
    const priorAllocations = await tx.bankStatementLineAllocation.findMany({ where: { bank_statement_line: { bank_statement_id: current.statement.id } } });
    const ledger = rows.map(r => ({ konto_id: r.konto_id, komitent_id: r.komitent_id ?? null, duguje: String(r.duguje), potrazuje: String(r.potrazuje) }));
    if (text(form, "clear_allocations") === "1") {
      await tx.bankStatementLineAllocation.deleteMany({ where: { bank_statement_line: { bank_statement_id: current.statement.id } } });
      for (const id of new Set(priorAllocations.map(a => a.kif_entry_id).filter((id): id is string => Boolean(id)))) await refreshBankInvoicePayment(tx, "KIF", id, actor.userId);
      for (const id of new Set(priorAllocations.map(a => a.kuf_entry_id).filter((id): id is string => Boolean(id)))) await refreshBankInvoicePayment(tx, "KUF", id, actor.userId);
    } else if (!await manualBankAllocationsValid(tx, actor, current.statement.id, ledger)) fail("izvod_veze_faktura");
    const now = new Date(Math.max(Date.now(), current.statement.updated_at.getTime() + 1, (current.journal?.updated_at.getTime() ?? 0) + 1));
    let journalId = current.journal?.id;
    if (!journalId) {
      const setting = await effectiveBankSetting(tx, actor.companyId, current.statement.company_bank_account_id, true);
      const type = setting?.journal_type ?? await tx.vrstaNaloga.findFirst({ where: { sifra: "BANK_STATEMENT", aktivan: true } });
      if (!type || !type.aktivan) fail("izvod_greska");
      if (type.agencija_id && type.agencija_id !== actor.agencyId || type.firma_id && type.firma_id !== actor.companyId) fail("izvod_greska");
      const number = Number(current.statement.statement_number);
      if (!/^\d+$/.test(current.statement.statement_number) || !Number.isSafeInteger(number) || number <= 0 || number > 2147483647) fail("izvod_broj_naloga_greska");
      if (await tx.nalog.findFirst({ where: { firma_id: actor.companyId, poslovna_godina_id: actor.yearId, vrsta_naloga_id: type.id, broj: number } })) fail("izvod_broj_naloga_zauzet");
      const year = await tx.poslovnaGodina.findUniqueOrThrow({ where: { id: actor.yearId } });
      const created = await tx.nalog.create({ data: { agencija_id: actor.agencyId, firma_id: actor.companyId, poslovna_godina_id: actor.yearId,
        vrsta_naloga_id: type.id, broj: number, sifra: formatJournalCode(type.prefiks, year.godina, number), datum: date,
        opis: description, poslovna_jedinica_id: unitId, status: "DRAFT", source_type: "BANK_STATEMENT", source_module: "IZVODI", izvorni_dokument_id: current.statement.id,
        kreirao_korisnik_id: actor.userId, created_by: actor.userId, updated_by: actor.userId, updated_at: now } });
      journalId = created.id;
    }
    await tx.stavkaNaloga.deleteMany({ where: { nalog_id: journalId } });
    const savedRows = rows.map(row => ({ ...row, nalog_id: journalId }));
    await tx.stavkaNaloga.createMany({ data: savedRows });
    await tx.nalog.update({ where: { id: journalId }, data: { datum: date, opis: description, poslovna_jedinica_id: unitId, updated_by: actor.userId, updated_at: now } });
    const debit = input.reduce((sum, r) => sum + r.debit, BigInt(0)), credit = input.reduce((sum, r) => sum + r.credit, BigInt(0));
    await tx.bankStatement.update({ where: { id: current.statement.id }, data: { journal_id: journalId, journal_mode: "MANUAL", status: debit > BigInt(0) && debit === credit ? "READY" : "NEEDS_REVIEW",
      posted_at: null, posted_by: null, updated_by: actor.userId, updated_at: now } });
    await auditLogInTransaction(tx, { korisnikId: actor.userId, agencijaId: actor.agencyId, firmaId: actor.companyId, modul: "agencija.izvodi",
      akcija: "manual_journal_save", tipEntiteta: "BankStatement", entitetId: current.statement.id,
      staraVrijednost: { ...before, allocations: priorAllocations }, novaVrijednost: { journalId, journalMode: "MANUAL", date, description, unitId, rows: savedRows, clearAllocations: text(form, "clear_allocations") === "1" } });
    return journalId;
  }, { timeout: 30000 });
}

export async function postManualBankJournalInTransaction(tx: Prisma.TransactionClient, actor: ManualBankActor, statementId: string, form?: FormData) {
  const current = await locked(tx, actor, statementId, "post");
  if (form) checkVersion(form, current);
  const { statement, journal } = current;
  if (statement.journal_mode !== "MANUAL" || !journal || journal.status !== "DRAFT") fail("izvod_greska");
  await checkDate(tx, actor, journal.datum);
  const rows = await tx.stavkaNaloga.findMany({ where: { nalog_id: journal.id }, include: { firma_konto: true } });
  const debit = rows.reduce((sum, r) => sum + cents(r.duguje), BigInt(0)), credit = rows.reduce((sum, r) => sum + cents(r.potrazuje), BigInt(0));
  if (debit <= BigInt(0) || debit !== credit) fail("nalog_nije_balansiran");
  for (const row of rows) {
    const acct = row.firma_konto;
    if (acct.firma_id !== actor.companyId || !acct.aktivan || acct.override_type === "DEACTIVATED" || acct.tip_konta !== "analiticko" || acct.sifra.length < 4) fail("konto_nevalidno");
    if (cents(row.duguje) < BigInt(0) || cents(row.potrazuje) < BigInt(0) || (cents(row.duguje) === BigInt(0)) === (cents(row.potrazuje) === BigInt(0))) fail("stavka_iznos");
    if (acct.analitika_obavezna && !row.komitent_id) fail("partner_obavezan");
    if (row.komitent_id && !await tx.komitent.findFirst({ where: { id: row.komitent_id, aktivan: true, OR: [
      { scope: "GLOBAL" }, { scope: "AGENCY", agencija_id: actor.agencyId }, { scope: "COMPANY", agencija_id: actor.agencyId, firma_id: actor.companyId }
    ] } })) fail("partner_obavezan");
    if (acct.koristi_radnu_jedinicu && (!row.poslovna_jedinica_id || !await tx.poslovnaJedinica.findFirst({ where: { id: row.poslovna_jedinica_id, firma_id: actor.companyId, agencija_id: actor.agencyId, aktivna: true, is_deleted: false } }))) fail("poslovna_jedinica_obavezna");
  }
  if (!await manualBankAllocationsValid(tx, actor, statementId, rows)) fail("izvod_veze_faktura");
  const now = new Date(Math.max(Date.now(), statement.updated_at.getTime() + 1, journal.updated_at.getTime() + 1));
  await tx.nalog.update({ where: { id: journal.id }, data: { status: "POSTED", datum_knjizenja: now, proknjizen_at: now, proknjizen_by: actor.userId, updated_by: actor.userId, updated_at: now } });
  await tx.bankStatement.update({ where: { id: statementId }, data: { status: "POSTED", posted_at: now, posted_by: actor.userId, updated_by: actor.userId, updated_at: now } });
  await postBankSettlements(tx, actor, statementId);
  await refreshBankPaymentStatuses(tx, statementId, actor.userId);
  await auditLogInTransaction(tx, { korisnikId: actor.userId, agencijaId: actor.agencyId, firmaId: actor.companyId, modul: "agencija.izvodi", akcija: "manual_journal_post", tipEntiteta: "BankStatement", entitetId: statementId,
    staraVrijednost: { statement, journal }, novaVrijednost: { journalId: journal.id, rows, status: "POSTED" } });
  return journal.id;
}

export async function postManualBankJournal(actor: ManualBankActor, form: FormData) {
  return prisma.$transaction(tx => postManualBankJournalInTransaction(tx, actor, text(form, "statement_id"), form), { timeout: 30000 });
}
