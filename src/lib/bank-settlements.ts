import "server-only";
import type { Prisma } from "@prisma/client";
import { loadSettlementLedger, settlementCents, settlementDate, writeSettlementPair, settlementAccess, importLegacySettlements, legacySettlementPairs, type SettlementScope } from "./settlements";
import { invoiceSettlementPaid } from "./settlements";

export async function bankSettlementProposals(tx:Prisma.TransactionClient,scope:SettlementScope,statementId:string) {
 const statement=await tx.bankStatement.findFirst({where:{id:statementId,agencija_id:scope.agencyId,firma_id:scope.companyId,poslovna_godina_id:scope.yearId,is_deleted:false},include:{lines:{include:{allocations:true}},journal:{include:{stavke:true}}}});
 if(!statement)return [];
 const date=settlementDate(statement.statement_date);
 try { await settlementAccess(tx,scope); } catch(error) {
  if(error instanceof Error && /Nemate pravo|nije dodijeljena|Kontekst nije dostupan/.test(error.message))return [];
  throw error;
 }
 const year=await tx.poslovnaGodina.findUniqueOrThrow({where:{id:scope.yearId}});
 const ledger=await loadSettlementLedger(tx,scope,settlementDate(year.datum_do));
 if(ledger.legacyErrors.length)return [];
 const result:Array<{lineId:string;targetId:string;document:string;documentDate:string|null;dueDate:string|null;cents:number;effectiveDate:string;reason:string}>=[];
 const used=new Set<string>();
 for(const line of statement.lines.filter(l=>l.posting_status!=="IGNORED")){
  if(line.allocations.length||!line.partner_id)continue;
  const inflow=line.direction==="INFLOW",accountId=inflow?line.credit_account_id:line.debit_account_id;
  const amount=settlementCents(inflow?line.inflow_amount:line.outflow_amount);
  if(!accountId||amount<=0)continue;
  const candidates=ledger.items.filter(i=>i.partnerId===line.partner_id&&i.accountId===accountId&&i.journalId!==statement.journal_id&&(i.documentDate??i.date)<=date&&i.remainingCents*(inflow?1:-1)>0&&(inflow?i.accountCode.startsWith("2"):i.accountCode.startsWith("4")));
  // Match explicit references only as whole tokens; never substring "12" in "312".
  const text=` ${line.reference_number??""} ${/rač|rac|fakt|invoice|inv\b/i.test(line.description)?line.description:""} `.toLocaleUpperCase();
  const references=candidates.filter(i=>i.document.length>=2 && text.split(/[\s,;:()]+/).includes(i.document.toLocaleUpperCase()));
  const exact=candidates.filter(i=>Math.abs(i.remainingCents)===amount);
  if(!references.length && ledger.items.some(i=>i.journalId!==statement.journal_id&&i.partnerId===line.partner_id&&i.accountId===accountId&&i.remainingCents===(inflow?-amount:amount)))continue;
  const target=references.length===1?references[0]:references.length===0&&exact.length===1?exact[0]:undefined;
  if(!target||used.has(target.id))continue;
  // Two equal payments for the same partner/account are ambiguous without references.
  if(!references.length&&statement.lines.filter(other=>other.posting_status!=="IGNORED"&&other.partner_id===line.partner_id&&(inflow?other.credit_account_id:other.debit_account_id)===accountId&&settlementCents(inflow?other.inflow_amount:other.outflow_amount)===amount).length!==1)continue;
  used.add(target.id);
  result.push({lineId:line.id,targetId:target.id,document:target.document,documentDate:target.documentDate,dueDate:target.dueDate,cents:Math.min(amount,Math.abs(target.remainingCents)),effectiveDate:[date,target.date].sort().at(-1)!,reason:references.length?"Broj računa / poziv na broj":"Jedinstven tačan iznos"});
 }
 return result;
}
export async function postBankSettlements(tx:Prisma.TransactionClient,scope:SettlementScope,statementId:string) {
 const statement=await tx.bankStatement.findUniqueOrThrow({where:{id:statementId},include:{journal:{include:{stavke:{include:{firma_konto:true}}}},lines:true}});
 if(statement.agencija_id!==scope.agencyId||statement.firma_id!==scope.companyId||statement.poslovna_godina_id!==scope.yearId||!statement.journal||statement.journal.status!=="POSTED")throw Error("Izvod nije dostupan za povezivanje.");
 try { await settlementAccess(tx,scope); } catch(error) {
  if(error instanceof Error && /Nemate pravo|nije dodijeljena|Kontekst nije dostupan/.test(error.message))return;
  throw error;
 }
 const date=settlementDate(statement.statement_date);
 const year=await tx.poslovnaGodina.findUniqueOrThrow({where:{id:scope.yearId}});
 const cutoff=settlementDate(year.datum_do);
 const legacy=await legacySettlementPairs(tx,scope,date,statementId);
 if(!legacy.errors.length) await importLegacySettlements(tx,scope,date,statementId);
 const proposals=await bankSettlementProposals(tx,scope,statementId);
 for(const p of proposals){
   const line=statement.lines.find(l=>l.id===p.lineId)!;
   const accountId=line.direction==="INFLOW"?line.credit_account_id:line.debit_account_id;
   const candidates=statement.journal.stavke.filter(s=>s.komitent_id===line.partner_id&&s.konto_id===accountId&&(statement.journal_mode!=="MANUAL"||s.broj_dokumenta===p.document)&&(line.direction==="INFLOW"?settlementCents(s.potrazuje)>0:settlementCents(s.duguje)>0));
   // A MANUAL ledger can have split/reordered rows. Only bind a unique row
   // whose amount and document agree; otherwise leave it for manual settlement.
   const payment=candidates.length===1?candidates[0]:candidates.find(s=>s.broj_dokumenta===p.document && (line.direction==="INFLOW"?settlementCents(s.potrazuje):settlementCents(s.duguje))===p.cents);
   if(!payment)continue;
   const ledger=await loadSettlementLedger(tx,scope,cutoff);
   const item=ledger.items.find(i=>i.id===payment.id);const target=ledger.items.find(i=>i.id===p.targetId);
   if(!item||!target||Math.abs(item.remainingCents)<p.cents||Math.abs(target.remainingCents)<p.cents)continue;
   await writeSettlementPair(tx,scope,ledger.items,{debitId:line.direction==="INFLOW"?target.id:item.id,creditId:line.direction==="INFLOW"?item.id:target.id,cents:p.cents},[date,target.date,item.date].sort().at(-1)!,"AUTO_BANK");
   // Keep GL amounts untouched; populate the reference only before the first
   // closure is created (the protective trigger prohibits later rewrites).
 }
 // The final MANUAL journal may split a single bank movement across several
 // invoices. Its own document references take precedence over parser rows.
 if(statement.journal_mode==="MANUAL") {
  for(const row of statement.journal.stavke.filter(r=>r.komitent_id&&r.firma_konto.analitika_obavezna)) {
   const ledger=await loadSettlementLedger(tx,scope,cutoff);
   if(ledger.legacyErrors.length)continue;
   const payment=ledger.items.find(i=>i.id===row.id);
   if(!payment?.remainingCents||!row.broj_dokumenta||row.broj_dokumenta===statement.statement_number)continue;
   const customer=payment.accountCode.startsWith("2")&&payment.remainingCents<0;
   const supplier=payment.accountCode.startsWith("4")&&payment.remainingCents>0;
   if(!customer&&!supplier)continue;
   const targets=ledger.items.filter(i=>i.journalId!==statement.journal_id&&i.accountId===payment.accountId&&i.partnerId===payment.partnerId&&i.document===row.broj_dokumenta&&(i.documentDate??i.date)<=date&&i.remainingCents*payment.remainingCents<0);
   if(targets.length!==1)continue;
   const target=targets[0],cents=Math.min(Math.abs(target.remainingCents),Math.abs(payment.remainingCents));
   await writeSettlementPair(tx,scope,ledger.items,{debitId:customer?target.id:payment.id,creditId:customer?payment.id:target.id,cents},[date,target.date,payment.date].sort().at(-1)!,"MANUAL_BANK_REFERENCE");
  }
 }
 // Refresh only the invoice rows touched by this statement's partner set.
 const partnerIds=statement.lines.map(l=>l.partner_id).filter((id):id is string=>Boolean(id));
 for(const type of ["KIF","KUF"] as const){
  const where={firma_id:scope.companyId,agencija_id:scope.agencyId,is_deleted:false,...(type==="KIF"?{kupac_id:{in:partnerIds}}:{dobavljac_id:{in:partnerIds}})};
  const entries=type==="KIF"?await tx.kifEntry.findMany({where}):await tx.kufEntry.findMany({where});
  for(const e of entries){const paid=await invoiceSettlementPaid(tx,type,e.id),total=Math.abs(settlementCents(e.total_gross));const data={payment_status:paid<=0?"UNPAID":paid<total?"PARTIALLY_PAID":paid===total?"PAID":"OVERPAID",updated_by:scope.userId};if(type==="KIF")await tx.kifEntry.update({where:{id:e.id},data});else await tx.kufEntry.update({where:{id:e.id},data});}
 }
}
