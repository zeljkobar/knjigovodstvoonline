"use server";
import {Prisma} from "@prisma/client";
import {getPlateContext} from "../_shared";
import {prisma} from "@/lib/prisma";
import {auditLogInTransaction} from "@/lib/audit";
import {jobPositions} from "@/lib/job-positions";
import {getWorkSchedule,strictEmploymentDate} from "@/lib/employment-options";
import {employmentTemplateVersion} from "@/lib/employment-contract-template";
import {renderEmploymentContract,type EmploymentSnapshot} from "@/lib/employment-contract";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
class ContractError extends Error {}
export async function saveEmploymentContract(form:FormData) {
 const text=(k:string)=>String(form.get(k)??"").trim();
 const op=text("akcija"),id=text("id");
 const context=await getPlateContext(op==="novi"?"create":op==="ponisti"?"delete":"update");
 if(!context.allowed||!context.firma||!context.godina||!context.user.agencija_id)redirect("/agencija/plate/ugovori?poruka=prava");
 const firmaId=context.firma.id,agencyId=context.user.agencija_id,yearId=context.godina.id;
 let resultId=id;
 try {
  if(!["novi","osvjezi","potvrdi","ponisti"].includes(op)||text("firma_id")!==firmaId||text("godina_id")!==yearId)throw new ContractError("podaci");
  await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM poslovne_godine WHERE id=${yearId}::uuid FOR UPDATE`;
   if(!await tx.poslovnaGodina.findFirst({where:{id:yearId,firma_id:firmaId,zakljucena:false}}))throw new ContractError("zakljucano");
   const firm=await tx.firma.findFirst({where:{id:firmaId,agencija_id:agencyId,aktivan:true,is_deleted:false,...(context.user.rola==="admin_agencije"?{}:{korisnici:{some:{korisnik_id:context.user.id,is_deleted:false}}})},include:{odgovorna_lica:{where:{aktivan:true,is_deleted:false,uloga:"IZVRSNI_DIREKTOR"},orderBy:{primarno:"desc"}}}});
   if(!firm)throw new ContractError("prava");
   if(op!=="novi"&&!/^[0-9a-f-]{36}$/i.test(id))throw new ContractError("podaci");
   if(op!=="novi")await tx.$queryRaw`SELECT id FROM ugovori_o_radu WHERE id=${id}::uuid FOR UPDATE`;
   const old=op!=="novi"?await tx.ugovorORadu.findFirst({where:{id,agencija_id:agencyId,firma_id:firmaId}}):null;
   if(op!=="novi"&&(!old||old.updated_at.toISOString()!==text("verzija")))throw new ContractError("zastarjelo");
   if(old&&(old.status==="CANCELLED"||op!=="ponisti"&&old.status!=="DRAFT"))throw new ContractError("status");
   // A contract's own accounting year must also remain open.
   if(old) {
    const ownYear=await tx.poslovnaGodina.findFirst({where:{firma_id:firmaId,godina:old.datum.getUTCFullYear()}});
    if(!ownYear)throw new ContractError("zakljucano");
    await tx.$queryRaw`SELECT id FROM poslovne_godine WHERE id=${ownYear.id}::uuid FOR UPDATE`;
    if((await tx.poslovnaGodina.findUnique({where:{id:ownYear.id}}))?.zakljucena)throw new ContractError("zakljucano");
   }
   let snapshot:Prisma.InputJsonValue|undefined,datum:Date|undefined,broj:string|undefined,workerId=old?.radnik_id;
   if(op==="novi"||op==="osvjezi") {
    broj=text("broj");datum=strictEmploymentDate(text("datum"))??undefined;workerId=old?.radnik_id??text("radnik_id");
    if(!broj||broj.length>80||!datum||datum.getUTCFullYear()!==context.godina!.godina||!workerId||!/^[0-9a-f-]{36}$/i.test(workerId))throw new ContractError("podaci");
    const employee=await tx.plateRadnik.findFirst({where:{id:workerId,agencija_id:agencyId,firma_id:firmaId,is_deleted:false}});
    if(!employee)throw new ContractError("podaci");
    const job=(await jobPositions(agencyId,tx)).find(j=>j.id===employee.radno_mjesto_id);
    const hours=getWorkSchedule(employee.vrsta_radnog_vremena??"");
    const director=firm.odgovorna_lica[0]?.ime_prezime;
    if(!firm.pib||!firm.adresa||!director||!employee.jmbg||!employee.adresa||!employee.opstina||!employee.mjesto_rada||!employee.datum_pocetka||!employee.tip_ugovora||!job?.aktivno||!hours||employee.neto_iznos_cent<=0||employee.tip_ugovora==="ODREDJENO"&&(!employee.ugovoreni_istek||employee.ugovoreni_istek<employee.datum_pocetka))throw new ContractError("nedostaje");
    const date=(v:Date)=>v.toLocaleDateString("sr-Latn",{timeZone:"UTC"});
    const words:Record<number,string>={1:"jedan",2:"dva",4:"četiri",5:"pet",6:"šest",8:"osam",10:"deset",20:"dvadeset",30:"trideset",40:"četrdeset"};
    const values:EmploymentSnapshot={broj,datum:date(datum),firma:firm.naziv,pib:firm.pib,firmaAdresa:firm.adresa,direktor:director,radnik:`${employee.prezime} ${employee.ime}`,jmbg:employee.jmbg,adresa:employee.adresa,opstina:employee.opstina,pozicija:job.naziv,opis:job.opis_poslova,mjestoRada:employee.mjesto_rada,tip:employee.tip_ugovora==="ODREDJENO"?"određeno":"neodređeno",pocetak:date(employee.datum_pocetka),istekTekst:employee.tip_ugovora==="ODREDJENO"?` do ${date(employee.ugovoreni_istek!)}`:"",neto:(employee.neto_iznos_cent/100).toLocaleString("sr-Latn",{minimumFractionDigits:2,maximumFractionDigits:2}),vrstaVremena:hours.daily===8?"PUNIM":"SKRAĆENIM",dnevno:String(hours.daily),nedjeljno:String(hours.weekly),dnevnoTekst:words[hours.daily],nedjeljnoTekst:words[hours.weekly]};
    snapshot={...values,html:renderEmploymentContract(values)};
   }
   const saved=old?await tx.ugovorORadu.update({where:{id:old.id},data:{...(snapshot?{snapshot,broj,datum,verzija_predloska:employmentTemplateVersion}:{}),status:op==="potvrdi"?"CONCLUDED":op==="ponisti"?"CANCELLED":"DRAFT",updated_by:context.user.id}}):await tx.ugovorORadu.create({data:{agencija_id:agencyId,firma_id:firmaId,radnik_id:workerId!,broj:broj!,datum:datum!,snapshot:snapshot!,verzija_predloska:employmentTemplateVersion,created_by:context.user.id,updated_by:context.user.id}});
   resultId=saved.id;
   await auditLogInTransaction(tx,{korisnikId:context.user.id,agencijaId:agencyId,firmaId,modul:"plate",akcija:`ugovor_${op}`,tipEntiteta:"UgovorORadu",entitetId:saved.id,staraVrijednost:old,novaVrijednost:saved});
  });
 } catch(e) {if(e instanceof ContractError)redirect(`/agencija/plate/ugovori?poruka=${e.message}`);if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==="P2002")redirect("/agencija/plate/ugovori?poruka=broj");throw e;}
 revalidatePath("/agencija/plate/ugovori");
 redirect(`/agencija/plate/ugovori?ugovor=${resultId}&poruka=sacuvano`);
}
