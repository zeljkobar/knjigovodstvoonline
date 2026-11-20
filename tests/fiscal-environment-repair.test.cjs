/* eslint-disable @typescript-eslint/no-require-imports -- Controlled metadata repair guards. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const id='11111111-1111-4111-8111-111111111111',apiId='22222222-2222-4222-8222-222222222222';
const version='2026-11-19T00:00:00.000Z';
function fixture({extra={},remoteExtra={},locked=false,txLocked=false,changed=false,auditFails=false}={}){
 let record={id,firma_id:'firm',agencija_id:'agency',poslovna_godina_id:'year',fiscal_api_invoice_id:apiId,interni_broj:'IF-1',fiscal_status:'Fiscalized',fiscal_environment:null,valuta:'EUR',document_type:'INVOICE',vrsta_racuna:'NORMAL',jikr:'jikr',iic:'iic',official_invoice_number:'official',issued_at:new Date('2026-10-28T10:00Z'),datum_racuna:new Date('2026-10-28Z'),datum_prometa:new Date('2026-10-28Z'),updated_at:new Date(version),ukupno_osnovica:'150',ukupno_izlazni_pdv:'31.50',ukupno_sa_pdv:'181.50',status:'FINALIZED',kif_status:'WAITING_KIF',nalog_id:null,kif_entry_id:null,pos_kif_membership:null,original_invoice_id:null,avansni_racun_id:null,firma:{is_deleted:false,fiscalCompanyLink:{agencija_id:'agency',fiscal_api_company_id:'company'}},poslovna_godina:{zakljucena:false},...extra};
 const remote={id:apiId,companyId:'company',status:'Fiscalized',environment:'Production',invoiceType:'Normal',category:'StandardSale',isInformational:false,currency:'EUR',jikr:'jikr',iic:'iic',officialInvoiceNumber:'official',issueDateTime:'2026-10-28T10:00:00Z',totalNetAmount:150,totalVatAmount:31.5,totalGrossAmount:181.5,...remoteExtra};
 let reads=0,writes=[],audits=[],locks=0;
 const tx={
  $queryRaw:async()=>{locks++;return[];},
  fiskalniIzlazniRacun:{findFirst:async()=>({...record,updated_at:changed?new Date('2026-11-20Z'):record.updated_at}),update:async q=>{writes.push(q);record={...record,...q.data};return record;}},
  pdvPeriod:{findFirst:async()=>txLocked?{id:'locked'}:null}
 };
 const load=sourceLoader({
 './prisma':{prisma:{fiskalniIzlazniRacun:{findFirst:async()=>record},pdvPeriod:{findFirst:async()=>locked?{id:'locked'}:null},$transaction:async(fn,options)=>{assert.equal(options.isolationLevel,'Serializable');const old=record;try{return await fn(tx);}catch(e){record=old;throw e;}}}},
 './fiscal-admin-api':{fiscalReviewApi:{invoice:async(_actor,value)=>{assert.equal(value,apiId);reads++;return{data:remote};}}},
 './audit':{auditLogInTransaction:async(actual,q)=>{assert.equal(actual,tx);if(auditFails)throw Error('AUDIT_FAILED');audits.push(q);}}
 });
 return{service:load('src/lib/fiscal-environment-repair.ts'),state:()=>({record,writes,audits,reads,locks})};
}
const actor={id:'admin',name:'admin'};
test('confirmed matching sale permits only missing environment and transactional audit',async()=>{
 const f=fixture();assert.deepEqual((await f.service.prepareFiscalEnvironmentRepair(actor,id)).reasons,[]);
 await f.service.applyFiscalEnvironmentRepair(actor,id,version);
 assert.deepEqual(f.state().writes[0].data,{fiscal_environment:'Production',updated_by:'admin'});
 assert.equal(f.state().record.ukupno_sa_pdv,'181.50');assert.equal(f.state().record.fiscal_status,'Fiscalized');assert.equal(f.state().audits.length,1);assert.equal(f.state().locks,5);
 await assert.rejects(f.service.applyFiscalEnvironmentRepair(actor,id,version),/već upisano/);assert.equal(f.state().writes.length,1);
});
test('accounting links, closed year/period, changed values, identity and workflow types block repair',async()=>{
 for(const settings of [{extra:{nalog_id:'posted'}},{extra:{kif_entry_id:'kif'}},{extra:{pos_kif_membership:{}}},{extra:{poslovna_godina:{zakljucena:true}}},{locked:true},{extra:{fiscal_status:'FiscalizationPending'}},{remoteExtra:{totalGrossAmount:999}},{remoteExtra:{companyId:'other'}},{remoteExtra:{category:'FinalWithAdvance'}},{remoteExtra:{jikr:'other'}},{remoteExtra:{issueDateTime:'2026-10-29T10:00Z'}}]){
  const f=fixture(settings);await assert.rejects(f.service.applyFiscalEnvironmentRepair(actor,id,version));assert.equal(f.state().writes.length,0);
 }
});
test('stale preview, newly locked period and failed audit leave metadata unchanged',async()=>{
 for(const settings of [{changed:true},{txLocked:true},{auditFails:true}]){const f=fixture(settings);await assert.rejects(f.service.applyFiscalEnvironmentRepair(actor,id,version));assert.equal(f.state().record.fiscal_environment,null);assert.equal(f.state().audits.length,0);}
 const bad=fixture();await assert.rejects(bad.service.prepareFiscalEnvironmentRepair(actor,'bad'),/identifikator/);assert.equal(bad.state().reads,0);
});
test('server action checks platform admin before preview or writes',async()=>{
 let applied=0;const load=sourceLoader({'@/lib/auth':{requireRole:async role=>{assert.equal(role,'admin');throw Error('DENIED');}},'@/lib/fiscal-environment-repair':{applyFiscalEnvironmentRepair:async()=>{applied++;}}});
 await assert.rejects(load('src/app/admin/fiskalizacija/usaglasavanje/[invoiceId]/actions.ts').confirmMissingFiscalEnvironment(new FormData()),/DENIED/);assert.equal(applied,0);
});
