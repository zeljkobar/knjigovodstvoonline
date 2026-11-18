/* eslint-disable @typescript-eslint/no-require-imports -- Source-loader regression. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');

function fixture({allowed=true,company=true,scope='AGENCY',agency='agency-a',auditFails=false}={}) {
 const record={id:'partner-a',naziv:'Duplicate',scope,agencija_id:agency,firma_id:'company-a',aktivan:true};
 const audits=[];let mutations=0;let transactions=0;
 const tx={
  firma:{findFirst:async args=>{
   assert.equal(args.where.agencija_id,'agency-a');
   assert.equal(args.where.korisnici.some.korisnik_id,'user-a');
   return company?{id:'company-a'}:null;
  }},
  $queryRaw:async()=>[],
  komitent:{
   findFirst:async args=>{
    assert.equal(args.where.agencija_id,'agency-a');
    return record.agencija_id==='agency-a'&&['AGENCY','COMPANY'].includes(record.scope)?{...record}:null;
   },
   updateMany:async({data})=>{mutations++;record.aktivan=data.aktivan;return{count:1};}
  }
 };
 const mocks={
  'next/cache':{revalidatePath(){}},
  'next/navigation':{redirect:url=>{throw new Error(`REDIRECT:${url}`);}},
  '@prisma/client':{Prisma:{sql:()=>({})}},
  '@/lib/auth':{requireAnyRole:async()=>({id:'user-a',rola:'korisnik_agencije',agencija_id:'agency-a'})},
  '@/lib/permissions':{hasPermission:async(_user,request)=>{
   assert.equal(request.firmaId,'company-a');assert.equal(request.modul,'nalozi');
   assert.ok(['delete','update'].includes(request.akcija));return allowed;
  }},
  '@/lib/prisma':{prisma:{$transaction:async fn=>{
   transactions++;const old=record.aktivan;
   try{return await fn(tx);}catch(e){record.aktivan=old;throw e;}
  }}},
  '@/lib/audit':{auditLogInTransaction:async(_tx,entry)=>{if(auditFails)throw new Error('audit failed');audits.push(entry);}}
 };
 for(const name of ['@/lib/account-plan','@/lib/journals','@/lib/opening-balance','@/lib/pdv','@/lib/payroll-journal','@/lib/bank-statement-lifecycle','@/app/agencija/plate/actions','@/lib/bank-manual-journal'])mocks[name]={};
 const action=sourceLoader(mocks)('src/app/agencija/nalozi/actions.ts').setPartnerActive;
 const submit=async(operation='delete')=>{
  const form=new FormData();
  for(const [key,val] of Object.entries({firma_id:'company-a',partner_id:'partner-a',operation,q:'02421833',scope:'AGENCY'}))form.set(key,val);
  let target='';try{await action(form);}catch(e){assert.match(e.message,/^REDIRECT:/);target=e.message;}
  return target;
 };
 return {record,audits,submit,get mutations(){return mutations;},get transactions(){return transactions;}};
}

test('partner removal and restoration preserve record identity and audit both transitions',async()=>{
 const f=fixture();
 assert.match(await f.submit(),/partner_obrisan/);assert.equal(f.record.aktivan,false);
 assert.equal(f.record.id,'partner-a');assert.equal(f.audits[0].akcija,'delete');
 assert.equal(f.audits[0].staraVrijednost.aktivan,true);
 assert.match(await f.submit('restore'),/partner_vracen/);assert.equal(f.record.aktivan,true);
 assert.equal(f.audits[1].akcija,'restore');
 await f.submit('restore');assert.equal(f.mutations,2);
});

test('partner removal rejects missing permission, foreign agency, global partner and unavailable company',async()=>{
 for(const options of [{allowed:false},{agency:'agency-b'},{scope:'GLOBAL'},{company:false}]){
  const f=fixture(options);assert.match(await f.submit(),/prava|partner_greska/);
  assert.equal(f.record.aktivan,true);assert.equal(f.mutations,0);assert.equal(f.audits.length,0);
 }
});

test('audit failure rolls back partner removal; arbitrary operations are rejected',async()=>{
 const f=fixture({auditFails:true});assert.match(await f.submit(),/partner_greska/);assert.equal(f.record.aktivan,true);
 const invalid=fixture();assert.match(await invalid.submit('purge'),/partner_greska/);assert.equal(invalid.transactions,0);
});
