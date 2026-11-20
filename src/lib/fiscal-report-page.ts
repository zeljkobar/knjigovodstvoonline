import { prisma } from "./prisma";
import { decimalToScaled } from "./inventory-calculation";
import { loadDirectPortalReport, reportWhere, type FiscalReportContext, type DirectPortalReportFilters } from "./direct-portal-reports";

export function fiscalReportPage(value: unknown) {
  return typeof value === "string" && /^[1-9]\d{0,5}$/.test(value) ? Number(value) : 1;
}

/** SQL totals and a bounded document page from one consistent database snapshot. */
export async function loadFiscalReportPage(context: FiscalReportContext, filters: DirectPortalReportFilters, requestedPage: number, kind: "promet" | "zurnal" | "korekcije" = "promet") {
  return prisma.$transaction(async db => {
    const where = reportWhere(context, filters, kind);
    const correction = { OR: [
      { original_invoice_id: { not: null } },
      { document_type: { in: ["OFFICE_STORNO", "POS_RETURN"] } },
      { vrsta_racuna: "CORRECTIVE" }
    ] };
    const sum = { ukupno_osnovica: true, ukupno_izlazni_pdv: true, ukupno_sa_pdv: true } as const;
    const [sales, corrections, taxes] = await Promise.all([
      db.fiskalniIzlazniRacun.aggregate({ where: { AND: [where, { NOT: correction }] }, _sum: sum, _count: true }),
      db.fiskalniIzlazniRacun.aggregate({ where: { AND: [where, correction] }, _sum: sum, _count: true }),
      db.fiskalniIzlazniRacunPorez.groupBy({ by: ["vat_rate_code", "vat_rate_name", "vat_rate_percent"],
        where: { fiskalni_izlazni_racun: where },
        _sum: { tax_base: true, output_vat_amount: true, total_with_vat: true } })
    ]);
    const count = sales._count + corrections._count;
    const pages = Math.max(1, Math.ceil(count / 50));
    const page = Math.min(pages, Math.max(1, Number.isSafeInteger(requestedPage) ? requestedPage : 1));
    const documents = (await loadDirectPortalReport(context, filters, kind, { skip: (page - 1) * 50, take: 50 }, db)).documents;
    const cents = (value: { toString(): string } | null) => value ? decimalToScaled(value, 2) : BigInt(0);
    return {
      page, pages, documents,
      totals: { count, ordinaryCount: sales._count, correctionCount: corrections._count,
        salesGross: cents(sales._sum.ukupno_sa_pdv), correctionsGross: cents(corrections._sum.ukupno_sa_pdv),
        base: cents(sales._sum.ukupno_osnovica) + cents(corrections._sum.ukupno_osnovica),
        vat: cents(sales._sum.ukupno_izlazni_pdv) + cents(corrections._sum.ukupno_izlazni_pdv),
        gross: cents(sales._sum.ukupno_sa_pdv) + cents(corrections._sum.ukupno_sa_pdv) },
      taxes: taxes.map(tax => ({ code: tax.vat_rate_code, name: tax.vat_rate_name, rate: tax.vat_rate_percent.toString(),
        base: cents(tax._sum.tax_base), vat: cents(tax._sum.output_vat_amount), gross: cents(tax._sum.total_with_vat) }))
        .sort((a,b) => Number(b.rate) - Number(a.rate))
    };
  }, { isolationLevel: "RepeatableRead" });
}
