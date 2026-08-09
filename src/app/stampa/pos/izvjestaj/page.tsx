import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { decimalToScaled } from "@/lib/inventory-calculation";
import { getPosContext } from "@/lib/pos";
import { prisma } from "@/lib/prisma";
import { loadPosReport, posMoney, posPaymentLabels, posQuantity, posReportDates } from "@/lib/pos-reports";

export default async function PosReportPrintPage({ searchParams }: { searchParams: Promise<{ od?: string; do?: string; kasa?: string; format?: string }> }) {
  const params = await searchParams;
  const ctx = await getPosContext("view");
  if (!ctx.firma || !ctx.year || !ctx.allowed || !ctx.user.agencija_id) return null;
  const dates = posReportDates(ctx.year.godina, params.od, params.do);
  const register = params.kasa ? await prisma.posRegister.findFirst({ where: { id: params.kasa, agencija_id: ctx.user.agencija_id, firma_id: ctx.firma.id, is_deleted: false }, select: { id: true, naziv: true, fiscal_device_code: true, cash_deposit_amount: true } }) : null;
  const report = await loadPosReport({ agencijaId: ctx.user.agencija_id, firmaId: ctx.firma.id, yearId: ctx.year.id, start: dates.start, end: dates.end, registerId: register?.id });
  const format = params.format === "58" ? "58" : params.format === "80" ? "80" : "a4";
  const baseQuery = `od=${dates.from}&do=${dates.to}${register ? `&kasa=${register.id}` : ""}`;
  const taxRates = ["21", "15", "7", "0"].map((rate) => report.taxes.find((row) => Number(row.rate) === Number(rate)) ?? { rate, base: BigInt(0), vat: BigInt(0), gross: BigInt(0) });
  const returns = report.invoices.filter((invoice) => invoice.document_type === "POS_RETURN");
  const returnGross = returns.reduce((sum, invoice) => sum + decimalToScaled(invoice.ukupno_sa_pdv, 2), BigInt(0));
  const returnVat = returns.reduce((sum, invoice) => sum + decimalToScaled(invoice.ukupno_izlazni_pdv, 2), BigInt(0));
  const cash = report.payments.find((row) => row.method === "CASH")?.amount ?? BigInt(0);
  const deposit = register?.cash_deposit_amount ? decimalToScaled(register.cash_deposit_amount, 2) : BigInt(0);

  return <main className={`print-page pos-report-print ${format === "a4" ? "" : "pos-periodic-page"}`}>
    <div className="print-toolbar pos-report-format-toolbar"><Link className="print-button print-back-button" href={`/agencija/pos/izvjestaji?${baseQuery}`}>Nazad</Link><Link className={`print-button ${format === "58" ? "active" : ""}`} href={`/stampa/pos/izvjestaj?${baseQuery}&format=58`}>58 mm</Link><Link className={`print-button ${format === "80" ? "active" : ""}`} href={`/stampa/pos/izvjestaj?${baseQuery}&format=80`}>80 mm</Link><Link className={`print-button ${format === "a4" ? "active" : ""}`} href={`/stampa/pos/izvjestaj?${baseQuery}&format=a4`}>A4</Link><PrintButton label="Štampaj izvještaj"/></div>
    {format !== "a4" ? <article className={`pos-periodic-report pos-periodic-report--${format}`}>
      <header><h1>PERIODIČNI POS IZVJEŠTAJ</h1><p>{ctx.firma.naziv}</p><p>PIB: {ctx.firma.pib}</p></header>
      <div className="pos-periodic-separator"/>
      <dl><div><dt>ENU kod:</dt><dd>{register?.fiscal_device_code ?? (report.registers.length === 1 ? report.registers[0].name : "SVE KASE")}</dd></div><div><dt>OD:</dt><dd>{dates.start.toLocaleString("sr-Latn-ME")}</dd></div><div><dt>DO:</dt><dd>{dates.end.toLocaleString("sr-Latn-ME")}</dd></div><div><dt>Broj prometnih dokumenata:</dt><dd>{report.totals.count}</dd></div></dl>
      <div className="pos-periodic-separator"/>
      <section><h2>PROMET PO PDV STOPAMA</h2>{taxRates.map((tax) => <div className="pos-periodic-tax" key={tax.rate}><h3>PDV {tax.rate}%</h3><p><span>Osnovica:</span><strong>{posMoney(tax.base)}</strong></p><p><span>Iznos poreza:</span><strong>{posMoney(tax.vat)}</strong></p><p><span>Promet:</span><strong>{posMoney(tax.gross)}</strong></p></div>)}</section>
      <div className="pos-periodic-total"><h2>UKUPNO</h2><p><span>Osnovica:</span><strong>{posMoney(report.totals.base)}</strong></p><p><span>Iznos poreza:</span><strong>{posMoney(report.totals.vat)}</strong></p><p><span>Promet:</span><strong>{posMoney(report.totals.gross)}</strong></p></div>
      <section className="pos-periodic-block"><h2>RAČUNI SA KOREKCIJOM</h2><p><span>Ukupan broj računa:</span><strong>{returns.length}</strong></p><p><span>Ukupan promet:</span><strong>{posMoney(returnGross)}</strong></p><p><span>Ukupan porez:</span><strong>{posMoney(returnVat)}</strong></p></section>
      <section className="pos-periodic-block"><h2>VRIJEDNOST PROMETA PO NAČINU PLAĆANJA</h2>{["CASH", "CARD", "BANK_TRANSFER", "OTHER"].map((method) => <p key={method}><span>{posPaymentLabels[method] ?? method}:</span><strong>{posMoney(report.payments.find((row) => row.method === method)?.amount ?? BigInt(0))}</strong></p>)}</section>
      <section className="pos-periodic-block"><h2>KALKULACIJA GOTOVINE</h2><p><span>Inicijalni gotovinski depozit:</span><strong>{posMoney(deposit)}</strong></p><p><span>Gotovinski promet:</span><strong>{posMoney(cash)}</strong></p><p><span>Povlačenje gotovine:</span><strong>0,00</strong></p><p><span>Očekivano u kasi:</span><strong>{posMoney(deposit + cash)}</strong></p></section>
      <footer>Izvještaj generisan iz fiskalizovanih SUMMA POS dokumenata.<br/>{new Date().toLocaleString("sr-Latn-ME")}</footer>
    </article> : <article>
      <header><p>POS IZVJEŠTAJ</p><h1>{ctx.firma.naziv}</h1><span>{dates.from} — {dates.to} · {register?.naziv ?? "Sve kase"}</span></header>
      <section className="pos-report-print-summary"><div><span>Računa</span><strong>{report.totals.sales}</strong></div><div><span>Storna</span><strong>{report.totals.returns}</strong></div><div><span>Osnovica</span><strong>{posMoney(report.totals.base)} €</strong></div><div><span>PDV</span><strong>{posMoney(report.totals.vat)} €</strong></div><div><span>Neto promet</span><strong>{posMoney(report.totals.gross)} €</strong></div></section>
      <h2>Načini plaćanja</h2><table><thead><tr><th>Plaćanje</th><th>Iznos</th></tr></thead><tbody>{report.payments.map((row) => <tr key={row.method}><td>{posPaymentLabels[row.method] ?? row.method}</td><td>{posMoney(row.amount)} €</td></tr>)}</tbody></table>
      <h2>PDV rekapitulacija</h2><table><thead><tr><th>Stopa</th><th>Osnovica</th><th>PDV</th><th>Ukupno</th></tr></thead><tbody>{report.taxes.map((row) => <tr key={row.rate}><td>{row.rate}%</td><td>{posMoney(row.base)} €</td><td>{posMoney(row.vat)} €</td><td>{posMoney(row.gross)} €</td></tr>)}</tbody></table>
      <h2>Prodaja po artiklima</h2><table><thead><tr><th>Šifra</th><th>Artikal / usluga</th><th>JM</th><th>Količina</th><th>Promet</th></tr></thead><tbody>{report.items.map((row) => <tr key={`${row.code}-${row.name}`}><td>{row.code}</td><td>{row.name}</td><td>{row.unit}</td><td>{posQuantity(row.quantity)}</td><td>{posMoney(row.gross)} €</td></tr>)}</tbody></table>
    </article>}
  </main>;
}
