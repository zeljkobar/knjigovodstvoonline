import Link from "next/link";
import { requireAnyRole } from "@/lib/auth";
import { readWorkContext } from "@/lib/work-context";
import { prisma } from "@/lib/prisma";
import { settlementAccess, loadSettlementLedger, settlementCents, settlementDate, settlementFingerprint } from "@/lib/settlements";
import { oldestSettlementPlan } from "@/lib/settlement-plan";
import { SettlementFilters } from "@/components/SettlementFilters";
import { settlementAction } from "./actions";
const money=(c:number)=>(c/100).toLocaleString("sr-Latn-ME",{minimumFractionDigits:2,maximumFractionDigits:2});
function snapshotLabel(value:unknown,side:string){
 const item=(value as Record<string,{document?:string;date?:string}>|null)?.[side];
 return item ? `${item.document??"Dokument"} · ${item.date??""}` : "Izvorna stavka uklonjena";
}
type Params={konto?:string;partner?:string;datum?:string;predlog?:string;poruka?:string};
export default async function SettlementPage({searchParams}:{searchParams?:Promise<Params>}){
 const user=await requireAnyRole(["admin_agencije","korisnik_agencije"]),context=await readWorkContext(),params=await searchParams??{};
 if(!user.agencija_id||!context.firmaId||!context.poslovnaGodinaId)return <p>Izaberite firmu i poslovnu godinu.</p>;
 const scope={agencyId:user.agencija_id,companyId:context.firmaId,yearId:context.poslovnaGodinaId,userId:user.id};
 const year=await prisma.poslovnaGodina.findFirst({where:{id:scope.yearId,firma_id:scope.companyId,firma:{agencija_id:scope.agencyId}}});if(!year)return <p>Kontekst nije dostupan.</p>;
 const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Podgorica"}).format(new Date());
 const date=params.datum||[settlementDate(year.datum_od),today,settlementDate(year.datum_do)].sort()[1];
 await settlementAccess(prisma,scope);
 // Only partners with posted company ledger activity, never the global catalogue.
 const partnerLines=await prisma.stavkaNaloga.findMany({where:{
  komitent_id:{not:null},...(params.konto?{konto_id:params.konto}:{}),
  firma_konto:{firma_id:scope.companyId,analitika_obavezna:true,OR:[{sifra:{startsWith:"2"}},{sifra:{startsWith:"4"}}]},
  nalog:{agencija_id:scope.agencyId,firma_id:scope.companyId,status:"POSTED",is_deleted:false,datum:{lte:new Date(date+"T00:00:00Z")}},
  OR:[{nalog:{poslovna_godina_id:scope.yearId}},{prenosiOtvorenihStavki:{some:{agencija_id:scope.agencyId,firma_id:scope.companyId,poslovna_godina_id:scope.yearId,nalog:{status:"POSTED",is_deleted:false}}}}]
 },distinct:["komitent_id"],select:{komitent_id:true}});
 const partners=await prisma.komitent.findMany({where:{id:{in:partnerLines.map(l=>l.komitent_id!)},OR:[{scope:"GLOBAL",agencija_id:null},{agencija_id:scope.agencyId,scope:"AGENCY"},{agencija_id:scope.agencyId,firma_id:scope.companyId,scope:"COMPANY"}]},select:{id:true,naziv:true,pib:true},orderBy:{naziv:"asc"}});
 const selectedPartner=params.partner && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(params.partner) ? await prisma.komitent.findFirst({where:{id:params.partner,OR:[{scope:"GLOBAL",agencija_id:null},{agencija_id:scope.agencyId,scope:"AGENCY"},{agencija_id:scope.agencyId,firma_id:scope.companyId,scope:"COMPANY"}]},select:{id:true,naziv:true,pib:true}}) : null;
 let data;try{data=selectedPartner ? await loadSettlementLedger(prisma,scope,date,params.konto||undefined,selectedPartner.id) : null;}catch(e){return <p className="admin-message">{e instanceof Error?e.message:"Pregled nije dostupan."}</p>;}
 const accounts=await prisma.firmaKonto.findMany({where:{firma_id:scope.companyId,analitika_obavezna:true,OR:[{sifra:{startsWith:"2"}},{sifra:{startsWith:"4"}}]},orderBy:{sifra:"asc"}});

 const hidden=<><input type="hidden" name="firma_id" value={scope.companyId}/><input type="hidden" name="godina_id" value={scope.yearId}/><input type="hidden" name="konto" value={params.konto??""}/><input type="hidden" name="partner" value={params.partner??""}/><input type="hidden" name="datum" value={date}/></>;
 const plan=params.predlog==="1"&&data?oldestSettlementPlan(data.items):[];
 const label=(id:string)=>{const i=data?.items.find(i=>i.id===id);return i?`${i.accountCode} · ${i.document} · ${i.date}`:id;};
 return <div className="admin-stack">
  <header className="admin-header"><div><h1>Zatvaranje stavki</h1><p>Povezivanje proknjiženih zaduženja i uplata. Knjiženja i saldo partnera ostaju isti.</p></div></header>
  {params.poruka?<p className="admin-message" role="status">{params.poruka}</p>:null}
  <section className="admin-card"><h2>Izbor partnera</h2>
   <SettlementFilters key={`${scope.companyId}:${scope.yearId}`} accounts={accounts.map(a=>({id:a.id,sifra:a.sifra,naziv:a.naziv}))} accountId={params.konto??""} partnerId={selectedPartner?.id??""} partners={selectedPartner&&!partners.some(p=>p.id===selectedPartner.id)?[selectedPartner,...partners]:partners} date={date} minDate={settlementDate(year.datum_od)} maxDate={settlementDate(year.datum_do)} />
  </section>
  {!data ? <p className="admin-message">Izaberite kupca ili dobavljača da prikažete njegove stavke.</p> : <>
  <section className="admin-card"><div className="card-header"><h2>{selectedPartner?.naziv}</h2><span>{data.items.length} stavki</span></div>
   <form action={settlementAction}>{hidden}<button className="secondary-button" name="mode" value="EXACT">Zatvori po tačnom iznosu</button></form>
  </section>
  {params.partner&&params.konto?<>
  <section className="admin-card"><h2>Ručno povezivanje</h2><form action={settlementAction} className="admin-form journal-filter-form">{hidden}<label>Duguje<select name="debit" required><option value="">Izaberite stavku</option>{data.items.filter(i=>i.remainingCents>0).map(i=><option key={i.id} value={i.id}>{label(i.id)} · {money(i.remainingCents)}</option>)}</select></label><label>Potražuje<select name="credit" required><option value="">Izaberite stavku</option>{data.items.filter(i=>i.remainingCents<0).map(i=><option key={i.id} value={i.id}>{label(i.id)} · {money(-i.remainingCents)}</option>)}</select></label><label>Iznos<input name="iznos" required inputMode="decimal" placeholder="0,00"/></label><button className="primary-button" name="mode" value="MANUAL">Poveži stavke</button></form>
  <Link className="secondary-button" href={`?${new URLSearchParams({konto:params.konto,partner:params.partner,datum:date,predlog:"1"})}`}>Predloži po starosti</Link>
  {params.predlog==="1"?<form action={settlementAction}>{hidden}<input type="hidden" name="fingerprint" value={settlementFingerprint(data.items)}/><h3>Predlog po starosti</h3>{plan.map((p,i)=><p key={i}>{label(p.debitId)} ↔ {label(p.creditId)}: {money(p.cents)}</p>)}<button name="mode" value="OLDEST" disabled={!plan.length} className="primary-button">Potvrdi prikazani predlog</button></form>:null}</section>
  </>:<p className="admin-message">Za ručno zatvaranje, predlog po starosti i grupno poništavanje izaberite jednog partnera i konto.</p>}
  <section className="admin-card"><h2>Cijela kartica — otvorene i zatvorene stavke</h2><form action={settlementAction}>{hidden}<div className="table-wrap"><table className="admin-table"><thead><tr><th>Izbor</th><th>Datum / nalog</th><th>Partner / konto</th><th>Dokument</th><th>Duguje</th><th>Potražuje</th><th>Preostalo</th><th>Status</th></tr></thead><tbody>{data.items.map(i=><tr key={i.id}><td><input type="checkbox" name="stavka_id" value={i.id} disabled={!i.remainingCents} aria-label={`Izaberi stavku ${i.document}`}/></td><td>{i.date}<small>{i.journal}</small></td><td>{i.partnerName}<small>{i.accountCode}</small></td><td>{i.document}</td><td>{money(Math.max(i.signedCents,0))}</td><td>{money(Math.max(-i.signedCents,0))}</td><td>{money(Math.abs(i.remainingCents))} {i.remainingCents>0?"D":i.remainingCents<0?"P":""}</td><td>{i.remainingCents===0?"Zatvorena":i.remainingCents===i.signedCents?"Otvorena":"Djelimično zatvorena"}</td></tr>)}</tbody></table></div><button name="mode" value="SELECTED" className="primary-button">Poveži označene stavke</button><p className="muted-text">Označite uplatu i više računa ili više uplata. Raspored koristi najstarije označene stavke do raspoloživog iznosa, unutar istog partnera i konta.</p></form></section>
  <details className="admin-card"><summary>Ranije veze izvoda i početno stanje</summary><form action={settlementAction}>{hidden}<button name="mode" value="CARRY" className="secondary-button">Preuzmi razradu ranijeg automatskog početnog stanja</button></form><form action={settlementAction}>{hidden}<button name="mode" value="IMPORT" className="secondary-button">Uskladi veze izvoda</button></form>{data.legacyErrors.length?<p className="admin-message">{data.legacyErrors.length} ranijih veza zahtijeva provjeru na izvodu.</p>:null}</details>
  <section className="admin-card"><h2>Veze i istorija</h2>{data.edges.map(e=><div key={e.id}><p>{e.duguje_stavka_id?label(e.duguje_stavka_id):snapshotLabel(e.snimak,"duguje")} ↔ {e.potrazuje_stavka_id?label(e.potrazuje_stavka_id):snapshotLabel(e.snimak,"potrazuje")} · {money(settlementCents(e.iznos))} · {settlementDate(e.datum)} · {e.nacin} · {e.is_deleted?`Poništeno${e.ponisteno_datum?` od ${settlementDate(e.ponisteno_datum)}`:""}`:"Aktivno"}</p>{!e.is_deleted&&params.partner&&params.konto?<form action={settlementAction}>{hidden}<input type="hidden" name="edge_id" value={e.id}/><button className="secondary-button" name="mode" value="CANCEL">Poništi ovo zatvaranje</button></form>:null}</div>)}
  {params.partner&&params.konto?<form action={settlementAction}>{hidden}<input type="hidden" name="edges_revision" value={JSON.stringify(data.edges.filter(e=>!e.is_deleted&&data.items.some(i=>i.id===e.duguje_stavka_id)&&data.items.some(i=>i.id===e.potrazuje_stavka_id)).map(e=>e.id).sort())}/><label><input type="checkbox" name="potvrda" value="DA" required/> Potvrđujem poništavanje svih prikazanih aktivnih zatvaranja partnera na izabranom kontu do {date}.</label><button name="mode" value="CANCEL_ALL" className="secondary-button">Poništi sva prikazana zatvaranja</button></form>:null}</section>
 </>}
 </div>;
}
