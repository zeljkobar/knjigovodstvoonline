import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { decimalToScaled } from "./inventory-calculation";
import { auditLogInTransaction } from "./audit";

export class BankStatementError extends Error {}
export type BankStatementActor = { userId: string; agencyId: string };

// Draft allocations retain the user's selection but do not settle invoices.
export const postedBankAllocationWhere: Prisma.BankStatementLineAllocationWhereInput = {
  bank_statement_line: { bank_statement: {
    status: "POSTED", is_deleted: false,
    journal: { status: "POSTED", is_deleted: false }
  } }
};

export async function assertBankStatementAccess(
  tx: Prisma.TransactionClient, actor: BankStatementActor, companyId: string,
  actions: Array<"update" | "post">, journalAction?: "update"
) {
  const user = await tx.korisnik.findFirst({ where: {
    id: actor.userId, agencija_id: actor.agencyId, aktivan: true, is_deleted: false,
    rola: { in: ["admin_agencije", "korisnik_agencije"] },
    agencija: { aktivan: true, is_deleted: false }
  } });
  const company = await tx.firma.findFirst({ where: {
    id: companyId, agencija_id: actor.agencyId, aktivan: true, is_deleted: false
  } });
  if (!user || !company) throw new BankStatementError("prava");
  if (user.rola === "admin_agencije") return;
  if (!await tx.korisnikFirma.findFirst({ where: {
    korisnik_id: user.id, firma_id: companyId, is_deleted: false
  } })) throw new BankStatementError("prava");
  for (const check of [
    ...actions.map(akcija => ({ modul: "izvodi", akcija })),
    ...(journalAction ? [{ modul: "nalozi", akcija: journalAction }] : [])
  ]) {
    if (!await tx.korisnikPravo.findFirst({ where: {
      agencija_id: actor.agencyId, korisnik_id: user.id, firma_id: companyId,
      ...check, dozvoljeno: true
    } })) throw new BankStatementError("prava");
  }
}

export async function assertBankJournalOwnership(
  tx: Prisma.TransactionClient,
  statement: { id: string; agencija_id: string; firma_id: string; poslovna_godina_id: string; journal_id: string | null }
) {
  const journal = statement.journal_id ? await tx.nalog.findFirst({ where: {
    id: statement.journal_id, agencija_id: statement.agencija_id,
    firma_id: statement.firma_id, poslovna_godina_id: statement.poslovna_godina_id,
    is_deleted: false, source_module: "IZVODI", source_type: "BANK_STATEMENT",
    izvorni_dokument_id: statement.id
  }, include: { stavke: true, _count: { select: {
    bankStatements: true, pdvPrijave: true, plateObracuni: true,
    posAccountingBatches: true, prenosiRobe: true, popisiRobe: true,
    otpisiRobe: true, nivelacijeCijena: true, osPromjene: true
  } }, osObracun: { select: { id: true } }, putniNalog: { select: { id: true } },
  povratDobavljacu: { select: { id: true } } } }) : null;
  if (!journal || journal._count.bankStatements !== 1 ||
      Object.entries(journal._count).some(([key, count]) => key !== "bankStatements" && count > 0) ||
      journal.osObracun || journal.putniNalog || journal.povratDobavljacu ||
      await tx.kifEntry.count({ where: { journal_id: journal.id } }) ||
      await tx.kufEntry.count({ where: { journal_id: journal.id } })) {
    throw new BankStatementError("izvod_nalog_veze");
  }
  return journal;
}

