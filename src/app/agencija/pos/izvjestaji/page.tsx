import Link from "next/link";
import { getPosContext } from "@/lib/pos";
import { prisma } from "@/lib/prisma";
import { loadPosReport, posMoney, posPaymentLabels, posQuantity, posReportDates } from "@/lib/pos-reports";

export default async function PosReportsPage({ searchParams }: { searchParams: Promise<{ od?: string; do?: string; kasa?: string }> }) {
  const params = await searchParams;
  const ctx = await getPosContext("view");
  if (!ctx.firma || !ctx.year || !ctx.allowed || !ctx.user.agencija_id) return <section className="admin-panel"><p>Nemate pravo pregleda POS izvještaja.</p></section>;
  const dates = posReportDates(ctx.year.godina, params.od, params.do);
  const registers = await prisma.posRegister.findMany({ where: { agencija_id: ctx.user.agencija_id, firma_id: ctx.firma.id, is_deleted: false }, orderBy: { naziv: "asc" }, select: { id: true, naziv: true } });
  const registerId = registers.some((register) => register.id === params.kasa) ? params.kasa : undefined;
  const report = await loadPosReport({ agencijaId: ctx.user.agencija_id, firmaId: ctx.firma.id, yearId: ctx.year.id, start: dates.start, end: dates.end, registerId });
  const printQuery = new URLSearchParams({ od: dates.from, do: dates.to, ...(registerId ? { kasa: registerId } : {}) }).toString();

  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">POS / Izvještaji</p><h2>Promet kase</h2><p className="muted-text">Neto promet uključuje prodaju i fiskalizovana storna kao umanjenje.</p></div><div className="header-actions"><Link className="secondary-button" href={`/stampa/pos/izvjestaj?${printQuery}&format=58`}>58 mm</Link><Link className="secondary-button" href={`/stampa/pos/izvjestaj?${printQuery}&format=80`}>80 mm</Link><Link className="secondary-button" href={`/stampa/pos/izvjestaj?${printQuery}&format=a4`}>A4</Link><Link className="secondary-button" href="/agencija/pos/smjene">Smjene</Link><Link className="secondary-button" href="/agencija/pos">Prodaja</Link></div></header>
    <section className="admin-panel"><form className="filter-bar" method="get"><label>Od<input type="date" name="od" defaultValue={dates.from}/></label><label>Do<input type="date" name="do" defaultValue={dates.to}/></label><label>Kasa<select name="kasa" defaultValue={registerId ?? ""}><option value="">Sve kase</option>{registers.map((register) => <option key={register.id} value={register.id}>{register.naziv}</option>)}</select></label><button className="primary-button" type="submit">Prikaži</button></form></section>
    <section className="metric-grid"><article><span>Dokumenata</span><strong>{report.totals.count}</strong><small>{report.totals.sales} računa · {report.totals.returns} storna</small></article><article><span>Osnovica</span><strong>{posMoney(report.totals.base)} €</strong></article><article><span>PDV</span><strong>{posMoney(report.totals.vat)} €</strong></article><article><span>Neto promet</span><strong>{posMoney(report.totals.gross)} €</strong></article></section>
    <div className="pos-report-grid">
      <section className="admin-panel"><h3>Po načinu plaćanja</h3><div className="table-wrap"><table><thead><tr><th>Plaćanje</th><th>Iznos</th></tr></thead><tbody>{report.payments.map((row) => <tr key={row.method}><td>{posPaymentLabels[row.method] ?? row.method}</td><td>{posMoney(row.amount)} €</td></tr>)}</tbody></table></div></section>
      <section className="admin-panel"><h3>PDV rekapitulacija</h3><div className="table-wrap"><table><thead><tr><th>Stopa</th><th>Osnovica</th><th>PDV</th><th>Ukupno</th></tr></thead><tbody>{report.taxes.map((row) => <tr key={row.rate}><td>{row.rate}%</td><td>{posMoney(row.base)} €</td><td>{posMoney(row.vat)} €</td><td>{posMoney(row.gross)} €</td></tr>)}</tbody></table></div></section>
    </div>
    <section className="admin-panel"><h3>Prodaja po artiklima</h3><div className="table-wrap"><table><thead><tr><th>Šifra</th><th>Artikal / usluga</th><th>JM</th><th>Neto količina</th><th>Neto promet</th></tr></thead><tbody>{report.items.map((row) => <tr key={`${row.code}-${row.name}`}><td>{row.code}</td><td>{row.name}</td><td>{row.unit}</td><td>{posQuantity(row.quantity)}</td><td>{posMoney(row.gross)} €</td></tr>)}</tbody></table></div></section>
    <section className="admin-panel"><h3>Dokumenti</h3><div className="table-wrap"><table><thead><tr><th>Vrijeme</th><th>Broj</th><th>Kasa</th><th>Vrsta</th><th>Ukupno</th><th></th></tr></thead><tbody>{report.invoices.map((invoice) => <tr key={invoice.id}><td>{invoice.issued_at?.toLocaleString("sr-Latn-ME")}</td><td>{invoice.official_invoice_number ?? invoice.broj_racuna}</td><td>{invoice.pos_register?.naziv ?? "-"}</td><td>{invoice.document_type === "POS_RETURN" ? "Storno" : "Prodaja"}</td><td>{Number(invoice.ukupno_sa_pdv).toFixed(2)} €</td><td><Link className="table-button" href={`/stampa/pos/racuni/${invoice.id}`}>POS štampa</Link></td></tr>)}</tbody></table></div></section>
  </div>;
}
