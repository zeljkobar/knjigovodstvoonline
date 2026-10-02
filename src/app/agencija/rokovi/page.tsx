import Link from "next/link";
import { requireAnyRole } from "@/lib/auth";
import { loadDeadlines } from "@/lib/deadlines";
import { annualChecklist, deadlineNames, deadlineSelection, localToday, type DeadlineKind } from "@/lib/deadline-rules";
import { updateDeadline } from "./actions";
import styles from "./deadlines.module.css";

const messages: Record<string,string> = {sacuvano:"Promjena je sačuvana.",prava:"Nemate pristup izabranoj firmi ili ovoj izmjeni.",podaci:"Provjerite unesene podatke i uključene obaveze.",zastarjelo:"Podaci su u međuvremenu promijenjeni. Provjerite novo stanje prije ponovne izmjene."};
type Filters = {tab?:string;period?:string;firma?:string;radnik?:string;status?:string;ranije?:string;poruka?:string};
export default async function DeadlinesPage({searchParams}:{searchParams?:Promise<Filters>}) {
 const user = await requireAnyRole(["admin_agencije","korisnik_agencije"]);
 const p = await searchParams ?? {};
 const kind: DeadlineKind = p.tab === "PLATE" || p.tab === "ZAVRSNI" ? p.tab : "PDV";
 const selection = deadlineSelection(kind,p.period);
 const current = deadlineSelection(kind);
 const {companies,tasks} = await loadDeadlines(user,Math.max(selection.year,current.year),true);
 const workers = [...new Map(companies.flatMap(c=>c.korisnici.map(k=>[k.korisnik.id,k.korisnik] as const))).values()];
 const scoped = tasks.filter(t=>t.kind===kind&&(!p.firma||t.company.id===p.firma)&&(!p.radnik||t.company.korisnici.some(k=>k.korisnik.id===p.radnik)));
 const earlier = scoped.filter(t=>!t.saved?.zavrseno_at&&t.due<current.due&&t.due<localToday());
 const previous = p.ranije === "1";
 const filtered = previous ? earlier : scoped.filter(t=>t.year===selection.year&&t.month===selection.month);
 const shown = filtered.filter(t=>!p.status||p.status==="svi"||(p.status==="otvoreni"?!t.saved?.zavrseno_at:p.status==="predato"?Boolean(t.saved?.zavrseno_at):t.state===p.status));
 const done = filtered.filter(t=>t.saved?.zavrseno_at).length;
 const periodLabel = kind === "ZAVRSNI" ? selection.period : new Date(`${selection.period}-01T12:00:00Z`).toLocaleDateString("sr-Latn",{month:"long",year:"numeric",timeZone:"UTC"});
 function href(values:Partial<Filters>) {
  const query = new URLSearchParams();
  for(const [key,val] of Object.entries({...p,poruka:undefined,...values}))if(val)query.set(key,val);
  return `/agencija/rokovi?${query}`;
 }
 const returnFields = Object.entries({tab:kind,period:selection.period,firma:p.firma,radnik:p.radnik,status:p.status,ranije:p.ranije}).map(([key,val])=>val?<input key={key} type="hidden" name={`povrat_${key}`} value={val}/>:null);
 return <div className={`admin-stack ${styles.page}`}>
  <header className="admin-header"><div><p className="eyebrow">Obaveze po firmama</p><h1>Rokovi</h1><p className="muted-text">Pregled pripreme i predaje obaveza vaših firmi.</p></div></header>
  <nav className={styles.tabs} aria-label="Vrsta obaveze">{Object.entries(deadlineNames).map(([key,name])=><Link key={key} href={href({tab:key,period:undefined,ranije:undefined,status:undefined})} aria-current={key===kind?"page":undefined}>{name}</Link>)}</nav>
  {p.poruka&&messages[p.poruka]?<p role="status" className="admin-message">{messages[p.poruka]}</p>:null}
  {earlier.length>0?<aside className={styles.warning}><strong>{earlier.length} nezavršenih obaveza iz ranijih perioda</strong><span>Zaostaci ostaju vidljivi i kada počne novi mjesec ili godina.</span><Link href={href({ranije:previous?undefined:"1",status:"svi"})}>{previous?"Vrati se na izabrani period":"Prikaži ranije obaveze"} →</Link></aside>:null}
  <form method="get" className="admin-panel admin-form">
   <input type="hidden" name="tab" value={kind}/>
   <label><span>{kind==="ZAVRSNI"?"Godina izvještaja":"Period obaveze"}</span>{kind==="ZAVRSNI"?<input name="period" type="number" min="2000" max="2099" defaultValue={selection.period}/>:<input name="period" type="month" min="2000-01" max="2099-12" defaultValue={selection.period}/>}</label>
   <label><span>Firma</span><select name="firma" defaultValue={p.firma??""}><option value="">Sve dostupne firme</option>{companies.map(c=><option key={c.id} value={c.id}>{c.naziv}</option>)}</select></label>
   <label><span>Radnik na firmi</span><select name="radnik" defaultValue={p.radnik??""}><option value="">Svi radnici</option>{workers.map(w=><option key={w.id} value={w.id}>{w.korisnicko_ime}</option>)}</select></label>
   <label><span>Status</span><select name="status" defaultValue={p.status??"svi"}><option value="svi">Svi statusi</option><option value="otvoreni">Nije predato</option><option value="predato">Predato</option><option value="Kasni">Kasni</option></select></label>
   <button>Prikaži period</button>
  </form>
  <section className={`admin-panel ${styles.overview}`}>
   <div><h2>{previous?`${deadlineNames[kind]} — ranije obaveze`:`${deadlineNames[kind]} za ${periodLabel}`}</h2><p className="muted-text">{previous?"Sve ranije dospjele obaveze koje nisu potvrđene kao predate.":`Rok ${selection.due.toLocaleDateString("sr-Latn",{timeZone:"UTC"})}`}</p></div>
   <div><strong>Predato {done} od {filtered.length}</strong><progress aria-label="Napredak predaje" value={done} max={filtered.length||1}/></div>
  </section>
  <p className="muted-text">Postojanje obračuna ili prijave prikazuje se iz evidencije. Predaju potvrđuje radnik; pripremljen dokument sam po sebi ne znači da je predat.</p>
  <section className="admin-panel"><div className="panel-header"><h2>{previous?"Ranije nezavršene obaveze":"Firme"}</h2><span>{shown.length} prikazano</span></div>
   {!shown.length?<p className="empty-state">Nema obaveza za izabrani period i filtere. Provjerite početni mjesec praćenja u podešavanjima obaveza.</p>:<div className="table-wrap"><table><thead><tr><th>Firma / period</th><th>Rok / status</th><th>Zaduženje / evidencija</th>{kind==="ZAVRSNI"?<th>Kontrolna lista</th>:null}<th>Predaja</th></tr></thead><tbody>{shown.map(t=>{
    const main=t.company.korisnici.filter(k=>k.glavni_radnik);
    const fields=<>{returnFields}<input type="hidden" name="firma" value={t.company.id}/><input type="hidden" name="vrsta" value={t.kind}/><input type="hidden" name="godina" value={t.year}/><input type="hidden" name="mjesec" value={t.month}/><input type="hidden" name="verzija" value={t.saved?.updated_at.toISOString()??""}/></>;
    return <tr key={`${t.company.id}-${t.kind}-${t.year}-${t.month}`}>
     <td><strong>{t.company.naziv}</strong><small>{t.period}</small></td>
     <td>{t.due.toLocaleDateString("sr-Latn",{timeZone:"UTC"})}<small><span className={t.state==="Kasni"?styles.late:t.saved?.zavrseno_at?styles.done:styles.pending}>{t.saved?.zavrseno_at?"Predato":t.state}</span></small></td>
     <td>{main.length?main.map(k=>k.korisnik.korisnicko_ime).join(", "):"Bez glavnog radnika"}<small>{t.evidence}</small></td>
     {kind==="ZAVRSNI"?<td><details className={styles.checklist}><summary>Provjere · {t.saved?.kontrola.length??0}/{Object.keys(annualChecklist).length}</summary><form action={updateDeadline}>{fields}<input type="hidden" name="napomena" value={t.saved?.napomena??""}/>{Object.entries(annualChecklist).map(([key,label])=><label key={key}><input type="checkbox" name="kontrola" value={key} defaultChecked={t.saved?.kontrola.includes(key)??false}/><span>{label}</span></label>)}<button className="table-button" name="akcija" value="kontrola">Sačuvaj provjere</button></form></details></td>:null}
     <td><form action={updateDeadline} className={styles.taskForm}>{fields}
      {t.saved?.zavrseno_at?<small>Potvrdio/la {t.saved.zavrseno_ime??"korisnik"}<br/>{t.saved.zavrseno_at.toLocaleString("sr-Latn",{timeZone:"Europe/Podgorica"})}</small>:null}
      <label><span>Napomena (opciono)</span><textarea name="napomena" maxLength={1000} defaultValue={t.saved?.napomena??""} rows={2}/></label>
      <button className="table-button" name="akcija" value={t.saved?.zavrseno_at?"otvori":"zavrsi"}>{t.saved?.zavrseno_at?"Vrati u nepredato":"Označi predato"}</button>
     </form></td>
    </tr>;
   })}</tbody></table></div>}
  </section>
  {user.rola==="admin_agencije"?<section className="admin-panel"><details><summary>Podešavanje obaveza po firmama</summary><p className="muted-text">Izaberite obaveze i mjesec od kojeg pratite njihove rokove. Već evidentirani zadaci ostaju sačuvani i kada isključite obavezu. Radnici potvrđuju završetak svojih firmi; samo administrator mijenja ovaj plan.</p>{companies.map(c=><form key={c.id} action={updateDeadline} className={`admin-form ${styles.plan}`}>
   {returnFields}<h3 className="form-wide">{c.naziv}</h3><input type="hidden" name="firma" value={c.id}/><input type="hidden" name="verzija" value={c.rok_plan?.updated_at.toISOString()??""}/><input type="hidden" name="godina" value={selection.year}/>
   <label className="single-checkbox form-checkbox"><input type="checkbox" name="pdv" defaultChecked={c.rok_plan?.pdv??c.pdv_obveznik}/><span>PDV</span></label><label className="single-checkbox form-checkbox"><input type="checkbox" name="plate" defaultChecked={c.rok_plan?.plate??c.defaultPayroll}/><span>Plate</span></label><label className="single-checkbox form-checkbox"><input type="checkbox" name="zavrsni" defaultChecked={c.rok_plan?.zavrsni??true}/><span>Završni račun</span></label>
   <label><span>Prati rokove od mjeseca</span><input type="month" name="od_mjeseca" required defaultValue={(c.rok_plan?.od_mjeseca??c.created_at).toISOString().slice(0,7)}/></label><button name="akcija" value="plan">Sačuvaj plan</button>
  </form>)}</details></section>:null} </div>;
}
