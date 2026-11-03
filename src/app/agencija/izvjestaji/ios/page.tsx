import { requireAnyRole } from "@/lib/auth";
import { AutoSubmitFilterForm } from "@/components/AutoSubmitFilterForm";
import { IosPartnerSelection } from "@/components/IosPartnerSelection";
import { loadIosReport, iosQuery, type IosParams } from "@/lib/ios";
export default async function IosPage({searchParams}:{searchParams?:Promise<IosParams>}){
 await requireAnyRole(["admin_agencije","korisnik_agencije"]);
 const params=await searchParams??{};
 let data;try{data=await loadIosReport(params);}catch(error){return <p className="admin-message">{error instanceof Error?error.message:"IOS nije dostupan."}</p>;}
 const query=iosQuery({...params,datum:data.date});
 return <div className="admin-stack"><header className="admin-header"><div><h1>IOS — Izvod otvorenih stavki</h1><p>Izaberite datum i partnere. Za svakog partnera štampa se zaseban obrazac za usaglašavanje.</p></div></header>
 <section className="admin-card"><h2>Filteri</h2><AutoSubmitFilterForm action="/agencija/izvjestaji/ios" className="admin-form journal-filter-form">
 <label>Stanje na dan<input type="date" name="datum" defaultValue={data.date}/></label>
 <label>Partneri<select name="vrsta" defaultValue={params.vrsta??"svi"}><option value="svi">Kupci i dobavljači</option><option value="kupci">Kupci</option><option value="dobavljaci">Dobavljači</option></select></label>
 <label>Prikaz<select name="prikaz" defaultValue={params.prikaz??"svi"}><option value="svi">Domaći i ino</option><option value="domaci">Domaći</option><option value="ino">Ino</option></select></label>
 <label>Konto<select name="konto" defaultValue={params.konto??""}><option value="">Sva konta kupaca i dobavljača</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.sifra} — {a.naziv}</option>)}</select></label>
 <label>Pretraga partnera<input type="search" name="q" defaultValue={params.q??""} placeholder="Naziv ili PIB"/></label>
 <label><input type="checkbox" name="nulti" value="1" defaultChecked={params.nulti==="1"}/> Prikaži i partnere bez otvorenih stavki</label>
 </AutoSubmitFilterForm></section>
 <section className="admin-card"><IosPartnerSelection key={query.toString()} query={query.toString()} rows={data.reports.map(r=>({id:r.partner.id,name:r.partner.naziv,tax:r.partner.pib??r.partner.foreign_tax_number,count:r.items.length,debit:r.debit,credit:r.credit}))}/></section></div>;
}
