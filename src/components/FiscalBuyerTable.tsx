import type { DirectPortalReport } from "@/lib/direct-portal-reports";
import { fiscalBuyerRows } from "@/lib/fiscal-report-buyers";
import { posMoney } from "@/lib/pos-reports";

export function FiscalBuyerTable({ documents, page }: { documents: DirectPortalReport["documents"]; page?: number }) {
  const allRows = fiscalBuyerRows(documents);
  const rows = page ? allRows.slice((page-1)*50,page*50) : allRows;
  return <section><h2>Promet po kupcima</h2><p>Naziv i poreski broj preuzimaju se iz snimka računa. Različite istorijske verzije istog kupca prikazane su odvojeno. Bez snimka koristi se označen trenutni adresar. Ovo je promet, ne stanje potraživanja niti potvrda uplate.</p>
    {!rows.length ? <p>Nema potvrđenih računa u izabranom obuhvatu.</p> : <div className="table-wrap"><table><thead><tr><th>Kupac / PIB</th><th>Izvor podataka</th><th>Računa</th><th>Korekcija</th><th>Prodaja EUR</th><th>Korekcije EUR</th><th>Osnovica EUR</th><th>PDV EUR</th><th>Promet EUR</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{row.name}<br/>{row.taxNumber || "Nije evidentiran"}</td><td>{row.historical ? "Snimak računa" : "Trenutni adresar"}</td><td>{row.ordinaryCount}</td><td>{row.correctionCount}</td>{[row.sales,row.corrections,row.base,row.vat,row.gross].map((amount,i) => <td key={i}>{posMoney(amount)}</td>)}</tr>)}</tbody></table></div>}
  </section>;
}
