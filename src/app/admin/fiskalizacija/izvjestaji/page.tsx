import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { fiscalReviewApi } from "@/lib/fiscal-admin-api";
import { prisma } from "@/lib/prisma";
import { fiscalMetrics, fiscalReportSelection, fiscalReviewHref, fiscalReviewRoutes as routes, groupings,
  invoiceEnvironments, type FiscalQuery, type FiscalSearch } from "@/lib/fiscal-review-filters";
import { CoverageNotice, fiscalLabel, fiscalMoney, fiscalTime, ReviewHeader, ReviewNotice } from "../pregledi";
import styles from "../pregledi.module.css";

export default async function FiscalTurnoverPage({ searchParams }: { searchParams: Promise<FiscalSearch> }) {
  const admin = await requireRole("admin");
  const selection = fiscalReportSelection(await searchParams);
  const { values, filter } = selection;
  const actor = { id: admin.id, name: admin.korisnicko_ime };
  const companies = await prisma.fiscalCompanyLink.findMany({
    where: { fiscal_api_company_id: { not: null }, firma: { is_deleted: false } },
    select: { fiscal_api_company_id: true, firma: { select: { naziv: true, pib: true } } },
    orderBy: [{ firma: { naziv: "asc" } }, { firma: { id: "asc" } }]
  });
  let report: Awaited<ReturnType<typeof fiscalReviewApi.turnover>>["data"] | undefined;
  let error: unknown;
  if (filter) {
    try { report = (await fiscalReviewApi.turnover(actor, filter)).data; }
    catch (e) { error = e; }
  }
  const documentLink = (metric: keyof typeof fiscalMetrics, extra: FiscalQuery = {}) =>
    fiscalReviewHref(routes.documents, { ...filter, metric, ...extra });
  const byMeasure = report ? [
    ["SalesPositive", report.totals.salesPositive], ["SalesCorrections", report.totals.salesCorrections],
    ["SalesNet", report.totals.salesNet]
  ] as const : [];
  const totals = report?.totals;
  const money = (amount: string) => fiscalMoney(amount, report?.currency);
  const externalCompany = filter && !companies.some(x => x.fiscal_api_company_id === filter.companyId);
  return <div className="admin-stack">
    <ReviewHeader title="Promet i PDV" description="Izaberi firmu i period. Iznosi dolaze iz Fiscal API-ja." active="turnover" />
    <section className="admin-panel">
      <form className={styles.filters} action={routes.turnover} method="get">
        <label>Firma <select name="companyId" required defaultValue={values.companyId}>
          <option value="">Izaberi firmu</option>
          {externalCompany ? <option value={filter.companyId}>Firma iz odabranog računa · {filter.companyId}</option> : null}
          {companies.map(company => company.fiscal_api_company_id ? <option key={company.fiscal_api_company_id} value={company.fiscal_api_company_id}>
            {company.firma.naziv}{company.firma.pib ? " · " + company.firma.pib : ""}
          </option> : null)}
        </select></label>
        <label>Okruženje <select name="environment" defaultValue={values.environment ?? "Production"}>
          {Object.entries(invoiceEnvironments).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Od <input type="date" name="fromDate" defaultValue={values.fromDate} required /></label>
        <label>Do (nije uključen) <input type="date" name="toDate" defaultValue={values.toDate} required /></label>
        <label>Grupiši po <select name="groupBy" defaultValue={values.groupBy ?? "Month"}>
          {Object.entries(groupings).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <button type="submit">Prikaži promet</button>
      </form>
      <p>Datumi su po vremenu u Podgorici. Za firmu koja nije povezana sa sajtom otvori njen račun i izaberi „Promet ove firme“.</p>
    </section>
    {selection.error ? <p className="admin-message" role="alert">{selection.error}</p> : null}
    {error ? <ReviewNotice error={error} permission="reports:read" /> : null}
    {report && totals ? <>
      {!report.authoritative ? <p className="admin-message">Nepoznato okruženje je samo dijagnostički pregled. Ne ulazi u potvrđeni produkcioni ili testni promet.</p> : null}
      <section className="admin-panel">
        <div className="panel-header"><h3>Promet za period</h3>
          <div className={styles.links}>
            <Link className="table-link" href={documentLink("DocumentCount")}>{totals.documentCount} potvrđenih dokumenata</Link>
            <Link className="table-link" href={documentLink("SaleInvoiceCount")}>{totals.saleInvoiceCount} prodajnih računa</Link>
          </div>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Prikaz</th><th>Osnovica</th><th>PDV</th><th>Bruto</th><th>Dokumenti</th></tr></thead>
          <tbody>{byMeasure.map(([metric, amount]) => <tr key={metric}>
            <th scope="row">{fiscalMetrics[metric]}</th><td>{money(amount.net)}</td><td>{money(amount.vat)}</td><td>{money(amount.gross)}</td>
            <td><Link className="table-link" href={documentLink(metric)}>Otvori dokumente</Link></td>
          </tr>)}</tbody>
        </table></div>
        <p>Neto promet je prodaja umanjena za korekcije. Avansi i informativni dokumenti prikazani su odvojeno. Izvještaj nije KIF ni PDV prijava.</p>
        <p>Stanje: {fiscalTime(report.evaluatedAt)} · {report.timeZone} · {report.rulesVersion}</p>
        <CoverageNotice coverage={report.coverage} />
      </section>
      <section className="admin-panel"><div className="panel-header"><h3>Neto promet po periodima</h3></div>
        {report.groups.length ? <div className="table-wrap"><table>
          <thead><tr><th>Početak grupe</th><th>Dokumenti</th><th>Pozitivni promet</th><th>Korekcije</th>
            <th>Osnovica</th><th>PDV</th><th>Neto promet (bruto)</th></tr></thead>
          <tbody>{report.groups.map(group => {
            const bucketStartDate = group.bucketStartDate ?? undefined;
            return <tr key={group.bucketStartDate}><th scope="row">{group.bucketStartDate}</th>
              <td><Link className="table-link" href={documentLink("DocumentCount", { bucketStartDate })}>{group.documentCount}</Link></td>
              <td><Link className="table-link" href={documentLink("SalesPositive", { bucketStartDate })}>{money(group.salesPositive.gross)}</Link></td>
              <td><Link className="table-link" href={documentLink("SalesCorrections", { bucketStartDate })}>{money(group.salesCorrections.gross)}</Link></td>
              <td>{money(group.salesNet.net)}</td><td>{money(group.salesNet.vat)}</td>
              <td><Link className="table-link" href={documentLink("SalesNet", { bucketStartDate })}>{money(group.salesNet.gross)}</Link></td>
            </tr>;
          })}</tbody>
        </table></div> : <p>Nema potvrđenih dokumenata u periodu.</p>}
      </section>
      <section className="admin-panel"><div className="panel-header"><h3>PDV po stopama</h3></div>
        {totals.vatByRate.length ? <div className="table-wrap"><table>
          <thead><tr><th>Stopa</th><th>Osnovica</th><th>PDV</th><th>Bruto</th><th>Dokumenti</th></tr></thead>
          <tbody>{totals.vatByRate.map(rate => <tr key={rate.rate}><th scope="row">{rate.rate.replace(".", ",")}%</th>
            <td>{money(rate.net)}</td><td>{money(rate.vat)}</td><td>{money(rate.gross)}</td>
            <td><Link className="table-link" href={documentLink("SalesNet", { vatRate: rate.rate })}>Otvori dokumente</Link></td>
          </tr>)}</tbody>
        </table></div> : <p>Nema PDV stavki neto prometa u periodu.</p>}
      </section>
      <section className="admin-panel"><div className="panel-header"><h3>Kategorije dokumenata</h3></div>
        {totals.categories.length ? <div className="table-wrap"><table>
          <thead><tr><th>Kategorija</th><th>Broj</th><th>Osnovica</th><th>PDV</th><th>Bruto</th></tr></thead>
          <tbody>{totals.categories.map(row => <tr key={row.category}>
            <td><Link className="table-link" href={documentLink("Category", { category: row.category })}>{fiscalLabel(row.category)}</Link></td>
            <td>{row.count}</td><td>{money(row.amounts.net)}</td><td>{money(row.amounts.vat)}</td><td>{money(row.amounts.gross)}</td>
          </tr>)}</tbody>
        </table></div> : <p>Nema potvrđenih kategorija u periodu.</p>}
      </section>
      <section className="admin-panel"><div className="panel-header"><h3>Oznake plaćanja na dokumentima</h3></div>
        <p>Ovo su oznake s računa, ne potvrde uplata. ORDER i korišćenje avansa nijesu nova naplata.</p>
        {totals.payments.length ? <div className="table-wrap"><table>
          <thead><tr><th>Kategorija</th><th>Način</th><th>Dokumenti</th><th>Iznos</th></tr></thead>
          <tbody>{totals.payments.map(row => <tr key={row.category + ":" + row.paymentType}>
            <td>{fiscalLabel(row.category)}</td><td>{fiscalLabel(row.paymentType)}</td>
            <td><Link className="table-link" href={documentLink("Payment", { category: row.category, paymentType: row.paymentType })}>{row.count}</Link></td>
            <td>{money(row.amount)}</td>
          </tr>)}</tbody>
        </table></div> : <p>Nema stavki plaćanja.</p>}
      </section>
      <section className="admin-panel"><div className="panel-header"><h3>Statusi i nedovršeni postupci</h3></div>
        {Object.keys(report.controls.statusCounts).length ? <ul>{Object.entries(report.controls.statusCounts).map(([status, count]) =>
          <li key={status}><Link className="table-link" href={documentLink("Status", { status })}>{fiscalLabel(status)} · {count}</Link></li>
        )}</ul> : <p>Nema dokumenata u periodu.</p>}
        {report.controls.openWorkflows.length ? <ul>{report.controls.openWorkflows.map(row =>
          <li key={row.kind}><Link className="table-link" href={documentLink("OpenWorkflow", { workflowKind: row.kind })}>
            {fiscalLabel(row.kind)} · {row.count} · {money(row.amount)}
          </Link></li>
        )}</ul> : <p>Nema otvorenih postupaka u obuhvaćenim podacima.</p>}
      </section>
    </> : null}
  </div>;
}
