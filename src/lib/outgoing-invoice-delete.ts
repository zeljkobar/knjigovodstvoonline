import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { auditLogInTransaction } from "./audit";

export async function deleteOutgoingInvoiceDraftDocument(scope: {
  agencijaId: string; firmaId: string; yearId: string; userId: string;
}, id: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`outgoing-invoice:${id}`}))`);
    const invoice = await tx.fiskalniIzlazniRacun.findFirst({
      where: { id, agencija_id: scope.agencijaId, firma_id: scope.firmaId, poslovna_godina_id: scope.yearId, sales_channel: "OFFICE", document_type: "INVOICE", is_deleted: false },
      include: { poslovna_godina: true, _count: { select: { fiskalni_pokusaji: true, placanja: true, corrective_invoices: true } }, pos_kif_membership: true }
    });
    if (!invoice) return "nije_nacrt";
    if (invoice.poslovna_godina.zakljucena) return "zakljucana";
    if (invoice.status !== "DRAFT" || !["DRAFT", "NOT_REQUIRED"].includes(invoice.fiscal_status)
      || invoice.nalog_id || invoice.kif_entry_id || invoice.posted_at || invoice.issued_at
      || invoice.fiscal_api_invoice_id || invoice.iic || invoice.jikr || invoice.fiscalized_at
      || invoice.last_fiscal_attempt_at || invoice.original_invoice_id || invoice.pos_kif_membership
      || invoice._count.fiskalni_pokusaji || invoice._count.placanja || invoice._count.corrective_invoices) return "brisanje_nedozvoljeno";
    const period = await tx.pdvPeriod.findFirst({ where: { firma_id: scope.firmaId, poslovna_godina_id: scope.yearId, mjesec: invoice.datum_racuna.getUTCMonth() + 1 }, select: { status: true } });
    if (period?.status === "LOCKED") return "pdv_period";
    const movement = await tx.prometZaliha.findFirst({ where: { firma_id: scope.firmaId, dokument_id: id }, select: { id: true } });
    if (movement) return "brisanje_nedozvoljeno";
    await tx.fiskalniIzlazniRacun.update({ where: { id }, data: { is_deleted: true, deleted_at: new Date(), deleted_by: scope.userId, updated_by: scope.userId } });
    await auditLogInTransaction(tx, { korisnikId: scope.userId, agencijaId: scope.agencijaId, firmaId: scope.firmaId, modul: "robno", akcija: "delete", tipEntiteta: "FiskalniIzlazniRacun", entitetId: id, staraVrijednost: { status: invoice.status, interni_broj: invoice.interni_broj, is_deleted: false }, novaVrijednost: { is_deleted: true } });
    return "obrisana";
  });
}
