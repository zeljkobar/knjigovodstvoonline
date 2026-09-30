"use server";
import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth";
import { requirePermissionForUser } from "@/lib/permissions";
import { readWorkContext } from "@/lib/work-context";
import { prisma } from "@/lib/prisma";
import { auditLogInTransaction } from "@/lib/audit";
import { fixedAssetContextMatches, fixedAssetDecimalToCents as cents, fixedAssetCentsToDecimal as decimal, parseFixedAssetDate } from "@/lib/fixed-assets";
import { lockAssetLifecycle } from "@/lib/fixed-assets-lifecycle";
import { assetDate, assetDay } from "@/lib/fixed-assets-batches";
import { formatJournalCode } from "@/lib/journals";
const v=(form:FormData,key:string)=>String(form.get(key)??"").trim();
async function run(form:FormData,mode:"activate"|"sale") {
  const user=await requireAnyRole(["admin_agencije","korisnik_agencije"]),context=await readWorkContext(),id=v(form,"sredstvo_id");
  const back=`/agencija/osnovna-sredstva/${encodeURIComponent(id)}${mode==="sale"?"/prodaja":""}`;
  if(!user.agencija_id||!context.firmaId||!context.poslovnaGodinaId||!fixedAssetContextMatches(form,context))redirect(`${back}?greska=${encodeURIComponent("Firma ili godina je promijenjena.")}`);
  await requirePermissionForUser(user,{firmaId:context.firmaId,modul:"osnovna_sredstva",akcija:"post"});
  const scope={agencija_id:user.agencija_id,firma_id:context.firmaId,poslovna_godina_id:context.poslovnaGodinaId};
  try {
    await prisma.$transaction(async tx=>{
      const date=parseFixedAssetDate(form.get("datum"));if(!date)throw new Error("Unesite datum promjene.");
      const {year,asset}=await lockAssetLifecycle(tx,scope,id,date);
      if(String(asset.verzija)!==v(form,"verzija"))throw new Error("Kartica je izmijenjena. Osvježite stranicu.");
      const parameter=asset.parametri.find(p=>p.vazi_od<=date);if(!parameter)throw new Error("Nedostaju važeći parametri sredstva.");
      if(mode==="activate") {
        if(asset.status==="ACTIVE")return;
        if(asset.status!=="IN_PREPARATION"||asset.datum_raspolozivosti?.getTime()!==date.getTime())throw new Error("Potvrda nabavke koristi datum raspoloživosti sredstva u pripremi.");
        const change=asset.promjene.find(p=>p.vrsta==="ACQUISITION"&&p.status==="DRAFT");if(!change)throw new Error("Nema nacrta nabavke.");
        const journal=await tx.nalog.findFirst({where:{agencija_id:scope.agencija_id,firma_id:scope.firma_id,sifra:v(form,"nalog_sifra"),status:"POSTED"},include:{stavke:true}});
        if(!journal)throw new Error("Nije pronađen proknjiženi izvorni nalog ove firme.");
        await tx.$queryRaw(Prisma.sql`SELECT id FROM nalozi WHERE id=${journal.id}::uuid FOR UPDATE`);
        if((await tx.nalog.findUniqueOrThrow({where:{id:journal.id}})).status!=="POSTED")throw new Error("Izvorni nalog je izmijenjen.");
        const account=await tx.firmaKonto.findFirst({where:{firma_id:scope.firma_id,sifra:v(form,"konto_sredstva"),aktivan:true,tip_konta:"analiticko"}});
        if(!account)throw new Error("Izaberite ispravan konto nabavne vrijednosti.");
        const available=journal.stavke.filter(s=>s.konto_id===account.id).reduce((n,s)=>n+cents(s.duguje)!-cents(s.potrazuje)!,0);
        const allocations=await tx.osPromjena.findMany({where:{agencija_id:scope.agencija_id,firma_id:scope.firma_id,izvorni_nalog_id:journal.id,status:"CONFIRMED",is_deleted:false,vrsta:"ACQUISITION"}});
        const allocated=allocations.filter(a=>(a.snapshot as Record<string,unknown>|null)?.asset_account_id===account.id).reduce((n,a)=>n+cents(a.delta_nabavna_vrijednost)!,0);
        const amount=cents(change.delta_nabavna_vrijednost)!;
        if(amount<=0||allocated+amount>available)throw new Error("Nabavna vrijednost prelazi neraspoređeni iznos na izabranom kontu izvornog naloga.");
        await tx.osPromjena.update({where:{id:change.id},data:{status:"CONFIRMED",izvorni_nalog_id:journal.id,snapshot:{...(change.snapshot as Prisma.JsonObject??{}),asset_account_id:account.id},updated_by:user.id}});
        await tx.osParametar.update({where:{id:parameter.id},data:{konto_sredstva_id:account.id,updated_by:user.id}});
        await tx.osnovnoSredstvo.update({where:{id},data:{status:"ACTIVE",verzija:{increment:1},updated_by:user.id}});
        await auditLogInTransaction(tx,{korisnikId:user.id,agencijaId:scope.agencija_id,firmaId:scope.firma_id,modul:"osnovna_sredstva",akcija:"activate",tipEntiteta:"OsnovnoSredstvo",entitetId:id,staraVrijednost:asset,novaVrijednost:{status:"ACTIVE",source_journal_id:journal.id,change_id:change.id}});
        return;
      }
      if(asset.status==="DISPOSED")return;
      if(asset.status!=="ACTIVE"||!asset.datum_raspolozivosti||date<=asset.datum_raspolozivosti)throw new Error("Prodaja zahtijeva aktivno sredstvo i ispravan datum.");
      const entry=await tx.kifEntry.findFirst({where:{id:v(form,"kif_entry_id"),...scope,source_type:"FIXED_ASSET_SALE",source_id:id,is_deleted:false}});
      if(!entry||!entry.journal_id||entry.invoice_date.getTime()!==date.getTime())throw new Error("Prodajni dokument nije povezan sa nalogom ili datum nije usklađen.");
      await tx.$queryRaw(Prisma.sql`SELECT id FROM nalozi WHERE id=${entry.journal_id}::uuid FOR UPDATE`);
      const source=await tx.nalog.findFirst({where:{id:entry.journal_id,agencija_id:scope.agencija_id,firma_id:scope.firma_id,status:"POSTED"}});
      if(!source)throw new Error("Prvo proknjižite nalog prodajnog KIF dokumenta.");
      const change=asset.promjene.find(p=>p.vrsta==="SALE"&&p.status==="DRAFT"&&(p.snapshot as Record<string,unknown>|null)?.kif_entry_id===entry.id);
      if(!change)throw new Error("Nacrt prodaje nije pronađen.");
      const covered=await tx.osObracunPokrice.findMany({where:{sredstvo_id:id,firma_id:scope.firma_id,aktivno:true},orderBy:{period_od:"asc"}});
      if(covered.some(c=>c.period_do>=date))throw new Error("Amortizacija je proknjižena na datum prodaje ili poslije njega. Potrebna je korekcija obračuna.");
      let next=asset.parametri[asset.parametri.length-1].vazi_od;
      for(const c of covered){if(c.period_od>next)break;if(c.period_do>=next)next=assetDay(c.period_do,1);}
      if(asset.vrsta_imovine!=="LAND"&&next<date)throw new Error(`Prvo proknjižite amortizaciju do ${assetDate(assetDay(date,-1))}.`);
      const confirmed=asset.promjene.filter(p=>p.status==="CONFIRMED");
      const gross=confirmed.reduce((n,p)=>n+cents(p.delta_nabavna_vrijednost)!,0);
      const posted=await tx.osObracunStavka.findMany({where:{sredstvo_id:id,firma_id:scope.firma_id,obracun:{status:"POSTED"}}});
      const accumulated=confirmed.reduce((n,p)=>n+cents(p.delta_ispravka_vrijednosti)!,0)+posted.reduce((n,p)=>n+cents(p.iznos)!,0);
      if(gross<0||accumulated<0||accumulated>gross)throw new Error("Vrijednosti kartice nijesu usklađene.");
      const codes=[v(form,"konto_sredstva"),v(form,"konto_ispravke"),v(form,"konto_rashoda")];
      const accounts=await tx.firmaKonto.findMany({where:{firma_id:scope.firma_id,sifra:{in:codes},aktivan:true,tip_konta:"analiticko",override_type:{not:"DEACTIVATED"}}});
      const [cost,correction,loss]=codes.map(code=>accounts.find(a=>a.sifra===code));
      if(!cost||accumulated>0&&!correction||gross>accumulated&&!loss||new Set([cost?.id,accumulated?correction?.id:null,gross>accumulated?loss?.id:null].filter(Boolean)).size!==1+Number(accumulated>0)+Number(gross>accumulated))throw new Error("Unesite različita analitička konta sredstva, ispravke i rashoda neotpisane vrijednosti.");
      if(accounts.some(a=>a.analitika_obavezna||a.koristi_radnu_jedinicu))throw new Error("Izabrana konta zahtijevaju dodatne analitičke dimenzije; ovaj tok podržava konta bez obaveznih dimenzija.");
      // Refuse double disposal if the invoice journal already credits this asset's cost account.
      if(await tx.stavkaNaloga.findFirst({where:{nalog_id:source.id,konto_id:cost.id,potrazuje:{gt:0}}}))throw new Error("Izvorni nalog već sadrži isknjiženje na kontu sredstva. Potrebno je povezivanje postojećeg isknjiženja.");
      const type=await tx.vrstaNaloga.findFirst({where:{sifra:"MANUAL",aktivan:true,OR:[{agencija_id:null},{agencija_id:scope.agencija_id}]}});if(!type)throw new Error("Nedostaje vrsta ručnog naloga.");
      await tx.$queryRaw(Prisma.sql`SELECT id FROM vrste_naloga WHERE id=${type.id}::uuid FOR UPDATE`);
      const last=await tx.nalog.findFirst({where:{firma_id:scope.firma_id,poslovna_godina_id:year.id,vrsta_naloga_id:type.id},orderBy:{broj:"desc"}});
      let disposalJournalId:string|null=null;
      if(gross){const rows=[{konto_id:cost.id,duguje:"0",potrazuje:decimal(gross)},...(accumulated?[{konto_id:correction!.id,duguje:decimal(accumulated),potrazuje:"0"}]:[]),...(gross>accumulated?[{konto_id:loss!.id,duguje:decimal(gross-accumulated),potrazuje:"0"}]:[])];
      const journal=await tx.nalog.create({data:{...scope,vrsta_naloga_id:type.id,broj:(last?.broj??0)+1,sifra:formatJournalCode(type.prefiks,year.godina,(last?.broj??0)+1),datum:date,datum_knjizenja:date,opis:`Prodaja osnovnog sredstva ${asset.inventarski_broj} – isknjiženje`,status:"POSTED",source_type:"FIXED_ASSET_DISPOSAL",source_module:"OSNOVNA_SREDSTVA",izvorni_dokument_id:change.id,kreirao_korisnik_id:user.id,created_by:user.id,updated_by:user.id,proknjizen_by:user.id,proknjizen_at:new Date(),stavke:{create:rows.map((row,i)=>({...row,redni_broj:i+1,opis:asset.naziv,created_by:user.id}))}}});disposalJournalId=journal.id;}
      await tx.osPromjena.update({where:{id:change.id},data:{datum:date,status:"CONFIRMED",izvorni_nalog_id:source.id,delta_nabavna_vrijednost:decimal(-gross),delta_ispravka_vrijednosti:decimal(-accumulated),snapshot:{kif_entry_id:entry.id,sale_price_cents:String(cents(entry.total_base)),disposal_journal_id:disposalJournalId},updated_by:user.id}});
      await tx.osnovnoSredstvo.update({where:{id},data:{status:"DISPOSED",datum_isknjizenja:date,verzija:{increment:1},updated_by:user.id}});
      await auditLogInTransaction(tx,{korisnikId:user.id,agencijaId:scope.agencija_id,firmaId:scope.firma_id,modul:"osnovna_sredstva",akcija:"confirm_sale",tipEntiteta:"OsPromjena",entitetId:change.id,staraVrijednost:change,novaVrijednost:{status:"CONFIRMED",kif_entry_id:entry.id,sale_price_cents:String(cents(entry.total_base)),disposal_journal_id:disposalJournalId}});
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
  }catch(error){const message=error instanceof Prisma.PrismaClientKnownRequestError?"Podaci su izmijenjeni. Osvježite stranicu i pokušajte ponovo.":error instanceof Error?error.message:"Promjena nije sačuvana.";redirect(`${back}?greska=${encodeURIComponent(message)}`);}
  revalidatePath("/agencija","layout");redirect(back);
}
export async function activateFixedAsset(form:FormData){await run(form,"activate");}
export async function confirmFixedAssetSale(form:FormData){await run(form,"sale");}
