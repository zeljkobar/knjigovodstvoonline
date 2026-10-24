import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { auditLogInTransaction } from "./audit";
import { postedMonthlyPayrollLines } from "./payroll-monthly-tax";

export class PayrollJournalError extends Error {}
export type PayrollJournalActor = { userId: string; agencyId: string };

export async function assertPayrollJournalAccess(
  db: Prisma.TransactionClient,
  actor: PayrollJournalActor,
  companyId: string,
  journalAction?: "update" | "post"
) {
  // Match the copy workflow's user -> year -> calculation -> journal lock order.
  await db.$queryRaw`SELECT id FROM korisnici WHERE id=${actor.userId}::uuid FOR UPDATE`;
  const user = await db.korisnik.findFirst({ where: {
    id: actor.userId, agencija_id: actor.agencyId, aktivan: true, is_deleted: false,
    rola: { in: ["admin_agencije", "korisnik_agencije"] },
    agencija: { aktivan: true, is_deleted: false }
  } });
  const firm = await db.firma.findFirst({ where: {
    id: companyId, agencija_id: actor.agencyId, aktivan: true, is_deleted: false
  } });
  if (!user || !firm) throw new PayrollJournalError("prava");
  if (user.rola !== "admin_agencije") {
    const assignment = await db.korisnikFirma.findFirst({ where: {
      korisnik_id: user.id, firma_id: firm.id, is_deleted: false
    } });
    if (!assignment) throw new PayrollJournalError("prava");
    const checks = [
      { modul: "plate", akcija: "post" },
      ...(journalAction ? [{ modul: "nalozi", akcija: journalAction }] : [])
    ];
    for (const check of checks) {
      const permission = await db.korisnikPravo.findFirst({ where: {
        agencija_id: actor.agencyId, korisnik_id: user.id, firma_id: firm.id,
        ...check, dozvoljeno: true
      } });
      if (!permission) throw new PayrollJournalError("prava");
    }
  }
}

export async function reopenPayrollJournal(actor: PayrollJournalActor, journalId: string) {
  return prisma.$transaction(async db => {
    const source = await db.nalog.findFirst({ where: {
      id: journalId, agencija_id: actor.agencyId, source_module: "PLATE",
      source_type: "PAYROLL", is_deleted: false
    } });
    if (!source) throw new PayrollJournalError("nalog_greska");
    await assertPayrollJournalAccess(db, actor, source.firma_id, "update");
    await db.$queryRaw`SELECT id FROM poslovne_godine WHERE id=${source.poslovna_godina_id}::uuid FOR UPDATE`;
    const year = await db.poslovnaGodina.findFirst({ where: {
      id: source.poslovna_godina_id, firma_id: source.firma_id
    } });
    if (!year || year.zakljucena) throw new PayrollJournalError("godina_zakljucena");
    await db.$queryRaw`SELECT id FROM plate_obracuni WHERE nalog_id=${journalId}::uuid FOR UPDATE`;
    await db.$queryRaw`SELECT id FROM nalozi WHERE id=${journalId}::uuid FOR UPDATE`;
    const journal = await db.nalog.findFirst({ where: {
      id: journalId, agencija_id: actor.agencyId, is_deleted: false
    } });
    if (!journal || journal.source_module !== "PLATE" || journal.source_type !== "PAYROLL" ||
        journal.firma_id !== source.firma_id || journal.poslovna_godina_id !== year.id ||
        !journal.izvorni_dokument_id) throw new PayrollJournalError("nalog_greska");
    const calculation = await db.plateObracun.findFirst({ where: {
      nalog_id: journal.id, id: journal.izvorni_dokument_id, agencija_id: actor.agencyId,
      firma_id: journal.firma_id, poslovna_godina_id: year.id, is_deleted: false
    }, include: { stavke: true } });
    if (!calculation || calculation.status === "LOCKED" || calculation.locked_at) {
      throw new PayrollJournalError("nalog_greska");
    }
    const periods = await db.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM pdv_periodi WHERE firma_id=${journal.firma_id}::uuid
      AND ((datum_od<=${journal.datum}::date AND datum_do>=${journal.datum}::date)
        OR (datum_od<=${calculation.datum_obracuna}::date AND datum_do>=${calculation.datum_obracuna}::date))
      FOR UPDATE`;
    if (periods.some(p => p.status === "LOCKED")) throw new PayrollJournalError("pdv_period_zakljucan");
    if (journal.status === "DRAFT" && calculation.status === "CALCULATED") {
      return { calculationId: calculation.id, existing: true };
    }
    if (journal.status !== "POSTED" || calculation.status !== "POSTED") {
      throw new PayrollJournalError("nalog_greska");
    }
    if (await db.osPromjena.findFirst({ where: {
      izvorni_nalog_id: journal.id, status: "CONFIRMED", is_deleted: false
    } })) throw new PayrollJournalError("nalog_greska");

    // Later monthly calculations may have consumed the original progressive tax base.
    const originalLines = new Set(calculation.stavke.map(line => line.id));
    const workers = new Set(calculation.stavke.map(line => line.radnik_id));
    const otherLines = await postedMonthlyPayrollLines(db, calculation);
    const dependent = otherLines.some(line => {
      if (!workers.has(line.radnik_id)) return false;
      const key = (line.detalji as Record<string, unknown> | null)?.monthlyHistoryKey;
      if (typeof key !== "string") return true;
      try {
        const rows: unknown = JSON.parse(key);
        return !Array.isArray(rows) || rows.some(row =>
          !Array.isArray(row) || originalLines.has(String(row[0])));
      } catch { return true; }
    });
    if (dependent) throw new PayrollJournalError("plate_zavisni_obracun");

    await db.nalog.update({ where: { id: journal.id }, data: {
      status: "DRAFT", proknjizen_at: null, proknjizen_by: null,
      vracen_u_nacrt_at: new Date(), vracen_u_nacrt_by: actor.userId, updated_by: actor.userId
    } });
    await db.plateObracun.update({ where: { id: calculation.id }, data: {
      status: "CALCULATED", posted_at: null, posted_by: null, updated_by: actor.userId
    } });
    await auditLogInTransaction(db, {
      korisnikId: actor.userId, agencijaId: actor.agencyId, firmaId: journal.firma_id,
      modul: "plate", akcija: "reopen_payroll", tipEntiteta: "PlateObracun", entitetId: calculation.id,
      staraVrijednost: {
        status: calculation.status, journalId: journal.id,
        journalStatus: journal.status, postedAt: calculation.posted_at
      },
      novaVrijednost: { status: "CALCULATED", journalId: journal.id, journalStatus: "DRAFT" }
    });
    return { calculationId: calculation.id, existing: false };
  });
}
