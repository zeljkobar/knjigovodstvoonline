"use server";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { auditLogInTransaction } from "@/lib/audit";
import { agencyProfileSelect } from "@/lib/agency-profile";

const path = "/agencija/podesavanja/agencija";
const value = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
class ProfileError extends Error {}
function finish(code: string): never { redirect(`${path}?poruka=${code}`); }
async function change(form: FormData, run: (tx: Prisma.TransactionClient, agencyId: string, userId: string) => Promise<void>) {
  const user = await requireRole("admin_agencije");
  if (!user.agencija_id) finish("nedostaje");
  try {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM agencije WHERE id=${user.agencija_id}::uuid FOR UPDATE`;
      const agency = await tx.agencija.findFirst({where:{id:user.agencija_id!,aktivan:true,is_deleted:false,is_fiscal_direct_container:false},select:agencyProfileSelect});
      if (!agency) throw new ProfileError("nedostaje");
      if (value(form,"verzija") !== agency.updated_at.toISOString()) throw new ProfileError("zastarjelo");
      await run(tx,agency.id,user.id);
      await tx.agencija.update({where:{id:agency.id},data:{updated_by:user.id,updated_at:new Date()}});
      const updated = await tx.agencija.findUniqueOrThrow({where:{id:agency.id},select:agencyProfileSelect});
      await auditLogInTransaction(tx,{korisnikId:user.id,agencijaId:agency.id,modul:"agencija.podesavanja.agencija",akcija:"update",tipEntiteta:"Agencija",entitetId:agency.id,staraVrijednost:agency,novaVrijednost:updated});
    });
  } catch(error) {
    if(error instanceof ProfileError) finish(error.message);
    if(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") finish("duplikat");
    throw error;
  }
  revalidatePath("/agencija","layout"); revalidatePath("/admin/agencije");
  finish("sacuvano");
}
export async function saveAgencyProfile(form: FormData) {
  return change(form,async(tx,id)=>{
    const data = {
      naziv:value(form,"naziv"),pib:value(form,"pib")||null,pdv_broj:value(form,"pdv_broj")||null,
      adresa:value(form,"adresa")||null,grad:value(form,"grad")||null,telefon:value(form,"telefon")||null,
      email:value(form,"email")||null,zastupnik_ime:value(form,"zastupnik_ime")||null,zastupnik_funkcija:value(form,"zastupnik_funkcija")||null
    };
    if(!data.naziv || Object.values(data).some(v=>v && (v.length>250 || /[\u0000-\u001f]/.test(v)))) throw new ProfileError("podaci");
    if(data.pib && !/^\d{8}$/.test(data.pib)) throw new ProfileError("pib");
    if(data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new ProfileError("email");
    await tx.agencija.update({where:{id},data});
  });
}
export async function saveAgencyBankAccount(form: FormData) {
  return change(form,async(tx,agencyId,userId)=>{
    const id=value(form,"racun_id"), bank=value(form,"naziv_banke"), number=value(form,"broj_racuna").replace(/\s/g,"").toUpperCase();
    if(!bank || bank.length>150 || !/^(\d{3}-\d{1,13}-\d{2}|\d{18}|[A-Z]{2}\d{2}[A-Z0-9]{11,30})$/.test(number)) throw new ProfileError("racun");
    if(id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new ProfileError("racun");
    if(id && !await tx.agencijaBankovniRacun.findFirst({where:{id,agencija_id:agencyId,is_deleted:false}})) throw new ProfileError("racun");
    const previous=await tx.agencijaBankovniRacun.findFirst({where:{agencija_id:agencyId,is_deleted:false,glavni:true}});
    const main=value(form,"glavni")==="on" || !previous || previous.id===id;
    if(main) await tx.agencijaBankovniRacun.updateMany({where:{agencija_id:agencyId,is_deleted:false,glavni:true},data:{glavni:false,updated_by:userId}});
    const data={naziv_banke:bank,broj_racuna:number,glavni:main,updated_by:userId};
    if(id) await tx.agencijaBankovniRacun.update({where:{id},data});
    else await tx.agencijaBankovniRacun.create({data:{agencija_id:agencyId,...data,created_by:userId}});
  });
}
export async function deleteAgencyBankAccount(form: FormData) {
  return change(form,async(tx,agencyId,userId)=>{
    const id=value(form,"racun_id");
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new ProfileError("racun");
    const account=await tx.agencijaBankovniRacun.findFirst({where:{id,agencija_id:agencyId,is_deleted:false}});
    if(!account) throw new ProfileError("racun");
    await tx.agencijaBankovniRacun.update({where:{id},data:{is_deleted:true,glavni:false,deleted_at:new Date(),deleted_by:userId,updated_by:userId}});
    if(account.glavni){
      const next=await tx.agencijaBankovniRacun.findFirst({where:{agencija_id:agencyId,is_deleted:false},orderBy:{created_at:"asc"}});
      if(next) await tx.agencijaBankovniRacun.update({where:{id:next.id},data:{glavni:true,updated_by:userId}});
    }
  });
}
