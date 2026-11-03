import "server-only";
import type { Prisma } from "@prisma/client";
import { decimalToScaled } from "./inventory-calculation";
import { auditLogInTransaction } from "./audit";
import { exactSettlementPlan, oldestSettlementPlan, type SettlementItem, type SettlementPair } from "./settlement-plan";
export type SettlementScope = { agencyId: string; companyId: string; yearId: string; userId: string };
export const settlementCents = (v: unknown) => Number(decimalToScaled(String(v ?? 0), 2));
const decimal = (v: number) => `${Math.trunc(v / 100)}.${String(v % 100).padStart(2, "0")}`;
export const settlementDate = (d: Date) => d.toISOString().slice(0,10);
export const validSettlementDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime()) && new Date(s).toISOString().slice(0,10) === s;
const posted = { status: "POSTED", is_deleted: false };
const includeLine = { nalog: true, firma_konto: true, komitent: true } as const;
export async function settlementAccess(tx: Prisma.TransactionClient, scope: SettlementScope, write = false) {
  const user = await tx.korisnik.findFirst({where:{id:scope.userId,agencija_id:scope.agencyId,aktivan:true,is_deleted:false,rola:{in:["admin_agencije","korisnik_agencije"]},agencija:{aktivan:true,is_deleted:false,is_fiscal_direct_container:false}}});
  const year = await tx.poslovnaGodina.findFirst({where:{id:scope.yearId,firma_id:scope.companyId,firma:{agencija_id:scope.agencyId,aktivan:true,is_deleted:false}}});
  if (!user || !year) throw Error("Kontekst nije dostupan.");
  if(user.rola !== "admin_agencije") {
    if(!await tx.korisnikFirma.findFirst({where:{korisnik_id:user.id,firma_id:scope.companyId,is_deleted:false}})) throw Error("Firma nije dodijeljena.");
    for (const akcija of write ? ["view","update"] : ["view"]) if(!await tx.korisnikPravo.findFirst({where:{korisnik_id:user.id,agencija_id:scope.agencyId,firma_id:scope.companyId,modul:"nalozi",akcija,dozvoljeno:true}})) throw Error("Nemate pravo zatvaranja stavki.");
  }
  return year;
}
export async function loadSettlementLedger(tx: Prisma.TransactionClient, scope: SettlementScope, cutoff: string, accountId?: string, partnerId?: string, omitLegacy = false) {
  if(!validSettlementDate(cutoff)) throw Error("Neispravan datum presjeka.");
  const year = await settlementAccess(tx, scope);
  const end = new Date(cutoff+"T00:00:00Z");
  if(end < year.datum_od || end > year.datum_do) throw Error("Datum mora pripadati izabranoj poslovnoj godini.");
  const filter: Prisma.StavkaNalogaWhereInput = { komitent_id: partnerId || {not:null}, ...(accountId ? {konto_id:accountId}:{}), firma_konto:{firma_id:scope.companyId,analitika_obavezna:true, OR:[{sifra:{startsWith:"2"}},{sifra:{startsWith:"4"}}]} };
  const direct = await tx.stavkaNaloga.findMany({where:{...filter,nalog:{...posted,agencija_id:scope.agencyId,firma_id:scope.companyId,poslovna_godina_id:scope.yearId,datum:{lte:end}}},include:includeLine});
  const carry = await tx.prenosOtvorenihStavki.findMany({where:{agencija_id:scope.agencyId,firma_id:scope.companyId,poslovna_godina_id:scope.yearId,nalog:{...posted,datum:{lte:end}},izvorna_stavka:filter},include:{izvorna_stavka:{include:includeLine}}});
  const mappedJournals = new Set(carry.map(c=>c.nalog_id));
  if(carry.length){
    const opening=new Map<string,number>(), detail=new Map<string,number>();
    for(const l of direct.filter(l=>mappedJournals.has(l.nalog_id))){const key=`${l.konto_id}:${l.komitent_id}`;opening.set(key,(opening.get(key)??0)+settlementCents(l.duguje)-settlementCents(l.potrazuje));}
    for(const l of new Map(carry.map(c=>[c.izvorna_stavka_id,c.izvorna_stavka])).values()){const key=`${l.konto_id}:${l.komitent_id}`;detail.set(key,(detail.get(key)??0)+settlementCents(l.duguje)-settlementCents(l.potrazuje));}
    if([...new Set([...opening.keys(),...detail.keys()])].some(k=>(opening.get(k)??0)!==(detail.get(k)??0))) throw Error("Razrada otvorenih stavki ne odgovara zbirnom početnom stanju. Ispravite početno stanje prije zatvaranja.");
  }
  const lines = [...new Map([...direct.filter(l=>!mappedJournals.has(l.nalog_id)),...carry.map(c=>c.izvorna_stavka)].map(l=>[l.id,l])).values()];
  const ids=lines.map(l=>l.id);
  const edges = await tx.zatvaranjeStavki.findMany({where:{agencija_id:scope.agencyId,firma_id:scope.companyId,datum:{lte:end},OR:[{duguje_stavka_id:{in:ids}},{potrazuje_stavka_id:{in:ids}},{is_deleted:true,poslovna_godina_id:scope.yearId,...(accountId?{snimak:{path:["duguje","accountId"],equals:accountId}}:{}),...(partnerId?{AND:[{snimak:{path:["duguje","partnerId"],equals:partnerId}}]}:{})}]},orderBy:{created_at:"asc"}});
  const consumed = new Map<string,number>();
  for(const e of edges.filter(e=>!e.is_deleted || (e.ponisteno_datum && settlementDate(e.ponisteno_datum)>cutoff))) for(const id of [e.duguje_stavka_id,e.potrazuje_stavka_id].filter((id):id is string=>Boolean(id))) consumed.set(id,(consumed.get(id)??0)+settlementCents(e.iznos));
  const legacy = omitLegacy ? {result:[],errors:[]} : await legacySettlementPairs(tx,scope,cutoff);
  for(const r of legacy.result) for(const id of [r.pair.debitId,r.pair.creditId]) consumed.set(id,(consumed.get(id)??0)+r.pair.cents);
  const items = lines.map(l=>{
    const signedCents=settlementCents(l.duguje)-settlementCents(l.potrazuje);
    return {id:l.id,accountId:l.konto_id,accountCode:l.firma_konto.sifra,partnerId:l.komitent_id!,partnerName:l.komitent?.naziv??"", document:l.broj_dokumenta??(l.nalog.source_type==="OPENING_BALANCE"?"Nerazrađeno početno stanje":l.nalog.sifra??l.nalog.id),date:settlementDate(l.nalog.datum),documentDate:l.datum_dokumenta?settlementDate(l.datum_dokumenta):null,dueDate:l.datum_valute?settlementDate(l.datum_valute):null,journal:l.nalog.sifra,journalId:l.nalog_id, signedCents,remainingCents: Math.sign(signedCents)*(Math.abs(signedCents)-(consumed.get(l.id)??0)) || 0};
  }).filter(l=>l.signedCents!==0).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  return {items,edges,year,legacyErrors:legacy.errors};
}
export async function writeSettlementPair(tx: Prisma.TransactionClient, scope: SettlementScope, items: SettlementItem[], pair: SettlementPair, date: string, mode: string, ref?: string) {
  const d=items.find(i=>i.id===pair.debitId), c=items.find(i=>i.id===pair.creditId);
  if(!d||!c||d.accountId!==c.accountId||d.partnerId!==c.partnerId||!Number.isSafeInteger(pair.cents)||pair.cents<=0||pair.cents>d.remainingCents||pair.cents> -c.remainingCents||date<d.date||date<c.date) throw Error("Stavke su promijenjene ili iznos prelazi preostalo stanje. Osvježite pregled.");
  const locked = await tx.$queryRaw<Array<{id:string}>>`SELECT s.id FROM stavke_naloga s JOIN nalozi n ON n.id=s.nalog_id WHERE s.id IN (${d.id}::uuid,${c.id}::uuid) ORDER BY n.id,s.id FOR UPDATE OF n,s`;
  if(locked.length!==2) throw Error("Izvorne stavke su promijenjene.");
  const current=await tx.stavkaNaloga.findMany({where:{id:{in:[d.id,c.id]},nalog:{status:"POSTED",is_deleted:false,agencija_id:scope.agencyId,firma_id:scope.companyId}},include:{nalog:true}});
  for(const item of [d,c]) {
    const live=current.find(l=>l.id===item.id);
    if(!live||live.konto_id!==item.accountId||live.komitent_id!==item.partnerId||settlementCents(live.duguje)-settlementCents(live.potrazuje)!==item.signedCents||settlementDate(live.nalog.datum)>date) throw Error("Izvorne stavke su promijenjene. Osvježite pregled.");
    const used=await tx.zatvaranjeStavki.aggregate({where:{is_deleted:false,OR:[{duguje_stavka_id:item.id},{potrazuje_stavka_id:item.id}]},_sum:{iznos:true}});
    if(settlementCents(used._sum.iznos)+pair.cents>Math.abs(item.signedCents)) throw Error("Iznos je već raspoređen. Osvježite pregled.");
  }
  const edge=await tx.zatvaranjeStavki.create({data:{agencija_id:scope.agencyId,firma_id:scope.companyId,poslovna_godina_id:scope.yearId,duguje_stavka_id:d.id,potrazuje_stavka_id:c.id,iznos:decimal(pair.cents),datum:new Date(date+"T00:00:00Z"),nacin:mode,created_at:new Date(),created_by:scope.userId,izvor_ref:ref,snimak:{duguje:d,potrazuje:c}}});
  d.remainingCents-=pair.cents;c.remainingCents+=pair.cents;
  await auditLogInTransaction(tx,{korisnikId:scope.userId,agencijaId:scope.agencyId,firmaId:scope.companyId,modul:"nalozi",akcija:"zatvori_stavke",tipEntiteta:"ZatvaranjeStavki",entitetId:edge.id,novaVrijednost:edge});
  return edge;
}
// No ledger mutation: closed financial years/periods deliberately remain eligible.
export async function settleInTransaction(tx: Prisma.TransactionClient, scope: SettlementScope, input: { date:string;accountId?:string;partnerIds:string[];mode:"EXACT"|"OLDEST"|"MANUAL";pairs?:SettlementPair[];fingerprint?:string }) {
  await tx.$queryRaw`SELECT id FROM firme WHERE id=${scope.companyId}::uuid FOR UPDATE`;
  await settlementAccess(tx,scope,true);
  if(!input.partnerIds.length) throw Error("Izaberite najmanje jednog partnera.");
  const ledger=await loadSettlementLedger(tx,scope,input.date,input.accountId);
  const items=ledger.items.filter(i=>input.partnerIds.includes(i.partnerId));
  await assertLegacyImported(tx,scope,items.map(i=>i.journalId));
  const pairs=input.mode==="MANUAL"?input.pairs??[]:input.mode==="EXACT"?exactSettlementPlan(items):oldestSettlementPlan(items);
  if(input.mode==="OLDEST" && input.fingerprint!==settlementFingerprint(items)) throw Error("Predlog je zastario. Ponovo prikažite predlog po starosti.");
  for(const pair of pairs) await writeSettlementPair(tx,scope,items,pair,input.date,input.mode);
  return pairs.length;
}
export function settlementFingerprint(items: SettlementItem[]) { return JSON.stringify(items.map(i=>[i.id,i.remainingCents]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))); }
// Existing invoice allocations are converted before any new matching. Ambiguous
// legacy ledger rows are never guessed and block only that partner/account.
async function assertLegacyImported(tx:Prisma.TransactionClient,scope:SettlementScope,journalIds:string[]) {
  const pending=await tx.bankStatementLineAllocation.findMany({where:{agencija_id:scope.agencyId,firma_id:scope.companyId,bank_statement_line:{bank_statement:{...posted,journal_id:{in:journalIds}}}}});
  for(const a of pending) if(!await tx.zatvaranjeStavki.findUnique({where:{izvor_ref:a.id}})) throw Error("Postoji ranije povezivanje izvoda. Prvo prenesite postojeće veze dugmetom Uskladi veze izvoda.");
}
export async function cancelSettlements(tx:Prisma.TransactionClient,scope:SettlementScope,input:{ids?:string[];accountId:string;partnerId:string;date:string;all:boolean;revision?:string}) {
  await tx.$queryRaw`SELECT id FROM firme WHERE id=${scope.companyId}::uuid FOR UPDATE`;
  await settlementAccess(tx,scope,true);
  const ledger=await loadSettlementLedger(tx,scope,input.date,input.accountId,input.partnerId);
  await assertLegacyImported(tx,scope,ledger.items.map(i=>i.journalId));
  const ids=new Set(ledger.items.map(i=>i.id));
  const edges=ledger.edges.filter(e=>!e.is_deleted&&ids.has(e.duguje_stavka_id??"")&&ids.has(e.potrazuje_stavka_id??"")&&(input.all||input.ids?.includes(e.id)));
  if(input.all && input.revision !== undefined && input.revision !== JSON.stringify(edges.map(e=>e.id).sort())) throw Error("Zatvaranja su promijenjena. Osvježite pregled prije grupnog poništavanja.");
  for(const edge of edges){
    await tx.zatvaranjeStavki.update({where:{id:edge.id},data:{is_deleted:true,ponisteno_datum:new Date(input.date+"T00:00:00Z"),deleted_at:new Date(),deleted_by:scope.userId}});
    await auditLogInTransaction(tx,{korisnikId:scope.userId,agencijaId:scope.agencyId,firmaId:scope.companyId,modul:"nalozi",akcija:"ponisti_zatvaranje",tipEntiteta:"ZatvaranjeStavki",entitetId:edge.id,staraVrijednost:edge,novaVrijednost:{is_deleted:true}});
  }
  return edges.length;
}
export async function carrySettlementDetails(tx:Prisma.TransactionClient,scope:SettlementScope,sourceYearId:string,journalId:string) {
  const year=await tx.poslovnaGodina.findUniqueOrThrow({where:{id:sourceYearId}});
  const ledger=await loadSettlementLedger(tx,{...scope,yearId:sourceYearId},settlementDate(year.datum_do));
  for(const id of [...new Set(ledger.items.map(i=>i.journalId))].sort()) await tx.$queryRaw`SELECT id FROM nalozi WHERE id=${id}::uuid FOR UPDATE`;
  const live=await tx.stavkaNaloga.findMany({where:{id:{in:ledger.items.map(i=>i.id)},nalog:{status:"POSTED",is_deleted:false,firma_id:scope.companyId,agencija_id:scope.agencyId}}});
  const byId=new Map(live.map(l=>[l.id,l]));
  if(ledger.items.some(i=>{const l=byId.get(i.id);return !l||l.konto_id!==i.accountId||l.komitent_id!==i.partnerId||settlementCents(l.duguje)-settlementCents(l.potrazuje)!==i.signedCents;}))throw Error("Izvorne stavke su promijenjene. Ponovite prenos početnog stanja.");
  await tx.prenosOtvorenihStavki.createMany({data:ledger.items.map(i=>({agencija_id:scope.agencyId,firma_id:scope.companyId,poslovna_godina_id:scope.yearId,nalog_id:journalId,izvorna_stavka_id:i.id})),skipDuplicates:true});
  await auditLogInTransaction(tx,{korisnikId:scope.userId,agencijaId:scope.agencyId,firmaId:scope.companyId,modul:"nalozi",akcija:"prenos_razrade",tipEntiteta:"Nalog",entitetId:journalId,novaVrijednost:{sourceYearId,count:ledger.items.length}});
}

