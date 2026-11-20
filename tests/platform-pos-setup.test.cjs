/* eslint-disable @typescript-eslint/no-require-imports -- Platform POS guards with read-only API fixtures. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const version='2026-11-20T00:00:00.000Z';
function fixture({environment='Test',deviceUnit='unit',deviceCompany='api',ready=true,old=null,used=false,stale=false,failAudit=false}={}) {
 let settings=null,register=old,reads=0;const writes=[],audits=[];
 const firm={id:'firm',agencija_id:'agency',fiscalCompanyLink:{fiscal_api_company_id:'api',fiscal_environment:'Test',updated_at:new Date(version)},posPodesavanje:null};
 const tx={$executeRaw:async()=>{},firma:{findFirst:async()=>({...firm,posPodesavanje:stale?{updated_at:new Date(version)}:settings})},posRegister:{findFirst:async q=>q.where.id?register:null,create:async q=>{writes.push(q);register={id:'register',updated_at:new Date(version),...q.data};return register;},update:async q=>{writes.push(q);register={...register,...q.data};return register;}},posPodesavanje:{upsert:async q=>{writes.push(q);settings={id:'settings',updated_at:new Date(version),...q.create};return settings;},update:async q=>{writes.push(q);settings={...settings,...q.data};return settings;}},fiskalniIzlazniRacun:{findFirst:async()=>used?{id:'invoice'}:null},posSmjena:{findFirst:async()=>null}};
 const remote={getCompany:async()=>{reads++;return{data:{id:'api',environment,isActive:true}};},getReadiness:async()=>({data:{companyId:'api',isReady:ready}}),listBusinessUnits:async()=>({data:[{id:'unit',companyId:'api',environment:'Test',isActive:true,name:'Unit',code:'bu'}]}),listDevices:async()=>({data:[{id:'device',companyId:deviceCompany,businessUnitId:deviceUnit,isActive:true,internalCode:'enu',tcrCode:'registered'}]}),listOperators:async()=>({data:[{id:'operator',companyId:'api',environment:'Test',isActive:true,operatorCode:'op'}]})};
 const service=sourceLoader({'./prisma':{prisma:{...tx,posRegister:{...tx.posRegister,findMany:async()=>register?[register]:[]},$transaction:async fn=>{const prevSettings=settings,prevRegister=register;try{return await fn(tx);}catch(e){settings=prevSettings;register=prevRegister;throw e;}}}},'./fiscal-admin-api':{fiscalAdminApi:remote},'./audit':{auditLogInTransaction:async(_tx,q)=>{if(failAudit)throw Error('AUDIT');audits.push(q);}}})('src/lib/platform-pos-setup.ts');
 return{service,writes,audits,state:()=>({settings,register,reads})};
}
const input={actor:{id:'admin',name:'admin',rola:'admin'},firmaId:'firm',version:'new',registerId:'',registerVersion:'new',unitId:'unit',deviceId:'device',operatorId:'operator',enabled:true};
test('platform admin alone enables local POS with explicit scoped fiscal resources and default register',async()=>{
 const f=fixture();await assert.rejects(f.service.savePlatformPosSetup({...input,actor:{...input.actor,rola:'admin_agencije'}}),/SAMO_ADMIN/);assert.equal(f.state().reads,0);
 await f.service.savePlatformPosSetup(input);assert.equal(f.state().settings.aktivan,true);assert.equal(f.state().settings.podrazumijevana_kasa_id,'register');assert.equal(f.state().register.agencija_id,'agency');assert.equal(f.audits.length,1);
});
test('foreign device, wrong business unit, readiness, environment and stale settings prevent writes',async()=>{
 for(const options of [{deviceCompany:'foreign'},{deviceUnit:'foreign'},{ready:false},{environment:'Production'},{stale:true}]){const f=fixture(options);await assert.rejects(f.service.savePlatformPosSetup(input));assert.equal(f.writes.length,0);}
});
test('used register fiscal mapping cannot be overwritten; audit failure rolls back settings/register',async()=>{
 const f=fixture({old:{id:'old',updated_at:new Date(version),fiscal_business_unit_id:'old-unit',fiscal_device_id:'old-device',fiscal_operator_id:'operator'},used:true});await assert.rejects(f.service.savePlatformPosSetup({...input,registerId:'old',registerVersion:version}),/KASA_KORISCENA/);assert.equal(f.writes.length,0);
 const broken=fixture({failAudit:true});await assert.rejects(broken.service.savePlatformPosSetup(input),/AUDIT/);assert.equal(broken.state().settings,null);assert.equal(broken.state().register,null);
});
test('admin action denies unauthenticated request before service or API calls',async()=>{
 let reads=0;const actions=sourceLoader({'@/lib/auth':{requireRole:async role=>{assert.equal(role,'admin');throw Error('DENIED');}},'@/lib/platform-pos-setup':{savePlatformPosSetup:async()=>reads++,PosSetupError:class extends Error{}},'next/cache':{},'next/navigation':{}})('src/app/admin/fiskalizacija/[firmaId]/pos/actions.ts');await assert.rejects(actions.configurePlatformPos(new FormData()),/DENIED/);assert.equal(reads,0);
});
test('disabling POS does not call fiscal API or delete issued documents or register',async()=>{
 const f=fixture();await f.service.savePlatformPosSetup(input);const before=f.state();await f.service.savePlatformPosSetup({...input,enabled:false,version:version});assert.equal(f.state().reads,before.reads);assert.equal(f.state().settings.aktivan,false);assert.equal(f.state().register.id,before.register.id);assert.equal(f.audits.at(-1).akcija,'pos_disabled');
});
