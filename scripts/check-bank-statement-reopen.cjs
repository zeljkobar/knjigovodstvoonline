/* eslint-disable @typescript-eslint/no-require-imports -- Real PostgreSQL lifecycle regression. */
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PrismaClient}=require('@prisma/client');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {sourceLoader,transactionProxy}=require('../tests/helpers/source-loader.cjs');
const db=new PrismaClient(),rollback=Error('ROLLBACK_BANK_REOPEN');
const date=s=>new Date(s+'T00:00:00Z');
const form=data=>{const f=new FormData();for(const[k,v]of Object.entries(data))for(const item of [].concat(v))f.append(k,String(item));return f;};
async function reply(action,data){try{await action(form(data));throw Error('Expected redirect');}catch(e){if(!e.message.startsWith('REDIRECT:'))throw e;return decodeURIComponent(e.message);}}
(async()=>{try{await db.$transaction(async tx=>{
 const agency=await tx.agencija.create({data:{naziv:'Bank reopen regression'}});
 const foreignAgency=await tx.agencija.create({data:{naziv:'Foreign agency'}});
 const company=await tx.firma.create({data:{agencija_id:agency.id,naziv:'Bank correction fixture'}});
 const other=await tx.firma.create({data:{agencija_id:foreignAgency.id,naziv:'Other firm'}});
 const year=await tx.poslovnaGodina.create({data:{firma_id:company.id,godina:2026,datum_od:date('2026-01-01'),datum_do:date('2026-12-31')}});
 const admin=await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
 const worker=await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'korisnik_agencije'}});
 const partner=await tx.komitent.create({data:{agencija_id:agency.id,firma_id:company.id,naziv:'Partner'}});
 const type=await tx.vrstaNaloga.findFirst({where:{sifra:'BANK_STATEMENT',aktivan:true}})||await tx.vrstaNaloga.create({data:{sifra:'BANK_STATEMENT',naziv:'Izvodi',prefiks:'IZV',sistemska:true}});
 const accounts={};for(const code of ['2410','2020','2021','4330'])accounts[code]=await tx.firmaKonto.create({data:{firma_id:company.id,sifra:code,naziv:'Fixture '+code,tip_konta:'analiticko',analitika_obavezna:code!=='2410'}});
 const bank=await tx.firmaBankovniRacun.create({data:{agencija_id:agency.id,firma_id:company.id,broj_racuna:'530-12345-67',naziv_banke:'Fixture bank'}});
 await tx.bankStatementAccountSetting.create({data:{agencija_id:agency.id,firma_id:company.id,company_bank_account_id:bank.id,bank_account_konto_id:accounts['2410'].id,journal_type_id:type.id}});
 const scope={agencija_id:agency.id,firma_id:company.id,poslovna_godina_id:year.id};
 const invoice={};for(const kind of ['KIF','KUF']){
  const kif=kind==='KIF';const rt=await tx.racunVrsta.create({data:{agencija_id:agency.id,firma_id:company.id,dokument_tip:kind,sifra:randomUUID(),naziv:kind}});
  const book=await tx[kif?'kifBook':'kufBook'].create({data:{...scope,racun_vrsta_id:rt.id,redni_broj:1,mjesec:6,[kif?'internal_kif_number':'internal_kuf_number']:kind+'1',[kif?'kif_date':'kuf_date']:date('2026-06-30')}});
  invoice[kind]=await tx[kif?'kifEntry':'kufEntry'].create({data:{...scope,[kif?'kif_book_id':'kuf_book_id']:book.id,[kif?'kupac_id':'dobavljac_id']:partner.id,redni_broj:1,[kif?'internal_kif_number':'internal_kuf_number']:kind+'1',[kif?'customer_invoice_number':'supplier_invoice_number']:'INV1',invoice_date:date('2026-06-01'),...(!kif?{receipt_date:date('2026-06-01')}:{}),total_base:'200',total_gross:'200'}});
 }
 let user=admin,context={firmaId:company.id,poslovnaGodinaId:year.id},failAudit=false;
 const base={'@/lib/prisma':{prisma:transactionProxy(tx)},'@/lib/auth':{getCurrentUser:async()=>user,isDirectFiscalTenantUser:()=>false,requireAnyRole:async roles=>{if(!roles.includes(user.rola))throw Error('ROLE');return user;}},'@/lib/work-context':{readWorkContext:async()=>context},'next/headers':{headers:async()=>new Map()},'next/cache':{revalidatePath(){}},'next/navigation':{redirect:url=>{throw Error('REDIRECT:'+url);}},'next/link':{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)}};
 const audit=sourceLoader(base)('src/lib/audit.ts');
 const load=sourceLoader({...base,'@/lib/audit':{...audit,auditLogInTransaction:async(t,input,...args)=>{if(failAudit&&['reopen_statement','post_statement','update_lines'].includes(input.akcija))throw Error('AUDIT_FAILURE');return audit.auditLogInTransaction(t,input,...args);}}});
 const service=load('src/lib/bank-statement-service.ts'),life=load('src/lib/bank-statement-lifecycle.ts'),journals=load('src/app/agencija/nalozi/actions.ts');
 const make=async(number,inflow,outflow)=>{
  const statement=await tx.bankStatement.create({data:{...scope,company_bank_account_id:bank.id,bank_account_konto_id:accounts['2410'].id,statement_number:String(number),statement_date:date('2026-06-20'),status:'READY',total_inflow:String(inflow),total_outflow:String(outflow),closing_balance:String(inflow-outflow),lines:{create:[{line_number:1,posting_date:date('2026-06-20'),description:'Customer payment',direction:'INFLOW',inflow_amount:String(inflow),credit_account_id:accounts['2020'].id,partner_id:partner.id,posting_status:'READY'},{line_number:2,posting_date:date('2026-06-20'),description:'Supplier payment',direction:'OUTFLOW',outflow_amount:String(outflow),debit_account_id:accounts['4330'].id,partner_id:partner.id,posting_status:'READY'}]}}});
  const lines=await tx.bankStatementLine.findMany({where:{bank_statement_id:statement.id},orderBy:{line_number:'asc'}});
  const data={statement_id:statement.id,line_id:lines.map(l=>l.id),line_direction:['INFLOW','OUTFLOW'],partner_id:[partner.id,partner.id],credit_account_code:['2020',''],debit_account_code:['','4330'],allocation_target:['KIF:'+invoice.KIF.id,'KUF:'+invoice.KUF.id]};
  assert.match(await reply(service.updateBankStatementLines,data),/stavke_sacuvane/);return{statement,lines,data};
 };
 const balance=async code=>{const sum=await tx.stavkaNaloga.aggregate({where:{konto_id:accounts[code].id,nalog:{...scope,status:'POSTED',is_deleted:false}},_sum:{duguje:true,potrazuje:true}});return Math.round(Number(sum._sum.duguje||0)*100)-Math.round(Number(sum._sum.potrazuje||0)*100);};
 const status=kind=>tx[kind==='KIF'?'kifEntry':'kufEntry'].findUniqueOrThrow({where:{id:invoice[kind].id}}).then(e=>e.payment_status);
 const first=await make(1,80,30);const second=await make(2,20,10);
 assert.equal(await status('KIF'),'UNPAID');assert.equal(await status('KUF'),'UNPAID');
 for(const item of[first,second])assert.match(await reply(service.postSelectedBankStatements,{statement_id:item.statement.id}),/izvodi_proknjizeni/);
 const before=await tx.bankStatement.findUniqueOrThrow({where:{id:first.statement.id}}),journalId=before.journal_id;
 const original=await tx.nalog.findUniqueOrThrow({where:{id:journalId}});
 assert.equal(await balance('2410'),6000);assert.equal(await balance('2020'),-10000);assert.equal(await status('KIF'),'PARTIALLY_PAID');
 // Failed audit must not leave half a transition or payment-status change.
 failAudit=true;await assert.rejects(()=>service.reopenPostedBankStatement(form({statement_id:first.statement.id})),/AUDIT_FAILURE/);failAudit=false;
 assert.equal((await tx.bankStatement.findUniqueOrThrow({where:{id:first.statement.id}})).status,'POSTED');assert.equal(await balance('2410'),6000);
 // Roles, scope, assignment, rights, year and period checks use real DB state.
 user=worker;assert.match(await reply(service.reopenPostedBankStatement,{statement_id:first.statement.id}),/izvod_greska/);user=admin;
 await assert.rejects(()=>life.reopenBankStatement({userId:admin.id,agencyId:foreignAgency.id},{statementId:first.statement.id}),/izvod_greska/);
 context={firmaId:other.id,poslovnaGodinaId:year.id};assert.match(await reply(service.reopenPostedBankStatement,{statement_id:first.statement.id}),/izvod_greska/);context={firmaId:company.id,poslovnaGodinaId:year.id};
 await tx.korisnikFirma.create({data:{korisnik_id:worker.id,firma_id:company.id}});
 for(const akcija of['post','update'])await tx.korisnikPravo.create({data:{agencija_id:agency.id,firma_id:company.id,korisnik_id:worker.id,modul:'izvodi',akcija,dozvoljeno:akcija==='post'}});
 user=worker;assert.match(await reply(service.reopenPostedBankStatement,{statement_id:first.statement.id}),/prava/);user=admin;
 await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:true}});assert.match(await reply(service.reopenPostedBankStatement,{statement_id:first.statement.id}),/godina_zakljucena/);await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:false}});
 const period=await tx.pdvPeriod.create({data:{...scope,mjesec:6,datum_od:date('2026-06-01'),datum_do:date('2026-06-30'),status:'LOCKED'}});
 assert.match(await reply(service.reopenPostedBankStatement,{statement_id:first.statement.id}),/pdv_period_zakljucan/);await tx.pdvPeriod.update({where:{id:period.id},data:{status:'OPEN'}});
 await tx.kifEntry.update({where:{id:invoice.KIF.id},data:{journal_id:journalId}});assert.match(await reply(service.reopenPostedBankStatement,{statement_id:first.statement.id}),/izvod_nalog_veze/);await tx.kifEntry.update({where:{id:invoice.KIF.id},data:{journal_id:null}});
 // Reopen from the journal is the very same atomic workflow.
 assert.match(await reply(journals.reopenJournal,{nalog_id:journalId}),/nalog_nacrt/);
 const draft=await tx.nalog.findUniqueOrThrow({where:{id:journalId}});
 assert.equal(draft.status,'DRAFT');assert.equal(draft.proknjizen_at,null);assert.equal(draft.proknjizen_by,null);assert.ok(draft.vracen_u_nacrt_at);
 const reopened=await tx.bankStatement.findUniqueOrThrow({where:{id:first.statement.id}});assert.equal(reopened.status,'NEEDS_REVIEW');assert.equal(reopened.journal_id,journalId);assert.equal(reopened.posted_at,null);
 assert.equal(await balance('2410'),1000);assert.equal(await balance('2020'),-2000);
 assert.equal(await tx.bankStatementLineAllocation.count({where:{bank_statement_line:{bank_statement_id:first.statement.id}}}),2);
 const sums=await tx.bankStatementLineAllocation.aggregate({where:{...life.postedBankAllocationWhere,kif_entry_id:invoice.KIF.id},_sum:{amount:true}});assert.equal(Number(sums._sum.amount),20);
 await service.reopenPostedBankStatement(form({statement_id:first.statement.id})).catch(e=>{assert.match(e.message,/REDIRECT:.*izvod_nacrt/)});
 assert.equal(await tx.auditLog.count({where:{entitet_id:first.statement.id,akcija:'reopen_statement'}}),1);
 assert.match(await reply(journals.postJournal,{nalog_id:journalId}),/izvod_uredjivanje/);
 assert.match(await reply(journals.updateDraftJournalLines,{nalog_id:journalId}),/nalog_greska/);
 assert.match(await reply(journals.deleteJournal,{nalog_id:journalId}),/nalog_greska/);
 assert.match(await reply(service.deleteBankStatement,{statement_id:first.statement.id}),/izvod_greska/);
 // Existing selections are rendered for correction, and the bank-generated line editor stays protected.
 const detail=load('src/app/agencija/nalozi/[id]/page.tsx').default;
 let html=renderToStaticMarkup(await detail({params:Promise.resolve({id:journalId})}));assert.match(html,/Otvori izvod/);assert.doesNotMatch(html,/Izmijeni stavke|Proknjiži nalog \(F9\)/);
 const page=load('src/app/agencija/izvodi/page.tsx').default;
 html=renderToStaticMarkup(await page({searchParams:Promise.resolve({izvod:first.statement.id,tab:'nalog'})}));assert.match(html,/Nalog je u nacrtu/);assert.match(html,/Sačuvaj predlog naloga/);assert.doesNotMatch(html,/>Proknjiži izvod<|>Vrati u nacrt</);
 // An old form revision and a concurrent audit failure cannot overwrite the correction.
 assert.match(await reply(service.updateBankStatementLines,{...first.data,statement_version:before.updated_at.toISOString()}),/izvod_promijenjen/);
 const corrected={...first.data,credit_account_code:['2021',''],allocation_target:['','KUF:'+invoice.KUF.id]};
 failAudit=true;await assert.rejects(()=>service.updateBankStatementLines(form(corrected)),/AUDIT_FAILURE/);failAudit=false;
 assert.equal((await tx.bankStatementLine.findUniqueOrThrow({where:{id:first.lines[0].id}})).credit_account_id,accounts['2020'].id);
 assert.match(await reply(service.updateBankStatementLines,corrected),/stavke_sacuvane/);
 assert.equal((await tx.bankStatement.findUniqueOrThrow({where:{id:first.statement.id}})).journal_id,journalId);
 assert.equal(await status('KIF'),'PARTIALLY_PAID');
 html=renderToStaticMarkup(await page({searchParams:Promise.resolve({izvod:first.statement.id,tab:'nalog'})}));assert.match(html,/>Proknjiži izvod</);
 failAudit=true;assert.match(await reply(service.postSelectedBankStatements,{statement_id:first.statement.id}),/knjizenje_greska/);failAudit=false;
 assert.equal((await tx.nalog.findUniqueOrThrow({where:{id:journalId}})).status,'DRAFT');assert.equal(await balance('2410'),1000);
 assert.match(await reply(service.postSelectedBankStatements,{statement_id:first.statement.id}),/izvodi_proknjizeni/);
 const posted=await tx.nalog.findUniqueOrThrow({where:{id:journalId}});assert.equal(posted.status,'POSTED');assert.equal(posted.broj,original.broj);assert.equal(posted.sifra,original.sifra);assert.equal(posted.vrsta_naloga_id,original.vrsta_naloga_id);
 assert.equal(await balance('2410'),6000);assert.equal(await balance('2020'),-2000);assert.equal(await balance('2021'),-8000);assert.equal(await balance('4330'),4000);
 assert.equal(await tx.nalog.count({where:{izvorni_dokument_id:first.statement.id}}),1);
 assert.equal(await tx.stavkaNaloga.count({where:{nalog_id:journalId}}),4);
 assert.equal(await tx.bankStatementLineAllocation.count({where:{bank_statement_line:{bank_statement_id:first.statement.id}}}),1);
 assert.equal(Number((await tx.bankStatementLineAllocation.aggregate({where:{...life.postedBankAllocationWhere,kuf_entry_id:invoice.KUF.id},_sum:{amount:true}}))._sum.amount),40);
 html=renderToStaticMarkup(await page({searchParams:Promise.resolve({izvod:first.statement.id,tab:'nalog'})}));assert.match(html,/>Vrati u nacrt</);assert.doesNotMatch(html,/>Proknjiži izvod</);
 assert.match(await reply(service.postSelectedBankStatements,{statement_id:first.statement.id}),/nema_spremnih_izvoda/);assert.equal(await balance('2410'),6000);
 console.log('PASS bank reopen: real post→draft→correction→post, same journal/number, GL and KIF/KUF payments, retained draft selections, locks/rights/scope, atomic audit rollback, repeat and SSR.');
 throw rollback;
},{timeout:120000});}catch(e){if(e!==rollback)throw e;}finally{await db.$disconnect();}})().catch(e=>{console.error(e);process.exitCode=1;});
