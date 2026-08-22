import Link from "next/link";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import {
  formatPortalMoney,
  loadDirectPortalDashboard
} from "@/lib/direct-portal-dashboard";
import { getDirectPortalNavigation } from "@/lib/portal-navigation";

type PortalPageProps = {
  searchParams: Promise<{
    stanje?: string;
  }>;
};

export default async function PortalPage({ searchParams }: PortalPageProps) {
  const context = await requireDirectPortalContext(undefined, "/portal");
  const [params, dashboard] = await Promise.all([
    searchParams,
    loadDirectPortalDashboard(context)
  ]);
  const navigation = getDirectPortalNavigation(
    context.permissionKeys,
    Boolean(context.firma.posPodesavanje?.aktivan)
  ).filter((item) => item.href !== "/portal");

  return (
    <div className="admin-stack portal-home">
      {params.stanje === "permission_denied" ? (
        <p className="status-banner error" role="alert">
          Nemate pravo za traženu funkciju ove firme.
        </p>
      ) : null}

      <header className="admin-header portal-welcome">
        <div>
          <p className="eyebrow">Direktni fiskalni portal</p>
          <h2>Dobro došli, {context.user.korisnicko_ime}</h2>
          <p className="muted-text">
            Današnji operativni pregled za {context.firma.skraceni_naziv || context.firma.naziv}.
          </p>
        </div>
        {dashboard.environment === "Test" ? (
          <span className="status-pill status-pill--warning">
            TEST · promet nije produkcijski
          </span>
        ) : null}
      </header>

      <section className="metric-grid portal-context-metrics" aria-label="Današnji promet">
        <article>
          <span>Neto fiskalizovani promet</span>
          <strong>{formatPortalMoney(dashboard.totals.netTurnover)} €</strong>
        </article>
        <article>
          <span>Izdati računi</span>
          <strong>{dashboard.totals.ordinaryCount}</strong>
        </article>
        <article>
          <span>Storno dokumenti</span>
          <strong>{dashboard.totals.stornoCount}</strong>
        </article>
        <article>
          <span>Prosječan račun</span>
          <strong>{formatPortalMoney(dashboard.totals.averageOrdinary)} €</strong>
        </article>
        <article>
          <span>Zahtijeva intervenciju</span>
          <strong>{dashboard.totals.interventionCount}</strong>
        </article>
      </section>

      {dashboard.warnings.length > 0 ? (
        <section className="admin-panel portal-warning-list" aria-labelledby="portal-warnings-title">
          <div className="panel-header">
            <h3 id="portal-warnings-title">Upozorenja</h3>
            <span>{dashboard.warnings.length}</span>
          </div>
          {dashboard.warnings.map((warning) => (
            <p className="status-banner error" key={warning.code}>
              {warning.message}
              {warning.correlationId ? ` ID: ${warning.correlationId}` : ""}
            </p>
          ))}
        </section>
      ) : null}

      <div className="portal-dashboard-grid">
        <section className="admin-panel">
          <div className="panel-header">
            <h3>Promet po načinu plaćanja</h3>
          </div>
          {dashboard.payments.length > 0 ? (
            <div className="portal-payment-list">
              {dashboard.payments.map((payment) => (
                <div key={payment.method}>
                  <span>{payment.label}</span>
                  <strong>{formatPortalMoney(payment.amount)} €</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted-text">Danas još nema fiskalizovanog prometa.</p>
          )}
        </section>

        <section className="admin-panel">
          <div className="panel-header">
            <h3>Brze akcije</h3>
          </div>
          <div className="portal-quick-grid compact">
            {navigation.slice(0, 6).map((item) => (
              <Link href={item.href} key={item.href}>
                <span aria-hidden="true">{item.icon}</span>
                <strong>{item.label}</strong>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Posljednji računi</h3>
          <Link className="table-link" href="/portal/racuni">Prikaži sve</Link>
        </div>
        {dashboard.recent.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Vrijeme</th><th>Broj</th><th>Tip</th><th>Kupac</th><th>Plaćanje</th><th>Iznos</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {dashboard.recent.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>{invoice.time.toLocaleString("sr-Latn-ME", { timeZone: "Europe/Podgorica" })}</td>
                    <td><strong>{invoice.number}</strong><small>{invoice.localNumber}</small></td>
                    <td>{invoice.type}</td>
                    <td>{invoice.buyer}</td>
                    <td>{invoice.payment}</td>
                    <td>{formatPortalMoney(invoice.amount)} €</td>
                    <td>
                      {invoice.status}
                      {invoice.environment === "Test" ? (
                        <small className="status-pill status-pill--warning">TEST</small>
                      ) : null}
                    </td>
                    <td><Link className="table-link" href={`/portal/racuni/${invoice.id}`}>Detalj</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted-text">Nema sačuvanih prodajnih dokumenata.</p>
        )}
      </section>
    </div>
  );
}
