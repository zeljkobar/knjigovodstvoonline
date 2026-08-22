import Link from "next/link";
import { DirectPortalReportDocuments } from "@/components/DirectPortalReportDocuments";
import { DirectPortalReportFilters } from "@/components/DirectPortalReportFilters";
import { formatPortalMoney } from "@/lib/direct-portal-dashboard";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { hasDirectPortalPermission } from "@/lib/direct-portal-policy";
import {
  directPortalReportPaymentLabels,
  directPortalReportQuery,
  loadDirectPortalReport,
  loadDirectPortalReportOptions,
  parseDirectPortalReportFilters,
  type DirectPortalReportSearchParams
} from "@/lib/direct-portal-reports";

const reportViewPermission = { modul: "izvjestaji", akcija: "view" };
const reportExportPermission = { modul: "izvjestaji", akcija: "export" };

export default async function DirectPortalPaymentsReportPage({
  searchParams
}: {
  searchParams: Promise<DirectPortalReportSearchParams>;
}) {
  const [context, params] = await Promise.all([
    requireDirectPortalContext(
      reportViewPermission,
      "/portal/izvjestaji/placanja"
    ),
    searchParams
  ]);
  const filters = parseDirectPortalReportFilters(params, context.year);
  const [report, options] = await Promise.all([
    loadDirectPortalReport(context, filters, "placanja"),
    loadDirectPortalReportOptions(context, filters)
  ]);
  const canExport = hasDirectPortalPermission(
    context.permissionKeys,
    reportExportPermission
  );
  const paymentTotal = report.payments.reduce(
    (sum, row) => sum + row.amount,
    BigInt(0)
  );

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Izvještaji / Plaćanja</p>
          <h2>Promet po načinu plaćanja</h2>
          <p className="muted-text">
            Naplate po fiskalizovanim OFFICE i POS dokumentima, uz negativne
            iznose korektivnih dokumenata.
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-button" href="/portal/izvjestaji">
            Svi izvještaji
          </Link>
        </div>
      </header>

      <DirectPortalReportFilters
        kind="placanja"
        filters={filters}
        options={options}
        canExport={canExport}
      />

      <section className="metric-grid portal-report-metrics" aria-label="Sažetak plaćanja">
        <article>
          <span>Dokumenata</span>
          <strong>{report.totals.count}</strong>
          <small>
            {report.totals.ordinaryCount} računa · {report.totals.correctionCount} storna
          </small>
        </article>
        <article>
          <span>Neto evidentirana plaćanja</span>
          <strong>{formatPortalMoney(paymentTotal)} €</strong>
        </article>
        <article>
          <span>Neto vrijednost dokumenata</span>
          <strong>{formatPortalMoney(report.totals.gross)} €</strong>
        </article>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Načini plaćanja</h3>
            <p className="muted-text">
              Otvorite drill-down da biste vidjeli dokumente konkretnog načina
              plaćanja.
            </p>
          </div>
        </div>
        {report.payments.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Način plaćanja</th>
                  <th>Neto iznos</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {report.payments.map((row) => (
                  <tr key={row.method}>
                    <td>
                      {directPortalReportPaymentLabels[row.method] ?? row.method}
                    </td>
                    <td>{formatPortalMoney(row.amount)} €</td>
                    <td>
                      <Link
                        className="table-button"
                        href={`/portal/izvjestaji/placanja?${directPortalReportQuery(
                          filters,
                          { placanje: row.method }
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
          <p className="muted-text">Nema plaćanja za izabrane filtere.</p>
        )}
      </section>

      <DirectPortalReportDocuments documents={report.documents} />
    </div>
  );
}
