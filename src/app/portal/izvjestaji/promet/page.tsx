import Link from "next/link";
import { DirectPortalReportDocuments } from "@/components/DirectPortalReportDocuments";
import { DirectPortalReportFilters } from "@/components/DirectPortalReportFilters";
import { formatPortalMoney } from "@/lib/direct-portal-dashboard";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { hasDirectPortalPermission } from "@/lib/direct-portal-policy";
import {
  directPortalReportChannelLabels,
  directPortalReportQuery,
  loadDirectPortalReport,
  loadDirectPortalReportOptions,
  parseDirectPortalReportFilters,
  type DirectPortalReportSearchParams
} from "@/lib/direct-portal-reports";

const reportViewPermission = { modul: "izvjestaji", akcija: "view" };
const reportExportPermission = { modul: "izvjestaji", akcija: "export" };

export default async function DirectPortalTurnoverReportPage({
  searchParams
}: {
  searchParams: Promise<DirectPortalReportSearchParams>;
}) {
  const [context, params] = await Promise.all([
    requireDirectPortalContext(
      reportViewPermission,
      "/portal/izvjestaji/promet"
    ),
    searchParams
  ]);
  const filters = parseDirectPortalReportFilters(params, context.year);
  const [report, options] = await Promise.all([
    loadDirectPortalReport(context, filters, "promet"),
    loadDirectPortalReportOptions(context, filters)
  ]);
  const canExport = hasDirectPortalPermission(
    context.permissionKeys,
    reportExportPermission
  );

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Izvještaji / Promet</p>
          <h2>Neto promet</h2>
          <p className="muted-text">
            Fiskalizovane OFFICE fakture i POS računi, umanjeni za povezana
            storna.
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-button" href="/portal/izvjestaji">
            Svi izvještaji
          </Link>
        </div>
      </header>

      <DirectPortalReportFilters
        kind="promet"
        filters={filters}
        options={options}
        canExport={canExport}
      />

      <section className="metric-grid portal-report-metrics" aria-label="Sažetak prometa">
        <article>
          <span>Obični računi</span>
          <strong>{report.totals.ordinaryCount}</strong>
        </article>
        <article>
          <span>Storna</span>
          <strong>{report.totals.correctionCount}</strong>
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

      <div className="pos-report-grid">
        <section className="admin-panel">
          <h3>OFFICE naspram POS prodaje</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kanal</th>
                  <th>Dokumenata</th>
                  <th>Neto promet</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {report.channels.map((row) => (
                  <tr key={row.channel}>
                    <td>
                      {directPortalReportChannelLabels[row.channel] ?? row.channel}
                    </td>
                    <td>{row.count}</td>
                    <td>{formatPortalMoney(row.gross)} €</td>
                    <td>
                      <Link
                        className="table-button"
                        href={`/portal/izvjestaji/promet?${directPortalReportQuery(filters, {
                          kanal: row.channel,
                          kasa: null
                        })}#dokumenti`}
                      >
                        Dokumenti
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="admin-panel">
          <h3>Promet po kasi</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kasa / kanal</th>
                  <th>Dokumenata</th>
                  <th>Neto promet</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {report.registers.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.code} · {row.name}
                    </td>
                    <td>{row.count}</td>
                    <td>{formatPortalMoney(row.gross)} €</td>
                    <td>
                      <Link
                        className="table-button"
                        href={`/portal/izvjestaji/promet?${directPortalReportQuery(
                          filters,
                          row.id === "office"
                            ? { kanal: "OFFICE", kasa: null }
                            : { kasa: row.id }
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
        </section>
      </div>

      <section className="admin-panel">
        <h3>Osnovica i PDV po stopi</h3>
        {report.taxes.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Stopa</th>
                  <th>Osnovica</th>
                  <th>PDV</th>
                  <th>Ukupno</th>
                </tr>
              </thead>
              <tbody>
                {report.taxes.map((row) => (
                  <tr key={`${row.code}-${row.rate}`}>
                    <td>
                      {row.name} ({row.rate}%)
                    </td>
                    <td>{formatPortalMoney(row.base)} €</td>
                    <td>{formatPortalMoney(row.vat)} €</td>
                    <td>{formatPortalMoney(row.gross)} €</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted-text">Nema poreskih stavki u izabranom periodu.</p>
        )}
      </section>

      <DirectPortalReportDocuments documents={report.documents} />
    </div>
  );
}
