"use server";
import { requireAnyRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deadlineCompanyScope } from "@/lib/deadlines";
import { deadlineDate,validDeadline,annualChecklist } from "@/lib/deadline-rules";
import { auditLogInTransaction } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
const value=(f:FormData,k:string)=>String(f.get(k)??"").trim();
class DeadlineError extends Error {}
export async function updateDeadline(form:FormData) {
 const user=await requireAnyRole(["admin_agencije","korisnik_agencije"]);
 const id=value(form,"firma"),kind=value(form,"vrsta"),year=Number(form.get("godina")),month=Number(form.get("mjesec")),operation=value(form,"akcija");
 try {
  if(!user.agencija_id||!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id))throw new DeadlineError("prava");
  if(!["plan","zavrsi","otvori","kontrola"].includes(operation))throw new DeadlineError("podaci");
  await prisma.$transaction(async tx=>{
   const company=await tx.firma.findFirst({where:{...deadlineCompanyScope(user),id}});
   if(!company)throw new DeadlineError("prava");
   await tx.$queryRaw`SELECT id FROM firme WHERE id=${id}::uuid FOR UPDATE`;
   if(!await tx.firma.findFirst({where:{...deadlineCompanyScope(user),id}}))throw new DeadlineError("prava");
   const plan=await tx.firmaRokPlan.findUnique({where:{firma_id:id}});
   if(operation==="plan") {
    if(user.rola!=="admin_agencije")throw new DeadlineError("prava");
    if(value(form,"verzija")!==(plan?.updated_at.toISOString()??""))throw new DeadlineError("zastarjelo");
    const start=value(form,"od_mjeseca");
    if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(start))throw new DeadlineError("podaci");
    const data={agencija_id:user.agencija_id!,pdv:form.get("pdv")==="on",plate:form.get("plate")==="on",zavrsni:form.get("zavrsni")==="on",od_mjeseca:new Date(start+"-01T00:00:00Z")};
    const updated=await tx.firmaRokPlan.upsert({where:{firma_id:id},create:{firma_id:id,...data},update:data});
    await auditLogInTransaction(tx,{korisnikId:user.id,agencijaId:user.agencija_id,firmaId:id,modul:"rokovi",akcija:"update",tipEntiteta:"FirmaRokPlan",entitetId:id,staraVrijednost:plan,novaVrijednost:updated});
   } else {
    if(!validDeadline(kind,year,month)||value(form,"napomena").length>1000)throw new DeadlineError("podaci");
    const checks=form.getAll("kontrola").map(String);
    if(operation==="kontrola"&&(kind!=="ZAVRSNI"||checks.some(k=>!Object.hasOwn(annualChecklist,k))))throw new DeadlineError("podaci");
    const key={firma_id:id,vrsta:kind,godina_roka:year,mjesec_roka:month};
    const old=await tx.firmaRokZadatak.findUnique({where:{firma_id_vrsta_godina_roka_mjesec_roka:key}});
    if(value(form,"verzija")!==(old?.updated_at.toISOString()??""))throw new DeadlineError("zastarjelo");
    const enabled=kind==="PDV"?(plan?.pdv??company.pdv_obveznik):kind==="ZAVRSNI"?(plan?.zavrsni??true):plan?.plate??Boolean(await tx.plateRadnik.count({where:{agencija_id:user.agencija_id!,firma_id:id,aktivan:true,zaposlen:true,is_deleted:false}}));
    const start=plan?.od_mjeseca??new Date(Date.UTC(company.created_at.getUTCFullYear(),company.created_at.getUTCMonth(),1));
    if(!old&&(!enabled||deadlineDate(kind,year,month)<start))throw new DeadlineError("podaci");
    const data={agencija_id:user.agencija_id!,...(operation==="kontrola"?{kontrola:[...new Set(checks)]}:{zavrseno_at:operation==="zavrsi"?new Date():null,zavrseno_by:operation==="zavrsi"?user.id:null,zavrseno_ime:operation==="zavrsi"?user.korisnicko_ime:null}),napomena:value(form,"napomena")||null};
    const updated=await tx.firmaRokZadatak.upsert({where:{firma_id_vrsta_godina_roka_mjesec_roka:key},create:{...key,...data},update:data});
    await auditLogInTransaction(tx,{korisnikId:user.id,agencijaId:user.agencija_id,firmaId:id,modul:"rokovi",akcija:"update",tipEntiteta:"FirmaRokZadatak",entitetId:updated.id,staraVrijednost:old,novaVrijednost:updated,napomena:operation==="kontrola"?"Sačuvana kontrolna lista.":operation==="zavrsi"?"Obaveza označena kao završena.":"Obaveza ponovo otvorena."});
   }
  });
 }catch(e){if(e instanceof DeadlineError)redirect(deadlineReturn(form,e.message));throw e;}
 revalidatePath("/agencija/rokovi");
 redirect(deadlineReturn(form,"sacuvano"));
}
function deadlineReturn(form:FormData,message:string) {
 const back=new URLSearchParams({poruka:message});
 for(const key of ["tab","period","firma","radnik","status","ranije"]) {
  const v=value(form,"povrat_"+key);
  if(v&&v.length<=80)back.set(key,v);
 }
 return `/agencija/rokovi?${back}`;
}
