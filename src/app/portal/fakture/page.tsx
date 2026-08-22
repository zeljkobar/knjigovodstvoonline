import Link from "next/link";
import {
  requireDirectPortalContext
} from "@/lib/direct-portal";
import {
  formatPortalMoney,
  portalPaymentLabels
} from "@/lib/direct-portal-dashboard";
import {
  loadDirectPortalInvoiceList,
  parseDirectPortalInvoiceFilters,
  portalFiscalStatusFilterLabels,
  portalFiscalStatusTone,
  type DirectPortalInvoiceFilters,
  type DirectPortalInvoiceSearchParams
} from "@/lib/direct-portal-invoices";
import { hasDirectPortalPermission } from "@/lib/direct-portal-policy";
import { decimalToScaled } from "@/lib/inventory-calculation";

const invoiceViewPermissions = [
  { modul: "robno", akcija: "view" },
  { modul: "fiskalizacija", akcija: "view" }
];

function pageHref(filters: DirectPortalInvoiceFilters, page: number) {
  return page > 1 ? `/portal/fakture?stranica=${page}` : "/portal/fakture";
}

export default async function PortalInvoicesPage({
  searchParams
}: {
  searchParams: Promise<DirectPortalInvoiceSearchParams>;
}) {
  const [params, context] = await Promise.all([
    searchParams,
    requireDirectPortalContext(
      invoiceViewPermissions,
      "/portal/fakture",
      "all"
    )
  ]);
  const filters = parseDirectPortalInvoiceFilters({
    ...params,
    tip: "INVOICE",
    kanal: "OFFICE"
  });
  const result = await loadDirectPortalInvoiceList(context, filters);
  const canCreate =
    hasDirectPortalPermission(context.permissionKeys, {
      modul: "robno",
      akcija: "create"
    }) &&
    hasDirectPortalPermission(context.permissionKeys, {
      modul: "fiskalizacija",
      akcija: "create"
    });

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Prodaja</p>
          <h2>Bezgotovinske fakture</h2>
          <p className="muted-text">
            Nacrti i fiskalizovane OFFICE fakture za {context.year.godina}.
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-button" href="/portal/racuni">
            Svi fiskalni računi
          </Link>
          {canCreate ? (
            <Link className="primary-button" href="/portal/fakture/nova">
              Nova faktura
            </Link>
          ) : null}
        </div>
      </header>

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Fakture</h3>
            <p className="muted-text">
              {result.total === 1
                ? "Pronađena je 1 faktura."
                : `Pronađeno je ${result.total} faktura.`}
            </p>
          </div>
          <span>
            Strana {result.page} / {result.totalPages}
          </span>
        </div>

        {result.invoices.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Broj</th>
                  <th>Datum</th>
                  <th>Kupac</th>
                  <th>Plaćanje</th>
                  <th>Ukupno</th>
                  <th>Status</th>
                  <th>Akcija</th>
                </tr>
              </thead>
              <tbody>
                {result.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <strong>
                        {invoice.official_invoice_number ?? invoice.interni_broj}
                      </strong>
                      {invoice.official_invoice_number ? (
                        <small>{invoice.interni_broj}</small>
                      ) : null}
                    </td>
                    <td>
                      {invoice.datum_racuna.toLocaleDateString("sr-Latn-ME", {
                        timeZone: "Europe/Podgorica"
                      })}
                    </td>
                    <td>
                      {invoice.kupac.naziv}
                      {invoice.kupac.pib ? (
                        <small>PIB {invoice.kupac.pib}</small>
                      ) : null}
                    </td>
                    <td>
                      {portalPaymentLabels[invoice.nacin_placanja] ??
                        invoice.nacin_placanja}
                    </td>
                    <td>
                      {formatPortalMoney(
                        decimalToScaled(invoice.ukupno_sa_pdv, 2)
                      )}{" "}
                      €
                    </td>
                    <td>
                      <span
                        className={`status-pill ${portalFiscalStatusTone(
                          invoice.fiscal_status
                        )}`}
                      >
                        {portalFiscalStatusFilterLabels[
                          invoice.fiscal_status
                        ] ?? "Status nije dostupan"}
                      </span>
                    </td>
                    <td>
                      <Link
                        className="table-button"
                        href={`/portal/fakture/${invoice.id}`}
                      >
                        Otvori
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted-text">Još nema bezgotovinskih faktura.</p>
        )}

        {result.totalPages > 1 ? (
          <nav className="pagination" aria-label="Stranice faktura">
            {result.page > 1 ? (
              <Link
                className="pagination-btn"
                href={pageHref(filters, result.page - 1)}
              >
                Prethodna
              </Link>
            ) : null}
            <span>
              {result.page} / {result.totalPages}
            </span>
            {result.page < result.totalPages ? (
              <Link
                className="pagination-btn"
                href={pageHref(filters, result.page + 1)}
              >
                Sljedeća
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
