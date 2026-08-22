import Link from "next/link";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { formatPortalMoney, portalPaymentLabels } from "@/lib/direct-portal-dashboard";
import {
  loadDirectPortalInvoiceList,
  parseDirectPortalInvoiceFilters,
  portalDocumentTypeLabels,
  portalFiscalEnvironmentLabels,
  portalFiscalStatusFilterLabels,
  portalFiscalStatusTone,
  portalPaymentFilterLabels,
  portalSalesChannelLabels,
  isFinalPortalPosReceipt,
  type DirectPortalInvoiceFilters,
  type DirectPortalInvoiceSearchParams
} from "@/lib/direct-portal-invoices";
import { decimalToScaled } from "@/lib/inventory-calculation";

const invoiceViewPermission = { modul: "fiskalizacija", akcija: "view" };

function pageHref(filters: DirectPortalInvoiceFilters, page: number) {
  const query = new URLSearchParams();
  const values: Array<[string, string]> = [
    ["od", filters.periodFrom],
    ["do", filters.periodTo],
    ["tip", filters.documentType],
    ["kanal", filters.salesChannel],
    ["status", filters.fiscalStatus],
    ["okruzenje", filters.fiscalEnvironment],
    ["placanje", filters.paymentMethod],
    ["kasa", filters.registerId],
    ["kupac", filters.buyer],
    ["broj", filters.number],
    ["ikof", filters.ikof],
    ["jikr", filters.jikr]
  ];

  for (const [name, value] of values) {
    if (value) query.set(name, value);
  }
  if (page > 1) query.set("stranica", String(page));

  const suffix = query.toString();
  return suffix ? `/portal/racuni?${suffix}` : "/portal/racuni";
}

