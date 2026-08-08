import { notFound } from "next/navigation";
import Image from "next/image";
import QRCode from "qrcode";
import { PrintButton } from "@/components/PrintButton";
import { requireAnyRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Snapshot = Record<string, string | null | undefined>;

function snapshot(value: unknown): Snapshot {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Snapshot : {};
}

function money(value: { toString(): string }, digits = 2) {
  return Number(value.toString()).toLocaleString("sr-Latn-ME", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function date(value: Date | null) {
  return value?.toLocaleDateString("sr-Latn-ME") ?? "-";
}

const paymentLabels: Record<string, string> = { BANK_TRANSFER: "Virman", CASH: "Gotovina", CARD: "Kartica", OTHER: "Drugo" };

export default async function OutgoingInvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const { id } = await params;
  if (!user.agencija_id) notFound();

  const invoice = await prisma.fiskalniIzlazniRacun.findFirst({
    where: {
      id,
      agencija_id: user.agencija_id,
      is_deleted: false,
      ...(user.rola === "admin_agencije" ? {} : { firma: { korisnici: { some: { korisnik_id: user.id, is_deleted: false } } } })
    },
    include: {
      firma: { include: { bankovni_racuni: { where: { aktivan: true, is_deleted: false }, orderBy: [{ glavni: "desc" }, { created_at: "asc" }], take: 1 } } },
      kupac: true,
      poslovna_godina: { select: { godina: true } },
      stavke: { orderBy: { redni_broj: "asc" } },
      poreske_stavke: { orderBy: { vat_rate_percent: "desc" } }
    }
  });
  if (!invoice) notFound();

  const storedIssuer = snapshot(invoice.issuer_snapshot);
  const storedBuyer = snapshot(invoice.buyer_snapshot);
  const bank = invoice.firma.bankovni_racuni[0];
  const issuer: Snapshot = Object.keys(storedIssuer).length ? storedIssuer : {
    naziv: invoice.firma.naziv, skraceniNaziv: invoice.firma.skraceni_naziv, pib: invoice.firma.pib,
    pdvBroj: invoice.firma.pdv_broj, adresa: invoice.firma.adresa, grad: invoice.firma.grad,
    drzava: invoice.firma.drzava, telefon: invoice.firma.telefon, email: invoice.firma.email,
    webSajt: invoice.firma.web_sajt, banka: bank?.naziv_banke, ziroRacun: bank?.broj_racuna
  };
  const buyer: Snapshot = Object.keys(storedBuyer).length ? storedBuyer : {
    naziv: invoice.kupac.naziv, pib: invoice.kupac.pib, pdvBroj: invoice.kupac.pdv_broj,
    adresa: invoice.kupac.adresa, grad: invoice.kupac.grad, drzava: invoice.kupac.drzava,
    telefon: invoice.kupac.telefon, email: invoice.kupac.email
  };
  const fiscalized = invoice.fiscal_status === "Fiscalized" && Boolean(invoice.iic && invoice.jikr && invoice.qr_code_data);
  const qrDataUrl = fiscalized && invoice.qr_code_data
    ? await QRCode.toDataURL(invoice.qr_code_data, { errorCorrectionLevel: "M", margin: 1, width: 240 })
    : null;
  const invoiceNumber = fiscalized ? invoice.official_invoice_number ?? invoice.broj_racuna : invoice.broj_racuna;
  const taxRows = invoice.poreske_stavke.length ? invoice.poreske_stavke : [...invoice.stavke.reduce((groups, line) => {
    const key = line.pdv_stopa_sifra;
    const group = groups.get(key) ?? { id: key, vat_rate_percent: Number(line.pdv_stopa_procenat), tax_base: 0, output_vat_amount: 0, total_with_vat: 0 };
    group.tax_base += Number(line.osnovica); group.output_vat_amount += Number(line.pdv_iznos); group.total_with_vat += Number(line.ukupno_sa_pdv); groups.set(key, group); return groups;
  }, new Map<string, { id: string; vat_rate_percent: number; tax_base: number; output_vat_amount: number; total_with_vat: number }>()).values()];

  return <main className="print-page invoice-print-page">
    <div className="print-toolbar"><PrintButton label="Štampaj fakturu" /></div>
    <article className="invoice-print-document">
      {invoice.status === "DRAFT" && !fiscalized ? <div className="invoice-print-watermark">NACRT</div> : null}
      <header className="invoice-print-header">
        <div className="invoice-print-brand"><div className="invoice-print-monogram">{(issuer.skraceniNaziv ?? issuer.naziv ?? "SS").slice(0, 2).toUpperCase()}</div><div><h1>{issuer.naziv}</h1><p>{[issuer.adresa, issuer.grad, issuer.drzava].filter(Boolean).join(", ")}</p><p>PIB: {issuer.pib ?? "-"}{issuer.pdvBroj ? ` · PDV: ${issuer.pdvBroj}` : ""}</p></div></div>
        <div className="invoice-print-title"><span>IZLAZNA FAKTURA</span><strong>{invoiceNumber}</strong><small>Poslovna oznaka: {invoice.interni_broj}</small></div>
      </header>

      <section className="invoice-print-parties">
        <div><span>IZDAVALAC</span><h2>{issuer.naziv}</h2><p>{[issuer.adresa, issuer.grad].filter(Boolean).join(", ")}</p><p>PIB: {issuer.pib ?? "-"}</p>{issuer.telefon || issuer.email ? <p>{[issuer.telefon, issuer.email].filter(Boolean).join(" · ")}</p> : null}</div>
        <div><span>KUPAC</span><h2>{buyer.naziv}</h2><p>{[buyer.adresa, buyer.grad, buyer.drzava].filter(Boolean).join(", ")}</p><p>PIB: {buyer.pib ?? "-"}{buyer.pdvBroj ? ` · PDV: ${buyer.pdvBroj}` : ""}</p>{buyer.email ? <p>{buyer.email}</p> : null}</div>
      </section>

      <section className="invoice-print-meta">
        <div><span>Datum računa</span><strong>{date(invoice.datum_racuna)}</strong></div>
        <div><span>Datum prometa</span><strong>{date(invoice.datum_prometa)}</strong></div>
        <div><span>Rok plaćanja</span><strong>{date(invoice.datum_valute)}</strong></div>
        <div><span>Način plaćanja</span><strong>{paymentLabels[invoice.nacin_placanja] ?? invoice.nacin_placanja}</strong></div>
      </section>

      <table className="invoice-print-table"><thead><tr><th>#</th><th>Šifra</th><th>Opis robe / usluge</th><th>JM</th><th>Količina</th><th>Cijena bez PDV</th><th>Rabat</th><th>PDV</th><th>Ukupno</th></tr></thead><tbody>
        {invoice.stavke.map((line) => <tr key={line.id}><td>{line.redni_broj}</td><td>{line.sifra_artikla}</td><td><strong>{line.naziv_artikla}</strong>{line.napomena ? <small>{line.napomena}</small> : null}</td><td>{line.jedinica_mjere}</td><td>{money(line.kolicina, 3)}</td><td>{money(line.jedinicna_cijena_bez_pdv, 4)}</td><td>{money(line.rabat_procenat)}%</td><td>{money(line.pdv_stopa_procenat)}%</td><td><strong>{money(line.ukupno_sa_pdv)}</strong></td></tr>)}
      </tbody></table>

      <section className="invoice-print-bottom">
        <div className="invoice-print-payment"><h3>Podaci za plaćanje</h3><p><span>Banka</span><strong>{issuer.banka ?? "-"}</strong></p><p><span>Žiro račun</span><strong>{issuer.ziroRacun ?? "-"}</strong></p><p><span>Poziv / opis</span><strong>{invoiceNumber}</strong></p>{invoice.napomena ? <div className="invoice-print-note"><span>Napomena</span><p>{invoice.napomena}</p></div> : null}</div>
        <div className="invoice-print-totals"><p><span>Osnovica</span><strong>{money(invoice.ukupno_osnovica)} €</strong></p><p><span>Rabat</span><strong>{money(invoice.ukupno_rabat)} €</strong></p><p><span>PDV</span><strong>{money(invoice.ukupno_izlazni_pdv)} €</strong></p><p className="invoice-print-grand-total"><span>ZA PLAĆANJE</span><strong>{money(invoice.ukupno_sa_pdv)} €</strong></p></div>
      </section>

      <section className="invoice-print-tax"><h3>Rekapitulacija PDV-a</h3><table><thead><tr><th>Stopa</th><th>Osnovica</th><th>PDV</th><th>Ukupno</th></tr></thead><tbody>{taxRows.map((tax) => <tr key={tax.id}><td>{money(tax.vat_rate_percent)}%</td><td>{money(tax.tax_base)} €</td><td>{money(tax.output_vat_amount)} €</td><td>{money(tax.total_with_vat)} €</td></tr>)}</tbody></table></section>

      <section className={`invoice-print-fiscal ${fiscalized ? "is-fiscalized" : ""}`}>
        {qrDataUrl ? <Image unoptimized width={240} height={240} src={qrDataUrl} alt="QR kod za provjeru fiskalnog računa" /> : null}
        <div><span>FISKALNI STATUS</span><h3>{fiscalized ? "Fiskalizovan račun" : invoice.fiskalizacija_rezim === "SUMMA" ? "Račun još nije fiskalizovan" : "Fiskalizacija se ne vrši kroz Summa sistem"}</h3>{fiscalized ? <><p><strong>IKOF:</strong> {invoice.iic}</p><p><strong>JIKR:</strong> {invoice.jikr}</p><p className="invoice-print-qr-url">QR vodi na zvaničnu provjeru Poreske uprave.</p></> : <p>Fiskalni QR se prikazuje tek nakon uspješne fiskalizacije i dobijenog zvaničnog QR podatka.</p>}</div>
      </section>

      <footer className="invoice-print-footer"><span>Dokument je generisan elektronski.</span><span>{issuer.webSajt ?? issuer.email ?? ""}</span></footer>
    </article>
  </main>;
}
