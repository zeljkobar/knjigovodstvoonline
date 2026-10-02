import Link from "next/link";
import { requireAnyRole } from "@/lib/auth";
import { loadBankStatementWarnings, warningCompanies } from "@/lib/bank-statement-warnings";
import { readWorkContext } from "@/lib/work-context";
import styles from "./warnings.module.css";

export default async function WarningsPage({searchParams}:{searchParams?:Promise<{godina?:string;firma?:string;prikaz?:string}>}) {
  const user = await requireAnyRole(["admin_agencije","korisnik_agencije"]);
  const params = await searchParams;
  const context = await readWorkContext();
  const accessible = await warningCompanies(user);
  const activeYear = accessible.flatMap(c=>c.poslovne_godine).find(y=>y.id===context.poslovnaGodinaId)?.godina;
  const requestedYear = Number(params?.godina);
  const year = Number.isInteger(requestedYear) && requestedYear>=2000 && requestedYear<=2100 ? requestedYear : activeYear ?? new Date().getFullYear();
  const {companies,rows,withoutYear,withoutAccounts} = await loadBankStatementWarnings(user,year,params?.firma);
  const invalidCompany = Boolean(params?.firma && !companies.some(c=>c.id===params.firma));
  const onlyWarnings = params?.prikaz !== "svi";
  const displayed = rows.filter(row=>!onlyWarnings || row.missingCount>0 || row.unrecognized.length>0 || row.account.bankStatements.length===0);
  const firmsWithGaps = new Set(rows.filter(r=>r.missingCount>0).map(r=>r.company.id)).size;
  const missing = rows.reduce((sum,r)=>sum+r.missingCount,0);
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Kontrola dokumentacije</p><h1>Upozorenja</h1><p className="muted-text">Preskočeni brojevi izvoda po firmama i bankovnim računima.</p></div></header>
    <form className="admin-panel admin-form" method="get">
      <label><span>Poslovna godina</span><input name="godina" type="number" min="2000" max="2100" defaultValue={year} required/></label>
      <label><span>Firma</span><select name="firma" defaultValue={params?.firma ?? ""}><option value="">Sve dostupne firme</option>{companies.map(c=><option key={c.id} value={c.id}>{c.naziv}</option>)}</select></label>
      <label><span>Prikaz</span><select name="prikaz" defaultValue={onlyWarnings?"upozorenja":"svi"}><option value="upozorenja">Samo upozorenja i neprovjereni računi</option><option value="svi">Svi računi</option></select></label>
      <button type="submit">Prikaži</button>
    </form>
    <div className={styles.metrics}>
      <div><span>Firmi sa preskočenim brojevima</span><strong>{firmsWithGaps}</strong></div>
      <div><span>Nedostajućih brojeva</span><strong>{missing.toLocaleString("sr-Latn")}</strong></div>
      <div><span>Pregledanih računa</span><strong>{rows.length}</strong></div>
    </div>
    <p className="muted-text">Kontrola ide od broja 1 do najvećeg prepoznatog broja za {year}. Uključuje sve uvezene izvode, i neproknjižene. Ne utvrđuje da li poslije posljednjeg izvoda postoji noviji izvod. Ako ste počeli evidenciju usred godine, provjerite da li su raniji izvodi vođeni van programa.</p>
    {invalidCompany ? <p className="admin-message">Izabrana firma nije dostupna.</p> : null}
    {!companies.length ? <p className="admin-message">Nemate dostupnih firmi sa pravom pregleda izvoda.</p> : null}
    {withoutYear.length>0 ? <p className="admin-message">Bez poslovne godine {year}: {withoutYear.map(c=>c.naziv).join(", ")}. Kontrola za ove firme nije izvršena.</p> : null}
    {withoutAccounts.length>0 ? <p className="admin-message">Bez bankovnih računa za provjeru: {withoutAccounts.map(c=>c.naziv).join(", ")}.</p> : null}
    <section className="admin-panel"><div className="panel-header"><h2>Kontinuitet izvoda</h2><span>{displayed.length} računa</span></div>
      {!displayed.length ? <p className="empty-state">{rows.length ? "Na pregledanim računima nema preskočenih brojeva ni neprepoznatih oznaka." : "Nema podataka za kontrolu izvoda u izabranom prikazu."}</p> : <div className="table-wrap"><table><thead><tr><th>Firma / banka</th><th>Status</th><th>Nedostaju brojevi</th><th>Najveći broj</th><th>Posljednji datum</th><th>Akcija</th></tr></thead><tbody>
        {displayed.map(row=>{
          const uncertain = row.unrecognized.length>0;
          const contextParams = new URLSearchParams({firma_id:row.company.id,poslovna_godina_id:row.yearId,returnTo:`/agencija/izvodi${row.account.bankStatements[0] ? `?izvod=${row.account.bankStatements[0].id}` : ""}`});
          return <tr key={row.account.id}>
            <td><strong>{row.company.naziv}</strong><small>{row.account.naziv_banke} · {row.account.broj_racuna}{!row.account.aktivan?" · Neaktivan račun":""}</small></td>
            <td><span className={row.missingCount?styles.warning:uncertain||!row.highest?styles.unknown:styles.ok}>{row.missingCount?uncertain?"Mogući preskoci":"Preskočeni brojevi":uncertain?"Provjerite oznake":!row.highest?"Nema izvoda":"Bez preskoka"}</span></td>
            <td>{row.ranges.length ? <details open={row.ranges.length<=10}><summary>{row.missingCount.toLocaleString("sr-Latn")} brojeva</summary><div className={styles.ranges}>{row.ranges.map(range=><span key={range.from}>{range.from===range.to?range.from:`${range.from}–${range.to}`}</span>)}</div></details> : "—"}
              {uncertain ? <details><summary>{row.unrecognized.length} neprepoznatih oznaka</summary><p>{row.unrecognized.join(", ")}</p><small>Ove oznake nisu uključene u brojčanu provjeru; provjerite ih prije zaključka da izvod nedostaje.</small></details>:null}
              {!row.account.bankStatements.length?<small>Potpunost se ne može utvrditi bez uvezenih izvoda.</small>:null}
            </td><td>{row.highest??"—"}</td><td>{row.account.bankStatements[0]?.statement_date.toLocaleDateString("sr-Latn",{timeZone:"UTC"})??"—"}</td>
            <td><Link prefetch={false} className="table-link" href={`/agencija/kontekst?${contextParams}`}>Otvori izvode</Link></td>
          </tr>;
        })}
      </tbody></table></div>}
    </section>
  </div>;
}
