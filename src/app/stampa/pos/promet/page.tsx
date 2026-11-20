import { FiscalAdvanceTable } from "@/components/FiscalAdvanceTable";
import { FiscalContextTable } from "@/components/FiscalContextTable";
import { isFiscalContextReportKind, fiscalContextReportTitles } from "@/lib/fiscal-report-context-groups";
import { FiscalBuyerTable } from "@/components/FiscalBuyerTable";
import { FiscalJournal } from "@/components/FiscalJournal";
import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { loadAgencyFiscalExport } from "@/lib/agency-fiscal-export";
import { auditLog } from "@/lib/audit";
import { directPortalReportQuery, directPortalReportChannelLabels, directPortalReportDocumentLabels, type DirectPortalReportSearchParams } from "@/lib/direct-portal-reports";
import { reportEnvironments } from "@/lib/fiscal-report-policy";
import { posMoney } from "@/lib/pos-reports";
import styles from "./report.module.css";

export const dynamic = "force-dynamic";

export default async function FiscalTurnoverPrint({ searchParams }: { searchParams: Promise<DirectPortalReportSearchParams> }) {
  const result = await loadAgencyFiscalExport(await searchParams);
  if (result.error) return <main className={styles.report}><h1>Izvještaj nije dostupan</h1><p role="alert">{result.error}</p><Link href="/agencija/pos/promet">Nazad na pregled</Link></main>;
  const { context, filters, report, generatedAt, kind = "promet" } = result;
  const query = `${directPortalReportQuery(filters)}&tip=${kind}`;
  await auditLog({ agencijaId: context.user.agencija_id!, firmaId: context.firma.id, korisnikId: context.user.id,
    modul: "izvjestaji", akcija: "print_a4", tipEntiteta: "fiscal_turnover",
    novaVrijednost: { tip: kind, period_od: filters.periodFrom, period_do: filters.periodTo, okruzenje: filters.environment, kanal: filters.salesChannel, kasa: filters.registerId, broj_dokumenata: report.documents.length } });
  return <main className={styles.report}>
    <div className="print-toolbar"><Link className="print-button" href={`${(kind === "avansi" || kind === "kupci" || isFiscalContextReportKind(kind)) ? `/agencija/pos/promet/${kind}` : "/agencija/pos/promet"}?${query}`}>Nazad na pregled</Link><PrintButton label="Štampaj / sačuvaj kao PDF"/><Link className="print-button" prefetch={false} href={`/agencija/pos/promet/export?${query}`}>Preuzmi Excel</Link></div>
    <header><h1>{kind === "avansi" ? "Avansi i lokalna evidencija korišćenja" : isFiscalContextReportKind(kind) ? fiscalContextReportTitles[kind] : kind === "kupci" ? "Promet po kupcima" : kind === "zurnal" ? "Elektronski žurnal" : kind === "korekcije" ? "Korektivni žurnal" : "Periodični fiskalni promet"}</h1><div className={styles.meta}><div><strong>{context.firma.naziv}</strong><p>PIB: {context.firma.pib}</p><p>Period: {filters.periodFrom} — {filters.periodTo} (uključeno)</p></div><div><strong>{reportEnvironments[filters.environment ?? "Production"]}</strong><p>Kanal: {filters.salesChannel ? directPortalReportChannelLabels[filters.salesChannel] : "Sva prodaja"}</p><p>Generisano: {generatedAt.toLocaleString("sr-Latn-ME", { timeZone: "Europe/Podgorica" })}</p></div></div>
      <p>Filter POS kase: {filters.registerId || "Sve / bez POS kase"} · Filter kupca: {filters.buyer || "Svi kupci"}</p>
      <p className={styles.note}>{kind === "avansi" ? "Lokalna evidencija avansnih računa iz perioda i trenutnih veza korišćenja; raspoloživost i rezervacije nijesu potvrđene." : "Lokalna evidencija potvrđene prodaje i korekcija u EUR. Avansi, informativni dokumenti i dokumenti nepoznatog okruženja nijesu uključeni."} Ovo nije KIF ni PDV prijava. Svi datumi računa su po vremenu u Podgorici.</p>
    </header>
    <h2>Sažetak perioda</h2><table><thead><tr><th>Računa</th><th>Korekcija</th><th>{kind === "avansi" ? "Avansi sa PDV-om" : "Prodaja sa PDV-om"}</th><th>Korekcije sa PDV-om</th><th>Osnovica</th><th>PDV</th><th>{kind === "avansi" ? "Iznos avansnih računa" : "Promet nakon korekcija"}</th></tr></thead><tbody><tr><td>{report.totals.ordinaryCount}</td><td>{report.totals.correctionCount}</td>{[report.totals.salesGross, report.totals.correctionsGross, report.totals.base, report.totals.vat, report.totals.gross].map((value,index) => <td className={styles.number} key={index}>{posMoney(value)} €</td>)}</tr></tbody></table>
    <h2>PDV rekapitulacija</h2>{report.taxes.length ? <table><thead><tr><th>Kategorija</th><th>Stopa</th><th>Osnovica</th><th>PDV</th><th>Ukupno</th></tr></thead><tbody>{report.taxes.map(tax => <tr key={`${tax.code}-${tax.rate}`}><td>{tax.name}</td><td>{tax.rate}%</td><td className={styles.number}>{posMoney(tax.base)}</td><td className={styles.number}>{posMoney(tax.vat)}</td><td className={styles.number}>{posMoney(tax.gross)}</td></tr>)}</tbody></table> : <p>Nema poreskih stavki u obuhvatu.</p>}
    {kind === "avansi" ? <FiscalAdvanceTable report={report}/> : isFiscalContextReportKind(kind) ? <FiscalContextTable documents={report.documents} kind={kind}/> : kind === "kupci" ? <FiscalBuyerTable documents={report.documents}/> : kind !== "promet" ? <FiscalJournal documents={report.documents}/> : null}
    <section className={styles.documents}><h2>Pregled računa</h2><p>{report.documents.length} dokumenata. Jedan red po računu.</p>{report.documents.length ? <table><thead><tr><th>Datum i vrijeme</th><th>Broj / tip</th><th>Kanal / kasa</th><th>Kupac / PIB</th><th>Osnovica</th><th>PDV</th><th>Ukupno EUR</th></tr></thead><tbody>{report.documents.map(document => <tr key={document.id}><td>{document.date.toLocaleString("sr-Latn-ME",{timeZone:"Europe/Podgorica"})}</td><td>{document.officialNumber || document.localNumber}<br/>{directPortalReportDocumentLabels[document.documentType]}</td><td>{directPortalReportChannelLabels[document.channel]}<br/>{document.register}</td><td>{document.buyer}<br/>{document.buyerTaxNumber}</td><td className={styles.number}>{posMoney(document.base)}</td><td className={styles.number}>{posMoney(document.vat)}</td><td className={styles.number}>{posMoney(document.gross)}</td></tr>)}</tbody></table> : <p>Nema potvrđenih računa za izabrani obuhvat.</p>}</section>
    <footer className={styles.note}><p>{kind === "avansi" ? "Avansi i umanjenja nijesu dodatna prodaja." : "Promet nakon korekcija uključuje negativne korektivne dokumente."} Način plaćanja naveden na računu nije dokaz stvarne uplate.</p></footer>
  </main>;
}
