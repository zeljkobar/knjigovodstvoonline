import "server-only";
import type { Korisnik } from "@prisma/client";
import { prisma } from "./prisma";
type User = Pick<Korisnik,"id"|"rola"|"agencija_id">;
const modules = ["nalozi","ulazni_racuni","izlazni_racuni","izvodi","plate"] as const;
export const statisticLabels = {
  journals:"Proknjiženi nalozi",incoming:"Ulazni računi · KUF",outgoing:"Izlazni računi · KIF",
  statements:"Proknjiženi izvodi",payroll:"Obračuni plata",service:"Obračuni ugovora o djelu",rent:"Obračuni zakupa",other:"Obračuni ostalih ugovora"
};
export type Metric = keyof typeof statisticLabels;
const empty = ():Record<Metric,number>=>({journals:0,incoming:0,outgoing:0,statements:0,payroll:0,service:0,rent:0,other:0});
export async function statisticCompanies(user:User) {
  if(!user.agencija_id || !["admin_agencije","korisnik_agencije"].includes(user.rola))return [];
  return prisma.firma.findMany({where:{agencija_id:user.agencija_id,is_deleted:false,aktivan:true,...(user.rola==="admin_agencije"?{}:{korisnici:{some:{korisnik_id:user.id,is_deleted:false}},prava:{some:{agencija_id:user.agencija_id,korisnik_id:user.id,modul:{in:[...modules]},akcija:"view",dozvoljeno:true}}})},select:{id:true,naziv:true,poslovne_godine:{select:{id:true,godina:true}}},orderBy:{naziv:"asc"}});
}
export async function loadAgencyStatistics(user:User,year:number,month:number|null,firmId?:string) {
  const companies=await statisticCompanies(user);
  const selected=companies.filter(c=>!firmId||c.id===firmId);
  const ids=selected.map(c=>c.id);
  const agency=user.agencija_id ?? "00000000-0000-0000-0000-000000000000";
  const admin=user.rola==="admin_agencije";
  const rights=admin?[]:await prisma.korisnikPravo.findMany({where:{agencija_id:agency,korisnik_id:user.id,firma_id:{in:ids},akcija:"view",dozvoljeno:true},select:{firma_id:true,modul:true}});
  const moduleIds = new Map(modules.map(module=>[module as string,ids.filter(id=>admin||rights.some(r=>r.firma_id===id&&r.modul===module))]));
  const allowed=(module:string)=>moduleIds.get(module) ?? [];
  const yearIds=selected.flatMap(c=>c.poslovne_godine.filter(y=>y.godina===year).map(y=>y.id));
  // Journals establish actual posting even when the originating module has stale flags.
  const journals=await prisma.nalog.findMany({where:{agencija_id:agency,firma_id:{in:ids},poslovna_godina_id:{in:yearIds},status:"POSTED",is_deleted:false},select:{id:true,firma_id:true,datum:true}});
  const scope={agencija_id:agency,is_deleted:false,poslovna_godina_id:{in:yearIds}};
  const postedIds=journals.map(j=>j.id);
  const [incoming,outgoing,statements,payroll,workers,agencyWorkers,contracts]=await Promise.all([
    prisma.kufEntry.findMany({where:{...scope,firma_id:{in:allowed("ulazni_racuni")},posting_status:"POSTED",journal_id:{in:postedIds}},select:{firma_id:true,invoice_date:true}}),
    prisma.kifEntry.findMany({where:{...scope,firma_id:{in:allowed("izlazni_racuni")},posting_status:"POSTED",journal_id:{in:postedIds}},select:{firma_id:true,invoice_date:true}}),
    prisma.bankStatement.findMany({where:{...scope,firma_id:{in:allowed("izvodi")},status:"POSTED",journal_id:{in:postedIds}},select:{firma_id:true,statement_date:true}}),
    prisma.plateObracun.findMany({where:{...scope,firma_id:{in:allowed("plate")},status:{in:["CALCULATED","REVIEWED","POSTED","LOCKED"]},godina:year},select:{firma_id:true,mjesec:true,kategorija:true}}),
    prisma.plateRadnik.groupBy({by:["firma_id"],where:{agencija_id:agency,firma_id:{in:allowed("plate")},is_deleted:false,aktivan:true,zaposlen:true},_count:{_all:true}}),
    admin?prisma.korisnik.count({where:{agencija_id:agency,rola:"korisnik_agencije",is_deleted:false,aktivan:true}}):Promise.resolve(null),
    admin?prisma.firmaUgovor.findMany({where:{agencija_id:agency,firma_id:{in:ids}},select:{firma_id:true}}):Promise.resolve(null)
  ]);
  const metricModule:Record<Metric,string>={journals:"nalozi",incoming:"ulazni_racuni",outgoing:"izlazni_racuni",statements:"izvodi",payroll:"plate",service:"plate",rent:"plate",other:"plate"};
  const totals=empty();
  const months=Array.from({length:12},(_,i)=>({month:i+1,counts:empty()}));
  const rows=selected.map(company=>({id:company.id,naziv:company.naziv,counts:empty(),visible:Object.fromEntries(Object.entries(metricModule).map(([key,module])=>[key,allowed(module).includes(company.id)])) as Record<Metric,boolean>,workers:allowed("plate").includes(company.id)?workers.find(w=>w.firma_id===company.id)?._count._all??0:null,contract:admin?contracts?.some(c=>c.firma_id===company.id)??false:null}));
  const add=(id:string,key:Metric,m:number)=>{
    if(m<1||m>12)return;
    months[m-1].counts[key]++;
    if(month!==null&&m!==month)return;
    totals[key]++;const row=rows.find(r=>r.id===id);if(row)row.counts[key]++;
  };
  const addDate=(id:string,key:Metric,date:Date)=>{if(date.getUTCFullYear()===year)add(id,key,date.getUTCMonth()+1);};
  for(const j of journals)if(allowed("nalozi").includes(j.firma_id))addDate(j.firma_id,"journals",j.datum);
  for(const i of incoming)addDate(i.firma_id,"incoming",i.invoice_date);
  for(const i of outgoing)addDate(i.firma_id,"outgoing",i.invoice_date);
  for(const s of statements)addDate(s.firma_id,"statements",s.statement_date);
  const payrollMetrics: Record<string,Metric> = {REDOVAN_RAD:"payroll",UGOVOR_O_DJELU:"service",ZAKUP:"rent",OSTALI_UGOVORI:"other"};
  for(const p of payroll){const key=payrollMetrics[p.kategorija];if(key)add(p.firma_id,key,p.mjesec);}
  rows.sort((a,b)=>(b.counts.incoming+b.counts.outgoing+b.counts.statements)-(a.counts.incoming+a.counts.outgoing+a.counts.statements)||a.naziv.localeCompare(b.naziv,"sr-Latn"));
  return {companies,rows,totals,months,agencyWorkers,contracts:contracts?.length??null,workers:allowed("plate").length?workers.reduce((n,w)=>n+w._count._all,0):null,visible:Object.fromEntries(Object.entries(metricModule).map(([key,module])=>[key,admin||allowed(module).length>0])) as Record<Metric,boolean>};
}
