import { notFound } from "next/navigation";
import { requireAnyRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { PrintButton } from "@/components/PrintButton";
import { travelAmount, travelRate, type TravelData } from "@/lib/travel-orders";
import "./print.css";
import { travelCountries } from "@/lib/travel-countries";
const date=(s:string)=>s?`${s.slice(8,10)}.${s.slice(5,7)}.${s.slice(0,4)}.`:"";
export default async function PrintTravel({params}:{params:Promise<{id:string}>}) {
 const user=await requireAnyRole(["admin_agencije","korisnik_agencije"]),{id}=await params;
 if(!user.agencija_id||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))notFound();
 const row=await prisma.putniNalog.findFirst({where:{id,agencija_id:user.agencija_id,is_deleted:false,firma:{aktivan:true,is_deleted:false,...(user.rola==="admin_agencije"?{}:{korisnici:{some:{korisnik_id:user.id,is_deleted:false}}})}}});
 if(!row||!await hasPermission(user,{firmaId:row.firma_id,modul:"putni_nalozi",akcija:"view"}))notFound();
 const d=row.podaci as unknown as TravelData;
 const legs=[...d.relacije,...Array.from({length:Math.max(0,6-d.relacije.length)},()=>null)];
 const costs=[...d.troskovi,...Array.from({length:Math.max(0,2-d.troskovi.length)},()=>null)];
 return <main className="pn-print"><div className="pn-toolbar"><PrintButton/>{row.status==="DRAFT"?<strong>NACRT — obračun nije završen</strong>:null}<span>Datum izdavanja: {date(row.datum.toISOString())}</span></div>{row.status==="DRAFT"?<p className="pn-status">NACRT — obračun nije završen</p>:null}<article className={`pn-sheet ${d.relacije.length+d.troskovi.length>12?"pn-dense":""}`}>
 <section className="pn-account"><p className="pn-intro">Na osnovu prednjeg naloga izvršio sam službeno putovanje i podnosim sledeći</p><h1>PUTNI RAČUN</h1>
 <table className="pn-cost-table"><colgroup><col style={{width:"4%"}}/><col style={{width:"20%"}}/><col style={{width:"21%"}}/><col style={{width:"19%"}}/><col style={{width:"7%"}}/><col style={{width:"13%"}}/><col style={{width:"16%"}}/></colgroup><tbody>
 <tr><th rowSpan={3} className="pn-vertical">Dnevnice</th><td colSpan={2}>Dan odlaska <b>{date(d.polazak)}</b><br/>u <b>{d.polazak.slice(11)}</b> č.</td><th>Broj časova</th><th>Broj dnev.</th><th>Po EUR</th><th>SVEGA EUR</th></tr>
 <tr><td colSpan={2}>Dan dolaska <b>{date(d.povratak)}</b><br/>u <b>{d.povratak.slice(11)}</b> č.</td><td rowSpan={2}>{d.sati.toLocaleString("sr-Latn-ME",{maximumFractionDigits:2})}</td><td rowSpan={2}>{d.brojDnevnica}</td><td rowSpan={2}>{travelAmount(d.dnevnica)}</td><td rowSpan={2}>{travelAmount(d.dnevniceUkupno)}</td></tr><tr><td colSpan={2} className="pn-spacer"/></tr>
 <tr><th rowSpan={legs.length+1} className="pn-vertical">Prevozni troškovi</th><th>od</th><th>do</th><th>Vrsta prevoza</th><th>km</th><th>EUR / km</th><th>EUR</th></tr>
 {legs.map((r,i)=><tr key={i}><td>{r?.od??" "}</td><td>{r?.do}</td><td>{r?.prevoz}</td><td>{r?.km}</td><td>{r?travelRate(r):""}</td><td>{r?travelAmount(r.iznos):""}</td></tr>)}
 <tr><th rowSpan={costs.length+1} className="pn-vertical">Ostalo</th><th colSpan={5}>Ostali troškovi</th><th>EUR</th></tr>{costs.map((r,i)=><tr key={i}><td colSpan={5}>{r?.opis??" "}</td><td>{r?travelAmount(r.iznos):""}</td></tr>)}
 <tr><td colSpan={6} className="pn-right"><strong>S v e g a</strong></td><td><strong>{travelAmount(d.ukupno)}</strong></td></tr>
 <tr><td colSpan={6} className="pn-right">Primljena akontacija</td><td>{travelAmount(d.akontacija)}</td></tr><tr><td colSpan={6} className="pn-right">{d.razlika<0?"Ostaje za povrat":"Ostaje za isplatu"}</td><td>{travelAmount(Math.abs(d.razlika))}</td></tr>
 <tr><td colSpan={7} className="pn-left">Broj priloga: {d.prilozi}<div className="pn-place">U <b>{d.mjesto}</b> dana __________________</div><div className="pn-sign right">podnosilac računa</div></td></tr>
 </tbody></table>
 <p className="pn-approval"><strong>Potvrđujem da je putovanje izvršeno prema ovom nalogu i odobravam isplatu putnog računa od EUR {travelAmount(d.ukupno)}</strong></p>
 <p>slovima: _____________________________________________________</p><p className="pn-rule">na teret <b>{d.teret}</b></p><p>U <b>{d.mjesto}</b> dana __________________</p>
 <div className="pn-signatures"><span>likvidirao</span><span>rukovodilac računovodstva</span><span>nalogodavac</span></div>
 <div className="pn-payment"><span>isplatio / naplatio EUR __________<div className="pn-sign">(blagajnik)</div></span><span>primio / vratio EUR __________<div className="pn-sign">(podnosilac računa)</div></span></div>
 </section>
 <section className="pn-order"><header><div><p>PREDUZEĆE <b>{d.firma}</b></p><p>Br. <b>{row.broj}</b> / {row.datum.getUTCFullYear()}</p><p>Datum: {date(row.datum.toISOString())}</p></div><h1>NALOG<br/>ZA SLUŽBENO<br/>PUTOVANJE</h1></header>
 <p className="pn-rule">Radnik-ca <b>{d.radnik}</b></p><p className="pn-rule">Raspoređen-na na poslove <b>{d.pozicija}</b></p>
 <p className="pn-rule pn-gap">otputovaće službeno dana <b>{date(d.polazak)}</b> u <b>{d.odrediste}{d.drzava?` — ${travelCountries.find(c=>c.kod===d.drzava)?.naziv??d.drzava}`:""}</b></p>
 <p className="pn-rule pn-task">sa zadatkom <b>{d.svrha}</b></p>
 <div className="pn-transport"><p>Za putovanje može koristiti prevozno sredstvo:</p><p className="pn-rule">u odlasku: <b>{d.odlazakPrevoz}</b></p><p className="pn-rule">u povratku: <b>{d.povratakPrevoz}</b></p>{d.registracija?<p className="pn-rule">Registracija: <b>{d.registracija}</b></p>:null}</div>
 {d.gorivo!==undefined?<p className="pn-rule">Cijena goriva: <b>{travelAmount(d.gorivo)} EUR/l</b> · sopstveno vozilo 25%; službeno vozilo bez naknade po km.</p>:null}
 <p className="pn-rule">Dnevnica za ovo službeno putovanje pripada u iznosu od EUR <b>{travelAmount(d.dnevnica)}</b>.</p>
 <p className="pn-rule">Na putu će se zadržati najdalje do: <b>{date(d.povratak)}</b></p><p>a u roku od 48 časova po povratku sa službenog puta i dolaska na posao, podneće pismeni izvještaj o obavljenom poslu. Putni račun podnijeće u roku od tri dana.</p>
 <p className="pn-rule pn-gap">Putni troškovi padaju na teret <b>{d.teret}</b></p><p className="pn-rule pn-gap">Odobravam isplatu akontacije u iznosu od EUR <b>{travelAmount(d.akontacija)}</b></p>
 <div className="pn-order-sign"><span>(M.P.)</span><div className="pn-sign">Nalogodavac</div></div>
 </section></article>{d.izvjestaj?<section className="pn-report"><h2>Izvještaj sa službenog puta</h2><p>Nalog {row.broj} · {d.radnik}</p><p>{d.izvjestaj}</p><div className="pn-sign">Podnosilac izvještaja</div></section>:null}</main>;
}
