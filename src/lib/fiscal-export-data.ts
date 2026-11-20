import { prisma } from "./prisma";
import { loadDirectPortalReport, reportWhere, type FiscalReportContext, type DirectPortalReportFilters, type DirectPortalReportKind } from "./direct-portal-reports";

/** The same bounded snapshot contract for portal and agency exports. */
export async function loadBoundedFiscalExport(context: FiscalReportContext, filters: DirectPortalReportFilters, kind: DirectPortalReportKind) {
  return prisma.$transaction(async db => {
    const where = reportWhere(context, filters, kind);
    const [count, lines] = await Promise.all([
      db.fiskalniIzlazniRacun.count({ where }),
      db.stavkaIzlazneFakture.count({ where: { izlazna_faktura: where } })
    ]);
    if (count > 5000 || lines > 50000) return null;
    if (kind === "avansi") {
      const usages = await db.fiskalniIzlazniRacun.count({ where: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, avansni_racun: where } });
      if (usages > 5000) return null;
    }
    return loadDirectPortalReport(context, filters, kind, undefined, db);
  }, { isolationLevel: "RepeatableRead", timeout: 30000 });
}
