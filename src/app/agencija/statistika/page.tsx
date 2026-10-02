import { requireAnyRole } from "@/lib/auth";
import { readWorkContext } from "@/lib/work-context";
import { loadAgencyStatistics, statisticCompanies, statisticLabels, type Metric } from "@/lib/agency-statistics";
import styles from "./statistics.module.css";
const monthNames=["Januar","Februar","Mart","April","Maj","Jun","Jul","Avgust","Septembar","Oktobar","Novembar","Decembar"];
const number=(n:number|null)=>n===null?"—":n.toLocaleString("sr-Latn");
export default async function StatisticsPage({searchParams}:{searchParams?:Promise<{godina?:string;mjesec?:string;firma?:string}>}) {
  const user=await requireAnyRole(["admin_agencije","korisnik_agencije"]);
  const params=await searchParams,context=await readWorkContext();
  const companies=await statisticCompanies(user);
  const currentYear=companies.flatMap(c=>c.poslovne_godine).find(y=>y.id===context.poslovnaGodinaId)?.godina??new Date().getFullYear();
  const y=Number(params?.godina),m=Number(params?.mjesec);
  const year=Number.isInteger(y)&&y>=2000&&y<=2100?y:currentYear;
  const month=Number.isInteger(m)&&m>=1&&m<=12?m:null;
  const data=await loadAgencyStatistics(user,year,month,params?.firma);
  const metrics=(Object.keys(statisticLabels) as Metric[]).filter(k=>data.visible[k]);
  const maximum=Math.max(1,...data.months.flatMap(row=>[row.counts.incoming,row.counts.outgoing,row.counts.statements]));
  return <div className={`admin-stack ${styles.page}`}>
    <header className="admin-header"><div><p className="eyebrow">Pregled rada agencije</p><h1>Statistika</h1><p className="muted-text">{month?monthNames[month-1]:"Cijela godina"} · {year} · {params?.firma?companies.find(c=>c.id===params.firma)?.naziv??"Nedostupna firma":"Sve dostupne firme"}</p></div></header>
    <form method="get" className="admin-panel admin-form"><label><span>Godina</span><input name="godina" type="number" min="2000" max="2100" defaultValue={year}/></label><label><span>Mjesec</span><select name="mjesec" defaultValue={month??""}><option value="">Cijela godina</option>{monthNames.map((name,i)=><option key={name} value={i+1}>{name}</option>)}</select></label><label><span>Firma</span><select name="firma" defaultValue={params?.firma??""}><option value="">Sve dostupne firme</option>{companies.map(c=><option key={c.id} value={c.id}>{c.naziv}</option>)}</select></label><button>Prikaži</button></form>
    <section className={styles.cards} aria-label="Broj dokumenata">{metrics.map(key=><article key={key}><span>{statisticLabels[key]}</span><strong>{number(data.totals[key])}</strong><small>{["payroll","service","rent","other"].includes(key)?"Obračunato · bez nacrta":"Proknjiženo u izabranom periodu"}</small></article>)}</section>
    <section className="admin-panel"><div className="panel-header"><h2>Firme i ljudi</h2><span>Trenutno stanje</span></div><div className={styles.people}><div><strong>{data.rows.length}</strong><span>Aktivne firme u prikazu</span></div>{data.agencyWorkers!==null?<div><strong>{data.agencyWorkers}</strong><span>Aktivni radnici agencije · cijela agencija</span></div>:null}{data.workers!==null?<div><strong>{data.workers}</strong><span>Aktivni zaposleni kod izabranih firmi</span></div>:null}{data.contracts!==null?<div><strong>{data.contracts}</strong><span>Evidentirani ugovori agencije sa firmama</span></div>:null}</div></section>
    <section className="admin-panel"><div className="panel-header"><h2>Dokumenti po mjesecima · {year}</h2></div><p className="muted-text">KUF, KIF i izvodi prikazani su odvojeno. Nalozi se ne sabiraju sa izvornim dokumentima.</p><div className={styles.legend}>{(["incoming","outgoing","statements"] as Metric[]).filter(k=>data.visible[k]).map(k=><span key={k}><i className={styles[k]}/>{statisticLabels[k]}</span>)}</div><div className={styles.chart}>{data.months.map(row=><div className={`${styles.month} ${month===row.month?styles.selected:""}`} key={row.month}><span>{monthNames[row.month-1]}</span><div>{(["incoming","outgoing","statements"] as Metric[]).filter(k=>data.visible[k]).map(k=><div className={styles.track} key={k}><div className={styles[k]} style={{width:`${row.counts[k]/maximum*100}%`}}/><b>{number(row.counts[k])}</b><span className={styles.sr}>{statisticLabels[k]}</span></div>)}</div></div>)}</div></section>
    <section className="admin-panel"><div className="panel-header"><h2>Pregled po firmama</h2><span>{data.rows.length} firmi</span></div>{!data.rows.length?<p className="empty-state">Nema dostupnih firmi u ovom prikazu.</p>:<div className="table-wrap"><table><thead><tr><th>Firma</th>{metrics.map(k=><th key={k}>{statisticLabels[k]}</th>)}<th>Zaposleni · sada</th></tr></thead><tbody>{data.rows.map(row=><tr key={row.id}><td><strong>{row.naziv}</strong></td>{metrics.map(k=><td key={k}>{number(row.visible[k]?row.counts[k]:null)}</td>)}<td>{number(row.workers)}</td></tr>)}</tbody></table></div>}</section>
    <p className="muted-text">Nalozi, KIF/KUF i izvodi broje se samo kada su proknjiženi i imaju važeći proknjižen nalog. Period se određuje datumom dokumenta, a plate mjesecom obračuna. Obračuni uključuju obračunate, pregledane, proknjižene i zaključane obračune, bez nacrta i obrisanih. Jedan obračun može obuhvatiti više zaposlenih. Zaposleni se broje po evidenciji firme. Crtica označava podatak za koji nemate pravo pregleda.</p>
  </div>;
}
