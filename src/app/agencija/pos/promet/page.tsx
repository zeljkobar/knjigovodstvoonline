import { FiscalJournal } from "@/components/FiscalJournal";
import Link from "next/link";
import { loadFiscalReportDetail, loadReportRegisters } from "@/lib/fiscal-report-detail";
import { ReportDetail } from "./ReportDetail";
import styles from "./report.module.css";
import { getAgencyFiscalReportContext } from "@/lib/agency-fiscal-report";
import { directPortalReportQuery, parseDirectPortalReportFilters, directPortalReportChannelLabels, directPortalReportDocumentLabels, type DirectPortalReportSearchParams } from "@/lib/direct-portal-reports";
import { loadFiscalReportPage, fiscalReportPage } from "@/lib/fiscal-report-page";
import { reportEnvironments } from "@/lib/fiscal-report-policy";
import { posMoney } from "@/lib/pos-reports";

export default async function AgencyFiscalTurnover({ searchParams }: { searchParams: Promise<DirectPortalReportSearchParams> }) {
  const context = await getAgencyFiscalReportContext();
  if (!context) return <section className="admin-panel"><p>Izaberite firmu i godinu za koju imate pravo pregleda prodaje.</p></section>;
  const params = await searchParams;
  const kind = params.tip === "zurnal" ? "zurnal" : params.tip === "korekcije" ? "korekcije" : "promet";
  const exportQuery = (filters: Parameters<typeof directPortalReportQuery>[0]) => `${directPortalReportQuery(filters)}&tip=${kind}`;
  const filters = parseDirectPortalReportFilters({ od: params.od, do: params.do, kanal: params.kanal, okruzenje: params.okruzenje, kupac: params.kupac, kasa: params.kasa }, context.year);
  // Never let a query string select a channel outside this user's permissions.
  if (context.channels.length === 1) filters.salesChannel = context.channels[0];
  const report = await loadFiscalReportPage(context, filters, fiscalReportPage(params.strana), kind);
  const [detail, registers] = await Promise.all([
    loadFiscalReportDetail(context, filters, params.racun),
    context.channels.includes("POS") ? loadReportRegisters(context) : Promise.resolve([])
  ]);
  const page = report.page;
  const query = (next: number, invoiceId?: string) => {
    const values = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (typeof value === "string" && key !== "strana" && key !== "racun") values.set(key, value);
    values.set("strana", String(next));
    if (invoiceId) values.set("racun", invoiceId);
    return `/agencija/pos/promet?${values}`;
  };
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Fiskalni izvještaji</p><h2>{kind === "zurnal" ? "Elektronski žurnal" : kind === "korekcije" ? "Korektivni žurnal" : "Fiskalni promet firme"}</h2><p>{context.firma.naziv} · {context.firma.pib}</p></div><div className="header-actions">{[["avansi","Avansi"],["operateri","Operateri"],["uredjaji","ENU uređaji"],["jedinice","Poslovne jedinice"]].map(([kind,label]) => <Link key={kind} className="secondary-button" href={`/agencija/pos/promet/${kind}?${directPortalReportQuery(filters)}`}>{label}</Link>)}<Link className="secondary-button" href={`/agencija/pos/promet/kupci?${directPortalReportQuery(filters)}`}>Po kupcima</Link><Link className="secondary-button" href={`/stampa/pos/promet?${exportQuery(filters)}`} prefetch={false} target="_blank">A4 / PDF</Link><Link className="secondary-button" prefetch={false} href={`/agencija/pos/promet/export?format=pdf&${exportQuery(filters)}`}>Preuzmi PDF</Link><Link className="secondary-button" href={`/agencija/fiskalna-dostava?${exportQuery(filters)}`}>Pošalji mejlom</Link><Link className="secondary-button" href={`/agencija/pos/promet/export?${exportQuery(filters)}`} prefetch={false}>Preuzmi Excel</Link><Link className="secondary-button" href="/agencija/pos/izvjestaji">Promet POS kase</Link></div></header>
    <section className="admin-panel"><div className="header-actions"><Link className="secondary-button" href={`/agencija/pos/promet?od=${context.year.datum_od.toISOString().slice(0,10)}&do=${context.year.datum_do.toISOString().slice(0,10)}&okruzenje=${filters.environment ?? "Production"}&kanal=${filters.salesChannel}`}>Cijela poslovna godina</Link><Link className="secondary-button" href="/agencija/pos/promet">Podrazumijevani period</Link></div><form className="portal-filter-form" method="get"><label>Izvještaj<select name="tip" defaultValue={kind}><option value="promet">Promet</option><option value="zurnal">Elektronski žurnal</option><option value="korekcije">Korektivni žurnal</option></select></label>
      <label>Od<input type="date" name="od" defaultValue={filters.periodFrom}/></label>
      <label>Do<input type="date" name="do" defaultValue={filters.periodTo}/></label>
      <label>Kanal prodaje<select name="kanal" defaultValue={filters.salesChannel}>{context.channels.length > 1 ? <option value="">Sva prodaja</option> : null}{context.channels.map(channel => <option key={channel} value={channel}>{directPortalReportChannelLabels[channel]}</option>)}</select></label>
      <label>Okruženje<select name="okruzenje" defaultValue={filters.environment}>{Object.entries(reportEnvironments).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>POS kasa<select name="kasa" defaultValue={filters.registerId}><option value="">Sve / bez POS kase</option>{registers.map(register => <option key={register.id} value={register.id}>{register.sifra} · {register.naziv}{register.aktivan ? "" : " (neaktivna)"}</option>)}</select></label>
      <label>Kupac<input name="kupac" defaultValue={filters.buyer} placeholder="Naziv ili PIB"/></label>
      <button className="primary-button" type="submit">Prikaži promet</button>
    </form>{filters.invalidPeriod ? <p role="alert">Neispravan period; prikazan je podrazumijevani period aktivne godine.</p> : null}
      <p>Obuhvat: potvrđene fakture i/ili POS računi sa njihovim korekcijama u EUR, prema pravima pristupa. Avansi, informativni dokumenti i nepoznato okruženje nijesu uključeni. Ovo nije KIF ni PDV prijava.</p>
      <p><strong>{reportEnvironments[filters.environment ?? "Production"]}</strong> · Lokalna evidencija; automatsko poređenje sa Fiscal API-jem još nije dostupno.</p>
    </section>
    <section className="admin-panel"><h3>Promet cijelog izabranog skupa</h3><div className="table-wrap"><table><thead><tr><th>Računi</th><th>Korekcije</th><th>Prodaja sa PDV-om</th><th>Korekcije sa PDV-om</th><th>Osnovica</th><th>PDV</th><th>Promet nakon korekcija</th></tr></thead><tbody><tr><td>{report.totals.ordinaryCount}</td><td>{report.totals.correctionCount}</td><td>{posMoney(report.totals.salesGross)} €</td><td>{posMoney(report.totals.correctionsGross)} €</td><td>{posMoney(report.totals.base)} €</td><td>{posMoney(report.totals.vat)} €</td><td>{posMoney(report.totals.gross)} €</td></tr></tbody></table></div></section>
    <section className="admin-panel"><h3>PDV rekapitulacija</h3>{report.taxes.length ? <div className="table-wrap"><table><thead><tr><th>Poreska kategorija</th><th>Stopa</th><th>Osnovica</th><th>PDV</th><th>Ukupno</th></tr></thead><tbody>{report.taxes.map(row => <tr key={`${row.code}-${row.rate}`}><td>{row.name}</td><td>{row.rate}%</td><td>{posMoney(row.base)} €</td><td>{posMoney(row.vat)} €</td><td>{posMoney(row.gross)} €</td></tr>)}</tbody></table></div> : <p>Nema poreskih stavki u izabranom obuhvatu.</p>}</section>
    
    {params.racun && !detail ? <p role="status">Račun nije dostupan u izabranom obuhvatu.</p> : null}
    <div className={detail ? styles.withDetail : undefined}><section className="admin-panel"><h3>Računi iza rezultata</h3><p>{report.totals.count} dokumenata · strana {page} · po 50</p>{kind !== "promet" ? <FiscalJournal documents={report.documents} surface="AGENCY"/> : report.documents.length ? <div className="table-wrap"><table><thead><tr><th>Datum</th><th>Broj</th><th>Kanal / kasa</th><th>Kupac</th><th>Vrsta</th><th>Ukupno</th><th>Detalj</th></tr></thead><tbody>{report.documents.map(document => <tr key={document.id}><td>{document.date.toLocaleString("sr-Latn-ME",{timeZone:"Europe/Podgorica"})}</td><td>{document.officialNumber || document.localNumber}</td><td>{directPortalReportChannelLabels[document.channel]} · {document.register}</td><td>{document.buyer} · {document.buyerTaxNumber}</td><td>{directPortalReportDocumentLabels[document.documentType]}</td><td>{posMoney(document.gross)} €</td><td><Link className="table-button" href={query(page, document.id)} scroll={false}>Otvori</Link><Link className="table-button" prefetch={false} href={`/agencija/pos/promet/racun/${document.id}/pdf`}>PDF</Link><Link className="table-button" href={`/agencija/fiskalna-dostava?racun=${document.id}`}>Pošalji mejlom</Link></td></tr>)}</tbody></table></div> : <p>Nema potvrđenih računa za izabrani period i obuhvat.</p>}
      <div className="header-actions">{page > 1 ? <Link className="secondary-button" href={query(page-1)}>Prethodna</Link> : null}{page < report.pages ? <Link className="secondary-button" href={query(page+1)}>Sljedeća</Link> : null}</div>
    </section>{detail ? <ReportDetail invoice={detail} closeHref={query(page)}/> : null}</div>
  </div>;
}
