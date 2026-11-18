import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { fiscalReviewApi } from "@/lib/fiscal-admin-api";
import { fiscalEnum, fiscalInput, fiscalPage, fiscalReviewHref, fiscalReviewRoutes as routes,
  fiscalUtcRange, invoiceEnvironments, isFiscalUuid, type FiscalSearch } from "@/lib/fiscal-review-filters";
import type { FiscalApiRequestReview, FiscalExchangeReview, FiscalReviewPage } from "@/lib/fiscal-review-models";
import { CoverageNotice, ExchangeTable, fiscalLabel, fiscalTime, InvoiceLink, ReviewHeader, ReviewNotice, ReviewPager } from "../pregledi";
import styles from "../pregledi.module.css";

const exchangeOutcomes = ["Started", "Accepted", "Rejected", "Timeout", "Cancelled", "TransportError", "LocalError", "Unknown"];
const requestOutcomes = ["Succeeded", "ValidationError", "Unauthorized", "Forbidden", "Conflict", "FiscalRejected", "TransportError", "InternalError", "Cancelled", "Unknown"];

export default async function FiscalDiagnosticsPage({ searchParams }: { searchParams: Promise<FiscalSearch> }) {
  const admin = await requireRole("admin");
  const query = await searchParams;
  const tab = query.view === "requests" ? "requests" : "exchanges";
  const actor = { id: admin.id, name: admin.korisnicko_ime };
  const companyId = fiscalInput(query.companyId);
  const invoiceId = fiscalInput(query.invoiceId);
  const correlationId = fiscalInput(query.correlationId);
  const selected = fiscalInput(query.outcome);
  const outcomes = tab === "requests" ? requestOutcomes : exchangeOutcomes;
  const outcome = outcomes.includes(selected) ? selected : undefined;
  const environment = tab === "exchanges" ? fiscalEnum(query.environment, invoiceEnvironments) : undefined;
  const httpStatus = fiscalInput(query.httpStatus);
  const errorCode = tab === "requests" ? fiscalInput(query.errorCode) : "";
  const range = fiscalUtcRange(query.fromDate, query.toDate);
  const page = fiscalPage(query.page);
  const links = { view: tab, companyId, invoiceId, correlationId, outcome, environment, httpStatus, errorCode,
    fromDate: range.fromDate, toDate: range.toDate };
  const filters = { companyId, invoiceId, correlationId, outcome, from: range.from, to: range.to, page };
  const invalid = range.error ?? ([companyId, invoiceId].some(x => x !== "" && !isFiscalUuid(x)) ?
    "Firma ili račun nemaju ispravan UUID." : httpStatus && !/^[1-5][0-9]{2}$/.test(httpStatus) ? "HTTP status mora imati tri cifre od 100 do 599." : null);

  let exchanges: FiscalReviewPage<FiscalExchangeReview> | undefined;
  let requests: FiscalReviewPage<FiscalApiRequestReview> | undefined;
  let error: unknown;
  if (!invalid) {
    try {
      if (tab === "requests") requests = (await fiscalReviewApi.requests(actor, { ...filters, apiHttpStatus: httpStatus, errorCode })).data;
      else exchanges = (await fiscalReviewApi.exchanges(actor, { ...filters, environment, puHttpStatus: httpStatus })).data;
    } catch (e) { error = e; }
  }
  const common = { companyId, invoiceId, correlationId, fromDate: range.fromDate, toDate: range.toDate };
  return <div className="admin-stack">
    <ReviewHeader title="Istorija i greške" description="Odvojeno vidiš razmjene s PU i zahtjeve prema našem API-ju." active="diagnostics" />
    <section className="admin-panel">
      <nav className={styles.links} aria-label="Vrsta dijagnostike">
        <Link className="table-link" aria-current={tab === "exchanges" ? "page" : undefined}
          href={fiscalReviewHref(routes.diagnostics, { ...common, view: "exchanges" })}>Pokušaji prema PU</Link>
        <Link className="table-link" aria-current={tab === "requests" ? "page" : undefined}
          href={fiscalReviewHref(routes.diagnostics, { ...common, view: "requests" })}>Dnevnik API zahtjeva</Link>
      </nav>
      <form className={styles.filters} action={routes.diagnostics} method="get">
        <input type="hidden" name="view" value={tab} />
        <label>Correlation ID <input name="correlationId" defaultValue={correlationId} maxLength={100} /></label>
        <label>Račun (UUID) <input name="invoiceId" defaultValue={invoiceId} maxLength={36} /></label>
        <label>Firma (UUID) <input name="companyId" defaultValue={companyId} maxLength={36} /></label>
        <label>Ishod <select name="outcome" defaultValue={outcome ?? ""}><option value="">Svi</option>
          {outcomes.map(value => <option key={value} value={value}>{fiscalLabel(value)}</option>)}
        </select></label>
        {tab === "exchanges" ? <label>Okruženje <select name="environment" defaultValue={environment ?? ""}><option value="">Sva</option>
          {Object.entries(invoiceEnvironments).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label> : <label>Kod greške <input name="errorCode" defaultValue={errorCode} maxLength={100} /></label>}
        <label>{tab === "requests" ? "HTTP status API-ja" : "HTTP status PU"} <input name="httpStatus" defaultValue={httpStatus} inputMode="numeric" pattern="[1-5][0-9]{2}" /></label>
        <label>Od (UTC) <input type="date" name="fromDate" defaultValue={range.fromDate} /></label>
        <label>Do (UTC, nije uključen) <input type="date" name="toDate" defaultValue={range.toDate} /></label>
        <button type="submit">Pretraži</button>
        <Link className="table-link" href={fiscalReviewHref(routes.diagnostics, { view: tab })}>Očisti filtere</Link>
      </form>
      <p>Bez perioda se prikazuje posljednjih 30 dana. Tačan ID računa ili Correlation ID pretražuje svu dostupnu istoriju.</p>
    </section>
    {invalid ? <p className="admin-message" role="alert">{invalid}</p> : null}
    {error ? <ReviewNotice error={error} permission={tab === "requests" ? "requests:read" : "exchanges:read"} /> : null}
    {exchanges ? <section className="admin-panel"><div className="panel-header"><h3>Pokušaji prema PU</h3></div>
      <CoverageNotice coverage={exchanges.coverage} /><ExchangeTable items={exchanges.items} showInvoice />
      <ReviewPager data={exchanges} href={routes.diagnostics} query={links} />
    </section> : null}
    {requests ? <section className="admin-panel"><div className="panel-header"><h3>API zahtjevi po firmama</h3></div>
      <p>Prikazani su pripisani zapisi. Ovo nije sigurnosni dnevnik i ne sadrži nepripisane zahtjeve.</p>
      <CoverageNotice coverage={requests.coverage} subject="dnevnika" />
      {requests.items.length ? <div className="table-wrap"><table>
        <thead><tr><th>Vrijeme / trajanje</th><th>Metod i ruta</th><th>HTTP status API-ja</th><th>Ishod</th>
          <th>Kod i poruka</th><th>Klijent / korisnik</th><th>Račun</th><th>Correlation ID</th></tr></thead>
        <tbody>{requests.items.map(row => <tr key={row.requestId}>
          <td>{fiscalTime(row.startedAt)}<small>{row.durationMs != null ? row.durationMs + " ms" : "—"}</small></td>
          <td className={styles.break}>{row.method} {row.routeTemplate}</td><td>{row.apiHttpStatus}</td><td>{fiscalLabel(row.outcome)}</td>
          <td className={styles.break}>{row.error ? <><strong>{row.error.code}</strong><small>{row.error.message}</small></> : "—"}</td>
          <td className={styles.break}>{row.clientId ?? "—"}<small>{row.initiatorId}</small></td>
          <td><InvoiceLink id={row.invoiceId} /></td>
          <td className={styles.break}>{row.correlationId ? <Link className="table-link"
            href={fiscalReviewHref(routes.diagnostics, { correlationId: row.correlationId })}>{row.correlationId}</Link> : "—"}</td>
        </tr>)}</tbody>
      </table></div> : <p>Nema evidentiranih zahtjeva za izabrane filtere.</p>}
      <ReviewPager data={requests} href={routes.diagnostics} query={links} />
    </section> : null}
  </div>;
}
