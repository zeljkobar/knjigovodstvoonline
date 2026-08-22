import Link from "next/link";
import { notFound } from "next/navigation";
import { retryPortalPosFiscalization } from "@/app/portal/pos/actions";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { hasDirectPortalPermission } from "@/lib/direct-portal-policy";
import { portalPaymentLabels } from "@/lib/direct-portal-dashboard";
import {
  findDirectPortalInvoice,
  formatPortalDecimal,
  isFinalPortalPosReceipt,
  portalDocumentTypeLabels,
  portalFiscalEnvironmentLabels,
  portalFiscalStatusFilterLabels,
  portalFiscalStatusTone,
  portalSalesChannelLabels
} from "@/lib/direct-portal-invoices";

type Snapshot = Record<string, string | null | undefined>;

function snapshot(value: unknown): Snapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item === null || item === undefined || typeof item === "string"
    )
  );
}

function date(value: Date | null | undefined, withTime = false) {
  if (!value) return "—";
  return withTime
    ? value.toLocaleString("sr-Latn-ME", { timeZone: "Europe/Podgorica" })
    : value.toLocaleDateString("sr-Latn-ME", { timeZone: "Europe/Podgorica" });
}

export default async function DirectPortalInvoiceDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ retry?: string; storno?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const context = await requireDirectPortalContext(
    { modul: "fiskalizacija", akcija: "view" },
    `/portal/racuni/${id}`
  );
  const invoice = await findDirectPortalInvoice(context, id);
  if (!invoice) notFound();

  const buyer = snapshot(invoice.buyer_snapshot);
  const shownBuyer: Snapshot = Object.keys(buyer).length > 0
    ? buyer
    : {
        naziv: invoice.kupac.naziv,
        pib: invoice.kupac.pib,
        pdvBroj: invoice.kupac.pdv_broj,
        adresa: invoice.kupac.adresa,
        grad: invoice.kupac.grad,
        drzava: invoice.kupac.drzava,
        telefon: invoice.kupac.telefon,
        email: invoice.kupac.email
      };
  const number = invoice.official_invoice_number ?? invoice.broj_racuna;
  const canPrintThermal = isFinalPortalPosReceipt(invoice);
  const canRetryPos =
    invoice.document_type === "POS_RECEIPT" &&
    invoice.fiscal_status === "FiscalizationFailed" &&
    !context.year.zakljucena &&
    !context.readiness.blocksChanges &&
    hasDirectPortalPermission(context.permissionKeys, {
      modul: "pos",
      akcija: "create"
    });
  const canCreateStorno =
    invoice.document_type === "POS_RECEIPT" &&
    invoice.fiscal_status === "Fiscalized" &&
    Boolean(invoice.iic && invoice.jikr && invoice.fiscal_api_invoice_id) &&
    invoice.corrective_invoices.length === 0 &&
    !context.year.zakljucena &&
    !context.readiness.blocksChanges &&
    hasDirectPortalPermission(context.permissionKeys, {
      modul: "fiskalizacija",
      akcija: "cancel"
    });

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Fiskalni računi / Detalj</p>
          <h2>{number}</h2>
          <p className="muted-text">
            {portalDocumentTypeLabels[invoice.document_type] ?? invoice.document_type} · {date(invoice.issued_at ?? invoice.created_at, true)}
          </p>
        </div>
        <div className="header-actions">
          <span className={`status-pill ${portalFiscalStatusTone(invoice.fiscal_status)}`}>
            {portalFiscalStatusFilterLabels[invoice.fiscal_status] ?? "Status nije dostupan"}
          </span>
          {invoice.fiscal_environment === "Test" ? (
            <span className="status-pill status-pill--warning">TEST</span>
          ) : null}
          <Link className="secondary-button" href={`/stampa/portal/racuni/${invoice.id}`} target="_blank" prefetch={false}>A4 štampa</Link>
          {canPrintThermal ? (
            <>
              <Link className="secondary-button" href={`/stampa/portal/racuni/${invoice.id}/termalni?sirina=58`} target="_blank" prefetch={false}>58 mm</Link>
              <Link className="secondary-button" href={`/stampa/portal/racuni/${invoice.id}/termalni?sirina=80`} target="_blank" prefetch={false}>80 mm</Link>
            </>
          ) : null}
          {canCreateStorno ? (
            <Link className="danger-button" href={`/portal/racuni/${invoice.id}/storno`}>
              Storniraj račun
            </Link>
          ) : null}
          <Link className="secondary-button" href="/portal/racuni">Nazad</Link>
        </div>
      </header>

      {query.retry === "fiscalized" ? (
        <p className="status-banner success" role="status">
          Fiskalizacija je potvrđena na postojećem dokumentu. Novi račun nije kreiran.
        </p>
      ) : null}
      {query.retry === "failed" ? (
        <p className="status-banner error" role="alert">
          Ponovni pokušaj nije uspio. Dokument je ostao sačuvan i nije kreiran novi račun.
          {invoice.correlation_id ? ` ID za podršku: ${invoice.correlation_id}` : ""}
        </p>
      ) : null}
      {query.retry && !["fiscalized", "failed"].includes(query.retry) ? (
        <p className="status-banner error" role="alert">
          Ponovni pokušaj trenutno nije dozvoljen. Provjerite podešavanja, poslovnu godinu i lager.
        </p>
      ) : null}
      {query.storno === "fiscalized" ? (
        <p className="status-banner success" role="status">
          Storno je fiskalizovan. Originalni račun je povezan sa ovim korektivnim dokumentom.
        </p>
      ) : null}
      {query.storno === "failed" ? (
        <p className="status-banner error" role="alert">
          Storno dokument je sačuvan, ali fiskalizacija nije završena. Ne pravite novi storno za isti račun.
        </p>
      ) : null}

      {invoice.fiscal_status === "FiscalizationFailed" ? (
        <section className="status-banner error" role="alert">
          <p>
            Fiskalizacija nije završena. Dokument je sačuvan i ne treba praviti novi dokument za istu prodaju.
            {invoice.correlation_id ? ` ID za podršku: ${invoice.correlation_id}` : ""}
          </p>
          {canRetryPos ? (
            <form action={retryPortalPosFiscalization}>
              <input name="invoice_id" type="hidden" value={invoice.id} />
              <button className="primary-button" type="submit">Pokušaj ponovo</button>
            </form>
          ) : invoice.sales_channel === "OFFICE" ? (
            <Link className="primary-button" href={`/portal/fakture/${invoice.id}`}>
              Otvori kontrolisani ponovni pokušaj
            </Link>
          ) : (
            <p>Nemate pravo za ponovni pokušaj ili je rad trenutno blokiran.</p>
          )}
        </section>
      ) : null}
      {invoice.fiscal_status === "FiscalizationPending" ? (
        <p className="status-banner error" role="status">
          Fiskalizacija je još u obradi. Ne kreirajte novi dokument za istu prodaju.
          {invoice.correlation_id ? ` ID za podršku: ${invoice.correlation_id}` : ""}
        </p>
      ) : null}

      <section className="metric-grid" aria-label="Iznosi računa">
        <article className="metric"><span>Osnovica</span><strong>{formatPortalDecimal(invoice.ukupno_osnovica)} €</strong></article>
        <article className="metric"><span>PDV</span><strong>{formatPortalDecimal(invoice.ukupno_izlazni_pdv)} €</strong></article>
        <article className="metric"><span>Ukupno</span><strong>{formatPortalDecimal(invoice.ukupno_sa_pdv)} €</strong></article>
      </section>

      <section className="admin-panel">
        <div className="panel-header"><h3>Podaci dokumenta</h3><span>{context.year.godina}</span></div>
        <div className="invoice-summary-grid">
          <span>Tip <strong>{portalDocumentTypeLabels[invoice.document_type] ?? invoice.document_type}</strong></span>
          <span>Kanal <strong>{portalSalesChannelLabels[invoice.sales_channel] ?? invoice.sales_channel}</strong></span>
          <span>Lokalni broj <strong>{invoice.interni_broj}</strong></span>
          <span>Zvanični broj <strong>{invoice.official_invoice_number ?? "—"}</strong></span>
          <span>Datum računa <strong>{date(invoice.datum_racuna)}</strong></span>
          <span>Datum prometa <strong>{date(invoice.datum_prometa)}</strong></span>
          <span>Vrijeme izdavanja <strong>{date(invoice.issued_at, true)}</strong></span>
          <span>Fiskalno okruženje <strong>{portalFiscalEnvironmentLabels[invoice.fiscal_environment ?? ""] ?? "—"}</strong></span>
          <span>Način plaćanja <strong>{portalPaymentLabels[invoice.nacin_placanja] ?? invoice.nacin_placanja}</strong></span>
          <span>Kasa <strong>{invoice.pos_register ? `${invoice.pos_register.sifra} · ${invoice.pos_register.naziv}` : "—"}</strong></span>
          <span>Magacin <strong>{invoice.magacin ? `${invoice.magacin.sifra} · ${invoice.magacin.naziv}` : "—"}</strong></span>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-header"><h3>Kupac</h3></div>
        <div className="invoice-summary-grid">
          <span>Naziv <strong>{shownBuyer.naziv ?? "—"}</strong></span>
          <span>PIB / poreski broj <strong>{shownBuyer.pib ?? "—"}</strong></span>
          <span>PDV broj <strong>{shownBuyer.pdvBroj ?? "—"}</strong></span>
          <span>Adresa <strong>{[shownBuyer.adresa, shownBuyer.grad, shownBuyer.drzava].filter(Boolean).join(", ") || "—"}</strong></span>
          <span>Telefon <strong>{shownBuyer.telefon ?? "—"}</strong></span>
          <span>E-mail <strong>{shownBuyer.email ?? "—"}</strong></span>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-header"><h3>Stavke</h3><span>{invoice.stavke.length}</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Šifra</th><th>Naziv</th><th>JM</th><th>Količina</th><th>Cijena bez PDV</th><th>Rabat</th><th>PDV</th><th>Ukupno</th></tr></thead>
            <tbody>
              {invoice.stavke.map((line) => (
                <tr key={line.id}>
                  <td>{line.redni_broj}</td>
                  <td>{line.sifra_artikla}</td>
                  <td><strong>{line.naziv_artikla}</strong>{line.napomena ? <small>{line.napomena}</small> : null}</td>
                  <td>{line.jedinica_mjere}</td>
                  <td>{formatPortalDecimal(line.kolicina, 3)}</td>
                  <td>{formatPortalDecimal(line.jedinicna_cijena_bez_pdv, 4)} €</td>
                  <td>{formatPortalDecimal(line.rabat_procenat, 4)}%</td>
                  <td>{formatPortalDecimal(line.pdv_stopa_procenat)}%</td>
                  <td><strong>{formatPortalDecimal(line.ukupno_sa_pdv)} €</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-header"><h3>Plaćanja</h3></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Način</th><th>Referenca</th><th>Iznos</th></tr></thead>
            <tbody>
              {invoice.placanja.length > 0 ? invoice.placanja.map((payment) => (
                <tr key={payment.id}>
                  <td>{payment.redni_broj}</td>
                  <td>{portalPaymentLabels[payment.payment_method] ?? payment.payment_method}</td>
                  <td>{payment.reference ?? "—"}</td>
                  <td>{formatPortalDecimal(payment.amount)} €</td>
                </tr>
              )) : (
                <tr><td>1</td><td>{portalPaymentLabels[invoice.nacin_placanja] ?? invoice.nacin_placanja}</td><td>—</td><td>{formatPortalDecimal(invoice.ukupno_sa_pdv)} €</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {invoice.poreske_stavke.length > 0 ? (
        <section className="admin-panel">
          <div className="panel-header"><h3>PDV rekapitulacija</h3></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Stopa</th><th>Osnovica</th><th>PDV</th><th>Ukupno</th></tr></thead>
              <tbody>{invoice.poreske_stavke.map((tax) => (
                <tr key={tax.id}><td>{tax.vat_rate_name} ({formatPortalDecimal(tax.vat_rate_percent)}%)</td><td>{formatPortalDecimal(tax.tax_base)} €</td><td>{formatPortalDecimal(tax.output_vat_amount)} €</td><td>{formatPortalDecimal(tax.total_with_vat)} €</td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="admin-panel">
        <div className="panel-header"><h3>Fiskalni rezultat</h3><span>{portalFiscalStatusFilterLabels[invoice.fiscal_status] ?? "Status nije dostupan"}</span></div>
        <div className="invoice-summary-grid">
          <span>IKOF <strong>{invoice.iic ?? "—"}</strong></span>
          <span>JIKR <strong>{invoice.jikr ?? "—"}</strong></span>
          <span>Fiskalizovano <strong>{date(invoice.fiscalized_at, true)}</strong></span>
          <span>ID za podršku <strong>{invoice.correlation_id ?? "—"}</strong></span>
        </div>
      </section>

      {invoice.original_invoice || invoice.corrective_invoices.length > 0 ? (
        <section className="admin-panel">
          <div className="panel-header"><h3>Povezani dokumenti</h3></div>
          <div className="table-actions">
            {invoice.original_invoice ? (
              <Link className="table-button" href={`/portal/racuni/${invoice.original_invoice.id}`}>
                Original: {invoice.original_invoice.official_invoice_number ?? invoice.original_invoice.broj_racuna}
              </Link>
            ) : null}
            {invoice.corrective_invoices.map((correction) => (
              <Link className="table-button" href={`/portal/racuni/${correction.id}`} key={correction.id}>
                Korekcija: {correction.official_invoice_number ?? correction.broj_racuna}
              </Link>
            ))}
          </div>
          {invoice.correction_reason ? <p className="muted-text">Razlog storna: {invoice.correction_reason}</p> : null}
        </section>
      ) : null}

      {invoice.fiskalni_pokusaji.length > 0 ? (
        <section className="admin-panel">
          <div className="panel-header"><h3>Istorija fiskalizacije</h3><span>Posljednjih {invoice.fiskalni_pokusaji.length}</span></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Pokušaj</th><th>Početak</th><th>Završetak</th><th>Status</th><th>ID za podršku</th></tr></thead>
              <tbody>{invoice.fiskalni_pokusaji.map((attempt) => (
                <tr key={attempt.id}><td>{attempt.attempt_number}</td><td>{date(attempt.started_at, true)}</td><td>{date(attempt.finished_at, true)}</td><td>{attempt.status}</td><td>{attempt.correlation_id ?? "—"}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
