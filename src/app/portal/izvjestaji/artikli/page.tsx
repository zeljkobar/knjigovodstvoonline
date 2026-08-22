import Link from "next/link";
import { DirectPortalReportDocuments } from "@/components/DirectPortalReportDocuments";
import { DirectPortalReportFilters } from "@/components/DirectPortalReportFilters";
import { formatPortalMoney } from "@/lib/direct-portal-dashboard";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { hasDirectPortalPermission } from "@/lib/direct-portal-policy";
import { posQuantity } from "@/lib/pos-reports";
import {
  directPortalReportQuery,
  loadDirectPortalReport,
  loadDirectPortalReportOptions,
  parseDirectPortalReportFilters,
  type DirectPortalReportSearchParams
} from "@/lib/direct-portal-reports";

const reportViewPermission = { modul: "izvjestaji", akcija: "view" };
const reportExportPermission = { modul: "izvjestaji", akcija: "export" };
const MAX_VISIBLE_ITEMS = 250;

export default async function DirectPortalItemsReportPage({
  searchParams
}: {
  searchParams: Promise<DirectPortalReportSearchParams>;
}) {
  const [context, params] = await Promise.all([
    requireDirectPortalContext(
      reportViewPermission,
      "/portal/izvjestaji/artikli"
    ),
    searchParams
  ]);
  const filters = parseDirectPortalReportFilters(params, context.year);
  const [report, options] = await Promise.all([
    loadDirectPortalReport(context, filters, "artikli"),
    loadDirectPortalReportOptions(context, filters)
  ]);
  const canExport = hasDirectPortalPermission(
    context.permissionKeys,
    reportExportPermission
  );
  const visibleItems = report.items.slice(0, MAX_VISIBLE_ITEMS);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Izvještaji / Artikli</p>
          <h2>Prodaja po artiklu i količini</h2>
          <p className="muted-text">
            Neto količine, osnovica, PDV i promet iz OFFICE i POS dokumenata.
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-button" href="/portal/izvjestaji">
            Svi izvještaji
          </Link>
        </div>
      </header>

      <DirectPortalReportFilters
        kind="artikli"
        filters={filters}
        options={options}
        canExport={canExport}
        showItemFilters
      />

      <section className="metric-grid portal-report-metrics" aria-label="Sažetak prodaje artikala">
        <article>
          <span>Artikala / usluga</span>
          <strong>{report.items.length}</strong>
        </article>
        <article>
          <span>Dokumenata</span>
          <strong>{report.totals.count}</strong>
          <small>
            {report.totals.ordinaryCount} računa · {report.totals.correctionCount} storna
          </small>
        </article>
        <article>
          <span>Osnovica</span>
          <strong>{formatPortalMoney(report.totals.base)} €</strong>
        </article>
        <article>
          <span>PDV</span>
          <strong>{formatPortalMoney(report.totals.vat)} €</strong>
        </article>
        <article>
          <span>Neto promet</span>
          <strong>{formatPortalMoney(report.totals.gross)} €</strong>
        </article>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Artikli i usluge</h3>
            <p className="muted-text">
              Drill-down otvara dokumente samo za izabrani artikal.
            </p>
          </div>
          <span>{report.items.length} redova</span>
        </div>
        {report.items.length > MAX_VISIBLE_ITEMS ? (
          <p className="status-banner">
            Prikazano je prvih {MAX_VISIBLE_ITEMS} stavki. CSV izvoz sadrži
            kompletan filtrirani rezultat.
          </p>
        ) : null}
        {visibleItems.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Šifra</th>
                  <th>Artikal / usluga</th>
                  <th>Grupa</th>
                  <th>JM</th>
                  <th>Neto količina</th>
                  <th>Dokumenata</th>
                  <th>Osnovica</th>
                  <th>PDV</th>
                  <th>Neto promet</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr key={item.id}>
                    <td>{item.code}</td>
                    <td>
                      {item.name}
                      <small>{item.service ? "Usluga" : "Roba"}</small>
                    </td>
                    <td>{item.group}</td>
                    <td>{item.unit}</td>
                    <td>{posQuantity(item.quantity)}</td>
                    <td>{item.invoiceCount}</td>
                    <td>{formatPortalMoney(item.base)} €</td>
                    <td>{formatPortalMoney(item.vat)} €</td>
                    <td>{formatPortalMoney(item.gross)} €</td>
                    <td>
                      <Link
                        className="table-button"
                        href={`/portal/izvjestaji/artikli?${directPortalReportQuery(
                          filters,
                          { artikal_id: item.id, artikal: null }
                        )}#dokumenti`}
                      >
                        Dokumenti
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted-text">
            Nema prodatih artikala ili usluga za izabrane filtere.
          </p>
        )}
      </section>

      <DirectPortalReportDocuments
        documents={report.documents}
        showReportAmount={Boolean(
          filters.itemId || filters.item || filters.groupId
        )}
      />
    </div>
  );
}
