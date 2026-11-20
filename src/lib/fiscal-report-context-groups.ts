import type { DirectPortalReport } from "./direct-portal-reports";

export type FiscalContextReportKind = "operateri" | "uredjaji" | "jedinice";
export const fiscalContextReportTitles = { operateri: "Promet po operaterima", uredjaji: "Promet po ENU uređajima", jedinice: "Promet po poslovnim jedinicama" };
export const fiscalContextSheetNames = { operateri: "Operateri", uredjaji: "ENU uređaji", jedinice: "Poslovne jedinice" };
export function isFiscalContextReportKind(value: unknown): value is FiscalContextReportKind {
  return value === "operateri" || value === "uredjaji" || value === "jedinice";
}

/** Codes are company/environment scoped. An ENU code is additionally scoped to its unit. */
export function fiscalContextRows(documents: DirectPortalReport["documents"], kind: FiscalContextReportKind) {
  const rows = new Map<string, { id: string; code: string | null; unitCode: string | null; historical: boolean; ordinaryCount: number; correctionCount: number; sales: bigint; corrections: bigint; base: bigint; vat: bigint; gross: bigint }>();
  for (const document of documents) {
    const context = document.fiscalContext;
    const code = context ? kind === "operateri" ? context.operatorCode : kind === "uredjaji" ? context.deviceCode : context.businessUnitCode : null;
    const unitCode = context && kind === "uredjaji" ? context.businessUnitCode : null;
    const key = context ? JSON.stringify([context.apiCompanyId,context.environment,code,unitCode]) : "not-recorded";
    const row = rows.get(key) ?? { id: key, code, unitCode, historical: Boolean(context), ordinaryCount: 0, correctionCount: 0, sales: BigInt(0), corrections: BigInt(0), base: BigInt(0), vat: BigInt(0), gross: BigInt(0) };
    if (document.correction) { row.correctionCount++; row.corrections += document.gross; }
    else { row.ordinaryCount++; row.sales += document.gross; }
    row.base += document.base; row.vat += document.vat; row.gross += document.gross;
    rows.set(key,row);
  }
  return [...rows.values()].sort((a,b) => a.historical !== b.historical ? a.historical ? -1 : 1 : a.gross === b.gross ? a.id.localeCompare(b.id) : a.gross > b.gross ? -1 : 1);
}
