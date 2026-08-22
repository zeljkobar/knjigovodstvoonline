import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { PrintButton } from "@/components/PrintButton";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { formatPortalMoney, portalPaymentLabels } from "@/lib/direct-portal-dashboard";
import {
  auditDirectPortalInvoicePrint,
  findDirectPortalInvoice,
  formatPortalDecimal,
  isFinalPortalPosReceipt
} from "@/lib/direct-portal-invoices";
import { decimalToScaled } from "@/lib/inventory-calculation";

type Snapshot = Record<string, string | null | undefined>;

function snapshot(value: unknown): Snapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item === null || item === undefined || typeof item === "string"
    )
  );
}

function percent(value: bigint) {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / BigInt(100)},${String(
    absolute % BigInt(100)
  ).padStart(2, "0")}`;
}

export default async function DirectPortalThermalPrintPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sirina?: string | string[] }>;
}) {
  const { id } = await params;
  const context = await requireDirectPortalContext(
    { modul: "fiskalizacija", akcija: "view" },
    `/portal/racuni/${id}`
  );
  const [invoice, query] = await Promise.all([
    findDirectPortalInvoice(context, id),
    searchParams
  ]);
  if (!invoice || !isFinalPortalPosReceipt(invoice)) notFound();

  const requestedWidth = Array.isArray(query.sirina) ? query.sirina[0] : query.sirina;
  const width = requestedWidth === "58" ? "58" : "80";
  await auditDirectPortalInvoicePrint({
    context,
    invoice,
    format: width === "58" ? "THERMAL_58" : "THERMAL_80"
  });
  const issuer = snapshot(invoice.issuer_snapshot);
  const buyer = snapshot(invoice.buyer_snapshot);
  const qrDataUrl = invoice.qr_code_data
    ? await QRCode.toDataURL(invoice.qr_code_data, {
        errorCorrectionLevel: "M",
        margin: 0,
        width: 360
      })
    : null;
  const isReturn = invoice.document_type === "POS_RETURN";
  const correction = invoice.corrective_invoices.find(
    (candidate) => candidate.fiscal_status === "Fiscalized"
  ) ?? invoice.corrective_invoices[0];
  const number = invoice.official_invoice_number ?? invoice.broj_racuna;
  const payments = invoice.placanja.length > 0
    ? invoice.placanja.map((payment) => ({
        key: payment.id,
        method: payment.payment_method,
        amount: decimalToScaled(payment.amount, 2)
      }))
    : [{
        key: "document-payment",
        method: invoice.nacin_placanja,
        amount: decimalToScaled(invoice.ukupno_sa_pdv, 2)
      }];
  const taxRows = invoice.poreske_stavke.length > 0
    ? invoice.poreske_stavke.map((tax) => ({
        key: tax.id,
        rate: decimalToScaled(tax.vat_rate_percent, 2),
        base: decimalToScaled(tax.tax_base, 2),
        vat: decimalToScaled(tax.output_vat_amount, 2),
        total: decimalToScaled(tax.total_with_vat, 2)
      }))
    : [...invoice.stavke.reduce((groups, line) => {
        const key = line.pdv_stopa_sifra;
        const current = groups.get(key) ?? {
          key,
          rate: decimalToScaled(line.pdv_stopa_procenat, 2),
          base: BigInt(0),
          vat: BigInt(0),
          total: BigInt(0)
        };
        current.base += decimalToScaled(line.osnovica, 2);
        current.vat += decimalToScaled(line.pdv_iznos, 2);
        current.total += decimalToScaled(line.ukupno_sa_pdv, 2);
        groups.set(key, current);
        return groups;
      }, new Map<string, { key: string; rate: bigint; base: bigint; vat: bigint; total: bigint }>()).values()];

  return (
    <main className="pos-receipt-page">
      <div className="print-toolbar pos-receipt-toolbar">
        <Link className="print-button print-back-button" href={`/portal/racuni/${invoice.id}`}>Nazad</Link>
        <Link className={`print-button ${width === "58" ? "active" : ""}`} href={`/stampa/portal/racuni/${invoice.id}/termalni?sirina=58`} prefetch={false}>58 mm</Link>
        <Link className={`print-button ${width === "80" ? "active" : ""}`} href={`/stampa/portal/racuni/${invoice.id}/termalni?sirina=80`} prefetch={false}>80 mm</Link>
        <PrintButton label="Štampaj račun" />
      </div>

      <article className={`pos-receipt pos-receipt--${width}`}>
        {invoice.fiscal_environment === "Test" ? (
          <div className="pos-receipt-test-watermark">
            TESTNI RAČUN · NIJE ZA PRODUKCIJU
          </div>
        ) : null}
        <header>
          <h1>{issuer.naziv ?? context.firma.naziv}</h1>
          <p>{[issuer.adresa ?? invoice.firma.adresa, issuer.grad ?? invoice.firma.grad].filter(Boolean).join(", ")}</p>
          <p>PIB: {issuer.pib ?? invoice.firma.pib}</p>
        </header>
        <div className="pos-receipt-rule" />
        <section className="pos-receipt-title">
          <strong>{isReturn ? "STORNO / KOREKTIVNI RAČUN" : invoice.fiscal_status === "StornoCreated" ? "STORNIRANI FISKALNI RAČUN" : "FISKALNI RAČUN"}</strong>
          <span>{number}</span>
          <small>Interni broj: {invoice.interni_broj}</small>
        </section>
        <dl>
          <div><dt>Datum i vrijeme</dt><dd>{(invoice.issued_at ?? invoice.created_at).toLocaleString("sr-Latn-ME", { timeZone: "Europe/Podgorica" })}</dd></div>
          <div><dt>Kasa</dt><dd>{invoice.pos_register?.naziv ?? "—"}</dd></div>
        </dl>
        {(buyer.naziv ?? invoice.kupac.naziv) ? (
          <section className="pos-receipt-buyer">
            <strong>Kupac: {buyer.naziv ?? invoice.kupac.naziv}</strong>
            {buyer.pib ?? invoice.kupac.pib ? <span>PIB: {buyer.pib ?? invoice.kupac.pib}</span> : null}
          </section>
        ) : null}
        <div className="pos-receipt-rule" />
        <section className="pos-receipt-lines">
          {invoice.stavke.map((line) => (
            <div key={line.id}>
              <strong>{line.naziv_artikla}</strong>
              <p><span>{formatPortalDecimal(line.kolicina, 3)} × {formatPortalDecimal(line.jedinicna_cijena_sa_pdv, 4)}</span><b>{formatPortalDecimal(line.ukupno_sa_pdv)} €</b></p>
              <small>{line.sifra_artikla} · PDV {formatPortalDecimal(line.pdv_stopa_procenat)}%</small>
            </div>
          ))}
        </section>
        <div className="pos-receipt-rule" />
        <section className="pos-receipt-totals">
          <p><span>Osnovica</span><strong>{formatPortalDecimal(invoice.ukupno_osnovica)} €</strong></p>
          <p><span>PDV</span><strong>{formatPortalDecimal(invoice.ukupno_izlazni_pdv)} €</strong></p>
          <p className="grand"><span>UKUPNO</span><strong>{formatPortalDecimal(invoice.ukupno_sa_pdv)} €</strong></p>
        </section>
        <section className="pos-receipt-payments">
          {payments.map((payment) => (
            <p key={payment.key}><span>{portalPaymentLabels[payment.method] ?? payment.method}</span><strong>{formatPortalMoney(payment.amount)} €</strong></p>
          ))}
        </section>
        <section className="pos-receipt-tax">
          <strong>PDV rekapitulacija</strong>
          {taxRows.map((tax) => (
            <p key={tax.key}><span>{percent(tax.rate)}%</span><span>{formatPortalMoney(tax.base)}</span><span>{formatPortalMoney(tax.vat)}</span><span>{formatPortalMoney(tax.total)}</span></p>
          ))}
        </section>
        {isReturn && invoice.original_invoice ? (
          <p className="pos-receipt-reference">Storno računa: {invoice.original_invoice.official_invoice_number ?? invoice.original_invoice.broj_racuna}<br />Razlog: {invoice.correction_reason ?? "—"}</p>
        ) : null}
        {!isReturn && correction ? (
          <p className="pos-receipt-reference">Račun je storniran dokumentom: {correction.official_invoice_number ?? correction.broj_racuna}</p>
        ) : null}
        {qrDataUrl ? (
          <section className="pos-receipt-fiscal">
            <Image unoptimized width={360} height={360} src={qrDataUrl} alt="QR kod fiskalnog računa" />
            <p>IKOF: {invoice.iic}</p><p>JIKR: {invoice.jikr}</p>
          </section>
        ) : (
          <p className="pos-receipt-reference">Račun nema fiskalni QR kod.</p>
        )}
        <footer>Hvala na povjerenju.</footer>
      </article>
    </main>
  );
}
