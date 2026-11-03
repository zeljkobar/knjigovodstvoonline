import "server-only";
import { requireAnyRole } from "./auth";
import { readWorkContext } from "./work-context";
import { hasAllPermissions } from "./permissions";
import { prisma } from "./prisma";
import { loadSettlementLedger, settlementDate, validSettlementDate } from "./settlements";
import { auditLogInTransaction } from "./audit";

export type IosParams = { datum?: string; konto?: string; vrsta?: string; prikaz?: string; nulti?: string; q?: string; partner?: string | string[] };
export { iosMoney, iosDate } from "./ios-format";
export function iosQuery(params: IosParams) {
  const query = new URLSearchParams();
  for(const key of ["datum","konto","vrsta","prikaz","nulti","q"] as const) if(params[key]) query.set(key,params[key]!);
  return query;
}

export async function loadIosReport(params: IosParams = {}, print = false) {
  const user=await requireAnyRole(["admin_agencije","korisnik_agencije"]);
  const context=await readWorkContext();
  if(!user.agencija_id||!context.firmaId||!context.poslovnaGodinaId) throw Error("Izaberite firmu i poslovnu godinu.");
  const checks=[{firmaId:context.firmaId,modul:"nalozi",akcija:"view" as const},{firmaId:context.firmaId,modul:"izvjestaji",akcija:"view" as const},...(print?[{firmaId:context.firmaId,modul:"izvjestaji",akcija:"export" as const}]:[])];
  if(!await hasAllPermissions(user,checks))throw Error("Nemate pravo pregleda ili štampe IOS-a.");
  const selected=[...new Set((Array.isArray(params.partner)?params.partner:params.partner?[params.partner]:[]))];
  if(selected.some(id=>!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)))throw Error("Neispravan izbor partnera.");
  if(print&&!selected.length)throw Error("Izaberite najmanje jednog partnera za štampu IOS-a.");
  return prisma.$transaction(async tx=>{
    const year=await tx.poslovnaGodina.findFirst({where:{id:context.poslovnaGodinaId!,firma_id:context.firmaId!}});
    if(!year)throw Error("Poslovna godina nije dostupna.");
    const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Podgorica"}).format(new Date());
    const date=params.datum||[today,settlementDate(year.datum_od),settlementDate(year.datum_do)].sort()[1];
    if(!validSettlementDate(date))throw Error("Neispravan datum IOS-a.");
    const scope={agencyId:user.agencija_id!,companyId:context.firmaId!,yearId:context.poslovnaGodinaId!,userId:user.id};
    const ledger=await loadSettlementLedger(tx,scope,date,params.konto||undefined,selected.length===1?selected[0]:undefined);
    // Ambiguous old allocations must not produce a seemingly authoritative IOS.
    if(ledger.legacyErrors.length)throw Error("Postoje nerazjašnjene ranije veze izvoda. Provjerite ih u Zatvaranju stavki prije izrade IOS-a.");
    const filtered=ledger.items.filter(i=>(!selected.length||selected.includes(i.partnerId))&&(params.vrsta==="kupci"?i.accountCode.startsWith("2"):params.vrsta==="dobavljaci"?i.accountCode.startsWith("4"):true));
    if(filtered.some(i=>i.remainingCents!==0&&(Math.sign(i.remainingCents)!==Math.sign(i.signedCents)||Math.abs(i.remainingCents)>Math.abs(i.signedCents))))throw Error("Otvoreni iznosi nijesu usklađeni. Provjerite zatvaranja prije štampe IOS-a.");
    const ids=[...new Set(filtered.map(i=>i.partnerId))];
    const partners=await tx.komitent.findMany({where:{id:{in:ids},OR:[{agencija_id:null,scope:"GLOBAL"},{agencija_id:scope.agencyId,scope:"AGENCY"},{agencija_id:scope.agencyId,firma_id:scope.companyId,scope:"COMPANY"}]},select:{id:true,naziv:true,pib:true,adresa:true,grad:true,is_foreign:true,foreign_tax_number:true}});
    const query=params.q?.trim().toLocaleLowerCase()??"";
    const reports=partners.filter(p=>(params.prikaz==="domaci"?!p.is_foreign:params.prikaz==="ino"?p.is_foreign:true)&&(!query||`${p.naziv} ${p.pib??""} ${p.foreign_tax_number??""}`.toLocaleLowerCase().includes(query))).map(partner=>{
      const all=filtered.filter(i=>i.partnerId===partner.id);
      const items=all.filter(i=>i.remainingCents!==0);
      const debit=items.reduce((sum,i)=>sum+Math.max(i.remainingCents,0),0),credit=items.reduce((sum,i)=>sum+Math.max(-i.remainingCents,0),0);
      return {partner,items,debit,credit,balance:debit-credit};
    }).filter(r=>params.nulti==="1"||r.items.length>0).sort((a,b)=>a.partner.naziv.localeCompare(b.partner.naziv,"sr-Latn"));
    if(print && selected.some(id=>!reports.some(r=>r.partner.id===id)))throw Error("Izabrani partner nema dostupnih otvorenih stavki za ove filtere. Osvježite pregled ili uključite partnere bez otvorenih stavki.");
    const company=await tx.firma.findFirstOrThrow({where:{id:scope.companyId,agencija_id:scope.agencyId,is_deleted:false,aktivan:true},select:{naziv:true,pib:true,adresa:true,grad:true}});
    const accounts=await tx.firmaKonto.findMany({where:{firma_id:scope.companyId,analitika_obavezna:true,OR:[{sifra:{startsWith:"2"}},{sifra:{startsWith:"4"}}]},select:{id:true,sifra:true,naziv:true},orderBy:{sifra:"asc"}});
    if(print)await auditLogInTransaction(tx,{korisnikId:user.id,agencijaId:scope.agencyId,firmaId:scope.companyId,modul:"izvjestaji",akcija:"ios_pregled_stampe",tipEntiteta:"Firma",entitetId:scope.companyId,novaVrijednost:{datum:date,partnerIds:reports.map(r=>r.partner.id),brojObrazaca:reports.length,konto:params.konto??null}});
    return {company,year,date,reports,accounts};
  },{isolationLevel:"RepeatableRead",timeout:60000});
}
