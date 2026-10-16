import "server-only";
import { prisma } from "./prisma";

export type InvoiceExecution = { userId: string; agencyId: string; companyId: string; yearId: string; expectedRole?: string };
export async function invoiceExecutionUser(context: InvoiceExecution) {
  const user = await prisma.korisnik.findFirst({
    where: { id: context.userId, agencija_id: context.agencyId, aktivan: true, is_deleted: false,
      rola: { in: ["admin_agencije", "korisnik_agencije"] },
      agencija: { aktivan: true, is_deleted: false, is_fiscal_direct_container: false } },
    include: { agencija: true, firme: { select: { firma_id: true } } }
  });
  if (!user || (context.expectedRole && user.rola !== context.expectedRole)) throw new Error("INVOICE_ACCESS_DENIED");
  return user;
}
