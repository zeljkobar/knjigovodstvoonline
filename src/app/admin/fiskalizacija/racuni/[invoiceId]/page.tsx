import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireRole } from "@/lib/auth";
import { fiscalReviewApi } from "@/lib/fiscal-admin-api";
import { fiscalPage, fiscalReviewHref, fiscalReviewRoutes as routes, isFiscalUuid, officialFiscalQr, type FiscalSearch } from "@/lib/fiscal-review-filters";
import { CoverageNotice, ExchangeTable, fiscalLabel, fiscalMoney, fiscalTime, InvoiceLink, ReviewFields, ReviewHeader, ReviewNotice, ReviewPager } from "../../pregledi";
import styles from "../../pregledi.module.css";

export default async function FiscalInvoiceDetailPage({ params, searchParams }: {
  params: Promise<{ invoiceId: string }>; searchParams: Promise<FiscalSearch>;
}) {
  const admin = await requireRole("admin");
  const { invoiceId } = await params;
  if (!isFiscalUuid(invoiceId)) notFound();
  const query = await searchParams;
  const actor = { id: admin.id, name: admin.korisnicko_ime };
  let invoice: Awaited<ReturnType<typeof fiscalReviewApi.invoice>>["data"] | undefined;
  let invoiceError: unknown;
  try { invoice = (await fiscalReviewApi.invoice(actor, invoiceId)).data; }
  catch (error) { invoiceError = error; }
  if (!invoice) return <div className="admin-stack">
    <ReviewHeader title="Detalj računa" description="Fiskalni zapis iz API-ja." active="invoices" />
    <ReviewNotice error={invoiceError} permission="invoices:read" />
  </div>;

  let history: Awaited<ReturnType<typeof fiscalReviewApi.invoiceExchanges>>["data"] | undefined;
  let historyError: unknown;
  try { history = (await fiscalReviewApi.invoiceExchanges(actor, invoiceId, fiscalPage(query.page))).data; }
  catch (error) { historyError = error; }
  const qrUrl = officialFiscalQr(invoice.qrCodeData);
  const qr = qrUrl ? await QRCode.toDataURL(qrUrl, { width: 184, margin: 2 }).catch(() => null) : null;
  const money = (amount?: number | null) => fiscalMoney(amount, invoice.currency);
  const fiscalResource = (entry?: typeof invoice.businessUnit) =>
    entry ? [entry.code, entry.label].filter(Boolean).join(" · ") || "—" : "—";
  const number = invoice.officialInvoiceNumber || invoice.invoiceNumber;
  const related = [
    ["Originalni račun", invoice.originalInvoiceId],
    ["Konačni račun", invoice.advanceSettlementFinalInvoiceId],
    ["Storno konačnog računa", invoice.advanceRestorationStornoInvoiceId]
  ].filter(([, id]) => isFiscalUuid(id));
  return <div className="admin-stack">
    <ReviewHeader title={"Račun " + number} description="Stavke, plaćanja, fiskalni identifikatori i istorija pokušaja." active="invoices" />
    <section className="admin-panel">
      <div className="panel-header"><h3>Fiskalni podaci</h3>
        <div className={styles.links}>
          <Link className="table-link" href={fiscalReviewHref(routes.invoices, { companyId: invoice.companyId })}>Računi ove firme</Link>
          <Link className="table-link" href={fiscalReviewHref(routes.turnover, { companyId: invoice.companyId, environment: invoice.environment })}>Promet ove firme</Link>
        </div>
      </div>
      <ReviewFields fields={[
        ["Status", fiscalLabel(invoice.status)], ["Vrsta", fiscalLabel(invoice.category ?? invoice.invoiceType)],
        ["Okruženje", fiscalLabel(invoice.environment)], ["Dokaz okruženja", fiscalLabel(invoice.environmentSource)],
        ["Vrijeme izdavanja", fiscalTime(invoice.issueDateTime)], ["Fiskalizovan", fiscalTime(invoice.fiscalizedAt)],
        ["Firma (ID)", invoice.companyId], ["Poslovna jedinica", fiscalResource(invoice.businessUnit)],
        ["ENU", fiscalResource(invoice.device)], ["Operater", fiscalResource(invoice.operator)],
        ["Osnovica", money(invoice.totalNetAmount)], ["PDV", money(invoice.totalVatAmount)], ["Ukupno", money(invoice.totalGrossAmount)],
        ["IKOF", invoice.iic], ["JIKR", invoice.jikr],
        ["Kupac", invoice.buyer?.name], ["ID kupca", invoice.buyer?.identificationNumber],
        ["Adresa kupca", [invoice.buyer?.address, invoice.buyer?.town, invoice.buyer?.country].filter(Boolean).join(", ") || "—"],
        ["Početak isporuke", invoice.supplyPeriodStart], ["Kraj isporuke", invoice.supplyPeriodEnd], ["Rok plaćanja", invoice.paymentDeadline]
      ]} />
      {invoice.isInformational ? <p className="admin-message">Informativni dokument; ne predstavlja novi promet.</p> : null}
      {invoice.correctionReason ? <p>Razlog korekcije: {invoice.correctionReason}</p> : null}
      {related.length ? <div className={styles.links}>{related.map(([label, id]) => <InvoiceLink key={label} id={id}>{label}</InvoiceLink>)}</div> : null}
      {qrUrl ? <div>
        {qr ? <Image className={styles.qr} src={qr} width={184} height={184} unoptimized alt="QR kod fiskalnog računa" /> : null}
        <a className="table-link" href={qrUrl} target="_blank" rel="noopener noreferrer">Provjeri račun na portalu Poreske uprave</a>
      </div> : <p>Zvanični QR nije dostupan za ovaj zapis.</p>}
    </section>
    <section className="admin-panel"><div className="panel-header"><h3>Stavke</h3></div>
      {invoice.items.length ? <div className="table-wrap"><table>
        <thead><tr><th>Stavka</th><th>Količina</th><th>Jedinična cijena</th><th>Popust</th><th>PDV stopa</th><th>Osnovica</th><th>PDV</th><th>Bruto</th></tr></thead>
        <tbody>{invoice.items.map(item => <tr key={item.id}><td>{item.name}{item.itemCode ? <small>{item.itemCode}</small> : null}</td>
          <td>{String(item.quantity).replace(".", ",")} {item.unitOfMeasure}</td><td>{money(item.unitPrice)}</td><td>{money(item.discountAmount)}</td>
          <td>{String(item.vatRate).replace(".", ",")}%</td><td>{money(item.netAmount)}</td><td>{money(item.vatAmount)}</td><td>{money(item.grossAmount)}</td>
        </tr>)}</tbody>
      </table></div> : <p>Nema stavki u odgovoru Fiscal API-ja.</p>}
    </section>
    <section className="admin-panel"><div className="panel-header"><h3>Plaćanja na računu</h3></div>
      {invoice.payments.length ? <div className="table-wrap"><table><thead><tr><th>Način</th><th>Iznos</th><th>Referenca</th><th>Avans</th></tr></thead>
        <tbody>{invoice.payments.map(payment => <tr key={payment.paymentType}>
          <td>{fiscalLabel(payment.paymentType)}</td><td>{money(payment.amount)}</td><td>{payment.reference || "—"}</td>
          <td><InvoiceLink id={payment.advanceInvoiceId}>{payment.advanceInvoiceId ? "Otvori avans" : "—"}</InvoiceLink></td>
        </tr>)}</tbody></table></div> : <p>Nema evidentiranih plaćanja.</p>}
    </section>
    <section className="admin-panel"><div className="panel-header"><h3>Istorija fiskalizacije</h3></div>
      <ReviewFields fields={[
        ["Dostupnost", fiscalLabel(invoice.diagnosticsAvailability)],
        ["Posljednji pokušaj", invoice.lastAttempt ? fiscalTime(invoice.lastAttempt.startedAt) + " · " + fiscalLabel(invoice.lastAttempt.outcome) : "—"],
        ["Posljednja greška", invoice.lastError ? invoice.lastError.code + ": " + invoice.lastError.message : "—"],
        ["Posljednje potvrđeno PU odbijanje", invoice.lastPuError ? invoice.lastPuError.code + ": " + invoice.lastPuError.message : "—"]
      ]} />
      {historyError ? <ReviewNotice error={historyError} permission="exchanges:read" /> : null}
      {history ? <><CoverageNotice coverage={history.coverage} /><ExchangeTable items={history.items} />
        <ReviewPager data={history} href={routes.invoices + "/" + invoiceId} query={{}} /></> : null}
    </section>
  </div>;
}