export async function legacySettlementPairs(tx:Prisma.TransactionClient,scope:SettlementScope,cutoff:string, statementId?:string) {
  const represented = await tx.zatvaranjeStavki.findMany({where:{agencija_id:scope.agencyId,firma_id:scope.companyId,izvor_ref:{not:null}},select:{izvor_ref:true}});
  const allocations=await tx.bankStatementLineAllocation.findMany({where:{id:{notIn:represented.map(r=>r.izvor_ref!)},agencija_id:scope.agencyId,firma_id:scope.companyId,bank_statement_line:{...(statementId?{bank_statement_id:statementId}:{}),bank_statement:{...posted,statement_date:{lte:new Date(cutoff)},journal:posted}}},include:{kif_entry:true,kuf_entry:true,bank_statement_line:{include:{bank_statement:{include:{journal:{include:{stavke:true}}}}}}}});
  const result:Array<{pair:SettlementPair;date:string;ref:string}>=[];const errors:string[]=[];
  for(const a of allocations){
    const entry=a.kif_entry??a.kuf_entry;if(!entry?.journal_id) {errors.push(a.id);continue;}
    const partner=a.kif_entry?.kupac_id??a.kuf_entry?.dobavljac_id;
    const doc=a.kif_entry?.customer_invoice_number??a.kuf_entry?.supplier_invoice_number;
    const invoice=await tx.stavkaNaloga.findMany({where:{nalog_id:entry.journal_id,komitent_id:partner,broj_dokumenta:doc,nalog:{...posted,agencija_id:scope.agencyId,firma_id:scope.companyId}}});
    const invoices=invoice.filter(l=>a.kif_entry?settlementCents(l.duguje)>settlementCents(l.potrazuje):settlementCents(l.potrazuje)>settlementCents(l.duguje));
    if(invoices.length!==1){errors.push(a.id);continue;}
    const i=invoices[0];const payments=(a.bank_statement_line.bank_statement.journal?.stavke??[]).filter(l=>l.komitent_id===partner&&l.konto_id===i.konto_id&&(a.kif_entry?settlementCents(l.potrazuje)>settlementCents(l.duguje):settlementCents(l.duguje)>settlementCents(l.potrazuje)));
    if(payments.length!==1){errors.push(a.id);continue;}
    const payment=payments[0];
    const invoiceJournal=await tx.nalog.findUniqueOrThrow({where:{id:i.nalog_id}});
    result.push({ref:a.id,date:settlementDate(new Date(Math.max(a.bank_statement_line.bank_statement.statement_date.getTime(),invoiceJournal.datum.getTime()))),pair:{debitId:a.kif_entry?i.id:payment.id,creditId:a.kif_entry?payment.id:i.id,cents:settlementCents(a.amount)}});
  }
  return {result,errors};
}
export async function importLegacySettlements(tx:Prisma.TransactionClient,scope:SettlementScope,cutoff:string, statementId?:string) {
  await tx.$queryRaw`SELECT id FROM firme WHERE id=${scope.companyId}::uuid FOR UPDATE`;
  await settlementAccess(tx,scope,!statementId);
  const {result,errors}=await legacySettlementPairs(tx,scope,cutoff,statementId);
  // Savepoints are unnecessary: fail atomically when any mapping is ambiguous.
  if(errors.length) throw Error(`Za ${errors.length} ranijih veza nije moguće jednoznačno utvrditi stavku naloga. Provjerite povezivanje na izvodu.`);
  const ledger=await loadSettlementLedger(tx,scope,cutoff,undefined,undefined,true);
  let count=0;
  for(const r of result){
    if(!ledger.items.some(i=>i.id===r.pair.debitId)||!ledger.items.some(i=>i.id===r.pair.creditId)) continue;
    await writeSettlementPair(tx,scope,ledger.items,r.pair,r.date,"LEGACY_BANK",r.ref);count++;
  }
  return count;
}
export async function invoiceSettlementPaid(tx:Prisma.TransactionClient,type:"KIF"|"KUF",id:string) {
  const e=type==="KIF"?await tx.kifEntry.findUnique({where:{id}}):await tx.kufEntry.findUnique({where:{id}});
  if(!e)return 0;
  const legacy=await tx.bankStatementLineAllocation.findMany({where:{...(type==="KIF"?{kif_entry_id:id}:{kuf_entry_id:id}),bank_statement_line:{bank_statement:{...posted,journal:posted}}}});
  const refs=await tx.zatvaranjeStavki.findMany({where:{izvor_ref:{in:legacy.map(a=>a.id)}},select:{izvor_ref:true}});
  const represented=new Set(refs.map(r=>r.izvor_ref));
  let paid=legacy.filter(a=>!represented.has(a.id)).reduce((s,a)=>s+settlementCents(a.amount),0);
  const doc="customer_invoice_number" in e?e.customer_invoice_number:e.supplier_invoice_number;
  const partner="kupac_id" in e?e.kupac_id:e.dobavljac_id;
  if(!e.journal_id)return paid;
  const lines=await tx.stavkaNaloga.findMany({where:{nalog_id:e.journal_id,komitent_id:partner,broj_dokumenta:doc,firma_konto:{analitika_obavezna:true},nalog:posted}});
  const debitSide=(type==="KIF") === (settlementCents(e.total_gross)>=0);
  const ids=lines.filter(l=>debitSide?settlementCents(l.duguje)>settlementCents(l.potrazuje):settlementCents(l.potrazuje)>settlementCents(l.duguje)).map(l=>l.id);
  const closed=await tx.zatvaranjeStavki.aggregate({where:{firma_id:e.firma_id,agencija_id:e.agencija_id,is_deleted:false,...(debitSide?{duguje_stavka_id:{in:ids}}:{potrazuje_stavka_id:{in:ids}})},_sum:{iznos:true}});
  paid+=settlementCents(closed._sum.iznos);return paid;
}
export async function refreshSettlementInvoices(tx:Prisma.TransactionClient,scope:SettlementScope,changedSince?:Date) {
  const changed=changedSince ? await tx.zatvaranjeStavki.findMany({where:{firma_id:scope.companyId,agencija_id:scope.agencyId,OR:[{created_at:{gte:changedSince}},{deleted_at:{gte:changedSince}}]},include:{duguje_stavka:true,potrazuje_stavka:true}}) : null;
  const affected=changed?.flatMap(e=>[e.duguje_stavka,e.potrazuje_stavka]).filter((l):l is NonNullable<typeof l>=>Boolean(l));
  if(affected && !affected.length)return;
  for(const type of ["KIF","KUF"] as const){
    const baseWhere={firma_id:scope.companyId,agencija_id:scope.agencyId,is_deleted:false,journal_id:{not:null}};
    const whereKif={...baseWhere,...(affected?{OR:affected.filter(l=>l.komitent_id&&l.broj_dokumenta).map(l=>({journal_id:l.nalog_id,kupac_id:l.komitent_id!,customer_invoice_number:l.broj_dokumenta!}))}:{})};
    const whereKuf={...baseWhere,...(affected?{OR:affected.filter(l=>l.komitent_id&&l.broj_dokumenta).map(l=>({journal_id:l.nalog_id,dobavljac_id:l.komitent_id!,supplier_invoice_number:l.broj_dokumenta!}))}:{})};
    const entries=type==="KIF"?await tx.kifEntry.findMany({where:whereKif,select:{id:true,total_gross:true}}):await tx.kufEntry.findMany({where:whereKuf,select:{id:true,total_gross:true}});
    for(const e of entries){const paid=await invoiceSettlementPaid(tx,type,e.id);const total=Math.abs(settlementCents(e.total_gross));const payment_status=paid<=0?"UNPAID":paid<total?"PARTIALLY_PAID":paid===total?"PAID":"OVERPAID";
      const data={payment_status,updated_by:scope.userId};if(type==="KIF")await tx.kifEntry.update({where:{id:e.id},data});else await tx.kufEntry.update({where:{id:e.id},data});
    }
  }
}
