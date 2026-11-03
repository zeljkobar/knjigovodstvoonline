"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth";
import { readWorkContext } from "@/lib/work-context";
import { prisma } from "@/lib/prisma";
import { parseScaledInteger } from "@/lib/inventory-calculation";
import { carrySettlementDetails, settlementAccess } from "@/lib/settlements";
import { loadSettlementLedger } from "@/lib/settlements";
import { oldestSettlementPlan } from "@/lib/settlement-plan";
import { cancelSettlements, importLegacySettlements, refreshSettlementInvoices, settleInTransaction } from "@/lib/settlements";

export async function settlementAction(form: FormData) {
  const user=await requireAnyRole(["admin_agencije","korisnik_agencije"]);
  const context=await readWorkContext();
  if(!user.agencija_id||!context.firmaId||!context.poslovnaGodinaId) redirect("/agencija/nalozi/zatvaranje-stavki");
  const value=(k:string)=>String(form.get(k)??"");
  const query=new URLSearchParams({konto:value("konto"),partner:value("partner"),datum:value("datum")});
  let message="";
  try{
    if(value("firma_id")!==context.firmaId||value("godina_id")!==context.poslovnaGodinaId) throw Error("Radni kontekst je promijenjen. Osvježite stranicu.");
    const scope={agencyId:user.agencija_id,companyId:context.firmaId,yearId:context.poslovnaGodinaId,userId:user.id};
    const count=await prisma.$transaction(async tx=>{
      const changedSince=new Date();
      const mode=value("mode");let count=0;
      if(mode==="CARRY") {
        await tx.$queryRaw`SELECT id FROM firme WHERE id=${scope.companyId}::uuid FOR UPDATE`;
        const target=await settlementAccess(tx,scope,true);
        const source=await tx.poslovnaGodina.findFirst({where:{firma_id:scope.companyId,datum_do:{lt:target.datum_od}},orderBy:{datum_do:"desc"}});
        const journals=await tx.nalog.findMany({where:{firma_id:scope.companyId,agencija_id:scope.agencyId,poslovna_godina_id:scope.yearId,source_type:"OPENING_BALANCE",is_deleted:false,status:"POSTED"}});
        if(!source||journals.length!==1)throw Error("Potreban je jedan proknjiženi automatski nalog početnog stanja i prethodna poslovna godina.");
        await carrySettlementDetails(tx,scope,source.id,journals[0].id);
        await loadSettlementLedger(tx,scope,value("datum"));count=1;
      }
      else if(mode==="IMPORT") count=await importLegacySettlements(tx,scope,value("datum"));
      else if(mode==="CANCEL"||mode==="CANCEL_ALL") {
        if(mode==="CANCEL_ALL"&&value("potvrda")!=="DA")throw Error("Potvrdite poništavanje svih prikazanih zatvaranja partnera na kontu.");
        if(!value("konto")||!value("partner")) throw Error("Izaberite partnera i konto.");
        count=await cancelSettlements(tx,scope,{ids:[value("edge_id")],date:value("datum"),accountId:value("konto"),partnerId:value("partner"),all:mode==="CANCEL_ALL",revision:mode==="CANCEL_ALL"?value("edges_revision"):undefined});
      } else {
        if(!["MANUAL","SELECTED","EXACT","OLDEST"].includes(mode))throw Error("Nepoznata akcija.");
        let partnerIds=value("partner")?[value("partner")]:form.getAll("partner_id").map(String);
        let selectedPairs;
        if(mode==="SELECTED") {
          await tx.$queryRaw`SELECT id FROM firme WHERE id=${scope.companyId}::uuid FOR UPDATE`;
          const ledger=await loadSettlementLedger(tx,scope,value("datum"),value("konto")||undefined,value("partner")||undefined);
          const selected=new Set(form.getAll("stavka_id").map(String));
          const selectedItems=ledger.items.filter(i=>selected.has(i.id));
          partnerIds=[...new Set(selectedItems.map(i=>i.partnerId))];
          selectedPairs=oldestSettlementPlan(selectedItems);
          if(!selectedPairs.length)throw Error("Označite najmanje jednu duguje i jednu potražuje stavku istog partnera i konta.");
        }
        count=await settleInTransaction(tx,scope,{date:value("datum"),accountId:value("konto")||undefined,partnerIds,mode:(mode==="SELECTED"?"MANUAL":mode) as "MANUAL"|"EXACT"|"OLDEST",fingerprint:value("fingerprint"),pairs:selectedPairs??(mode==="MANUAL"?[{debitId:value("debit"),creditId:value("credit"),cents:Number(parseScaledInteger(value("iznos").replace(",", "."),2)??0)}]:undefined)});
      }
      await refreshSettlementInvoices(tx,scope,changedSince);return count;
    },{timeout:60000});
    message=`Obrađeno povezivanja: ${count}.`;
  }catch(error){message=error instanceof Error&&!error.message.includes("prisma")&&!error.message.includes("Invalid")?error.message:"Obrada nije uspjela. Osvježite pregled i provjerite podatke.";}
  revalidatePath("/agencija");
  query.set("poruka",message);redirect(`/agencija/nalozi/zatvaranje-stavki?${query}`);
}
