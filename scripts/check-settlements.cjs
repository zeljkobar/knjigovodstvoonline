/* eslint-disable @typescript-eslint/no-require-imports -- PostgreSQL rollback regression. */
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{PrismaClient}=require('@prisma/client');
const {sourceLoader,transactionProxy}=require('../tests/helpers/source-loader.cjs');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const db=new PrismaClient(),rollback=Error('ROLLBACK_SETTLEMENTS');const date=s=>new Date(s+'T00:00:00Z');
(async()=>{try{await db.$transaction(async tx=>{
 const agency=await tx.agencija.create({data:{naziv:'Settlement QA'}}),other=await tx.agencija.create({data:{naziv:'Settlement foreign QA'}});
 const company=await tx.firma.create({data:{agencija_id:agency.id,naziv:'Settlement fixture'}});
 const year=await tx.poslovnaGodina.create({data:{firma_id:company.id,godina:2026,datum_od:date('2026-01-01'),datum_do:date('2026-12-31'),zakljucena:true}});
 const next=await tx.poslovnaGodina.create({data:{firma_id:company.id,godina:2027,datum_od:date('2027-01-01'),datum_do:date('2027-12-31')}});
 const admin=await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
 const worker=await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'korisnik_agencije'}});
 const partner=await tx.komitent.create({data:{agencija_id:agency.id,scope:'AGENCY',naziv:'Settlement partner'}});
 const account=await tx.firmaKonto.create({data:{firma_id:company.id,sifra:'2020',naziv:'Kupci',tip_konta:'analiticko',analitika_obavezna:true,override_type:'CUSTOM'}});
 const bank=await tx.firmaKonto.create({data:{firma_id:company.id,sifra:'2410',naziv:'Banka',tip_konta:'analiticko',override_type:'CUSTOM'}});
 const type=await tx.vrstaNaloga.findFirst()||await tx.vrstaNaloga.create({data:{sifra:'QA',naziv:'QA',prefiks:'QA'}});
 let num=800000;async function journal(amount,doc,yearId=year.id,day='2026-03-01',source_type='MANUAL'){return tx.nalog.create({data:{agencija_id:agency.id,firma_id:company.id,poslovna_godina_id:yearId,vrsta_naloga_id:type.id,broj:++num,datum:date(day),status:'POSTED',source_type,kreirao_korisnik_id:admin.id,stavke:{create:[{konto_id:account.id,komitent_id:partner.id,duguje:amount>0?String(amount):'0',potrazuje:amount<0?String(-amount):'0',broj_dokumenta:doc,redni_broj:1},{konto_id:bank.id,duguje:amount<0?String(-amount):'0',potrazuje:amount>0?String(amount):'0',redni_broj:2}]}},include:{stavke:true}});}
 const inv=await journal(100,'A'),inv2=await journal(200,'B'),pay=await journal(-250,'PAY');
 const scope={agencyId:agency.id,companyId:company.id,yearId:year.id,userId:admin.id};
 const base={'@/lib/prisma':{prisma:transactionProxy(tx)},'@/lib/auth':{requireAnyRole:async()=>admin},'@/lib/work-context':{readWorkContext:async()=>({firmaId:company.id,poslovnaGodinaId:year.id})},'next/headers':{headers:async()=>new Map()},'next/link':{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)},'next/navigation':{useRouter:()=>({replace(){},refresh(){}}),redirect:u=>{throw Error('REDIRECT:'+u)}}};
 const load=sourceLoader(base),s=load('src/lib/settlements.ts'),plan=load('src/lib/settlement-plan.ts');
 let ledger=await s.loadSettlementLedger(tx,scope,'2026-12-31');assert.equal(ledger.items.length,3);assert.equal(ledger.items.reduce((sum,i)=>sum+i.remainingCents,0),5000);
 await assert.rejects(()=>s.loadSettlementLedger(tx,{...scope,agencyId:other.id},'2026-12-31'),/Kontekst/);
 await assert.rejects(()=>s.settleInTransaction(tx,{...scope,userId:worker.id},{date:'2026-12-31',partnerIds:[partner.id],mode:'EXACT'}),/dodijeljena/);
 const a=inv.stavke.find(l=>l.komitent_id),b=inv2.stavke.find(l=>l.komitent_id),p=pay.stavke.find(l=>l.komitent_id);
 await s.settleInTransaction(tx,scope,{date:'2026-12-31',partnerIds:[partner.id],mode:'MANUAL',pairs:[{debitId:a.id,creditId:p.id,cents:10000},{debitId:b.id,creditId:p.id,cents:15000}]});
 ledger=await s.loadSettlementLedger(tx,scope,'2026-12-31');assert.deepEqual(ledger.items.map(i=>i.remainingCents).sort((a,b)=>a-b),[0,0,5000]);
 await assert.rejects(()=>s.settleInTransaction(tx,scope,{date:'2026-12-31',partnerIds:[partner.id],mode:'MANUAL',pairs:[{debitId:a.id,creditId:p.id,cents:1}]}),/prelazi/);
 // A future settlement is excluded from a historical cut-off.
 assert.equal((await s.loadSettlementLedger(tx,scope,'2026-06-01')).items.find(i=>i.id===a.id).remainingCents,10000);
 const opening=await journal(50,null,next.id,'2027-01-01','OPENING_BALANCE');
 await s.carrySettlementDetails(tx,{...scope,yearId:next.id},year.id,opening.id);

 await assert.rejects(()=>transactionProxy(tx).$transaction(t=>t.nalog.update({where:{id:inv.id},data:{status:'DRAFT'}})),/Prvo poništite/);
 await assert.rejects(()=>transactionProxy(tx).$transaction(t=>t.stavkaNaloga.update({where:{id:a.id},data:{duguje:'101'}})),/istoriju zatvaranja|prenos razrade/);
 let carried=await s.loadSettlementLedger(tx,{...scope,yearId:next.id},'2027-12-31');assert.equal(carried.items.length,3);assert.equal(carried.items.reduce((n,i)=>n+i.remainingCents,0),5000);assert(!carried.items.some(i=>i.journalId===opening.id));
 // Undo previous year's matches in the current year, without changing GL.
 await s.cancelSettlements(tx,{...scope,yearId:next.id},{date:'2027-12-31',accountId:account.id,partnerId:partner.id,all:true});
 carried=await s.loadSettlementLedger(tx,{...scope,yearId:next.id},'2027-12-31');assert.equal(carried.items.find(i=>i.id===a.id).remainingCents,10000);assert.equal(carried.items.reduce((n,i)=>n+i.remainingCents,0),5000);
 const oldPlan=plan.oldestSettlementPlan(carried.items);assert.equal(oldPlan.length,2);
 await assert.rejects(()=>s.settleInTransaction(tx,{...scope,yearId:next.id},{date:'2027-12-31',partnerIds:[partner.id],mode:'OLDEST',fingerprint:'stale'}),/zastario/);
 await s.settleInTransaction(tx,{...scope,yearId:next.id},{date:'2027-12-31',partnerIds:[partner.id],mode:'OLDEST',fingerprint:s.settlementFingerprint(carried.items)});
 const payment2=await journal(-50,'PAY2',next.id,'2027-02-01');assert(payment2);
 assert.equal(await s.settleInTransaction(tx,{...scope,yearId:next.id},{date:'2027-12-31',partnerIds:[partner.id],mode:'EXACT'}),1);
 assert((await s.loadSettlementLedger(tx,{...scope,yearId:next.id},'2027-12-31')).items.every(i=>i.remainingCents===0));
 const html=renderToStaticMarkup(await load('src/app/agencija/nalozi/zatvaranje-stavki/page.tsx').default({searchParams:Promise.resolve({konto:account.id,partner:partner.id,datum:'2026-12-31'})}));assert.match(html,/Zatvori po tačnom iznosu/);assert.match(html,/Poništi sva prikazana/);
 assert.doesNotMatch(html,/Partneri i automatsko zatvaranje|Prikaži cijelu karticu/);
 const noSelection=sourceLoader({...base,'@/lib/settlements':{...s,loadSettlementLedger:async()=>{throw Error('Must not load all partners');}}})('src/app/agencija/nalozi/zatvaranje-stavki/page.tsx').default;
 const emptyHtml=renderToStaticMarkup(await noSelection({searchParams:Promise.resolve({konto:account.id,datum:'2026-12-31'})}));
 assert.match(emptyHtml,/Izaberite kupca ili dobavljača/);assert.doesNotMatch(emptyHtml,/<table|Zatvori po tačnom iznosu/);assert.match(emptyHtml,/<select[^>]*name="partner"/);assert.match(emptyHtml,/Settlement partner/);

 assert.equal(plan.exactSettlementPlan([{id:'1',accountId:'a',partnerId:'p',document:'1',date:'2026-01-01',signedCents:10,remainingCents:10},{id:'2',accountId:'a',partnerId:'p',document:'2',date:'2026-01-01',signedCents:10,remainingCents:10},{id:'3',accountId:'a',partnerId:'p',document:'3',date:'2026-01-01',signedCents:-10,remainingCents:-10}]).length,0);
 const counts=await tx.zatvaranjeStavki.count({where:{firma_id:company.id}});assert.equal(counts,5);

 // Bank suggestion + posting + invoice status + reversal, all on fixture rows.
 const bankLogic=load('src/lib/bank-settlements.ts');
 const inv75=await journal(75,'INV-75',next.id,'2027-03-01');
 const invoice75=await tx.kifEntry.create({data:{agencija_id:agency.id,firma_id:company.id,poslovna_godina_id:next.id,kupac_id:partner.id,redni_broj:1,internal_kif_number:'QA-75',customer_invoice_number:'INV-75',invoice_date:date('2027-03-01'),total_gross:'75',journal_id:inv75.id,posting_status:'POSTED'}});
 const pay75=await journal(-75,'STMT',next.id,'2027-03-02');
 const bankAccount=await tx.firmaBankovniRacun.create({data:{agencija_id:agency.id,firma_id:company.id,naziv_banke:'QA bank',broj_racuna:'530-1111-11'}});
 const stmt=await tx.bankStatement.create({data:{agencija_id:agency.id,firma_id:company.id,poslovna_godina_id:next.id,company_bank_account_id:bankAccount.id,bank_account_konto_id:bank.id,journal_id:pay75.id,statement_number:'75',statement_date:date('2027-03-02'),status:'POSTED',total_inflow:'75',closing_balance:'75',lines:{create:{line_number:1,posting_date:date('2027-03-02'),direction:'INFLOW',inflow_amount:'75',description:'Customer payment',partner_id:partner.id,credit_account_id:account.id,posting_status:'READY'}}}});
 const scopeNext={...scope,yearId:next.id};
 let proposals=await bankLogic.bankSettlementProposals(tx,scopeNext,stmt.id);assert.equal(proposals.length,1);assert.equal(proposals[0].document,'INV-75');assert.match(proposals[0].reason,/tačan/);
 await bankLogic.postBankSettlements(tx,scopeNext,stmt.id);assert.equal(await s.invoiceSettlementPaid(tx,'KIF',invoice75.id),7500);assert.equal((await tx.kifEntry.findUnique({where:{id:invoice75.id}})).payment_status,'PAID');
 await bankLogic.postBankSettlements(tx,scopeNext,stmt.id);assert.equal(await s.invoiceSettlementPaid(tx,'KIF',invoice75.id),7500);
 await s.cancelSettlements(tx,scopeNext,{date:'2027-03-02',accountId:account.id,partnerId:partner.id,all:true});await s.refreshSettlementInvoices(tx,scopeNext);assert.equal((await tx.kifEntry.findUnique({where:{id:invoice75.id}})).payment_status,'UNPAID');
 // Historical preslices still include a closure undone in the following year.
 assert.equal((await s.loadSettlementLedger(tx,scope,'2026-12-31')).items.find(i=>i.id===a.id).remainingCents,0);
 // Legacy allocation projection is not counted twice after explicit import.
 const line75=await tx.bankStatementLine.findFirst({where:{bank_statement_id:stmt.id}});
 const legacy75=await tx.bankStatementLineAllocation.create({data:{agencija_id:agency.id,firma_id:company.id,poslovna_godina_id:next.id,bank_statement_line_id:line75.id,document_type:'KIF',kif_entry_id:invoice75.id,amount:'75'}});
 assert.equal((await s.loadSettlementLedger(tx,scopeNext,'2027-03-02')).items.find(i=>i.journalId===inv75.id).remainingCents,0);
 assert.equal(await s.importLegacySettlements(tx,scopeNext,'2027-03-02'),1);assert.equal(await s.invoiceSettlementPaid(tx,'KIF',invoice75.id),7500);assert.equal(await s.importLegacySettlements(tx,scopeNext,'2027-03-02'),0);
 const legacyEdge=await tx.zatvaranjeStavki.findUnique({where:{izvor_ref:legacy75.id}});assert(legacyEdge);
 await s.cancelSettlements(tx,scopeNext,{date:'2027-03-02',accountId:account.id,partnerId:partner.id,ids:[legacyEdge.id],all:false});assert.equal(await s.invoiceSettlementPaid(tx,'KIF',invoice75.id),0);
 // Audit failure rolls back the closing edge with the rest of the transaction.
 const audit=load('src/lib/audit.ts');const failed=sourceLoader({...base,'@/lib/audit':{...audit,auditLogInTransaction:async()=>{throw Error('AUDIT_FAILURE')}}})('src/lib/settlements.ts');
 const before=await tx.zatvaranjeStavki.count({where:{firma_id:company.id}});
 await assert.rejects(()=>transactionProxy(tx).$transaction(t=>failed.settleInTransaction(t,scopeNext,{date:'2027-12-31',accountId:account.id,partnerIds:[partner.id],mode:'EXACT'})),/AUDIT_FAILURE/);
 assert.equal(await tx.zatvaranjeStavki.count({where:{firma_id:company.id}}),before);

 const action=sourceLoader({...base,'next/cache':{revalidatePath(){}},'@/lib/work-context':{readWorkContext:async()=>({firmaId:company.id,poslovnaGodinaId:next.id})}})('src/app/agencija/nalozi/zatvaranje-stavki/actions.ts').settlementAction;
 const selectedForm=new FormData();for(const[k,v]of Object.entries({firma_id:company.id,godina_id:next.id,konto:account.id,partner:partner.id,datum:'2027-12-31',mode:'SELECTED'}))selectedForm.append(k,v);
 selectedForm.append('stavka_id',inv75.stavke.find(l=>l.komitent_id).id);selectedForm.append('stavka_id',pay75.stavke.find(l=>l.komitent_id).id);
 await assert.rejects(()=>action(selectedForm),/REDIRECT:/);assert.equal((await tx.kifEntry.findUnique({where:{id:invoice75.id}})).payment_status,'PAID');
 console.log('Bank auto suggestion/post/idempotence; KIF payment status; legacy import/reversal; historical cancellation; audit rollback passed.');

 const futureInvoice=await journal(66,'INV-66',next.id,'2027-04-30');const futureItem=futureInvoice.stavke.find(l=>l.komitent_id);
 await tx.stavkaNaloga.update({where:{id:futureItem.id},data:{datum_dokumenta:date('2027-04-01')}});
 const earlyPayment=await journal(-66,'EARLY',next.id,'2027-04-02');
 const earlyStatement=await tx.bankStatement.create({data:{agencija_id:agency.id,firma_id:company.id,poslovna_godina_id:next.id,company_bank_account_id:bankAccount.id,bank_account_konto_id:bank.id,journal_id:earlyPayment.id,statement_number:'66',statement_date:date('2027-04-02'),status:'POSTED',total_inflow:'66',closing_balance:'66',lines:{create:{line_number:1,posting_date:date('2027-04-02'),direction:'INFLOW',inflow_amount:'66',description:'Customer payment',partner_id:partner.id,credit_account_id:account.id,posting_status:'READY'}}}});
 const earlyProposals=await bankLogic.bankSettlementProposals(tx,scopeNext,earlyStatement.id);assert.equal(earlyProposals[0].effectiveDate,'2027-04-30');
 await bankLogic.postBankSettlements(tx,scopeNext,earlyStatement.id);
 assert.equal((await tx.zatvaranjeStavki.findFirst({where:{duguje_stavka_id:futureItem.id,is_deleted:false}})).datum.toISOString().slice(0,10),'2027-04-30');
 assert.equal((await s.loadSettlementLedger(tx,scopeNext,'2027-04-02')).items.find(i=>i.journalId===earlyPayment.id).remainingCents,-6600);
 console.log('Invoice document date before payment, later book date: reference proposal with later effective settlement date passed.');

 const debit25=await journal(25,'INV-25',next.id,'2027-05-01'),credit25=await journal(-25,'CN-25',next.id,'2027-05-01');
 const creditEntry=await tx.kifEntry.create({data:{agencija_id:agency.id,firma_id:company.id,poslovna_godina_id:next.id,kupac_id:partner.id,redni_broj:2,internal_kif_number:'QA-CN25',customer_invoice_number:'CN-25',invoice_date:date('2027-05-01'),total_gross:'-25',journal_id:credit25.id,posting_status:'POSTED'}});
 await s.settleInTransaction(tx,scopeNext,{date:'2027-12-31',accountId:account.id,partnerIds:[partner.id],mode:'MANUAL',pairs:[{debitId:debit25.stavke.find(l=>l.komitent_id).id,creditId:credit25.stavke.find(l=>l.komitent_id).id,cents:2500}]});
 await s.refreshSettlementInvoices(tx,scopeNext);assert.equal(await s.invoiceSettlementPaid(tx,'KIF',creditEntry.id),2500);assert.equal((await tx.kifEntry.findUnique({where:{id:creditEntry.id}})).payment_status,'PAID');
 console.log('Source mutation guards and credit-note settlement/payment status passed.');

 const iosLoad=sourceLoader({...base,'@/lib/work-context':{readWorkContext:async()=>({firmaId:company.id,poslovnaGodinaId:next.id})}});
 const ios=iosLoad('src/lib/ios.ts');
 const report=await ios.loadIosReport({datum:'2027-12-31',nulti:'1',partner:partner.id});assert.equal(report.reports.length,1);assert.equal(report.reports[0].items.length,0);
 const secondPartner=await tx.komitent.create({data:{agencija_id:agency.id,scope:'AGENCY',naziv:'IOS second partner',is_foreign:true,foreign_tax_number:'FOREIGN-123'}});
 const secondJournal=await tx.nalog.create({data:{agencija_id:agency.id,firma_id:company.id,poslovna_godina_id:next.id,vrsta_naloga_id:type.id,broj:++num,datum:date('2027-06-01'),status:'POSTED',kreirao_korisnik_id:admin.id,stavke:{create:[{konto_id:account.id,komitent_id:secondPartner.id,duguje:'11.23',potrazuje:'0',broj_dokumenta:'IOS-11',redni_broj:1},{konto_id:bank.id,duguje:'0',potrazuje:'11.23',redni_broj:2}]}}});assert(secondJournal);
 assert.equal((await ios.loadIosReport({datum:'2027-12-31',prikaz:'ino'})).reports[0].debit,1123);
 const iosPage=iosLoad('src/app/agencija/izvjestaji/ios/page.tsx').default;
 const iosHtml=renderToStaticMarkup(await iosPage({searchParams:Promise.resolve({datum:'2027-12-31',nulti:'1'})}));assert.match(iosHtml,/IOS second partner/);assert.match(iosHtml,/Štampaj izabrane IOS-e/);
 const printPage=iosLoad('src/app/stampa/ios/page.tsx').default;
 const printHtml=renderToStaticMarkup(await printPage({searchParams:Promise.resolve({datum:'2027-12-31',nulti:'1',partner:[partner.id,secondPartner.id]})}));
 assert.equal((printHtml.match(/class="ios-document"/g)||[]).length,2);assert.match(printHtml,/11,23/);assert.match(printHtml,/Nijesmo saglasni/);assert.match(printHtml,/Obrazloženje razlike/);assert.match(printHtml,/Ovlašćeno lice primaoca/);
 const external=await tx.komitent.create({data:{agencija_id:other.id,scope:'AGENCY',naziv:'Foreign hidden IOS'}});
 await assert.rejects(()=>ios.loadIosReport({datum:'2027-12-31',partner:external.id},true),/nema dostupnih/);
 await assert.rejects(()=>ios.loadIosReport({datum:'2027-12-31'},true),/najmanje jednog/);
 await assert.rejects(()=>ios.loadIosReport({datum:'2027-12-31',partner:'invalid'},true),/Neispravan/);
 const deniedIos=sourceLoader({...base,'@/lib/work-context':{readWorkContext:async()=>({firmaId:company.id,poslovnaGodinaId:next.id})},'@/lib/permissions':{hasAllPermissions:async()=>false}})('src/lib/ios.ts');
 await assert.rejects(()=>deniedIos.loadIosReport({datum:'2027-12-31',partner:partner.id},true),/Nemate pravo/);
 console.log('IOS: exact cents; zero/foreign filters; selected partner isolation; batch print; confirmation; export rights; no-selection and tamper guards passed.');
 const purge=load('src/lib/company-purge.ts');await purge.purgeCompanyData(tx,{agencijaId:agency.id,firmaId:company.id,potvrdaNaziva:company.naziv,korisnikId:admin.id});
 assert.equal(await tx.firma.count({where:{id:company.id}}),0);
 console.log('Settlement DB lifecycle: partial/multiple/exact/ambiguous/oldest/stale/scope/locked-year/carry/reversal/SSR passed.');throw rollback;
 },{timeout:120000});}catch(e){if(e!==rollback)throw e;}finally{await db.$disconnect();}})().catch(e=>{console.error(e);process.exitCode=1;});
