import Link from "next/link";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { hasDirectPortalPermission } from "@/lib/direct-portal-policy";
import { loadDirectPortalReportOptions, parseDirectPortalReportFilters, directPortalReportQuery, type DirectPortalReportSearchParams } from "@/lib/direct-portal-reports";
import { loadFiscalReportPage, fiscalReportPage } from "@/lib/fiscal-report-page";
import { DirectPortalReportFilters } from "./DirectPortalReportFilters";
import { FiscalJournal } from "./FiscalJournal";
import { posMoney } from "@/lib/pos-reports";

export async function PortalFiscalJournal({ kind, params }: { kind: "zurnal" | "korekcije"; params: DirectPortalReportSearchParams }) {
  const context = await requireDirectPortalContext({ modul: "izvjestaji", akcija: "view" }, `/portal/izvjestaji/${kind}`);
  const filters = parseDirectPortalReportFilters(params, context.year);
  const [report, options] = await Promise.all([loadFiscalReportPage(context, filters, fiscalReportPage(params.strana), kind), loadDirectPortalReportOptions(context)]);
  const query = directPortalReportQuery(filters);
  return <div className="admin-stack"><header className="admin-header"><h2>{kind === "zurnal" ? "Elektronski žurnal" : "Korektivni žurnal"}</h2><Link className="secondary-button" href="/portal/izvjestaji">Svi izvještaji</Link></header>
    <DirectPortalReportFilters kind={kind} filters={filters} options={options} canExport={hasDirectPortalPermission(context.permissionKeys,{modul:"izvjestaji",akcija:"export"})}/>
    <section className="admin-panel"><p>{report.totals.count} dokumenata · Promet nakon korekcija: {posMoney(report.totals.gross)} € · strana {report.page} od {report.pages}</p><FiscalJournal documents={report.documents} surface="PORTAL"/><div className="header-actions">
      {report.page > 1 ? <Link className="secondary-button" href={`?${query}&strana=${report.page-1}`}>Prethodna</Link> : null}
      {report.page < report.pages ? <Link className="secondary-button" href={`?${query}&strana=${report.page+1}`}>Sljedeća</Link> : null}
    </div></section>
  </div>;
}
