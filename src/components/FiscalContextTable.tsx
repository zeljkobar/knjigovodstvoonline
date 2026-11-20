import type { DirectPortalReport } from "@/lib/direct-portal-reports";
import { fiscalContextRows, fiscalContextReportTitles, type FiscalContextReportKind } from "@/lib/fiscal-report-context-groups";
import { posMoney } from "@/lib/pos-reports";

export function FiscalContextTable({ documents, kind, page }: { documents: DirectPortalReport["documents"]; kind: FiscalContextReportKind; page?: number }) {
  const allRows = fiscalContextRows(documents,kind);
  const rows = page ? allRows.slice((page-1)*50,page*50) : allRows;
  const missing = allRows.find(row => !row.historical);
  return <section><h2>{fiscalContextReportTitles[kind]}</h2><p>Grupisanje koristi istorijske fiskalne kodove sa računa. Današnja podešavanja kase i kontekst originala ne zamjenjuju podatke korektivnog računa.</p>
    {missing ? <p role="status">Bez istorijskog konteksta: {missing.ordinaryCount + missing.correctionCount} dokumenata · {posMoney(missing.gross)} € prometa. Uključeni su u ukupan rezultat, u grupi „Nije evidentirano“.</p> : null}
    {!rows.length ? <p>Nema potvrđenih računa u izabranom obuhvatu.</p> : <div className="table-wrap"><table><thead><tr><th>{kind === "operateri" ? "Kod operatera" : kind === "uredjaji" ? "ENU / poslovna jedinica" : "Kod poslovne jedinice"}</th><th>Izvor podataka</th><th>Računa</th><th>Korekcija</th><th>Prodaja EUR</th><th>Korekcije EUR</th><th>Osnovica EUR</th><th>PDV EUR</th><th>Promet EUR</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{row.code ?? "Nije evidentirano"}{row.unitCode ? <><br/>Jedinica: {row.unitCode}</> : null}</td><td>{row.historical ? "Snimak prvog slanja" : "Nije evidentirano"}</td><td>{row.ordinaryCount}</td><td>{row.correctionCount}</td>{[row.sales,row.corrections,row.base,row.vat,row.gross].map((amount,index) => <td key={index}>{posMoney(amount)}</td>)}</tr>)}</tbody></table></div>}
  </section>;
}
