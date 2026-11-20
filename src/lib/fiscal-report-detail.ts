import { prisma } from "./prisma";
import { reportWhere, type FiscalReportContext, type DirectPortalReportFilters } from "./direct-portal-reports";

export function reportInvoiceId(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value) ? value : null;
}

/** The detail is constrained by the same authorized scope and filters as the list. */
export async function loadFiscalReportDetail(context: FiscalReportContext, filters: DirectPortalReportFilters, value: unknown) {
  const id = reportInvoiceId(value);
  if (!id) return null;
  return prisma.fiskalniIzlazniRacun.findFirst({
    where: { AND: [reportWhere(context, filters, "promet"), { id }] },
    select: {
      id: true, interni_broj: true, official_invoice_number: true, issued_at: true,
      fiscal_status: true, fiscal_environment: true, fiscal_api_invoice_id: true, fiscal_context_snapshot: true, buyer_snapshot: true, issuer_snapshot: true,
      iic: true, jikr: true, original_invoice_id: true, correction_reason: true,
      ukupno_osnovica: true, ukupno_izlazni_pdv: true, ukupno_sa_pdv: true,
      pos_register: { select: { naziv: true, sifra: true } },
      stavke: { orderBy: { redni_broj: "asc" }, select: { id: true, sifra_artikla: true, naziv_artikla: true,
        jedinica_mjere: true, kolicina: true, pdv_stopa_procenat: true, osnovica: true, pdv_iznos: true, ukupno_sa_pdv: true } },
      placanja: { orderBy: { redni_broj: "asc" }, select: { id: true, payment_method: true, amount: true } }
    }
  });
}

export async function loadReportRegisters(context: FiscalReportContext) {
  return prisma.posRegister.findMany({
    where: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, is_deleted: false },
    select: { id: true, sifra: true, naziv: true, aktivan: true }, orderBy: { naziv: "asc" }
  });
}
