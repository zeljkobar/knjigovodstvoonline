"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { saveTravel } from "./actions";
import { calculateTravel, travelMoney, fuelRate, travelRate, travelVehicles, dailyCount, routeKey, travelAmount, travelDuration, type TravelData, type TravelLeg, type TravelSettings } from "@/lib/travel-orders";
import { travelCountries, countryDaily } from "@/lib/travel-countries";
import CountrySelect from "./CountrySelect";
type Worker = { id:string; ime:string; prezime:string; pozicija:string };
type Route = { polazak:string; odrediste:string; polazak_drzava:string; odrediste_drzava:string; km:number };
function SaveButton() { const {pending}=useFormStatus(); return <button disabled={pending}>{pending?"Čuvanje…":"Sačuvaj putni nalog"}</button>; }
export default function TravelForm({firmaId,godinaId,year,workers,routes,settings,record,canSave}:{firmaId:string;godinaId:string;year:number;workers:Worker[];routes:Route[];settings:TravelSettings;record?:{id:string;broj:string;datum:string;status:string;verzija:string;data:TravelData};canSave:boolean}) {
 const d=record?.data;
 const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Podgorica",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const [legs,setLegs]=useState<TravelLeg[]>(d?.relacije.length?d.relacije:[{od:"",do:"",km:0,cijena:settings.kilometar,prevoz:"SOPSTVENO VOZILO",odDrzava:"ME",doDrzava:"",iznos:0}]);
 const [expenses,setExpenses]=useState(d?.troskovi??[]);
 const [start,setStart]=useState(d?.polazak??""),[end,setEnd]=useState(d?.povratak??"");
 const [rate,setRate]=useState(String((d?.dnevnica??settings.dnevnica)/100)),[advance,setAdvance]=useState(String((d?.akontacija??0)/100));
 const [days,setDays]=useState(d&&d.rucneDnevnice!==false?String(d.brojDnevnica):"");
 const [worker,setWorker]=useState(d?.radnikId??""),[position,setPosition]=useState(d?.pozicija??"");
 const [country,setCountry]=useState(d?.drzava??""),[destination,setDestination]=useState(d?.odrediste??"");
 const [fuel,setFuel]=useState(String((d?.gorivo??settings.gorivo??0)/100));
 const vehicle=(v?:string)=>v===undefined?"SOPSTVENO VOZILO":travelVehicles.find(x=>x===v.trim().toUpperCase().replace("SLUZBENO","SLUŽBENO"))??"";
 const [outbound,setOutbound]=useState(vehicle(d?.odlazakPrevoz)),[inbound,setInbound]=useState(vehicle(d?.povratakPrevoz));
 const citiesFor=(code:string)=>[...new Set(routes.flatMap(r=>[...(r.polazak_drzava===code?[r.polazak]:[]),...(r.odrediste_drzava===code?[r.odrediste]:[])]))].sort();
 const cents=(s:string)=>{try{return travelMoney(s);}catch{return 0;}};
 const currentLegs=legs.map(r=>({...r,prevoz:vehicle(r.prevoz),stopa10000:vehicle(r.prevoz)?fuelRate(Math.min(10000,cents(fuel)),vehicle(r.prevoz)):0}));
 const setTransport=(direction:"out"|"in",value:typeof travelVehicles[number])=>{
   if(direction==="out")setOutbound(value);else setInbound(value);
   setLegs(old=>old.map((r,i)=>i===0&&direction==="out"||i>0&&direction==="in"?{...r,prevoz:value}:r));
 };
 let minutes=0; try {if(start&&end)minutes=travelDuration(start,end);}catch{/* The server reports invalid dates on save. */}
 const automatic=dailyCount(minutes,d?.polaSati??settings.polaSati,d?.punaSati??settings.punaSati);
 let total={ukupno:0,razlika:0,dnevniceUkupno:0};
 try { total=calculateTravel({brojDnevnica:days===""?automatic:Number(days),dnevnica:cents(rate),akontacija:cents(advance),relacije:currentLegs,troskovi:expenses}); } catch {/* Keep editor usable while values are incomplete. */}
 const changeLeg=(i:number,patch:Partial<TravelLeg>)=>setLegs(old=>old.map((r,j)=>{
   if(i!==j)return r; const next={...r,...patch};
   if(patch.od!==undefined||patch.do!==undefined||patch.odDrzava!==undefined||patch.doDrzava!==undefined) next.km=routes.find(known=>routeKey(known.polazak,known.odrediste,known.polazak_drzava,known.odrediste_drzava)===routeKey(next.od,next.do,next.odDrzava,next.doDrzava))?.km??0;
   return next;
 }));
 return <form action={saveTravel} className="admin-stack travel-editor"><input type="hidden" name="firma_id" value={firmaId}/><input type="hidden" name="godina_id" value={godinaId}/><input type="hidden" name="id" value={record?.id??""}/><input type="hidden" name="verzija" value={record?.verzija??""}/>
 {d&&d.obracunVerzija!==2?<p role="status">Za novi obračun ovog naloga izaberite države i unesite cijenu goriva. Sačuvani obračun ostaje dostupan na štampi do čuvanja izmjena.</p>:null}
 {!workers.length?<p role="status">Firma nema evidentiranih zaposlenih. Prvo dodajte zaposlenog u meniju Plate → Zaposleni.</p>:null}<fieldset disabled={!canSave}><legend>Nalog i putovanje</legend><div className="travel-fields">
 <label>Broj naloga<input name="broj" required maxLength={80} defaultValue={record?.broj??""}/></label>
 <label>Datum izdavanja<input type="date" name="datum" required min={`${year}-01-01`} max={`${year}-12-31`} defaultValue={record?.datum??(today.startsWith(String(year))?today:`${year}-01-01`)}/></label>
 <label>Status<select name="status" defaultValue={record?.status??"DRAFT"}><option value="DRAFT">Nacrt / planirano putovanje</option><option value="COMPLETED">Završen obračun</option></select></label>
 <label>Zaposleni<select name="radnikId" required value={worker} onChange={e=>{setWorker(e.target.value);setPosition(workers.find(w=>w.id===e.target.value)?.pozicija??"");}}><option value="">Izaberite zaposlenog</option>{workers.map(w=><option key={w.id} value={w.id}>{w.prezime} {w.ime}</option>)}</select></label>
 <label>Radno mjesto<input name="pozicija" value={position} onChange={e=>setPosition(e.target.value)} maxLength={200}/></label>
 <label>Država odredišta<CountrySelect name="drzava" value={country} onChange={e=>{setCountry(e.target.value);setDestination("");setRate(String(countryDaily(e.target.value,settings)/100));}}/></label>
 <label>Grad odredišta<input name="odrediste" required disabled={!country} list={`cities-${country}`} value={destination} onChange={e=>setDestination(e.target.value)} maxLength={200}/></label>
 <label>Svrha puta<textarea name="svrha" required defaultValue={d?.svrha} maxLength={1000}/></label>
 <label>Polazak — datum i vrijeme<input type="datetime-local" name="polazak" required value={start} onChange={e=>setStart(e.target.value)}/></label>
 <label>Povratak — datum i vrijeme<input type="datetime-local" name="povratak" value={end} onChange={e=>setEnd(e.target.value)}/></label>
 <label>Prevoz u odlasku<select name="odlazakPrevoz" value={outbound} onChange={e=>setTransport("out",e.target.value as typeof travelVehicles[number])} required><option value="" disabled>Izaberite vozilo</option>{travelVehicles.map(v=><option key={v}>{v}</option>)}</select></label>
 <label>Prevoz u povratku<select name="povratakPrevoz" value={inbound} onChange={e=>setTransport("in",e.target.value as typeof travelVehicles[number])} required><option value="" disabled>Izaberite vozilo</option>{travelVehicles.map(v=><option key={v}>{v}</option>)}</select></label>
 <label>Registracija vozila<input name="registracija" defaultValue={d?.registracija} maxLength={80}/></label>
 <label>Mjesto izdavanja / obračuna<input name="mjesto" defaultValue={d?.mjesto??settings.mjesto} maxLength={200}/></label>
 <label>Troškovi na teret<input name="teret" defaultValue={d?.teret??settings.teret} maxLength={200}/></label>
 </div></fieldset>
 <fieldset disabled={!canSave}><legend>Dnevnice i prevoz</legend><div className="travel-fields">
 <label>Cijena litra goriva (EUR/l)<input name="gorivo" type="number" min={currentLegs.some(r=>r.prevoz==="SOPSTVENO VOZILO")?"0.01":"0"} max="100" step="0.01" value={fuel} onChange={e=>setFuel(e.target.value)} required/></label>
 <label>Dnevnica (EUR)<input name="dnevnica" type="number" min="0" step="0.01" value={rate} onChange={e=>setRate(e.target.value)} required/></label>
 <label>Broj dnevnica — prazno za automatski<input name="brojDnevnica" type="number" min="0" max="366" step="0.5" value={days} onChange={e=>setDays(e.target.value)} placeholder={String(automatic)}/></label>
 <p>Trajanje: {(minutes/60).toLocaleString("sr-Latn-ME")} h · Prijedlog: {automatic} dnevnica · Dnevnice: {travelAmount(total.dnevniceUkupno)} EUR</p>
 </div>{travelCountries.map(c=><datalist key={c.kod} id={`cities-${c.kod}`}>{citiesFor(c.kod).map(name=><option key={name} value={name}/>)}</datalist>)}
 <p className="muted-text">Prvo izaberite državu, pa grad. Nova relacija se pamti za naredne naloge. Sopstveno vozilo: kilometri × 25% cijene litra goriva. Službeno vozilo: naknada po kilometraži je 0; stvarne troškove unesite među ostale troškove.</p>
 <div className="table-wrap"><table><thead><tr><th>Od — država i grad</th><th>Do — država i grad</th><th>Vrsta prevoza</th><th>km</th><th>EUR / km</th><th>Iznos EUR</th><th/></tr></thead><tbody>{legs.map((r,i)=><tr key={i}>
 <td><CountrySelect aria-label={`Država polaska ${i+1}`} name={`odDrzava_${i}`} value={r.odDrzava??""} onChange={e=>changeLeg(i,{odDrzava:e.target.value,od:""})}/><input disabled={!r.odDrzava} aria-label={`Od ${i+1}`} name={`od_${i}`} list={`cities-${r.odDrzava}`} value={r.od} onChange={e=>changeLeg(i,{od:e.target.value})} maxLength={80} required/></td>
 <td><CountrySelect aria-label={`Država dolaska ${i+1}`} name={`doDrzava_${i}`} value={r.doDrzava??""} onChange={e=>changeLeg(i,{doDrzava:e.target.value,do:""})}/><input disabled={!r.doDrzava} aria-label={`Do ${i+1}`} name={`do_${i}`} list={`cities-${r.doDrzava}`} value={r.do} onChange={e=>changeLeg(i,{do:e.target.value})} maxLength={80} required/></td>
 <td><select aria-label={`Prevoz ${i+1}`} name={`prevoz_${i}`} value={vehicle(r.prevoz)} onChange={e=>changeLeg(i,{prevoz:e.target.value})} required><option value="" disabled>Izaberite vozilo</option>{travelVehicles.map(v=><option key={v}>{v}</option>)}</select></td>
 <td><input aria-label={`Kilometri ${i+1}`} name={`km_${i}`} type="number" min="0.01" max="100000" step="0.01" value={r.km||""} onChange={e=>changeLeg(i,{km:Number(e.target.value)})} required/></td>
 <td>{travelRate(currentLegs[i])}</td>
 <td>{travelAmount(Math.round(Math.round(r.km*100)*(currentLegs[i].stopa10000??0)/10000))}</td><td><button type="button" onClick={()=>setLegs(legs.filter((_,j)=>j!==i))}>Ukloni</button></td></tr>)}</tbody></table></div>
 <div className="table-actions"><button type="button" disabled={legs.length>=12} onClick={()=>setLegs([...legs,{od:legs.at(-1)?.do??"",do:"",odDrzava:legs.at(-1)?.doDrzava??"ME",doDrzava:country,km:0,cijena:0,prevoz:inbound,iznos:0}])}>Dodaj relaciju</button>
 <button type="button" disabled={!legs.length||legs.length>=12} onClick={()=>{const r=legs[legs.length-1];setLegs([...legs,{...r,od:r.do,do:r.od,odDrzava:r.doDrzava,doDrzava:r.odDrzava,prevoz:inbound}]);}}>Dodaj povratnu relaciju</button></div>
 <label className="travel-check"><input type="checkbox" name="zapamti" defaultChecked/>Zapamti nove relacije za naredne naloge agencije</label>
 </fieldset>
 <fieldset disabled={!canSave}><legend>Ostali troškovi i obračun</legend>{expenses.map((e,i)=><div className="travel-expense" key={i}><label>Opis troška<input name={`trosak_${i}`} value={e.opis} onChange={v=>setExpenses(expenses.map((x,j)=>j===i?{...x,opis:v.target.value}:x))} maxLength={200} required/></label><label>Iznos EUR<input name={`iznos_${i}`} type="number" min="0" step="0.01" value={e.iznos/100} onChange={v=>setExpenses(expenses.map((x,j)=>j===i?{...x,iznos:cents(v.target.value)}:x))}/></label><button type="button" onClick={()=>setExpenses(expenses.filter((_,j)=>i!==j))}>Ukloni</button></div>)}
 <button type="button" disabled={expenses.length>=8} onClick={()=>setExpenses([...expenses,{opis:"",iznos:0}])}>Dodaj trošak</button><div className="travel-fields">
 <label>Primljena akontacija (EUR)<input name="akontacija" type="number" min="0" step="0.01" value={advance} onChange={e=>setAdvance(e.target.value)} required/></label>
 <label>Broj priloga<input name="prilozi" type="number" min="0" max="999" step="1" defaultValue={d?.prilozi??0}/></label>
 <label>Izvještaj sa puta<textarea name="izvjestaj" defaultValue={d?.izvjestaj} maxLength={4000}/></label></div>
 <p className="travel-total">Ukupno: {travelAmount(total.ukupno)} EUR · {total.razlika<0?"Za povrat":"Za isplatu"}: {travelAmount(Math.abs(total.razlika))} EUR</p>
 {canSave?<SaveButton/>:null}</fieldset></form>;
}
