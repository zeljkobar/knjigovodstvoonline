/* eslint-disable @typescript-eslint/no-require-imports -- First-send evidence and storage regression. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const {confirmedFiscalContext,readFiscalContext}=sourceLoader()('src/lib/fiscal-context-snapshot.ts');
const id='00000000-0000-4000-8000-000000000001',company='00000000-0000-4000-8000-000000000002';
const remote=()=>({id,companyId:company,status:'Fiscalized',iic:'IKOF',qrCodeData:'QR',jikr:'JIKR',environment:'Test',operator:{code:'TODAY'},device:{code:'TODAY'},fiscalContext:{preparation:{operatorCode:'PREPARED'},firstSend:{environment:'Test',businessUnitCode:'UNIT-SENT',tcrCode:'ENU-SENT',operatorCode:'OP-SENT',softwareCode:'SECRET-NOT-COPIED',tin:'001'}}});
test('only confirmed first-send codes survive; current labels, preparation and unrelated diagnostics never replace them',()=>{
 const result=confirmedFiscalContext(remote(),id,'Test');
 assert.equal(result.operatorCode,'OP-SENT');assert.equal(result.deviceCode,'ENU-SENT');assert.equal(result.businessUnitCode,'UNIT-SENT');assert.equal(result.source,'API_FIRST_SEND');
 assert.equal(result.softwareCode,undefined);assert.equal(result.tin,undefined);
 assert.deepEqual(readFiscalContext(result,{fiscal_api_invoice_id:id,fiscal_environment:'Test',jikr:'JIKR'}),{apiCompanyId:company,environment:'Test',operatorCode:'OP-SENT',deviceCode:'ENU-SENT',businessUnitCode:'UNIT-SENT'});
 const changed=remote();changed.operator.code='RENAMED';assert.deepEqual(confirmedFiscalContext(changed,id,'Test'),result);
});
test('legacy, missing full diagnostics, wrong identity, environment and unconfirmed invoices stay unknown',()=>{
 for(const mutate of [r=>delete r.fiscalContext.firstSend,r=>r.fiscalContext.firstSend.operatorCode=null,r=>r.fiscalContext.firstSend.environment='Production',r=>r.environment='Production',r=>r.status='Draft',r=>r.jikr=null,r=>r.id=company,r=>r.companyId='bad']) {
 const value=remote();mutate(value);assert.equal(confirmedFiscalContext(value,id,'Test'),undefined);
 }
 assert.equal(readFiscalContext(null,{fiscal_api_invoice_id:id,fiscal_environment:'Test',jikr:'JIKR'}),null);
 const snapshot=confirmedFiscalContext(remote(),id,'Test');
 for(const identity of [{fiscal_api_invoice_id:company,fiscal_environment:'Test',jikr:'JIKR'},{fiscal_api_invoice_id:id,fiscal_environment:'Production',jikr:'JIKR'},{fiscal_api_invoice_id:id,fiscal_environment:'Test',jikr:'OTHER'}]) assert.equal(readFiscalContext(snapshot,identity),null);
});
test('POS storno saves its own first-send evidence and keeps it in confirmed-result recovery',async()=>{
 const {Prisma}=require('@prisma/client');let writes=[],transactions=0;
 const original={id:'original',agencija_id:'a',firma_id:'f',poslovna_godina_id:'y',fiscal_api_invoice_id:company,jikr:'old',iic:'old',pos_register:{fiscal_operator_id:'TODAY'},corrective_invoices:[],stavke:[],placanja:[],fiscal_environment:'Test',ukupno_osnovica:new Prisma.Decimal(1),ukupno_rabat:new Prisma.Decimal(0),ukupno_izlazni_pdv:new Prisma.Decimal(0),ukupno_sa_pdv:new Prisma.Decimal(1)};
 const db={fiscalCompanyLink:{findUnique:async()=>({fiscal_api_company_id:company})},firma:{findFirst:async()=>({pib:'001'})},$executeRaw:async()=>{},pdvPeriod:{findFirst:async()=>null},fiskalniIzlazniRacun:{findFirst:async q=>q.orderBy?null:original,create:async q=>({id:'correction',...q.data}),update:async q=>{writes.push(q);return q;}},stavkaIzlazneFakture:{createMany:async()=>{}},salesDocumentPayment:{createMany:async()=>{}},fiscalizationAttempt:{create:async()=>{},update:async()=>{}},fiskalniIzlazniRacunPorez:{createMany:async()=>{}}};
 let failLocal=false;
 db.$transaction=async fn=>{transactions++;if(Array.isArray(fn))return Promise.all(fn);if(failLocal&&transactions===2)throw Error('local failure');return fn(db);};
 const api={getCompany:async()=>({data:{environment:'Test'}}),createInvoiceStorno:async()=>({data:{id}}),fiscalizeInvoice:async()=>({data:{isSuccess:true,status:'Fiscalized',jikr:'JIKR'}}),getInvoice:async()=>({data:remote()})};
 const load=sourceLoader({'./prisma':{prisma:db},'./fiscal-admin-api':{fiscalAdminApi:api,FiscalAdminApiError:class extends Error{}},'./audit':{auditLog:async()=>{}},'./pos-inventory':{applyPosReturnInventoryMovement:async()=>{}},'./pos-transfer-accounting':{finalizePosTransferAccounting:async()=>({ok:true})},'./pos':{posModule:'pos'}});
 const {createAndFiscalizePosStorno}=load('src/lib/pos-storno-service.ts');
 const input={context:{agencijaId:'a',firmaId:'f',poslovnaGodinaId:'y',userId:'u',userName:'U',year:2026},originalInvoiceId:'original',reason:'Povrat',confirmed:true,accountingMode:'FISCAL_ONLY'};
 await createAndFiscalizePosStorno(input);
 let saved=writes.find(w=>w.where.id==='correction'&&w.data.fiscal_status==='Fiscalized');assert.equal(saved.data.fiscal_context_snapshot.operatorCode,'OP-SENT');
 writes=[];transactions=0;failLocal=true;await createAndFiscalizePosStorno(input);
 saved=writes.find(w=>w.data.fiscal_error_code==='LOCAL_RECONCILIATION_REQUIRED');assert.equal(saved.data.fiscal_context_snapshot.deviceCode,'ENU-SENT');
});