function pageNumbers(page: number, totalPages: number) {
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export default async function DirectPortalInvoicesPage({
  searchParams
}: {
  searchParams: Promise<DirectPortalInvoiceSearchParams>;
}) {
  const [context, params] = await Promise.all([
    requireDirectPortalContext(invoiceViewPermission, "/portal/racuni"),
    searchParams
  ]);
  const filters = parseDirectPortalInvoiceFilters(params);
  const result = await loadDirectPortalInvoiceList(context, filters);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Direktni fiskalni portal</p>
          <h2>Fiskalni računi</h2>
          <p className="muted-text">
            Jedinstveni pregled POS i OFFICE dokumenata za {context.year.godina}. godinu.
          </p>
        </div>
      </header>

      {filters.invalidPeriod ? (
        <p className="status-banner error" role="alert">
          Datum „od“ mora biti prije ili jednak datumu „do“.
        </p>
      ) : null}

      <section className="admin-panel" aria-labelledby="invoice-filter-title">
        <div className="panel-header">
          <div>
            <h3 id="invoice-filter-title">Filteri</h3>
            <p className="muted-text">
              IKOF i JIKR se traže samo po tačno unesenoj vrijednosti.
            </p>
          </div>
        </div>
        <form className="portal-filter-form portal-filter-form--extended" method="get">
          <label>
            <span>Period od</span>
            <input name="od" type="date" defaultValue={filters.periodFrom} />
          </label>
          <label>
            <span>Period do</span>
            <input name="do" type="date" defaultValue={filters.periodTo} />
          </label>
          <label>
            <span>Tip dokumenta</span>
            <select name="tip" defaultValue={filters.documentType}>
              <option value="">Svi tipovi</option>
              {Object.entries(portalDocumentTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Kanal prodaje</span>
            <select name="kanal" defaultValue={filters.salesChannel}>
              <option value="">Svi kanali</option>
              {Object.entries(portalSalesChannelLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Fiskalni status</span>
            <select name="status" defaultValue={filters.fiscalStatus}>
              <option value="">Svi statusi</option>
              {Object.entries(portalFiscalStatusFilterLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Fiskalno okruženje</span>
            <select name="okruzenje" defaultValue={filters.fiscalEnvironment}>
              <option value="">Sva okruženja</option>
              {Object.entries(portalFiscalEnvironmentLabels).map(
                ([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                )
              )}
            </select>
          </label>
          <label>
            <span>Način plaćanja</span>
            <select name="placanje" defaultValue={filters.paymentMethod}>
              <option value="">Sva plaćanja</option>
              {Object.entries(portalPaymentFilterLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Kasa</span>
            <select name="kasa" defaultValue={filters.registerId}>
              <option value="">Sve kase</option>
              {result.registers.map((register) => (
                <option key={register.id} value={register.id}>
                  {register.sifra} · {register.naziv}{register.aktivan ? "" : " (neaktivna)"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Kupac (naziv ili PIB)</span>
            <input name="kupac" defaultValue={filters.buyer} maxLength={120} />
          </label>
          <label>
            <span>Lokalni ili zvanični broj</span>
            <input name="broj" defaultValue={filters.number} maxLength={120} />
          </label>
          <label>
            <span>Tačan IKOF</span>
            <input name="ikof" defaultValue={filters.ikof} maxLength={200} />
          </label>
          <label>
            <span>Tačan JIKR</span>
            <input name="jikr" defaultValue={filters.jikr} maxLength={200} />
          </label>
          <div className="form-actions form-wide">
            <button type="submit">Primijeni filtere</button>
            <Link className="secondary-button" href="/portal/racuni">Poništi filtere</Link>
          </div>
        </form>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Dokumenti</h3>
            <p className="muted-text">
              {result.total === 1 ? "Pronađen je 1 dokument." : `Pronađeno je ${result.total} dokumenata.`}
            </p>
          </div>
          <span>Strana {result.page} / {result.totalPages}</span>
        </div>

        {result.invoices.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Datum i vrijeme</th>
                  <th>Tip / kanal</th>
                  <th>Lokalni broj</th>
                  <th>Zvanični broj</th>
                  <th>Kupac</th>
                  <th>Plaćanje</th>
                  <th>Ukupno</th>
                  <th>Status</th>
                  <th>Akcije</th>
                </tr>
              </thead>
              <tbody>
                {result.invoices.map((invoice) => {
                  const payments = invoice.placanja.length > 0
                    ? [...new Set(invoice.placanja.map((payment) => payment.payment_method))]
                    : [invoice.nacin_placanja];
                  return (
                    <tr key={invoice.id}>
                      <td>
                        {(invoice.issued_at ?? invoice.created_at).toLocaleString("sr-Latn-ME", {
                          timeZone: "Europe/Podgorica"
                        })}
                      </td>
                      <td>
                        <strong>{portalDocumentTypeLabels[invoice.document_type] ?? invoice.document_type}</strong>
                        <small>{portalSalesChannelLabels[invoice.sales_channel] ?? invoice.sales_channel}</small>
                      </td>
                      <td>
                        {invoice.interni_broj}
                        {invoice.original_invoice_id ? <small>Korektivni dokument</small> : null}
                      </td>
                      <td>{invoice.official_invoice_number ?? "—"}</td>
                      <td>
                        {invoice.kupac.naziv}
                        {invoice.kupac.pib ? <small>PIB {invoice.kupac.pib}</small> : null}
                      </td>
                      <td>
                        {payments.map((payment) => portalPaymentLabels[payment] ?? payment).join(", ")}
                        {invoice.pos_register ? <small>{invoice.pos_register.naziv}</small> : null}
                      </td>
                      <td>{formatPortalMoney(decimalToScaled(invoice.ukupno_sa_pdv, 2))} €</td>
                      <td>
                        <span className={`status-pill ${portalFiscalStatusTone(invoice.fiscal_status)}`}>
                          {portalFiscalStatusFilterLabels[invoice.fiscal_status] ?? "Status nije dostupan"}
                        </span>
                        {invoice.fiscal_environment === "Test" ? (
                          <small className="status-pill status-pill--warning">TEST</small>
                        ) : null}
                      </td>
                      <td>
                        <div className="table-actions">
                          <Link className="table-button" href={`/portal/racuni/${invoice.id}`}>Detalj</Link>
                          <Link className="table-button" href={`/stampa/portal/racuni/${invoice.id}`} target="_blank" prefetch={false}>A4</Link>
                          {isFinalPortalPosReceipt(invoice) ? (
                            <>
                              <Link className="table-button" href={`/stampa/portal/racuni/${invoice.id}/termalni?sirina=58`} target="_blank" prefetch={false}>58 mm</Link>
                              <Link className="table-button" href={`/stampa/portal/racuni/${invoice.id}/termalni?sirina=80`} target="_blank" prefetch={false}>80 mm</Link>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted-text">Nema računa koji odgovaraju izabranim filterima.</p>
        )}

        {result.totalPages > 1 ? (
          <nav className="pagination" aria-label="Stranice fiskalnih računa">
            {result.page > 1 ? (
              <Link className="pagination-btn" href={pageHref(filters, result.page - 1)}>Prethodna</Link>
            ) : (
              <span className="pagination-btn pagination-btn--disabled">Prethodna</span>
            )}
            <div className="pagination-pages">
              {pageNumbers(result.page, result.totalPages).map((page) => (
                <Link
                  className={`pagination-page ${page === result.page ? "pagination-page--active" : ""}`}
                  href={pageHref(filters, page)}
                  key={page}
                  aria-current={page === result.page ? "page" : undefined}
                >
                  {page}
                </Link>
              ))}
            </div>
            {result.page < result.totalPages ? (
              <Link className="pagination-btn" href={pageHref(filters, result.page + 1)}>Sljedeća</Link>
            ) : (
              <span className="pagination-btn pagination-btn--disabled">Sljedeća</span>
            )}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
