import Link from "next/link";
import type { ReactNode } from "react";
import { FiscalAdminApiError, type FiscalAdminInvoiceRow } from "@/lib/fiscal-admin-api";
import {
  fiscalReviewHref, fiscalReviewRoutes as routes, invoiceEnvironments, isFiscalUuid, type FiscalQuery
} from "@/lib/fiscal-review-filters";
import type { FiscalExchangeReview, FiscalReviewCoverage, FiscalReviewPage, FiscalTurnoverDocument } from "@/lib/fiscal-review-models";
import styles from "./pregledi.module.css";

const formatter = new Intl.DateTimeFormat("sr-Latn-ME", {
  dateStyle: "short", timeStyle: "short", timeZone: "Europe/Podgorica"
});
const codes: Record<string, string> = {
  ...invoiceEnvironments,
  Fiscalized: "Fiskalizovan", StornoCreated: "Storniran", FiscalizationFailed: "Neuspjela fiskalizacija",
  FiscalizationPending: "Ishod nije potvrđen", ReadyForFiscalization: "Spreman za fiskalizaciju", Draft: "Nacrt",
  Cancelled: "Otkazan", Started: "Započet", Accepted: "Prihvaćen", Rejected: "Odbijen", Timeout: "Istek vremena",
  TransportError: "Greška veze", LocalError: "Lokalna greška", Failed: "Neuspješno", Pending: "Na čekanju",
  Completed: "Sačuvano", NotApplicable: "Nije primjenljivo", Complete: "Potpun", RequestOnly: "Samo zahtjev",
  Incomplete: "Nepotpun", Partial: "Djelimično", Indexed: "Evidentirano", NotRecorded: "Nije zabilježeno",
  Live: "Novi zapis", Backfill: "Iz arhive", RegisterInvoice: "Fiskalizacija računa", RegisterTcr: "Registracija ENU-a",
  RegisterCashDeposit: "Gotovinski depozit", Other: "Ostalo", StandardSale: "Redovna prodaja", OrderSale: "ORDER prodaja",
  FinalWithAdvance: "Konačni račun sa avansom", SaleCorrection: "Korekcija prodaje", OrderCorrection: "Korekcija ORDER-a",
  AdvanceReceipt: "Primljeni avans", AdvanceStorno: "Storno avansa", AdvanceSettlement: "Umanjenje avansa",
  AdvanceRestoration: "Obnova avansa", Summary: "Informativni sumarni", SummaryCorrection: "Korekcija sumarnog",
  SummaryCancellation: "Poništenje sumarnog", AdvanceSettlementDue: "Potrebno umanjenje avansa",
  AdvanceRestorationDue: "Potrebna obnova avansa", SummaryCorrectionDue: "Potrebna korekcija sumarnog",
  BankAccount: "Prenos na račun", Cash: "Gotovina", Card: "Kartica", Advance: "Avans", Order: "ORDER",
  Succeeded: "Uspješan", ValidationError: "Greška validacije", Unauthorized: "Bez autentifikacije",
  Forbidden: "Bez dozvole", Conflict: "Konflikt", FiscalRejected: "Odbila PU", InternalError: "Interna greška",
  VerifiedExchange: "Potvrđena razmjena", SendSnapshot: "Zapis pri slanju", PreparationSnapshot: "Zapis pri pripremi"
};
export function fiscalLabel(value?: string | null) {
  if (!value) return "—";
  return Object.hasOwn(codes, value) ? codes[value] : value;
}
export function fiscalTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? formatter.format(date) : "—";
}
export function fiscalMoney(value?: string | number | null, currency = "EUR") {
  if (value === undefined || value === null) return "—";
  // Stari detalj vraća numeričke iznose. Zbirove sa novih ruta ne pretvaramo u Number.
  const text = typeof value === "number" ? value.toFixed(2) : value;
  return text.replace(".", ",") + " " + currency;
}

export function ReviewHeader({ title, description, active }: {
  title: string; description: string; active?: "invoices" | "turnover" | "diagnostics";
}) {
  return <header className="admin-header">
    <div><p className="eyebrow">Fiskalna platforma</p><h2>{title}</h2><p>{description}</p></div>
    <nav className={styles.links} aria-label="Fiskalni pregledi">
      <Link className="table-link" href={routes.home}>Fiskalna platforma</Link>
      <Link className="table-link" href={routes.invoices} aria-current={active === "invoices" ? "page" : undefined}>Fiskalni računi</Link>
      <Link className="table-link" href={routes.turnover} aria-current={active === "turnover" ? "page" : undefined}>Promet i PDV</Link>
      <Link className="table-link" href="/admin/fiskalizacija/usaglasavanje">Usaglašavanje</Link>
      <Link className="table-link" href={routes.diagnostics} aria-current={active === "diagnostics" ? "page" : undefined}>Istorija i greške</Link>
    </nav>
  </header>;
}

export function ReviewNotice({ error, permission }: { error: unknown; permission?: string }) {
  const api = error instanceof FiscalAdminApiError ? error : null;
  let message = "Pregled trenutno nije dostupan.";
  if (api?.code === "FISCAL_READ_NOT_CONFIGURED" || api?.status === 401)
    message = "Serverski ključ za pregled nedostaje ili ga Fiscal API ne prihvata.";
  else if (api?.status === 403)
    message = permission ? "Ključ nema potrebnu dozvolu: " + permission + "." : "Ključ nema pristup ovom pregledu.";
  else if (api?.status === 404) message = "Zapis nije pronađen ili nije dostupan.";
  else if (api?.status === 400) message = "Fiscal API ne prihvata izabrane filtere.";
  return <p className="admin-message" role="alert">{message}{api?.correlationId ? " Referenca: " + api.correlationId + "." : ""}</p>;
}

