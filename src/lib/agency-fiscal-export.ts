import { isFiscalContextReportKind } from "./fiscal-report-context-groups";
import { getAgencyFiscalReportContext } from "./agency-fiscal-report";
import { parseDirectPortalReportFilters, type DirectPortalReportSearchParams, type DirectPortalReportKind } from "./direct-portal-reports";
import { loadBoundedFiscalExport } from "./fiscal-export-data";

/** Shared authorization, filters and consistent snapshot for Excel and A4 export. */
export async function loadAgencyFiscalExport(params: DirectPortalReportSearchParams) {
  const context = await getAgencyFiscalReportContext("export");
  if (!context) return { error: "Nemate pravo izvoza.", status: 403 } as const;
  const filters = parseDirectPortalReportFilters({ od: params.od, do: params.do, kanal: params.kanal, kupac: params.kupac, kasa: params.kasa, okruzenje: params.okruzenje }, context.year);
  if (filters.invalidPeriod) return { error: "Neispravan period izvoza.", status: 400 } as const;
  if (context.channels.length === 1 && (!filters.salesChannel || filters.salesChannel !== context.channels[0])) {
    return { error: "Izaberite kanal za koji imate pravo izvoza.", status: 403 } as const;
  }
  const kind: DirectPortalReportKind = isFiscalContextReportKind(params.tip) ? params.tip : params.tip === "avansi" ? "avansi" : params.tip === "kupci" ? "kupci" : params.tip === "zurnal" ? "zurnal" : params.tip === "korekcije" ? "korekcije" : "promet";
  const generatedAt = new Date();
  const report = await loadBoundedFiscalExport(context, filters, kind);
  if (!report) return { error: "Izvoz je prevelik. Izaberite uži period (najviše 5.000 računa i 50.000 stavki).", status: 413 } as const;
  return { context, filters, report, generatedAt, kind };
}