export async function lockBankStatement(
  tx: Prisma.TransactionClient, actor: BankStatementActor,
  scope: { id: string; firma_id: string; poslovna_godina_id: string },
  actions: Array<"update" | "post">, editable = false, journalAction?: "update"
) {
  await tx.$queryRaw`SELECT id FROM firme WHERE id=${scope.firma_id}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM poslovne_godine WHERE id=${scope.poslovna_godina_id}::uuid FOR UPDATE`;
  await assertBankStatementAccess(tx, actor, scope.firma_id, actions, journalAction);
  const year = await tx.poslovnaGodina.findFirst({ where: {
    id: scope.poslovna_godina_id, firma_id: scope.firma_id
  } });
  if (!year || year.zakljucena) throw new BankStatementError("godina_zakljucena");
  await tx.$queryRaw`SELECT id FROM bank_statements WHERE id=${scope.id}::uuid FOR UPDATE`;
  const statement = await tx.bankStatement.findFirst({ where: {
    id: scope.id, firma_id: scope.firma_id, poslovna_godina_id: scope.poslovna_godina_id,
    agencija_id: actor.agencyId, is_deleted: false
  } });
  if (!statement) throw new BankStatementError("izvod_greska");
  if (statement.journal_id) {
    await tx.$queryRaw`SELECT id FROM nalozi WHERE id=${statement.journal_id}::uuid FOR UPDATE`;
  }
  const journal = statement.journal_id ? await assertBankJournalOwnership(tx, statement) : null;
  if (editable && (statement.status === "POSTED" || (journal && journal.status !== "DRAFT"))) {
    throw new BankStatementError("izvod_greska");
  }
  const periods = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT status FROM pdv_periodi WHERE firma_id=${scope.firma_id}::uuid
    AND ((datum_od<=${statement.statement_date}::date AND datum_do>=${statement.statement_date}::date)
      OR (datum_od<=${journal?.datum ?? statement.statement_date}::date AND datum_do>=${journal?.datum ?? statement.statement_date}::date))
    FOR UPDATE`;
  if (periods.some(period => period.status === "LOCKED")) throw new BankStatementError("pdv_period_zakljucan");
  return { statement, journal };
}

export async function refreshBankPaymentStatuses(tx: Prisma.TransactionClient, statementId: string, userId: string) {
  const allocations = await tx.bankStatementLineAllocation.findMany({ where: {
    bank_statement_line: { bank_statement_id: statementId }
  }, select: { kif_entry_id: true, kuf_entry_id: true } });
  for (const type of ["KIF", "KUF"] as const) {
    const ids = new Set(allocations.map(a => type === "KIF" ? a.kif_entry_id : a.kuf_entry_id).filter((id): id is string => Boolean(id)));
    for (const id of ids) await refreshBankInvoicePayment(tx, type, id, userId);
  }
}

export async function refreshBankInvoicePayment(tx: Prisma.TransactionClient, type: "KIF" | "KUF", id: string, userId: string) {
  const entry = type === "KIF" ? await tx.kifEntry.findUnique({ where: { id } }) : await tx.kufEntry.findUnique({ where: { id } });
  if (!entry) return;
  const sum = await tx.bankStatementLineAllocation.aggregate({ where: {
    ...postedBankAllocationWhere, ...(type === "KIF" ? { kif_entry_id: id } : { kuf_entry_id: id })
  }, _sum: { amount: true } });
  const paid = Number(decimalToScaled(sum._sum.amount ?? "0", 2));
  const total = Number(decimalToScaled(entry.total_gross, 2));
  const payment_status = paid <= 0 ? "UNPAID" : paid < total ? "PARTIALLY_PAID" : paid === total ? "PAID" : "OVERPAID";
  const data = { payment_status, updated_by: userId };
  if (type === "KIF") await tx.kifEntry.update({ where: { id }, data });
  else await tx.kufEntry.update({ where: { id }, data });
}

export async function reopenBankStatement(
  actor: BankStatementActor,
  target: { statementId?: string; journalId?: string; companyId?: string; yearId?: string }
) {
  if (![target.statementId, target.journalId].filter(Boolean).every(id => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id!)) ||
      (!target.statementId && !target.journalId)) throw new BankStatementError("izvod_greska");
  return prisma.$transaction(async tx => {
    const source = await tx.bankStatement.findFirst({ where: {
      ...(target.statementId ? { id: target.statementId } : { journal_id: target.journalId }),
      agencija_id: actor.agencyId, is_deleted: false,
      ...(target.companyId ? { firma_id: target.companyId } : {}),
      ...(target.yearId ? { poslovna_godina_id: target.yearId } : {})
    } });
    if (!source) throw new BankStatementError("izvod_greska");
    const { statement, journal } = await lockBankStatement(tx, actor, source, ["update", "post"], false, target.journalId ? "update" : undefined);
    if (!journal || (target.journalId && journal.id !== target.journalId)) throw new BankStatementError("izvod_greska");
    if (statement.status !== "POSTED" && journal.status === "DRAFT") return statement;
    if (statement.status !== "POSTED" || journal.status !== "POSTED") throw new BankStatementError("izvod_greska");
    const lines = await tx.bankStatementLine.findMany({ where: { bank_statement_id: statement.id }, include: { allocations: true } });
    await tx.nalog.update({ where: { id: journal.id }, data: {
      status: "DRAFT", datum_knjizenja: null, proknjizen_at: null, proknjizen_by: null,
      vracen_u_nacrt_at: new Date(), vracen_u_nacrt_by: actor.userId, updated_by: actor.userId
    } });
    // A deliberate correction cannot be picked up by the automatic READY queue.
    const reopened = await tx.bankStatement.update({ where: { id: statement.id }, data: {
      status: "NEEDS_REVIEW", posted_at: null, posted_by: null, updated_by: actor.userId
    } });
    await refreshBankPaymentStatuses(tx, statement.id, actor.userId);
    await auditLogInTransaction(tx, {
      korisnikId: actor.userId, agencijaId: actor.agencyId, firmaId: statement.firma_id,
      modul: "agencija.izvodi", akcija: "reopen_statement", tipEntiteta: "BankStatement", entitetId: statement.id,
      staraVrijednost: { statement, journal, lines },
      novaVrijednost: { status: reopened.status, journalId: journal.id, journalStatus: "DRAFT", allocationsActive: false }
    });
    return reopened;
  }, { timeout: 30000 });
}
