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
  isFinalPortalFiscalDocument,
  portalDocumentTypeLabels,
  portalFiscalStatusFilterLabels
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

function date(value: Date | null) {
  return value?.toLocaleDateString("sr-Latn-ME", {
    timeZone: "Europe/Podgorica"
  }) ?? "—";
}

function percent(value: bigint) {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / BigInt(100)},${String(
    absolute % BigInt(100)
  ).padStart(2, "0")}`;
}

export default async function DirectPortalInvoiceA4PrintPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireDirectPortalContext(
    { modul: "fiskalizacija", akcija: "view" },
    `/portal/racuni/${id}`
  );
  const invoice = await findDirectPortalInvoice(context, id);
  if (!invoice) notFound();
  if (isFinalPortalFiscalDocument(invoice)) {
    await auditDirectPortalInvoicePrint({
      context,
      invoice,
      format: "A4"
    });
  }

  const storedIssuer = snapshot(invoice.issuer_snapshot);
  const storedBuyer = snapshot(invoice.buyer_snapshot);
  const bank = invoice.firma.bankovni_racuni[0];
  const issuer: Snapshot = Object.keys(storedIssuer).length > 0
    ? storedIssuer
    : {
        naziv: invoice.firma.naziv,
        skraceniNaziv: invoice.firma.skraceni_naziv,
        pib: invoice.firma.pib,
        pdvBroj: invoice.firma.pdv_broj,
        adresa: invoice.firma.adresa,
        grad: invoice.firma.grad,
        drzava: invoice.firma.drzava,
        telefon: invoice.firma.telefon,
        email: invoice.firma.email,
        webSajt: invoice.firma.web_sajt,
        banka: bank?.naziv_banke,
        ziroRacun: bank?.broj_racuna
      };
  const buyer: Snapshot = Object.keys(storedBuyer).length > 0
    ? storedBuyer
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
  const hasFiscalResult = ["Fiscalized", "StornoCreated"].includes(
    invoice.fiscal_status
  ) && Boolean(invoice.iic && invoice.jikr && invoice.qr_code_data);
  const qrDataUrl = hasFiscalResult && invoice.qr_code_data
    ? await QRCode.toDataURL(invoice.qr_code_data, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 240
      })
    : null;
  const invoiceNumber = invoice.official_invoice_number ?? invoice.broj_racuna;
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
    <main className="print-page invoice-print-page">
      <div className="print-toolbar">
        <Link className="print-button print-back-button" href={`/portal/racuni/${invoice.id}`}>Nazad</Link>
        <PrintButton label="Štampaj račun" />
      </div>
      <article className="invoice-print-document">
        {invoice.fiscal_environment === "Test" ? (
          <div className="invoice-print-watermark invoice-print-watermark--test">
            TEST / NIJE ZA PRODUKCIJU
          </div>
        ) : invoice.status === "DRAFT" && !hasFiscalResult ? (
          <div className="invoice-print-watermark">NACRT / DRAFT</div>
        ) : null}
        <header className="invoice-print-header">
          <div className="invoice-print-brand">
            <div className="invoice-print-monogram">
              {(issuer.skraceniNaziv ?? issuer.naziv ?? "SS").slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h1>{issuer.naziv}</h1>
              <p>{[issuer.adresa, issuer.grad, issuer.drzava].filter(Boolean).join(", ")}</p>
              <p>PIB / Tax ID: {issuer.pib ?? "—"}{issuer.pdvBroj ? ` · PDV / VAT: ${issuer.pdvBroj}` : ""}</p>
            </div>
          </div>
          <div className="invoice-print-title">
            <span>{portalDocumentTypeLabels[invoice.document_type] ?? "IZLAZNA FAKTURA"} / SALES INVOICE</span>
            <strong>{invoiceNumber}</strong>
            <small>Poslovna oznaka / Internal reference: {invoice.interni_broj}</small>
          </div>
        </header>

        <section className="invoice-print-parties">
          <div>
            <span>IZDAVALAC / SUPPLIER</span><h2>{issuer.naziv}</h2>
            <p>{[issuer.adresa, issuer.grad].filter(Boolean).join(", ")}</p>
            <p>PIB / Tax ID: {issuer.pib ?? "—"}</p>
            {issuer.telefon || issuer.email ? <p>{[issuer.telefon, issuer.email].filter(Boolean).join(" · ")}</p> : null}
          </div>
          <div>
            <span>KUPAC / CUSTOMER</span><h2>{buyer.naziv}</h2>
            <p>{[buyer.adresa, buyer.grad, buyer.drzava].filter(Boolean).join(", ")}</p>
            <p>PIB / Tax ID: {buyer.pib ?? "—"}{buyer.pdvBroj ? ` · PDV / VAT: ${buyer.pdvBroj}` : ""}</p>
            {buyer.email ? <p>{buyer.email}</p> : null}
          </div>
        </section>

        <section className="invoice-print-meta">
          <div><span>Datum računa / Invoice date</span><strong>{date(invoice.datum_racuna)}</strong></div>
          <div><span>Datum prometa / Supply date</span><strong>{date(invoice.datum_prometa)}</strong></div>
          <div><span>Rok plaćanja / Due date</span><strong>{date(invoice.datum_valute)}</strong></div>
          <div><span>Način plaćanja / Payment</span><strong>{portalPaymentLabels[invoice.nacin_placanja] ?? invoice.nacin_placanja}</strong></div>
        </section>

        <table className="invoice-print-table">
          <thead><tr><th>#</th><th>Šifra<br />Code</th><th>Opis robe / usluge<br />Description</th><th>JM<br />Unit</th><th>Količina<br />Qty</th><th>Cijena bez PDV<br />Price excl. VAT</th><th>Rabat<br />Discount</th><th>PDV<br />VAT</th><th>Ukupno<br />Total</th></tr></thead>
          <tbody>{invoice.stavke.map((line) => (
            <tr key={line.id}>
              <td>{line.redni_broj}</td><td>{line.sifra_artikla}</td>
              <td><strong>{line.naziv_artikla}</strong>{line.napomena ? <small>{line.napomena}</small> : null}</td>
              <td>{line.jedinica_mjere}</td><td>{formatPortalDecimal(line.kolicina, 3)}</td>
              <td>{formatPortalDecimal(line.jedinicna_cijena_bez_pdv, 4)}</td>
              <td>{formatPortalDecimal(line.rabat_procenat, 4)}%</td>
              <td>{formatPortalDecimal(line.pdv_stopa_procenat)}%</td>
              <td><strong>{formatPortalDecimal(line.ukupno_sa_pdv)}</strong></td>
            </tr>
          ))}</tbody>
        </table>

        <section className="invoice-print-bottom">
          <div className="invoice-print-payment">
            <h3>Podaci za plaćanje / Payment details</h3>
            <p><span>Banka / Bank</span><strong>{issuer.banka ?? "—"}</strong></p>
            <p><span>Žiro račun / Bank account</span><strong>{issuer.ziroRacun ?? "—"}</strong></p>
            <p><span>Poziv / opis / Reference</span><strong>{invoiceNumber}</strong></p>
            {invoice.napomena ? <div className="invoice-print-note"><span>Napomena / Note</span><p>{invoice.napomena}</p></div> : null}
          </div>
          <div className="invoice-print-totals">
            <p><span>Osnovica / Net</span><strong>{formatPortalDecimal(invoice.ukupno_osnovica)} €</strong></p>
            <p><span>Rabat / Discount</span><strong>{formatPortalDecimal(invoice.ukupno_rabat)} €</strong></p>
            <p><span>PDV / VAT</span><strong>{formatPortalDecimal(invoice.ukupno_izlazni_pdv)} €</strong></p>
            <p className="invoice-print-grand-total"><span>ZA PLAĆANJE / AMOUNT DUE</span><strong>{formatPortalDecimal(invoice.ukupno_sa_pdv)} €</strong></p>
          </div>
        </section>

        <section className="invoice-print-tax">
          <h3>Rekapitulacija PDV-a / VAT summary</h3>
          <table><thead><tr><th>Stopa / Rate</th><th>Osnovica / Tax base</th><th>PDV / VAT</th><th>Ukupno / Total</th></tr></thead>
            <tbody>{taxRows.map((tax) => (
              <tr key={tax.key}><td>{percent(tax.rate)}%</td><td>{formatPortalMoney(tax.base)} €</td><td>{formatPortalMoney(tax.vat)} €</td><td>{formatPortalMoney(tax.total)} €</td></tr>
            ))}</tbody>
          </table>
        </section>

        <section className={`invoice-print-fiscal ${hasFiscalResult ? "is-fiscalized" : ""}`}>
          {qrDataUrl ? <Image unoptimized width={240} height={240} src={qrDataUrl} alt="QR kod za provjeru fiskalnog računa" /> : null}
          <div>
            <span>FISKALNI STATUS / FISCAL STATUS</span>
            <h3>{portalFiscalStatusFilterLabels[invoice.fiscal_status] ?? "Status nije dostupan"}</h3>
            {hasFiscalResult ? (
              <><p><strong>IKOF:</strong> {invoice.iic}</p><p><strong>JIKR:</strong> {invoice.jikr}</p><p className="invoice-print-qr-url">QR vodi na zvaničnu provjeru Poreske uprave.</p></>
            ) : (
              <p>Fiskalni QR se prikazuje tek nakon uspješne fiskalizacije.</p>
            )}
          </div>
        </section>

        <footer className="invoice-print-footer">
          <span>Dokument je generisan elektronski. / This document was generated electronically.</span>
          <span>{issuer.webSajt ?? issuer.email ?? ""}</span>
        </footer>
      </article>
    </main>
  );
}
