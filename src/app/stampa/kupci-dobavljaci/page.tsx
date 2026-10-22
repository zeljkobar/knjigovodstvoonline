import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { loadPartnerSummary, partnerSummaryMoney as money, partnerSummaryQuery, type PartnerSummaryParams } from "@/lib/partner-summary";
import "./print.css";

export default async function PartnerSummaryPrint({ searchParams }: { searchParams?: Promise<PartnerSummaryParams> }) {
  const params = await searchParams;
  const data = await loadPartnerSummary(params, true);
  if (!data) return <main className="print-page"><p>Izaberite firmu i poslovnu godinu prije štampe.</p></main>;
  const { firma, godina, account, rows, totalDebit, totalCredit, totalDebitBalance, totalCreditBalance, filterError } = data;
  const date = (value?: string) => value ? new Date(value + "T00:00:00Z").toLocaleDateString("sr-Latn-ME") : "";
  const period = params?.datum_od || params?.datum_do ? `${params.datum_od ? `Od ${date(params.datum_od)}` : "Od početka godine"} ${params.datum_do ? `do ${date(params.datum_do)}` : "do kraja godine"}` : "Cijela poslovna godina";
  return <main className="print-page partner-summary-print-page">
    <div className="print-toolbar"><Link className="print-button print-back-button" href={`/agencija/nalozi/kupci-dobavljaci?${partnerSummaryQuery(params)}`}>Nazad na pregled</Link>{!filterError ? <PrintButton label="Štampaj pregled" /> : null}</div>
    <article className="partner-summary-print">
      <header><div><strong>{firma.naziv}</strong><p>{[firma.adresa, firma.grad].filter(Boolean).join(", ")}</p><p>{firma.pib ? `PIB: ${firma.pib}` : ""}</p></div><div><h1>KUPCI / DOBAVLJAČI</h1><p>Poslovna godina: {godina.godina}</p><p>{filterError ? "Neispravni filteri" : period}</p></div></header>
      {filterError ? <p role="alert">{filterError}</p> : <>
        <div className="partner-summary-print-meta"><span>Konto: <strong>{account ? `${account.sifra} — ${account.naziv}` : params?.konto && params.konto !== "ALL" ? "Izabrano konto nema dostupnog prometa" : "Sva konta sa partner analitikom"}</strong></span><span>{rows.length} otvorenih salda</span></div>
        <table><colgroup><col style={{ width: "19%" }} /><col style={{ width: "33%" }} /><col span={4} style={{ width: "12%" }} /></colgroup><thead><tr><th>Konto</th><th>Partner / PIB</th><th>Duguje</th><th>Potražuje</th><th>Saldo duguje</th><th>Saldo potražuje</th></tr></thead>
          <tbody>{rows.map(row => <tr key={`${row.kontoId}:${row.partnerId}`}><td><strong>{row.kontoSifra}</strong><small>{row.kontoNaziv}</small></td><td>{row.partnerName}<small>{row.partnerPib ?? ""}</small></td><td>{money(row.debit)}</td><td>{money(row.credit)}</td><td>{money(Math.max(0, row.balance))}</td><td>{money(Math.max(0, -row.balance))}</td></tr>)}{!rows.length ? <tr><td colSpan={6}>Nema otvorenih salda za izabrane uslove.</td></tr> : null}</tbody>
          <tfoot><tr><td colSpan={2}>UKUPNO</td><td>{money(totalDebit)}</td><td>{money(totalCredit)}</td><td>{money(totalDebitBalance)}</td><td>{money(totalCreditBalance)}</td></tr></tfoot>
        </table>
        <p className="partner-summary-print-note">Pregled otvorenih salda po analitičkom kontu i partneru. Prikazani su samo proknjiženi nalozi u izabranom periodu. Iznosi su u EUR.</p>
      </>}
    </article>
  </main>;
}