export function CoverageNotice({ coverage, subject = "istorije" }: { coverage?: FiscalReviewCoverage; subject?: string }) {
  if (!coverage?.partial) return null;
  return <p className="admin-message">Pokrivenost {subject} je djelimična.
    {coverage.availableSince ? " Novo indeksiranje evidentirano od " + fiscalTime(coverage.availableSince) + "." : ""}
    {" "}Prazan rezultat ne dokazuje da ranije nije bilo pokušaja ili zahtjeva.</p>;
}

export function ReviewPager({ data, href, query }: { data: FiscalReviewPage<unknown>; href: string; query: FiscalQuery }) {
  return <nav className={styles.links} aria-label="Stranice rezultata">
    {data.page > 1 ? <Link className="table-link" href={fiscalReviewHref(href, { ...query, page: data.page - 1 })}>Prethodna</Link> : null}
    <span>Stranica {data.page} · {data.totalCount} ukupno</span>
    {data.page * data.pageSize < data.totalCount ? <Link className="table-link" href={fiscalReviewHref(href, { ...query, page: data.page + 1 })}>Sljedeća</Link> : null}
  </nav>;
}

export function ReviewFields({ fields }: { fields: Array<[string, ReactNode]> }) {
  return <div className={styles.fields}><dl>
    {fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "—"}</dd></div>)}
  </dl></div>;
}
export function InvoiceLink({ id, children }: { id?: string | null; children?: ReactNode }) {
  return isFiscalUuid(id)
    ? <Link className="table-link" href={routes.invoices + "/" + id}>{children ?? "Otvori račun"}</Link>
    : <>{children ?? "—"}</>;
}
export function FiscalInvoiceTable({ items, contributions = false }: {
  items: Array<FiscalAdminInvoiceRow | FiscalTurnoverDocument>; contributions?: boolean;
}) {
  if (!items.length) return <p>Nema računa na ovoj stranici za izabrane filtere.</p>;
  return <div className="table-wrap"><table>
    <thead><tr><th>Firma</th><th>Račun</th><th>Izdavanje</th><th>Kupac</th><th>Okruženje / status</th>
      <th className={styles.numeric}>{contributions ? "Doprinos" : "Ukupno"}</th><th>JIKR</th></tr></thead>
    <tbody>{items.map(row => {
      const c = "contribution" in row ? row.contribution : null;
      return <tr key={row.id}>
        <td><strong>{row.companyName}</strong><small>PIB {row.companyTin}</small></td>
        <td className={styles.break}><InvoiceLink id={row.id}>{row.officialInvoiceNumber || row.invoiceNumber}</InvoiceLink>
          {row.category ? <small>{fiscalLabel(row.category)}</small> : null}</td>
        <td><time dateTime={row.issueDateTime}>{fiscalTime(row.issueDateTime)}</time></td>
        <td>{row.buyer?.name ?? "—"}</td><td>{fiscalLabel(row.environment)}<small>{fiscalLabel(row.status)}</small></td>
        <td className={styles.numeric}>{contributions ? <>
          {fiscalMoney(c?.gross ?? c?.amount, row.currency)}
          {c?.net != null ? <small>Osnovica: {fiscalMoney(c.net, row.currency)}</small> : null}
          {c?.vat != null ? <small>PDV: {fiscalMoney(c.vat, row.currency)}</small> : null}
        </> : fiscalMoney(row.totalGrossAmount, row.currency)}</td>
        <td className={styles.break}>{row.jikr ?? "—"}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

export function ExchangeTable({ items, showInvoice = false }: { items: FiscalExchangeReview[]; showInvoice?: boolean }) {
  if (!items.length) return <p>Nema evidentiranih razmjena za izabrane filtere.</p>;
  return <div className="table-wrap"><table>
    <thead><tr><th>Početak</th><th>Operacija</th><th>Ishod PU</th><th>Lokalni završetak</th><th>Greška</th>
      <th>Correlation ID</th>{showInvoice ? <th>Račun</th> : null}<th>Detalj</th></tr></thead>
    <tbody>{items.map(row => <tr key={row.exchangeId}>
      <td>{fiscalTime(row.startedAt)}<small>{fiscalLabel(row.environment)}</small></td><td>{fiscalLabel(row.operation)}</td>
      <td>{fiscalLabel(row.outcome)}<small>{row.puHttpStatus != null ? "HTTP " + row.puHttpStatus : "HTTP status nije evidentiran"}</small></td>
      <td>{fiscalLabel(row.localCompletion)}</td><td>{row.error?.code ?? "—"}</td>
      <td className={styles.break}>{row.correlationId || "—"}</td>
      {showInvoice ? <td><InvoiceLink id={row.invoiceId} /></td> : null}
      <td><Link className="table-link" href={routes.diagnostics + "/" + row.exchangeId}>Otvori razmjenu</Link></td>
    </tr>)}</tbody>
  </table></div>;
}
