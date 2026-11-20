import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fiscalReportSelection, type FiscalSearch } from "@/lib/fiscal-review-filters";
import { FiscalReconciliationError, loadFiscalReconciliation } from "@/lib/fiscal-reconciliation-service";
import { posMoney } from "@/lib/pos-reports";
import { ReviewHeader, ReviewNotice } from "../pregledi";
import styles from "../pregledi.module.css";

export const dynamic = "force-dynamic";
export default async function FiscalReconciliationPage({ searchParams }: { searchParams: Promise<FiscalSearch> }) {
  const admin = await requireRole("admin");
  const selection = fiscalReportSelection(await searchParams);
  const companies = await prisma.fiscalCompanyLink.findMany({ where: { fiscal_api_company_id: { not: null }, firma: { is_deleted: false } },
    select: { fiscal_api_company_id: true, firma: { select: { naziv: true, pib: true } } }, orderBy: { firma: { naziv: "asc" } } });
  let report: Awaited<ReturnType<typeof loadFiscalReconciliation>> | undefined;
  let error: unknown;
  if (selection.filter && selection.filter.environment !== "Unknown") {
    try { report = await loadFiscalReconciliation({ id: admin.id, name: admin.korisnicko_ime }, selection.filter); }
    catch (caught) { error = caught; }
  }
  return <div className="admin-stack">
    <ReviewHeader title="Usaglašavanje sa Fiscal API-jem" description="Kontrola lokalne prodaje prema potvrđenim API prodajnim dokumentima. Samo za čitanje." active="turnover"/>
    <section className="admin-panel"><form className={styles.filters} method="get">
      <label>Firma<select name="companyId" required defaultValue={selection.values.companyId}><option value="">Izaberite firmu</option>{companies.map(company => <option key={company.fiscal_api_company_id} value={company.fiscal_api_company_id!}>{company.firma.naziv} · {company.firma.pib}</option>)}</select></label>
      <label>Okruženje<select name="environment" defaultValue={selection.values.environment}><option value="Production">Produkcija</option><option value="Test">Test</option></select></label>
      <label>Od<input type="date" name="fromDate" defaultValue={selection.values.fromDate} required/></label>
      <label>Do (nije uključen)<input type="date" name="toDate" defaultValue={selection.values.toDate} required/></label>
      <button className="primary-button" type="submit">Provjeri usaglašenost</button>
    </form><p>Kontrola obuhvata sve OFFICE/POS kanale i lokalne godine povezane firme unutar perioda, bez kupčevih i POS filtera. API prodaja uključuje konačne račune sa avansom i ORDER; razlike obuhvata ostaju vidljive. Maksimalno 500 API dokumenata po kontroli.</p>
    <p>Datumi su po vremenu u Podgorici. Poređenje ne popravlja podatke, ne knjiži i ne šalje račune Poreskoj upravi.</p></section>
    {selection.error ? <p role="alert">{selection.error}</p> : null}
    {selection.values.environment === "Unknown" ? <p role="alert">Izaberite produkciju ili test.</p> : null}
    {error ? error instanceof FiscalReconciliationError ? <p role="alert">{error.message}</p> : <ReviewNotice error={error} permission="reports:read i invoices:read"/> : null}
    {report ? <>
      <section className="admin-panel"><h3>{report.differences.length ? `${report.differences.length} dokumenata zahtijeva provjeru` : "Bez razlika u pročitanim podacima"}</h3>
        <p>API stanje: {report.apiEvaluatedAt} · lokalno čitanje: {report.localReadAt.toISOString()} · pravila: {report.rulesVersion}</p>
        <p>Čitanja dva sistema nijesu jedan atomski snimak. Rezultat važi za pročitani obuhvat, ne potvrđuje trajnu sinhronizaciju.</p>
        {report.partial ? <p className="admin-message">API prijavljuje nepotpun istorijski obuhvat. Slaganje nije potvrda potpune istorije firme.{report.availableSince ? ` Evidencija dostupna od: ${report.availableSince}.` : ""}</p> : null}
        <div className="table-wrap"><table><thead><tr><th>Podatak</th><th>Lokalna evidencija</th><th>Fiscal API</th><th>Razlika (lokalno − API)</th></tr></thead><tbody>
          <tr><th>Prodajni dokumenti</th><td>{report.localTotals.count}</td><td>{report.apiTotals.count}</td><td>{report.localTotals.count-report.apiTotals.count}</td></tr>
          {([['net','Osnovica'],['vat','PDV'],['gross','Ukupno']] as const).map(([key,label]) => <tr key={key}><th>{label}</th><td>{posMoney(report.localTotals[key])} €</td><td>{posMoney(report.apiTotals[key])} €</td><td>{posMoney(report.localTotals[key]-report.apiTotals[key])} €</td></tr>)}
        </tbody></table></div>
      </section>
      <section className="admin-panel"><h3>Dokumenti sa razlikama</h3>{report.differences.length ? <div className="table-wrap"><table><thead><tr><th>Broj</th><th>Lokalni ID</th><th>API ID</th><th>Razlog</th></tr></thead><tbody>{report.differences.map((row,index) => <tr key={index}><td>{row.number}</td><td>{row.localId ? <Link className="table-link" href={`/admin/fiskalizacija/usaglasavanje/${row.localId}`}>Provjeri dopunu okruženja</Link> : "—"}</td><td>{row.apiId ?? "—"}</td><td>{row.reasons.join("; ")}</td></tr>)}</tbody></table></div> : <p>Nema razlika u pročitanom prodajnom skupu.</p>}</section>
    </> : null}
  </div>;
}
