import styles from "../employees.module.css";
import Link from "next/link";
import {prisma} from "@/lib/prisma";
import {getPlateContext,MissingPlateContext} from "../_shared";
import {saveEmploymentContract} from "./actions";
const messages:Record<string,string>={sacuvano:"Ugovor je sačuvan.",prava:"Nemate pravo za ovu radnju.",podaci:"Provjerite broj, datum i zaposlenog. Datum ugovora mora biti u izabranoj poslovnoj godini.",zakljucano:"Godina ugovora ili izabrana godina je zaključana.",nedostaje:"Dopunite karticu zaposlenog: JMBG, adresu, opštinu, radno mjesto, mjesto rada, trajanje ugovora, datume, neto zaradu i radno vrijeme. Firma mora imati PIB, adresu i izvršnog direktora.",zastarjelo:"Ugovor je promijenjen. Osvježite stranicu.",status:"Potvrđeni i poništeni ugovori se ne mijenjaju.",broj:"Broj ugovora već postoji za ovu firmu."};
export default async function PayrollContractsPage({searchParams}:{searchParams?:Promise<{radnik?:string;ugovor?:string;poruka?:string}>}) {
 const c=await getPlateContext("view"),p=await searchParams;
 if(!c.firma||!c.godina||!c.user.agencija_id)return <MissingPlateContext title="Ugovori o radu"/>;
 if(!c.allowed)return <p>Nemate pravo pregleda plata.</p>;
 const where={agencija_id:c.user.agencija_id,firma_id:c.firma.id};
 const [workers,contracts,createAccess,updateAccess,deleteAccess]=await Promise.all([
  prisma.plateRadnik.findMany({where:{...where,is_deleted:false},orderBy:[{prezime:"asc"},{ime:"asc"}]}),
  prisma.ugovorORadu.findMany({where,include:{radnik:{select:{ime:true,prezime:true}}},orderBy:{created_at:"desc"}}),
  getPlateContext("create"),getPlateContext("update"),getPlateContext("delete")
 ]);
 const fields=<><input type="hidden" name="firma_id" defaultValue={c.firma.id}/><input type="hidden" name="godina_id" defaultValue={c.godina.id}/></>;
 return <div className={`admin-stack ${styles.page}`}><header className="admin-header"><div><h1>Ugovori o radu</h1><p>{c.firma.naziv} · {c.godina.godina}</p></div></header>
 {p?.poruka&&messages[p.poruka]?<p role="status" className="admin-message">{messages[p.poruka]}</p>:null}
 <p className="muted-text">Podaci se preuzimaju sa kartice zaposlenog. Predložak je preuzet iz postojećeg sajta Summa Summarum. Pregledajte nacrt prije potvrde.</p>
 {createAccess.allowed&&!c.godina.zakljucena?<section className="admin-panel"><h2>Novi ugovor</h2><form className="admin-form" action={saveEmploymentContract}>{fields}<input type="hidden" name="akcija" defaultValue="novi"/><label><span>Zaposleni</span><select name="radnik_id" defaultValue={p?.radnik??""} required><option value="">Izaberite zaposlenog</option>{workers.map(w=><option key={w.id} value={w.id}>{w.prezime} {w.ime}</option>)}</select></label><label><span>Broj ugovora</span><input name="broj" required maxLength={80}/></label><label><span>Datum zaključenja</span><input name="datum" type="date" required min={`${c.godina.godina}-01-01`} max={`${c.godina.godina}-12-31`}/></label><button type="submit">Napravi nacrt</button></form></section>:null}
 <section className="admin-panel"><h2>Sačuvani ugovori</h2>{contracts.length===0?<p>Nema sačuvanih ugovora.</p>:<div className="table-wrap"><table><thead><tr><th>Broj / datum</th><th>Zaposleni</th><th>Status</th><th>Radnje</th></tr></thead><tbody>{contracts.map(row=><tr key={row.id}><td>{row.broj}<small>{row.datum.toLocaleDateString("sr-Latn",{timeZone:"UTC"})}</small></td><td>{row.radnik.prezime} {row.radnik.ime}</td><td>{row.status==="DRAFT"?"Nacrt":row.status==="CONCLUDED"?"Potvrđen":"Poništen"}</td><td><div className="table-actions"><Link className="table-button" href={`/stampa/plate/ugovori/${row.id}`} target="_blank">Pregled / štampa</Link><Link className="table-button" href={`/agencija/plate?edit=${row.radnik_id}`}>Kartica zaposlenog</Link></div>{!c.godina!.zakljucena&&row.status!=="CANCELLED"?<div key={row.updated_at.toISOString()}>
{row.status==="DRAFT"&&updateAccess.allowed?<>
<form action={saveEmploymentContract} className="admin-form">{fields}<input type="hidden" name="id" defaultValue={row.id}/><input type="hidden" name="verzija" defaultValue={row.updated_at.toISOString()}/><input type="hidden" name="akcija" defaultValue="osvjezi"/>
<label><span>Broj ugovora</span><input name="broj" defaultValue={row.broj} required maxLength={80}/></label><label><span>Datum zaključenja</span><input name="datum" type="date" defaultValue={row.datum.toISOString().slice(0,10)} required/></label><button type="submit">Sačuvaj i preuzmi podatke zaposlenog</button></form>
<form action={saveEmploymentContract}>{fields}<input type="hidden" name="id" defaultValue={row.id}/><input type="hidden" name="verzija" defaultValue={row.updated_at.toISOString()}/><input type="hidden" name="akcija" defaultValue="potvrdi"/><button type="submit">Potvrdi sačuvani nacrt</button></form>
</>:null}
{deleteAccess.allowed?<form action={saveEmploymentContract}>{fields}<input type="hidden" name="id" defaultValue={row.id}/><input type="hidden" name="verzija" defaultValue={row.updated_at.toISOString()}/><input type="hidden" name="akcija" defaultValue="ponisti"/><button type="submit" className="table-button table-button-danger">Poništi ugovor</button></form>:null}
</div>:null}</td></tr>)}</tbody></table></div>}</section></div>;
}
