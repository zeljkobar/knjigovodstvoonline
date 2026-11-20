/* eslint-disable @typescript-eslint/no-require-imports -- Read-only reconciliation. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const pure=sourceLoader()('src/lib/fiscal-reconciliation.ts');
const local=(id,amount,extra={})=>({id:'local-'+id,fiscal_api_invoice_id:id,interni_broj:id,fiscal_status:'Fiscalized',fiscal_environment:'Production',valuta:'EUR',document_type:'INVOICE',vrsta_racuna:'NORMAL',ukupno_osnovica:amount,ukupno_izlazni_pdv:'0',ukupno_sa_pdv:amount,...extra});
const remote=(id,amount,extra={})=>({id,companyId:'company',environment:'Production',status:'Fiscalized',currency:'EUR',invoiceNumber:id,contribution:{net:amount,vat:'0',gross:amount},...extra});
test('comparison catches per-document offsetting differences, stale environment/status and missing IDs',()=>{
 const clean=pure.compareFiscalDocuments([local('1','0.30'),local('2','-0.10',{document_type:'OFFICE_STORNO',vrsta_racuna:'CORRECTIVE'})],[remote('1','0.30'),remote('2','-0.10')],'company','Production');assert.equal(clean.differences.length,0);assert.equal(clean.localTotals.gross,20n);
 const changed=pure.compareFiscalDocuments([local('1','1.10'),local('2','0.90')],[remote('1','1'),remote('2','1')],'company','Production');assert.equal(changed.localTotals.gross,changed.apiTotals.gross);assert.equal(changed.differences.length,2);
 const stale=pure.compareFiscalDocuments([local('1','1',{fiscal_status:'FiscalizationPending',fiscal_environment:null}),local('2','2',{fiscal_api_invoice_id:null})],[remote('1','1'),remote('3','3')],'company','Production');assert.equal(stale.differences.length,3);assert(stale.differences[0].reasons.some(x=>x.includes('okruženje')));assert.equal(stale.localTotals.count,1);
});
test('foreign tenant, duplicate API identity and malformed monetary data never give a clean result',()=>{
 assert.throws(()=>pure.compareFiscalDocuments([], [remote('1','1',{companyId:'foreign'})],'company','Production'));
 assert.throws(()=>pure.compareFiscalDocuments([], [remote('1','1'),remote('1','1')],'company','Production'));
 assert.throws(()=>pure.reconciliationCents('1,20'));assert.throws(()=>pure.reconciliationCents('1.001'));assert.throws(()=>pure.reconciliationCents(null));
});
function fixture({changed=false,foreign=false,oversized=false}={}){
 let calls=0,documents=0,localQueries=[];
 const start='2026-09-30T22:00:00Z',end='2026-10-31T23:00:00Z';
 const report=()=>({filters:{fromUtc:start,toUtc:end},rulesVersion:'turnover-v1',currency:'EUR',authoritative:true,evaluatedAt:'2026-11-19T01:00Z',coverage:{partial:true,availableSince:null},totals:{salesNet:{net:changed&&calls>1?'2':'1',vat:'0',gross:changed&&calls>1?'2':'1'}}});
 const load=sourceLoader({
  './fiscal-admin-api':{fiscalReviewApi:{turnover:async(_a,filters)=>{calls++;assert.equal(filters.companyId,'company');return{data:report()};},turnoverDocuments:async(_a,filters)=>{documents++;assert.equal(filters.metric,'SalesNet');return{data:{page:1,pageSize:25,totalCount:oversized?501:1,items:[remote('1','1',{companyId:foreign?'other':'company'})]}};}}},
  './prisma':{prisma:{fiscalCompanyLink:{findFirst:async q=>{assert.equal(q.where.fiscal_api_company_id,'company');return{firma_id:'f',agencija_id:'a',firma:{naziv:'Firma',pib:'001'}};}},fiskalniIzlazniRacun:{findMany:async q=>{localQueries.push(q);return[local('1','1')];}}}}
 });return{run:()=>load('src/lib/fiscal-reconciliation-service.ts').loadFiscalReconciliation({id:'admin',name:'admin'},{companyId:'company',environment:'Production',fromDate:'2026-10-01',toDate:'2026-11-01'}),stats:()=>({calls,documents,localQueries})};
}
test('service constrains local tenant, checks API stability and preserves partial coverage',async()=>{
 const f=fixture(),result=await f.run();assert.equal(result.differences.length,0);assert.equal(result.partial,true);assert.equal(f.stats().calls,2);const q=f.stats().localQueries[0];assert.equal(q.where.agencija_id,'a');assert.equal(q.where.firma_id,'f');assert.equal(q.take,5001);
 await assert.rejects(fixture({changed:true}).run(),/promijenio/);await assert.rejects(fixture({foreign:true}).run(),/obuhvatu/);const large=fixture({oversized:true});await assert.rejects(large.run(),/prevelik/);assert.equal(large.stats().localQueries.length,0);
});
test('reconciliation page requires platform admin before local or API reads',async()=>{
 let reads=0;
 const load=sourceLoader({
 '@/lib/auth':{requireRole:async role=>{assert.equal(role,'admin');throw Error('DENIED');}},
 '@/lib/prisma':{prisma:{fiscalCompanyLink:{findMany:async()=>{reads++;return[];}}}},
 '@/lib/fiscal-reconciliation-service':{loadFiscalReconciliation:async()=>{reads++;},FiscalReconciliationError:class extends Error{}}
 });
 await assert.rejects(load('src/app/admin/fiskalizacija/usaglasavanje/page.tsx').default({searchParams:Promise.resolve({companyId:'foreign'})}),/DENIED/);assert.equal(reads,0);
});
