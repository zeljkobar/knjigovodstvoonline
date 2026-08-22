import { Prisma } from "@prisma/client";

type Row = { table_name: string };
type LockedRequest = { id: string; firma_id: string; source_agencija_id: string; target_agencija_id: string; status: string };

export async function approveCompanyAgencyTransfer(tx: Prisma.TransactionClient, requestId: string, adminId: string) {
  const requests = await tx.$queryRaw<LockedRequest[]>(Prisma.sql`
    SELECT id, firma_id, source_agencija_id, target_agencija_id, status
    FROM firma_agency_transfer_requests
    WHERE id = ${requestId}::uuid FOR UPDATE
  `);
  const request = requests[0];
  if (!request || request.status !== "PENDING") throw new Error("TRANSFER_REQUEST_INVALID");

  const company = await tx.firma.findFirst({
    where: { id: request.firma_id, agencija_id: request.source_agencija_id, is_deleted: false, agencija: { is_fiscal_direct_container: true }, fiscalCompanyLink: { isNot: null } },
    select: { id: true, pib: true, korisnici: { where: { is_deleted: false, access_type: { in: ["FISCAL_CLIENT", "FISCAL_OPERATOR"] } }, select: { korisnik_id: true } } }
  });
  const target = await tx.agencija.findFirst({ where: { id: request.target_agencija_id, aktivan: true, is_deleted: false, is_fiscal_direct_container: false }, select: { id: true } });
  if (!company || !target) throw new Error("TRANSFER_SCOPE_INVALID");
  if (company.pib && await tx.firma.findFirst({ where: { agencija_id: target.id, pib: company.pib, is_deleted: false }, select: { id: true } })) throw new Error("TRANSFER_TARGET_DUPLICATE");

  const tables = await tx.$queryRaw<Row[]>(Prisma.sql`
    SELECT c1.table_name
    FROM information_schema.columns c1
    JOIN information_schema.columns c2 ON c2.table_schema = c1.table_schema AND c2.table_name = c1.table_name
    WHERE c1.table_schema = 'public' AND c1.column_name = 'firma_id' AND c2.column_name = 'agencija_id' AND c1.table_name <> 'firme'
    ORDER BY c1.table_name
  `);
  for (const { table_name: table } of tables) {
    if (!/^[a-z0-9_]+$/.test(table)) throw new Error("TRANSFER_TABLE_INVALID");
    await tx.$executeRawUnsafe(`UPDATE "${table}" SET "agencija_id" = $1::uuid WHERE "firma_id" = $2::uuid`, target.id, company.id);
  }

  await tx.firma.update({ where: { id: company.id }, data: { agencija_id: target.id, updated_by: adminId } });
  const userIds = company.korisnici.map((item) => item.korisnik_id);
  if (userIds.length) {
    await tx.korisnik.updateMany({ where: { id: { in: userIds }, agencija_id: request.source_agencija_id }, data: { agencija_id: target.id, rola: "klijent", updated_by: adminId } });
  }
  await tx.firmaAgencyTransferRequest.update({ where: { id: request.id }, data: { status: "APPROVED", decided_by: adminId, decided_at: new Date() } });
  return { firmaId: company.id, targetAgencyId: target.id };
}
