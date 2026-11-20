import Link from "next/link";
import styles from "./FiscalJournal.module.css";
import { directPortalReportChannelLabels } from "@/lib/direct-portal-reports";
import type { DirectPortalReport } from "@/lib/direct-portal-reports";
import { posMoney } from "@/lib/pos-reports";

/** Shared read-only journal content for screen and A4 print. */
export function FiscalJournal({ documents, surface }: { documents: DirectPortalReport["documents"]; surface?:"PORTAL"|"AGENCY" }) {
  return <section aria-label="Dokumenti elektronskog žurnala">
    {!documents.length ? <p>Nema potvrđenih dokumenata u izabranom obuhvatu.</p> : documents.map(document => <article key={document.id} className={styles.document}>
      <h3>{document.correction ? "Korektivni račun" : "Račun"} · {document.officialNumber || document.localNumber}</h3>
      {surface?<div className="header-actions"><Link className="secondary-button" prefetch={false} href={surface==="PORTAL"?`/portal/racuni/${document.id}/pdf`:`/agencija/pos/promet/racun/${document.id}/pdf`}>Preuzmi PDF računa</Link><Link className="secondary-button" href={`${surface==="PORTAL"?"/portal/dostava":"/agencija/fiskalna-dostava"}?racun=${document.id}`}>Pošalji račun mejlom</Link></div>:null}
      <p>{document.date.toLocaleString("sr-Latn-ME", { timeZone: "Europe/Podgorica" })} · {directPortalReportChannelLabels[document.channel]} · {document.register}<br/>{document.buyer} · {document.buyerTaxNumber}</p>
      <p>ENU: {document.fiscalContext?.deviceCode ?? "Nije evidentiran"} · Poslovna jedinica: {document.fiscalContext?.businessUnitCode ?? "Nije evidentirana"} · Operater: {document.fiscalContext?.operatorCode ?? "Nije evidentiran"}</p>
      <p>IKOF: {document.iic || "Nije evidentiran"}<br/>JIKR: {document.jikr || "Nije evidentiran"}</p>
      {document.correction ? <p>Originalni račun: {document.originalNumber || "Nije evidentiran"}<br/>Originalni IKOF: {document.originalIic || "Nije evidentiran"}<br/>{document.correctionReason}</p> : null}
      <div className="table-wrap"><table><thead><tr><th>Šifra</th><th>Stavka</th><th>Količina / JM</th><th>Osnovica</th><th>PDV</th><th>Ukupno EUR</th></tr></thead><tbody>{document.lines.map((line,index) => <tr key={index}><td>{line.code}</td><td>{line.name}</td><td>{(Number(line.quantity)/1000).toLocaleString("sr-Latn-ME",{maximumFractionDigits:3})} {line.unit}</td><td>{posMoney(line.base)}</td><td>{posMoney(line.vat)}</td><td>{posMoney(line.gross)}</td></tr>)}</tbody></table></div>
      <p>Osnovica: {posMoney(document.base)} € · PDV: {posMoney(document.vat)} € · Ukupno: <strong>{posMoney(document.gross)} €</strong></p>
    </article>)}
  </section>;
}
