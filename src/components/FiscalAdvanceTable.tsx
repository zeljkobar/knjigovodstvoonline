import type { DirectPortalReport } from "@/lib/direct-portal-reports";
import { posMoney } from "@/lib/pos-reports";

export function FiscalAdvanceTable({report,page}: {report: DirectPortalReport; page?:number}) {
  const rows=page ? report.advances.slice((page-1)*50,page*50) : report.advances;
  return <section><h2>Avansi i lokalna evidencija korišćenja</h2><p>Period bira avansne račune iz aktivne godine. Veze sa konačnim računima prikazuju trenutno sačuvano stanje, uključujući druge godine iste firme; ovo nije istorijski saldo na kraj perioda. Avansi i umanjenja nijesu dodatna prodaja.</p><p>Raspoloživi saldo i rezervacije nijesu potvrđeni ovim izvještajem. Zbir nepotvrđenih veza obuhvata samo EUR. Nacrti i neuspjeli zahtjevi su veze za provjeru, a ne potvrđene rezervacije. Oznaka plaćanja nije dokaz bankovne uplate.</p>
    {!rows.length ? <p>Nema potvrđenih avansnih računa u izabranom obuhvatu.</p> : rows.map(row=><article key={row.id}><h3>{row.number} · {row.buyer}</h3><div className="table-wrap"><table><thead><tr><th>Avans EUR</th><th>Potvrđeno korišćenje EUR</th><th>Potvrđeno umanjenje EUR</th><th>Čeka umanjenje EUR</th><th>Nepotvrđene veze EUR</th></tr></thead><tbody><tr>{[row.gross,row.used,row.settled,row.unsettled,row.pending].map((value,i)=><td key={i}>{posMoney(value)}</td>)}</tr></tbody></table></div>{row.review?<p role="status">Potrebna je provjera lokalnog toka. Raspoloživost avansa nije potvrđena.</p>:null}
    {row.links.length ? <table><thead><tr><th>Konačni račun</th><th>Korišćenje / valuta</th><th>Status veze</th><th>Umanjenje / JIKR</th></tr></thead><tbody>{row.links.map(link=><tr key={link.id}><td>{link.number}</td><td>{posMoney(link.amount)} {link.currency}</td><td>{link.status}</td><td>{link.settlementNumber || "Nije potvrđeno"}<br/>{link.settlementJikr}</td></tr>)}</tbody></table> : <p>Nema lokalno sačuvanih veza korišćenja.</p>}</article>)}
  </section>;
}
