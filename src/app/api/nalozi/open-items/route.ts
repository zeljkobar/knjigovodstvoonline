import { NextResponse } from "next/server";
import { getCurrentUser, isDirectFiscalTenantUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { loadSettlementLedger, settlementDate } from "@/lib/settlements";
export async function GET(request:Request){
 const user=await getCurrentUser();
 if(!user?.agencija_id||!["admin_agencije","korisnik_agencije"].includes(user.rola)||isDirectFiscalTenantUser(user))return NextResponse.json({message:"Ruta nije dostupna."},{status:403});
 const context=await readWorkContext();if(!context.firmaId||!context.poslovnaGodinaId)return NextResponse.json({items:[]});
 const query=new URL(request.url).searchParams,code=query.get("konto_sifra")??"",partner=query.get("komitent_id")??"";
 if(!/^[0-9a-f-]{36}$/i.test(partner))return NextResponse.json({items:[]});
 try{
 const year=await prisma.poslovnaGodina.findFirst({where:{id:context.poslovnaGodinaId,firma_id:context.firmaId}});
 const account=await prisma.firmaKonto.findFirst({where:{firma_id:context.firmaId,sifra:code,aktivan:true,analitika_obavezna:true}});
 const closeSide=code.startsWith("2")?"P":code.startsWith("4")?"D":null;
 if(!year||!account||!closeSide)return NextResponse.json({items:[]});
 const ledger=await loadSettlementLedger(prisma,{agencyId:user.agencija_id,companyId:context.firmaId,yearId:context.poslovnaGodinaId,userId:user.id},settlementDate(year.datum_do),account.id,partner);
 return NextResponse.json({closeSide,items:ledger.items.filter(i=>closeSide==="P"?i.remainingCents>0:i.remainingCents<0).map(i=>({id:i.id,documentNumber:i.document,documentDate:i.documentDate??i.date,dueDate:i.dueDate,openAmountCents:Math.abs(i.remainingCents)}))});
 }catch{return NextResponse.json({message:"Otvorene stavke nijesu dostupne. Provjerite prava i razradu početnog stanja."},{status:403});}
}
