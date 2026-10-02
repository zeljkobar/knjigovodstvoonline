import "server-only";
import type { Korisnik } from "@prisma/client";
import { prisma } from "./prisma";
import { deadlineDate, deadlineState, deadlinePeriod, type DeadlineKind } from "./deadline-rules";
export type DeadlineUser=Pick<Korisnik,"id"|"agencija_id"|"rola">;
export function deadlineCompanyScope(user:DeadlineUser) {
 return {agencija_id:user.agencija_id??"00000000-0000-0000-0000-000000000000",aktivan:true,is_deleted:false,...(user.rola==="admin_agencije"?{}:{korisnici:{some:{korisnik_id:user.id,is_deleted:false}}})};
}
export async function loadDeadlines(user:DeadlineUser,year:number,includeEarlier=false) {
 if(!user.agencija_id||!["admin_agencije","korisnik_agencije"].includes(user.rola))return {companies:[],tasks:[]};
 const companies=await prisma.firma.findMany({where:deadlineCompanyScope(user),select:{id:true,naziv:true,pdv_obveznik:true,created_at:true,rok_plan:true,rok_zadaci:{where:{agencija_id:user.agencija_id,godina_roka:includeEarlier?{gte:2000,lte:year}:year}},korisnici:{where:{is_deleted:false,korisnik:{agencija_id:user.agencija_id,aktivan:true,is_deleted:false,rola:{in:["admin_agencije","korisnik_agencije"]}}},select:{glavni_radnik:true,korisnik:{select:{id:true,korisnicko_ime:true}}},orderBy:{glavni_radnik:"desc"}}},orderBy:{naziv:"asc"}});
 const employees=await prisma.plateRadnik.groupBy({by:["firma_id"],where:{agencija_id:user.agencija_id,firma_id:{in:companies.map(c=>c.id)},aktivan:true,zaposlen:true,is_deleted:false},_count:{_all:true}});
 const rights=user.rola==="admin_agencije"?[]:await prisma.korisnikPravo.findMany({where:{agencija_id:user.agencija_id,korisnik_id:user.id,firma_id:{in:companies.map(c=>c.id)},akcija:"view",dozvoljeno:true},select:{firma_id:true,modul:true}});
 const allowed=(moduleName:string)=>companies.filter(c=>user.rola==="admin_agencije"||rights.some(r=>r.firma_id===c.id&&r.modul===moduleName)).map(c=>c.id);
 const [vat,payroll,reports]=await Promise.all([
  prisma.pdvPrijava.findMany({where:{agencija_id:user.agencija_id,firma_id:{in:allowed("pdv")},poslovna_godina:{godina:{gte:includeEarlier?1999:year-1,lte:year}}},select:{firma_id:true,pdv_period:{select:{mjesec:true}},poslovna_godina:{select:{godina:true}}}}),
  prisma.plateObracun.findMany({where:{agencija_id:user.agencija_id,firma_id:{in:allowed("plate")},godina:{gte:includeEarlier?1999:year-1,lte:year},kategorija:"REDOVAN_RAD",is_deleted:false,status:{in:["CALCULATED","REVIEWED","POSTED","LOCKED"]}},select:{firma_id:true,godina:true,mjesec:true}}),
  prisma.finansijskiIzvjestajArhiva.findMany({where:{agencija_id:user.agencija_id,firma_id:{in:allowed("zavrsni_racun")},poslovna_godina:{godina:{gte:includeEarlier?1999:year-1,lte:year-1}}},select:{firma_id:true,poslovna_godina:{select:{godina:true}}}})
 ]);
 const tasks=companies.flatMap(company=>{
  const plan=company.rok_plan??{pdv:company.pdv_obveznik,plate:employees.some(e=>e.firma_id===company.id),zavrsni:true,od_mjeseca:new Date(Date.UTC(company.created_at.getUTCFullYear(),company.created_at.getUTCMonth(),1)),updated_at:null};
  const firstYear=includeEarlier?Math.max(2000,Math.min(year,plan.od_mjeseca.getUTCFullYear(),...company.rok_zadaci.map(t=>t.godina_roka))):year;
  return Array.from({length:year-firstYear+1},(_,i)=>firstYear+i).flatMap(taskYear=>{
  const year=taskYear;
  return Array.from({length:12},(_,i)=>i+1).flatMap(month=>(["PDV","PLATE","ZAVRSNI"] as DeadlineKind[]).flatMap(kind=>{
   const saved=company.rok_zadaci.find(t=>t.vrsta===kind&&t.godina_roka===year&&t.mjesec_roka===month);
   const due=deadlineDate(kind,year,month);
   const enabled=kind==="PDV"?plan.pdv:kind==="PLATE"?plan.plate:plan.zavrsni;
   if(kind==="ZAVRSNI"&&month!==3)return [];
   // Saved work remains visible even after its schedule is disabled.
   if(!saved&&(!enabled||due<plan.od_mjeseca))return [];
   const periodYear=month===1?year-1:year,periodMonth=month===1?12:month-1;
   const moduleName=kind==="PDV"?"pdv":kind==="PLATE"?"plate":"zavrsni_racun";
   const evidence=!allowed(moduleName).includes(company.id)?"Bez prava pregleda obračuna":kind==="PDV"?(vat.some(v=>v.firma_id===company.id&&v.pdv_period.mjesec===periodMonth&&v.poslovna_godina.godina===periodYear)?"Postoji PDV prijava":"Nema sačuvane PDV prijave"):kind==="PLATE"?(payroll.some(p=>p.firma_id===company.id&&p.godina===periodYear&&p.mjesec===periodMonth)?"Postoji obračun plata":"Nema obračuna plata"):(reports.some(r=>r.firma_id===company.id&&r.poslovna_godina.godina===year-1)?"Postoji arhiviran izvještaj":"Nema arhiviranog izvještaja");
   return [{company,kind,year,month,due,evidence,period:deadlinePeriod(kind,year,month),saved,state:deadlineState(due,Boolean(saved?.zavrseno_at))}];
  }));
  });
 });
 tasks.sort((a,b)=>Number(Boolean(a.saved?.zavrseno_at))-Number(Boolean(b.saved?.zavrseno_at))||a.due.getTime()-b.due.getTime()||a.company.naziv.localeCompare(b.company.naziv,"sr-Latn"));
 return {companies:companies.map(c=>({...c,defaultPayroll:employees.some(e=>e.firma_id===c.id)})),tasks};
}
