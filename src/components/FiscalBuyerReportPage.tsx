import { FiscalAdvanceTable } from "./FiscalAdvanceTable";
import { loadReportRegisters } from "@/lib/fiscal-report-detail";
import { fiscalContextRows, fiscalContextReportTitles, type FiscalContextReportKind } from "@/lib/fiscal-report-context-groups";
import { FiscalContextTable } from "./FiscalContextTable";
import { fiscalBuyerRows } from "@/lib/fiscal-report-buyers";
import { fiscalReportPage } from "@/lib/fiscal-report-page";
import Link from "next/link";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { hasDirectPortalPermission } from "@/lib/direct-portal-policy";
import { getAgencyFiscalReportContext } from "@/lib/agency-fiscal-report";
import { loadBoundedFiscalExport } from "@/lib/fiscal-export-data";
import { parseDirectPortalReportFilters, directPortalReportQuery, loadDirectPortalReportOptions, type DirectPortalReportSearchParams } from "@/lib/direct-portal-reports";
import { DirectPortalReportFilters } from "./DirectPortalReportFilters";
import { FiscalBuyerTable } from "./FiscalBuyerTable";
import { reportEnvironments } from "@/lib/fiscal-report-policy";
import { posMoney } from "@/lib/pos-reports";

export async function FiscalBuyerReportPage({ params, portal = false }: { params: DirectPortalReportSearchParams; portal?: boolean }) {
  return FiscalGroupedReportPage({params,portal,kind:"kupci"});
}

export async function FiscalGroupedReportPage({ params, portal = false, kind }: { params: DirectPortalReportSearchParams; portal?: boolean; kind: "kupci" | "avansi" | FiscalContextReportKind }) {
  const context = portal ? await requireDirectPortalContext({modul:"izvjestaji",akcija:"view"},`/portal/izvjestaji/${kind}`) : await getAgencyFiscalReportContext();
  if (!context) return <section className="admin-panel">Izaberite firmu i godinu za koju imate pravo pregleda prodaje.</section>;
  const filterParams = portal ? params : { od: params.od, do: params.do, kanal: params.kanal, kupac: params.kupac, kasa: params.kasa, okruzenje: params.okruzenje };
  const filters = parseDirectPortalReportFilters(filterParams, context.year);
  if ("channels" in context && context.channels.length === 1) filters.salesChannel = context.channels[0];
  const registers = "channels" in context && context.channels.includes("POS") ? await loadReportRegisters(context) : [];
  const query = `${directPortalReportQuery(filters)}&tip=${kind}`;
  // Full bounded snapshot: never aggregate just a document page and label it as the full period.
  const report = filters.invalidPeriod ? null : await loadBoundedFiscalExport(context,filters,kind);
  const pages = report ? Math.max(1,Math.ceil((kind === "avansi" ? report.advances : kind === "kupci" ? fiscalBuyerRows(report.documents) : fiscalContextRows(report.documents,kind)).length/50)) : 1;
  const page = Math.min(pages,fiscalReportPage(params.strana));
  return <div className="admin-stack"><header className="admin-header"><h2>{kind === "avansi" ? "Avansi i korišćenje" : kind === "kupci" ? "Promet po kupcima" : fiscalContextReportTitles[kind]}</h2><Link className="secondary-button" href={portal ? "/portal/izvjestaji" : "/agencija/pos/promet"}>Svi izvještaji</Link></header>
    {portal && "permissionKeys" in context ? <DirectPortalReportFilters kind={kind} filters={filters} options={await loadDirectPortalReportOptions(context)} canExport={hasDirectPortalPermission(context.permissionKeys,{modul:"izvjestaji",akcija:"export"})}/> : <section className="admin-panel"><form method="get" className="portal-filter-form">
      <label>Od<input name="od" type="date" defaultValue={filters.periodFrom}/></label><label>Do<input name="do" type="date" defaultValue={filters.periodTo}/></label>
      <label>Kanal<select name="kanal" defaultValue={filters.salesChannel}>{"channels" in context && context.channels.length > 1 ? <option value="">Sva prodaja</option> : null}{"channels" in context ? context.channels.map(channel => <option key={channel} value={channel}>{channel === "POS" ? "POS" : "Fakture"}</option>) : null}</select></label>
      <label>Okruženje<select name="okruzenje" defaultValue={filters.environment}>{Object.entries(reportEnvironments).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>POS kasa<select name="kasa" defaultValue={filters.registerId}><option value="">Sve / bez POS kase</option>{registers.map(register => <option key={register.id} value={register.id}>{register.sifra} · {register.naziv}{register.aktivan ? "" : " (neaktivna)"}</option>)}</select></label>
      <label>Kupac<input name="kupac" defaultValue={filters.buyer} placeholder="Naziv ili PIB"/></label><button className="primary-button" type="submit">Prikaži</button></form>
      <div className="header-actions"><Link className="secondary-button" prefetch={false} href={`/agencija/pos/promet/export?format=pdf&${query}`}>Preuzmi PDF</Link><Link className="secondary-button" href={`/agencija/fiskalna-dostava?${query}`}>Pošalji mejlom</Link><Link className="secondary-button" prefetch={false} href={`/agencija/pos/promet/export?${query}`}>Preuzmi Excel</Link><Link className="secondary-button" prefetch={false} target="_blank" href={`/stampa/pos/promet?${query}`}>A4 / PDF</Link></div></section>}
    <section className="admin-panel">{!report ? <p role="alert">{filters.invalidPeriod ? "Neispravan period. Unesite važeće datume." : "Obuhvat je prevelik. Izaberite uži period (najviše 5.000 računa i 50.000 stavki)."}</p> : <><p>{reportEnvironments[filters.environment ?? "Production"]} · {report.totals.count} dokumenata · {kind === "avansi" ? "Iznos avansnih računa" : "Promet nakon korekcija"}: {posMoney(report.totals.gross)} €</p>{kind === "avansi" ? <FiscalAdvanceTable report={report} page={page}/> : kind === "kupci" ? <FiscalBuyerTable documents={report.documents} page={page}/> : <FiscalContextTable documents={report.documents} kind={kind} page={page}/>}<p>Strana {page} od {pages} · do 50 redova po strani</p><div className="header-actions">{page > 1 ? <Link className="secondary-button" href={`?${query}&strana=${page-1}`}>Prethodna</Link> : null}{page < pages ? <Link className="secondary-button" href={`?${query}&strana=${page+1}`}>Sljedeća</Link> : null}</div></>}</section>
  </div>;
}
