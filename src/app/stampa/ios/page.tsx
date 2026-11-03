import { requireAnyRole } from "@/lib/auth";
import { PrintButton } from "@/components/PrintButton";
import { loadIosReport, iosDate, iosMoney, type IosParams } from "@/lib/ios";
import "./print.css";
export default async function IosPrint({searchParams}:{searchParams?:Promise<IosParams>}){
 await requireAnyRole(["admin_agencije","korisnik_agencije"]);
 let data;try{data=await loadIosReport(await searchParams,true);}catch(error){return <main className="print-page"><p role="alert">{error instanceof Error?error.message:"IOS nije dostupan."}</p></main>;}
 return <main className="print-page ios-print-page"><div className="print-toolbar"><PrintButton label="Štampaj IOS"/></div>
 {data.reports.map(report=><article className="ios-document" key={report.partner.id}>
  <header className="ios-parties"><div><strong>{data.company.naziv}</strong><p>{[data.company.adresa,data.company.grad].filter(Boolean).join(", ")}</p><p>PIB: {data.company.pib??"—"}</p><small>Pošiljalac</small></div><div><strong>{report.partner.naziv}</strong><p>{[report.partner.adresa,report.partner.grad].filter(Boolean).join(", ")}</p><p>PIB / poreski broj: {report.partner.pib??report.partner.foreign_tax_number??"—"}</p><small>Primalac</small></div></header>
  <h1>IZVOD OTVORENIH STAVKI</h1><p className="ios-subtitle">Stanje na dan {iosDate(data.date)} · Poslovna godina {data.year.godina} · EUR</p>
  <p>Prema našoj evidenciji na navedeni datum postoje sljedeće otvorene stavke. Iznosi su prikazani iz perspektive pošiljaoca.</p>
  <table><thead><tr><th>Dokument / konto</th><th>Datum dok.</th><th>Dospijeće</th><th>Izvorni iznos</th><th>Zatvoreno</th><th>Otvoreno duguje</th><th>Otvoreno potražuje</th></tr></thead><tbody>{report.items.map(item=><tr key={item.id}><td>{item.document}<small>Konto {item.accountCode}</small></td><td>{iosDate(item.documentDate??item.date)}</td><td>{iosDate(item.dueDate)}</td><td>{iosMoney(Math.abs(item.signedCents))}<small>{item.signedCents>0?"Duguje":"Potražuje"}</small></td><td>{iosMoney(Math.abs(item.signedCents)-Math.abs(item.remainingCents))}</td><td>{iosMoney(Math.max(item.remainingCents,0))}</td><td>{iosMoney(Math.max(-item.remainingCents,0))}</td></tr>)}{!report.items.length?<tr><td colSpan={7}>Nema otvorenih stavki na navedeni datum.</td></tr>:null}</tbody><tfoot><tr><td colSpan={5}>UKUPNO</td><td>{iosMoney(report.debit)}</td><td>{iosMoney(report.credit)}</td></tr></tfoot></table>
  <p className="ios-balance"><strong>{report.balance>0?"Naše neto potraživanje":report.balance<0?"Naša neto obaveza":"Neto saldo"}: {iosMoney(Math.abs(report.balance))} EUR</strong></p>
  <p className="ios-note">Duguje predstavlja naša potraživanja i date avanse, a potražuje naše obaveze i primljene avanse. Neraspoređene uplate prikazane su odvojeno od računa.</p>
  <section className="ios-confirmation"><h2>Potvrda usaglašavanja stanja</h2><p>Molimo da potvrdite slaganje sa iskazanim stanjem ili navedete razliku i vratite potpisan primjerak pošiljaocu.</p>
   <p>☐ Saglasni smo sa iskazanim stanjem.</p><p>☐ Nijesmo saglasni sa iskazanim stanjem.</p>
   <p>Prema našoj evidenciji stanje iznosi: __________________ EUR</p><p>Naše potraživanje / naša obaveza (zaokružiti)</p>
   <p>Obrazloženje razlike: ___________________________________________________</p><p>_____________________________________________________________________</p>
   <div className="ios-signatures"><div>Mjesto i datum<br/><br/>________________________</div><div>Ovlašćeno lice primaoca — ime i potpis<br/><br/>_______________________________</div></div>
  </section>
 </article>)}</main>;
}
