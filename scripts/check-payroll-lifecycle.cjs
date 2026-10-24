/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test runner. */
// Actual payroll actions + PostgreSQL. Never use a development/production database.
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
if(!process.env.TEST_DATABASE_URL || !/_test(?:_|$)/.test(new URL(process.env.TEST_DATABASE_URL).pathname))throw Error('Isolated TEST_DATABASE_URL required');
process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{PrismaClient}=require('@prisma/client');
const {sourceLoader,transactionProxy}=require('../tests/helpers/source-loader.cjs');
const db=new PrismaClient(),rollback=Error('ROLLBACK_PAYROLL_FIXTURES'),date=s=>new Date(s+'T00:00:00Z');
const form=o=>{const f=new FormData();for(const[k,v]of Object.entries(o))f.set(k,String(v));return f;};
async function call(fn,o){try{await fn(form(o));throw Error('No redirect');}catch(e){if(!e.message.startsWith('REDIRECT:'))throw e;return e.message;}}
(async()=>{try{await db.$transaction(async tx=>{
 const agency=await tx.agencija.create({data:{naziv:'Payroll regression'}}),foreign=await tx.agencija.create({data:{naziv:'Foreign payroll'}});
 const firm=await tx.firma.create({data:{agencija_id:agency.id,naziv:'Payroll employer',pib:'12345678',opstina:'FixtureTown'}});
 const year=await tx.poslovnaGodina.create({data:{firma_id:firm.id,godina:2026,datum_od:date('2026-01-01'),datum_do:date('2026-12-31')}});
 const admin=await tx.korisnik.create({data:{agencija_id:agency.id,rola:'admin_agencije',korisnicko_ime:randomUUID(),lozinka_hash:'disabled'}});
 const worker=await tx.korisnik.create({data:{agencija_id:agency.id,rola:'korisnik_agencije',korisnicko_ime:randomUUID(),lozinka_hash:'disabled'}});
 await tx.korisnikFirma.create({data:{korisnik_id:worker.id,firma_id:firm.id}});
 let user=admin;
 const mocks={'server-only':{},'@/lib/prisma':{prisma:transactionProxy(tx)},'@/lib/auth':{requireAnyRole:async roles=>{if(!roles.includes(user.rola))throw Error('ROLE');return user;}},'@/lib/work-context':{readWorkContext:async()=>({firmaId:firm.id,poslovnaGodinaId:year.id})},'next/navigation':{redirect:u=>{throw Error('REDIRECT:'+u);}},'next/cache':{revalidatePath(){}},'next/headers':{headers:async()=>new Map()}};
 const load=sourceLoader(mocks),actions=load('src/app/agencija/plate/actions.ts');
 const scope={agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id};
 // Independent explicit fixture rules; existing test DB rules are restored by rollback.
 await tx.platePorezRazred.updateMany({data:{aktivan:false}});await tx.plateDoprinosStopa.updateMany({data:{aktivan:false}});
 for(const [from,to,rate]of [[0,70000,0],[70000,100000,.09],[100000,null,.15]])await tx.platePorezRazred.create({data:{sifra:'REGULAR_SALARY',naziv:'Fixture',bruto_od:from,bruto_do:to,stopa:rate,valid_from:date('2026-01-02')}});
 for(const [code,rate]of [['EMPLOYEE_PIO',.1],['EMPLOYEE_UNEMPLOYMENT',.005],['EMPLOYER_UNEMPLOYMENT',.005],['LABOR_FUND',.002],['UNION',.002],['CHAMBER',.0027]])await tx.plateDoprinosStopa.create({data:{sifra:code,naziv:code,payer_type:'Fixture',stopa:rate,valid_from:date('2026-01-02')}});
 await tx.platePrirezStopa.create({data:{opstina:'FixtureTown',stopa:.13,valid_from:date('2026-01-02')}});
 const kind=await tx.plateVrstaObracuna.create({data:{sifra:randomUUID(),naziv:'Gross fixture',input_type:'GROSS',algoritam:'GROSS_TO_NET',valid_from:date('2026-01-01')}});
 const ioppd=await tx.plateIoppdSifra.create({data:{sifra:randomUUID(),naziv:'Fixture',valid_from:date('2026-01-01')}});
 const income=await tx.plateSifraPrimanja.create({data:{agencija_id:agency.id,firma_id:firm.id,sifra:'001',naziv:'Salary',ioppd_sifra_id:ioppd.id,vrsta_obracuna_id:kind.id,valid_from:date('2026-01-01')}});
 const emp=await tx.plateRadnik.create({data:{agencija_id:agency.id,firma_id:firm.id,ime:'Fixture',prezime:'Worker',jmbg:'0000000000000',opstina:'FixtureTown',datum_pocetka:date('2026-01-01'),podrazumijevana_sifra_id:income.id,podrazumijevana_vrsta_id:kind.id,bruto_iznos_cent:100000}});
 const jt=await tx.vrstaNaloga.create({data:{sifra:randomUUID(),naziv:'Payroll fixture',prefiks:'PL',agencija_id:agency.id}});
 const d=await tx.firmaKonto.create({data:{firma_id:firm.id,sifra:'5200',naziv:'Expense',tip_konta:'analiticko'}}),p=await tx.firmaKonto.create({data:{firma_id:firm.id,sifra:'4500',naziv:'Liability',tip_konta:'analiticko'}});
 const components=load('src/lib/payroll-posting.ts').payrollPostingComponents.filter(x=>!x.aggregate);
 await tx.plateKontiranjePodesavanje.create({data:{...scope,kategorija:'REDOVAN_RAD',vrsta_naloga_id:jt.id,pravila:{create:components.map(x=>({komponenta:x.code,naziv:x.label,grupa:x.group,izvorno_polje:x.sourceField,redosljed:x.order,duguje_konto_id:d.id,potrazuje_konto_id:p.id}))}}});
 const request={mjesec:6,godina:2026,datum_od:'2026-06-01',datum_do:'2026-06-30',datum_obracuna:'2026-06-30',fond_sati:176};
 for (const invalid of [{godina:2025},{datum_od:'2026-05-31'},{datum_do:'2026-07-01'},{datum_obracuna:'2027-01-01'},{datum_od:'2026-02-30',mjesec:2}]) {
  assert.match(await call(actions.createPayrollCalculation,{...request,...invalid}),/obracun_nevalidan/);
 }
 assert.equal(await tx.plateObracun.count({where:scope}),0);
 assert.match(await call(actions.createPayrollCalculation,request),/obracun_dodat/);
 const calc=await tx.plateObracun.findFirstOrThrow({where:scope});const args={obracun_id:calc.id};
 assert.match(await call(actions.preparePayrollCalculation,args),/pripremljen/);
 assert.equal(await tx.plateObracunStavka.count({where:{obracun_id:calc.id}}),1);
 assert.match(await call(actions.calculatePayrollCalculation,args),/obracun_obradjen/);
 const line=await tx.plateObracunStavka.findFirstOrThrow({where:{obracun_id:calc.id}});
 assert.equal(line.bruto_cent,100000);assert.equal(line.neto_cent,86449);assert.equal(line.porez_cent,2700);assert.equal(line.prirez_cent,351);
 const document=load('src/lib/payroll-documents.ts'),docArgs={agencijaId:agency.id,firmaId:firm.id,poslovnaGodinaId:year.id,obracunId:calc.id};
 let doc=await document.getPayrollDocumentData(docArgs);assert.equal(doc.totals.netoCent,86449);assert.equal(doc.isPreview,true);
 const i=load('src/lib/payroll-ioppd.ts'),query={agencijaId:agency.id,firmaId:firm.id,poslovnaGodinaId:year.id,godina:2026,mjesec:6};
 const monthly=await i.getIoppdCalculationsForMonth(query),report=i.buildIoppdMonthData(2026,6,monthly);
 assert.equal(report.totals.porezCent,2700);assert.equal(report.employeeCount,1);
 const expanded=i.buildIoppdReportLines(report);assert.deepEqual(expanded.map(x=>x.sifra),['001','097']);assert.equal(i.totalIoppdReportLines(expanded).porezCent,2700);
 const xml=load('src/lib/payroll-ioppd-xml.ts').buildIoppdXml(report);assert.match(xml,/27\.00/);
 const opp=load('src/lib/payroll-oppnd.ts').buildOppndMonthData(2026,6,monthly,.13);assert.equal(opp.ukupnoPorezCent,2700);assert.equal(opp.ukupnoPrirezCent,351);
 assert.equal((await i.getIoppdCalculationsForMonth({...query,mjesec:5})).length,0);
 assert.equal((await i.getIoppdCalculationsForMonth({...query,agencijaId:foreign.id})).length,0);
 assert.equal(await document.getPayrollDocumentData({...docArgs,agencijaId:foreign.id}),null);
 user=worker;assert.match(await call(actions.postPayrollCalculation,args),/prava/);user=admin;
 await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:true}});assert.match(await call(actions.postPayrollCalculation,args),/godina_zakljucena/);await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:false}});
 // Inject audit failure, executing the real transaction to verify no half-posting.
 const audit=load('src/lib/audit.ts');
 const failing=sourceLoader({...mocks,'@/lib/audit':{...audit,auditLogInTransaction:async()=>{throw Error('AUDIT_FAILURE');}}})('src/app/agencija/plate/actions.ts');
 assert.match(await call(failing.postPayrollCalculation,args),/knjizenje_greska/);
 assert.equal((await tx.plateObracun.findUniqueOrThrow({where:{id:calc.id}})).status,'CALCULATED');
 assert.equal(await tx.nalog.count({where:{izvorni_dokument_id:calc.id}}),0);
 await assert.rejects(()=>call(failing.calculatePayrollCalculation,args),/AUDIT_FAILURE/);
 assert.equal(await tx.nalog.count({where:{izvorni_dokument_id:calc.id}}),0);
 assert.match(await call(actions.postPayrollCalculation,args),/obracun_proknjizen/);
 const posted=await tx.plateObracun.findUniqueOrThrow({where:{id:calc.id},include:{nalog:{include:{stavke:true}}}});
 assert.equal(posted.status,'POSTED');assert.equal(posted.nalog.source_type,'PAYROLL');
 const sum=key=>posted.nalog.stavke.reduce((s,l)=>s+Math.round(Number(l[key])*100),0);
 assert.equal(sum('duguje'),101170);assert.equal(sum('potrazuje'),101170);
 assert.match(await call(actions.postPayrollCalculation,args),/obracun_vec_proknjizen/);assert.equal(await tx.nalog.count({where:{izvorni_dokument_id:calc.id}}),1);
 assert.match(await call(actions.calculatePayrollCalculation,args),/obracun_zakljucan/);
 doc=await document.getPayrollDocumentData(docArgs);assert.equal(doc.isPreview,false);assert.equal(doc.totals.brutoCent,100000);
 const payments=await document.buildPayrollPaymentOrders(doc);
 const netOrder=payments.orders.find(x=>x.type==='NET_SALARY');assert.equal(netOrder.amountCent,86449);
 assert.ok(payments.invalidOrders.length>0,'missing bank accounts must not become ready orders');
 const cashDoc={...doc,workers:doc.workers.map(w=>({...w,employee:{...w.employee,isplataGotovina:true}}))};
 const cash=await document.buildPayrollPaymentOrders(cashDoc);assert.equal(cash.cashWorkers.length,1);assert.ok(!cash.orders.some(x=>x.type==='NET_SALARY'));
 const m4=load('src/lib/payroll-m4.ts').buildM4Report({godina:2026,calculations:monthly,employees:[emp],categoriesByIncomeTypeId:new Map([[income.id,'ZARADA_OSNOVICA']]),payments:[]});
 assert.equal(m4.workers[0].ukupnaM4OsnovicaCent,100000);assert.equal(m4.workers[0].ukupnoPioUplacenoCent,0);
 const payment=await tx.plateM4MjesecnaUplata.create({data:{...scope,mjesec:6,potvrdjena:true,zaposleni_pio_cent:10000}});
 const paid=load('src/lib/payroll-m4.ts').buildM4Report({godina:2026,calculations:monthly,employees:[emp],categoriesByIncomeTypeId:new Map([[income.id,'ZARADA_OSNOVICA']]),payments:[payment]});
 assert.equal(paid.workers[0].ukupnoPioUplacenoCent,10000);
 const partial=load('src/lib/payroll-m4.ts').buildM4Report({godina:2026,calculations:monthly,employees:[emp],categoriesByIncomeTypeId:new Map([[income.id,'ZARADA_OSNOVICA']]),payments:[{...payment,zaposleni_pio_cent:5000}]});
 assert.equal(partial.workers[0].ukupnoPioUplacenoCent,0,'partial payment requires allocation, cannot claim fully paid');

 assert.equal(await tx.auditLog.count({where:{entitet_id:calc.id,akcija:'post_payroll'}}),1);
 // A reopened payroll and its journal move together, and retain their identities.
 const journalActions=load('src/app/agencija/nalozi/actions.ts');
 const journalService=load('src/lib/payroll-journal.ts');
 const journalArgs={nalog_id:posted.nalog.id};
 const snapshot=()=>tx.plateObracun.findUniqueOrThrow({where:{id:calc.id},include:{nalog:{include:{stavke:true}}}});
 const remainsPosted=async()=>{const c=await snapshot();assert.equal(c.status,'POSTED');assert.equal(c.nalog.status,'POSTED');};
 await assert.rejects(journalService.reopenPayrollJournal({userId:admin.id,agencyId:foreign.id},posted.nalog.id),/nalog_greska/);
 user=worker;assert.match(await call(journalActions.reopenJournal,journalArgs),/prava/);await remainsPosted();
 for(const [modul,akcija]of [['plate','post'],['nalozi','update']])await tx.korisnikPravo.create({data:{agencija_id:agency.id,korisnik_id:worker.id,firma_id:firm.id,modul,akcija,dozvoljeno:true}});
 await tx.korisnikFirma.updateMany({where:{korisnik_id:worker.id},data:{is_deleted:true}});
 await assert.rejects(journalService.reopenPayrollJournal({userId:worker.id,agencyId:agency.id},posted.nalog.id),/prava/);
 await tx.korisnikFirma.updateMany({where:{korisnik_id:worker.id},data:{is_deleted:false}});
 user=admin;
 await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:true}});
 assert.match(await call(journalActions.reopenJournal,journalArgs),/godina_zakljucena/);await remainsPosted();
 await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:false}});
 const period=await tx.pdvPeriod.create({data:{...scope,mjesec:6,datum_od:date('2026-06-01'),datum_do:date('2026-06-30'),status:'LOCKED'}});
 assert.match(await call(journalActions.reopenJournal,journalArgs),/pdv_period_zakljucan/);await remainsPosted();
 await tx.pdvPeriod.update({where:{id:period.id},data:{status:'OPEN'}});
 await tx.plateObracun.update({where:{id:calc.id},data:{status:'LOCKED',locked_at:new Date()}});
 assert.match(await call(journalActions.reopenJournal,journalArgs),/nalog_greska/);
 await tx.plateObracun.update({where:{id:calc.id},data:{status:'POSTED',locked_at:null}});
 const failingReopen=sourceLoader({...mocks,'@/lib/audit':{...audit,auditLogInTransaction:async()=>{throw Error('AUDIT_FAILURE')}}})('src/lib/payroll-journal.ts');
 await assert.rejects(failingReopen.reopenPayrollJournal({userId:admin.id,agencyId:agency.id},posted.nalog.id),/AUDIT_FAILURE/);await remainsPosted();
 user=worker;assert.match(await call(journalActions.reopenJournal,journalArgs),/nalog_nacrt/);user=admin;
 let reopened=await snapshot();assert.equal(reopened.status,'CALCULATED');assert.equal(reopened.nalog.status,'DRAFT');assert.equal(reopened.posted_at,null);assert.equal(reopened.nalog.proknjizen_at,null);
 assert.equal(reopened.nalog.id,posted.nalog.id);assert.equal(reopened.nalog.broj,posted.nalog.broj);assert.equal(reopened.nalog.sifra,posted.nalog.sifra);
 assert.deepEqual(reopened.nalog.stavke,posted.nalog.stavke);
 assert.equal(await tx.stavkaNaloga.count({where:{nalog_id:posted.nalog.id,nalog:{status:'POSTED',is_deleted:false}}}),0,'draft payroll is excluded from the ledger');
 doc=await document.getPayrollDocumentData(docArgs);assert.equal(doc.isPreview,true);
 await call(journalActions.reopenJournal,journalArgs);assert.equal(await tx.auditLog.count({where:{entitet_id:calc.id,akcija:'reopen_payroll'}}),1,'replay does not audit twice');
 assert.match(await call(journalActions.updateDraftJournalLines,journalArgs),/nalog_greska/);
 assert.match(await call(journalActions.deleteJournal,journalArgs),/nalog_greska/);
 await tx.pdvPeriod.update({where:{id:period.id},data:{status:'LOCKED'}});
 assert.match(await call(actions.postPayrollCalculation,args),/pdv_period_zakljucan/);
 await tx.pdvPeriod.update({where:{id:period.id},data:{status:'OPEN'}});
 assert.match(await call(failing.postPayrollCalculation,args),/knjizenje_greska/);
 reopened=await snapshot();assert.equal(reopened.nalog.status,'DRAFT');assert.equal(reopened.status,'CALCULATED');assert.deepEqual(reopened.nalog.stavke,posted.nalog.stavke,'failed repost restores the draft lines');
 // The journal screen uses its own source scope, even if a different company is selected.
 const explicitJournal=sourceLoader({...mocks,'@/lib/work-context':{readWorkContext:()=>{throw Error('Wrong company context must not be read')}}})('src/app/agencija/nalozi/actions.ts');
 user=worker;assert.match(await call(explicitJournal.postJournal,journalArgs),/prava/);user=admin;
 assert.match(await call(explicitJournal.postJournal,journalArgs),/nalog_proknjizen/);await remainsPosted();
 reopened=await snapshot();assert.equal(reopened.nalog.id,posted.nalog.id);assert.equal(reopened.nalog.broj,posted.nalog.broj);assert.equal(await tx.nalog.count({where:{izvorni_dokument_id:calc.id}}),1);
 assert.equal(reopened.nalog.stavke.reduce((s,l)=>s+Math.round(Number(l.duguje)*100),0),101170);
 assert.equal(reopened.nalog.stavke.reduce((s,l)=>s+Math.round(Number(l.potrazuje)*100),0),101170);
 // The payroll list also reposts into the same journal.
 await call(journalActions.reopenJournal,journalArgs);assert.match(await call(actions.postPayrollCalculation,args),/obracun_proknjizen/);await remainsPosted();
 assert.equal((await snapshot()).nalog_id,posted.nalog.id);
 // Two prepared supplementary drafts must not both reuse the same monthly threshold.
 async function supplement(amount) {
  assert.match(await call(actions.createPayrollCalculation,request),/obracun_dodat/);
  const c=await tx.plateObracun.findFirstOrThrow({where:{...scope,status:'DRAFT'},orderBy:{broj:'desc'}});
  await call(actions.preparePayrollCalculation,{obracun_id:c.id});
  await tx.plateObracunStavka.updateMany({where:{obracun_id:c.id},data:{input_bruto_cent:amount/2}});
  const original=await tx.plateObracunStavka.findFirstOrThrow({where:{obracun_id:c.id}});
  const {id:originalId,...copy}=original;assert.ok(originalId);
  await tx.plateObracunStavka.create({data:{...copy,id:randomUUID(),redni_broj:original.redni_broj+1,sifra_primanja:'001.05'}});
  assert.match(await call(actions.calculatePayrollCalculation,{obracun_id:c.id}),/obracun_obradjen/);
  return c;
 }
 const extra=await supplement(20000),stale=await supplement(20000);
 // Legacy calculated drafts must be refreshed before posting.
 await tx.plateObracunStavka.updateMany({where:{obracun_id:extra.id},data:{detalji:{}}});
 assert.match(await call(actions.postPayrollCalculation,{obracun_id:extra.id}),/obracun_porez_promijenjen/);
 await call(actions.calculatePayrollCalculation,{obracun_id:extra.id});
 let extraLine=await tx.plateObracunStavka.findFirstOrThrow({where:{obracun_id:extra.id}});
 assert.equal(extraLine.porez_cent,1500);assert.equal(extraLine.prirez_cent,195);
 // Recalculation excludes itself and any other unposted draft.
 await call(actions.calculatePayrollCalculation,{obracun_id:extra.id});
 assert.equal((await tx.plateObracunStavka.findFirstOrThrow({where:{obracun_id:extra.id}})).porez_cent,1500);
 assert.match(await call(actions.postPayrollCalculation,{obracun_id:extra.id}),/obracun_proknjizen/);
 assert.match(await call(actions.postPayrollCalculation,{obracun_id:stale.id}),/obracun_porez_promijenjen/);
 assert.equal(await tx.nalog.count({where:{izvorni_dokument_id:stale.id}}),0);
 await call(actions.calculatePayrollCalculation,{obracun_id:stale.id});
 assert.match(await call(actions.postPayrollCalculation,{obracun_id:stale.id}),/obracun_proknjizen/);
 const combined=i.buildIoppdMonthData(2026,6,await i.getIoppdCalculationsForMonth(query));
 assert.equal(combined.totals.porezCent,8700);
 // Reverse dependent monthly calculations in reverse order; earlier tax bases stay protected.
 assert.match(await call(journalActions.reopenJournal,journalArgs),/plate_zavisni_obracun/);
 const stalePosted=await tx.plateObracun.findUniqueOrThrow({where:{id:stale.id}}),extraPosted=await tx.plateObracun.findUniqueOrThrow({where:{id:extra.id}});
 assert.match(await call(journalActions.reopenJournal,{nalog_id:extraPosted.nalog_id}),/plate_zavisni_obracun/);
 assert.match(await call(journalActions.reopenJournal,{nalog_id:stalePosted.nalog_id}),/nalog_nacrt/);
 assert.match(await call(journalActions.reopenJournal,{nalog_id:extraPosted.nalog_id}),/nalog_nacrt/);
 assert.match(await call(journalActions.reopenJournal,journalArgs),/nalog_nacrt/);
 assert.match(await call(actions.postPayrollCalculation,{obracun_id:extra.id}),/obracun_porez_promijenjen/);
 assert.match(await call(actions.postPayrollCalculation,args),/obracun_proknjizen/);
 assert.match(await call(actions.postPayrollCalculation,{obracun_id:extra.id}),/obracun_proknjizen/);
 assert.match(await call(actions.postPayrollCalculation,{obracun_id:stale.id}),/obracun_proknjizen/);
 assert.equal(await tx.nalog.count({where:{...scope,source_module:'PLATE'}}),3);
 console.log('PASS payroll lifecycle: prepare/calculate/post, cents, reports/XML, scopes, permissions, locks, replay, atomic reopen/repost, unchanged journal number, dependency guards, audit rollback, immutable source lines');
 throw rollback;
 },{timeout:60000});}catch(e){if(e!==rollback)throw e;}finally{await db.$disconnect();}})().catch(e=>{console.error(e);process.exitCode=1;});
