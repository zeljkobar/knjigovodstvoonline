import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { PrintButton } from "@/components/PrintButton";
import { getPosContext } from "@/lib/pos";
import { posPaymentLabels } from "@/lib/pos-reports";
import { prisma } from "@/lib/prisma";

type Snapshot = Record<string, string | null | undefined>;
const snapshot = (value: unknown): Snapshot => value && typeof value === "object" && !Array.isArray(value) ? value as Snapshot : {};
const money = (value: { toString(): string }, digits = 2) => Number(value.toString()).toLocaleString("sr-Latn-ME", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export default async function PosReceiptPrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sirina?: string }> }) {
  const ctx = await getPosContext("view");
  const { id } = await params;
  const query = await searchParams;
  if (!ctx.firma || !ctx.year || !ctx.allowed || !ctx.user.agencija_id) notFound();
  const width = query.sirina === "58" ? "58" : "80";
  const invoice = await prisma.fiskalniIzlazniRacun.findFirst({
    where: { id, agencija_id: ctx.user.agencija_id, firma_id: ctx.firma.id, poslovna_godina_id: ctx.year.id, sales_channel: "POS", is_deleted: false },
    include: { pos_register: true, kupac: true, stavke: { orderBy: { redni_broj: "asc" } }, poreske_stavke: { orderBy: { vat_rate_percent: "desc" } }, placanja: true, original_invoice: { select: { official_invoice_number: true, broj_racuna: true } }, corrective_invoices: { where: { is_deleted: false, fiscal_status: "Fiscalized" }, select: { official_invoice_number: true, broj_racuna: true }, take: 1 } }
  });
  if (!invoice) notFound();
  const issuer = snapshot(invoice.issuer_snapshot);
  const buyer = snapshot(invoice.buyer_snapshot);
  const qrDataUrl = invoice.qr_code_data ? await QRCode.toDataURL(invoice.qr_code_data, { errorCorrectionLevel: "M", margin: 0, width: 360 }) : null;
  const isReturn = invoice.document_type === "POS_RETURN";
  const correction = invoice.corrective_invoices[0];
  const number = invoice.official_invoice_number ?? invoice.broj_racuna;

  return <main className="pos-receipt-page"><div className="print-toolbar pos-receipt-toolbar"><Link className="print-button print-back-button" href="/agencija/pos/racuni">Nazad</Link><Link className={`print-button ${width === "58" ? "active" : ""}`} href={`/stampa/pos/racuni/${invoice.id}?sirina=58`}>58 mm</Link><Link className={`print-button ${width === "80" ? "active" : ""}`} href={`/stampa/pos/racuni/${invoice.id}?sirina=80`}>80 mm</Link><PrintButton label="Štampaj račun"/></div>
    <article className={`pos-receipt pos-receipt--${width}`}>
      <header><h1>{issuer.naziv ?? ctx.firma.naziv}</h1><p>{[issuer.adresa ?? ctx.firma.adresa, issuer.grad ?? ctx.firma.grad].filter(Boolean).join(", ")}</p><p>PIB: {issuer.pib ?? ctx.firma.pib}</p></header>
      <div className="pos-receipt-rule"/><section className="pos-receipt-title"><strong>{isReturn ? "STORNO / KOREKTIVNI RAČUN" : invoice.fiscal_status === "StornoCreated" ? "STORNIRANI FISKALNI RAČUN" : "FISKALNI RAČUN"}</strong><span>{number}</span><small>Interni broj: {invoice.interni_broj}</small></section>
      <dl><div><dt>Datum i vrijeme</dt><dd>{invoice.issued_at?.toLocaleString("sr-Latn-ME")}</dd></div><div><dt>Kasa</dt><dd>{invoice.pos_register?.naziv ?? "-"}</dd></div><div><dt>ENU</dt><dd>{invoice.pos_register?.fiscal_device_code ?? "-"}</dd></div></dl>
      {buyer.naziv ? <section className="pos-receipt-buyer"><strong>Kupac: {buyer.naziv}</strong>{buyer.pib ? <span>PIB: {buyer.pib}</span> : null}</section> : null}
      <div className="pos-receipt-rule"/>
      <section className="pos-receipt-lines">{invoice.stavke.map((line) => <div key={line.id}><strong>{line.naziv_artikla}</strong><p><span>{money(line.kolicina, 3)} × {money(line.jedinicna_cijena_sa_pdv, 4)}</span><b>{money(line.ukupno_sa_pdv)} €</b></p><small>{line.sifra_artikla} · PDV {money(line.pdv_stopa_procenat)}%</small></div>)}</section>
      <div className="pos-receipt-rule"/><section className="pos-receipt-totals"><p><span>Osnovica</span><strong>{money(invoice.ukupno_osnovica)} €</strong></p><p><span>PDV</span><strong>{money(invoice.ukupno_izlazni_pdv)} €</strong></p><p className="grand"><span>UKUPNO</span><strong>{money(invoice.ukupno_sa_pdv)} €</strong></p></section>
      <section className="pos-receipt-payments">{invoice.placanja.map((payment) => <p key={payment.id}><span>{posPaymentLabels[payment.payment_method] ?? payment.payment_method}</span><strong>{money(payment.amount)} €</strong></p>)}</section>
      <section className="pos-receipt-tax"><strong>PDV rekapitulacija</strong>{invoice.poreske_stavke.map((tax) => <p key={tax.id}><span>{money(tax.vat_rate_percent)}%</span><span>{money(tax.tax_base)}</span><span>{money(tax.output_vat_amount)}</span><span>{money(tax.total_with_vat)}</span></p>)}</section>
      {isReturn && invoice.original_invoice ? <p className="pos-receipt-reference">Storno računa: {invoice.original_invoice.official_invoice_number ?? invoice.original_invoice.broj_racuna}<br/>Razlog: {invoice.correction_reason ?? "-"}</p> : null}
      {!isReturn && correction ? <p className="pos-receipt-reference">Račun je storniran dokumentom: {correction.official_invoice_number ?? correction.broj_racuna}</p> : null}
      {qrDataUrl ? <section className="pos-receipt-fiscal"><Image unoptimized width={360} height={360} src={qrDataUrl} alt="QR kod fiskalnog računa"/><p>IKOF: {invoice.iic}</p><p>JIKR: {invoice.jikr}</p></section> : <p className="pos-receipt-reference">Račun nema fiskalni QR kod.</p>}
      <footer>Hvala na povjerenju.</footer>
    </article>
  </main>;
}
