"use server";
import {requireAnyRole} from "@/lib/auth";
import {prisma} from "@/lib/prisma";
import {auditLogInTransaction} from "@/lib/audit";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
class PositionError extends Error {}
export async function saveJobPosition(form:FormData) {
 const user=await requireAnyRole(["admin","admin_agencije"]);
 const path=user.rola==="admin"?"/admin/radna-mjesta":"/agencija/plate/ugovori/radna-mjesta";
 const field=(k:string)=>String(form.get(k)??"").trim();
 const id=field("id"),name=field("naziv"),description=field("opis_poslova"),version=field("verzija");
 try {
  if(!name||name.length>200||!description||description.length>10000||user.rola!=="admin"&&!user.agencija_id)throw new PositionError("podaci");
  if(id&&!/^[0-9a-f-]{36}$/i.test(id))throw new PositionError("podaci");
  await prisma.$transaction(async tx=>{
   const agency=user.rola==="admin"?null:user.agencija_id!;
   // Serialize overrides per agency; global edits serialize on the source row.
   if(agency)await tx.$queryRaw`SELECT id FROM agencije WHERE id=${agency}::uuid FOR UPDATE`;
   if(id)await tx.$queryRaw`SELECT id FROM radna_mjesta WHERE id=${id}::uuid FOR UPDATE`;
   const base=id?await tx.radnoMjesto.findFirst({where:{id,globalno_id:null,OR:agency?[{agencija_id:null},{agencija_id:agency}]:[{agencija_id:null}]}}):null;
   if(id&&!base)throw new PositionError("prava");
   const old=base&&agency&&!base.agencija_id?await tx.radnoMjesto.findUnique({where:{agencija_id_globalno_id:{agencija_id:agency,globalno_id:base.id}}}):base;
   if(version!==(old?.updated_at.toISOString()??""))throw new PositionError("zastarjelo");
   const data={naziv:name,opis_poslova:description,aktivno:form.get("aktivno")==="on"};
   const saved=old?await tx.radnoMjesto.update({where:{id:old.id},data}):await tx.radnoMjesto.create({data:{...data,agencija_id:agency,globalno_id:base?.id??null}});
   await auditLogInTransaction(tx,{korisnikId:user.id,agencijaId:agency,modul:"plate",akcija:old?"update_job":"create_job",tipEntiteta:"RadnoMjesto",entitetId:saved.id,staraVrijednost:old,novaVrijednost:saved});
  });
 }catch(e){if(e instanceof PositionError)redirect(`${path}?poruka=${e.message}`);throw e;}
 revalidatePath("/admin/radna-mjesta");revalidatePath("/agencija/plate/ugovori/radna-mjesta");revalidatePath("/agencija/plate");
 redirect(`${path}?poruka=sacuvano`);
}
