import {randomUUID} from "crypto";
import {Prisma} from "@prisma/client";
import {prisma} from "@/lib/prisma";
import {auditLogInTransaction} from "@/lib/audit";
import {strictEmploymentDate} from "@/lib/employment-options";
import {isTerminationType,terminationTypes,renderTermination,type TerminationSnapshot} from "@/lib/employment-termination";
import {getPlateContext} from "@/app/agencija/plate/_shared";
export class TerminationError extends Error {}
export async function createEmploymentTermination(form:FormData) {
 const c=await getPlateContext("delete");
 if(!c.allowed||!c.firma||!c.godina||!c.user.agencija_id)throw new TerminationError("prava");
 const firmaId=c.firma.id,agencyId=c.user.agencija_id,yearId=c.godina.id;
 const text=(name:string)=>String(form.get(name)??"").trim();
 const id=text("radnik_id"),type=text("vrsta_prestanka");
 const end=strictEmploymentDate(text("datum_prestanka")),date=strictEmploymentDate(text("datum_dokumenta"));
 if(text("firma_id")!==firmaId||text("godina_id")!==yearId||!/^[0-9a-f-]{36}$/i.test(id)||!isTerminationType(type)||!end||!date||date>end||end.getUTCFullYear()!==c.godina.godina||date.getUTCFullYear()!==c.godina.godina)throw new TerminationError("odjava_nevalidna");
 const shorter=form.get("kraci_rok")==="on";
 if(type==="RADNIK"&&!shorter&&end.getTime()-date.getTime()<30*86400000)throw new TerminationError("otkaz_rok");
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM poslovne_godine WHERE id=${yearId}::uuid FOR UPDATE`;
  if(!await tx.poslovnaGodina.findFirst({where:{id:yearId,firma_id:firmaId,zakljucena:false}}))throw new TerminationError("godina_zakljucena");
  const firm=await tx.firma.findFirst({where:{id:firmaId,agencija_id:agencyId,aktivan:true,is_deleted:false,...(c.user.rola==="admin_agencije"?{}:{korisnici:{some:{korisnik_id:c.user.id,is_deleted:false}}})},include:{odgovorna_lica:{where:{aktivan:true,is_deleted:false,uloga:"IZVRSNI_DIREKTOR"},orderBy:{primarno:"desc"}}}});
  if(!firm)throw new TerminationError("prava");
  await tx.$queryRaw`SELECT id FROM plate_radnici WHERE id=${id}::uuid AND firma_id=${firmaId}::uuid FOR UPDATE`;
  const employee=await tx.plateRadnik.findFirst({where:{id,firma_id:firmaId,agencija_id:agencyId,is_deleted:false}});
  if(!employee||!employee.zaposlen||!employee.aktivan||text("verzija")!==employee.updated_at.toISOString())throw new TerminationError("otkaz_zastarjelo");
  if(!employee.datum_pocetka||date<employee.datum_pocetka||end<employee.datum_pocetka)throw new TerminationError("odjava_nevalidna");
  if(type==="ISTEK"&&(employee.tip_ugovora!=="ODREDJENO"||employee.ugovoreni_istek?.getTime()!==end.getTime()))throw new TerminationError("otkaz_istek");
  const director=firm.odgovorna_lica[0]?.ime_prezime;
  if(!firm.pib||!firm.adresa||!(firm.grad||firm.opstina)||!director||!employee.jmbg||!employee.adresa||!employee.radno_mjesto)throw new TerminationError("otkaz_podaci");
  const documentId=randomUUID();
  const fmt=(d:Date)=>d.toLocaleDateString("sr-Latn",{timeZone:"UTC"});
  const snapshot:TerminationSnapshot={version:"2026-10-03-v1",type,broj:`OD-${c.godina!.godina}-${documentId.slice(0,8).toUpperCase()}`,datum:fmt(date),prestanak:fmt(end),firma:firm.naziv,pib:firm.pib,adresaFirme:firm.adresa,grad:(firm.grad||firm.opstina)!,direktor:director,radnik:`${employee.prezime} ${employee.ime}`,jmbg:employee.jmbg,adresa:employee.adresa,pozicija:employee.radno_mjesto,pocetak:fmt(employee.datum_pocetka),kontakt:[employee.telefon,employee.email].filter(Boolean).join(" / "),kraciRok:type==="RADNIK"&&shorter};
  const document=await tx.otkazORadu.create({data:{id:documentId,agencija_id:agencyId,firma_id:firmaId,radnik_id:id,vrsta:type,datum:date,datum_prestanka:end,snapshot:{...snapshot,html:renderTermination(snapshot)} as Prisma.InputJsonValue,created_by:c.user.id}});
  const updated=await tx.plateRadnik.update({where:{id},data:{zaposlen:false,datum_prestanka:end,razlog_prestanka:terminationTypes[type],updated_by:c.user.id}});
  await auditLogInTransaction(tx,{korisnikId:c.user.id,agencijaId:agencyId,firmaId,modul:"plate",akcija:"deactivate_employee",tipEntiteta:"PlateRadnik",entitetId:id,staraVrijednost:employee,novaVrijednost:updated});
  await auditLogInTransaction(tx,{korisnikId:c.user.id,agencijaId:agencyId,firmaId,modul:"plate",akcija:"create_termination",tipEntiteta:"OtkazORadu",entitetId:documentId,novaVrijednost:document});
  return documentId;
 });
}
