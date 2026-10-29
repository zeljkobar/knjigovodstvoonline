/* eslint-disable @typescript-eslint/no-require-imports -- Source-loader regression. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const {dateTimeForMapr}=sourceLoader()('src/lib/mapr-request.ts');
const link=crtd=>'https://mapr.tax.gov.me/ic/#/verify?'+new URLSearchParams({iic:'A'.repeat(32),tin:'12345678',crtd,prc:'121.00'});
const payload={seller:{name:'Fixture',idNum:'12345678'},items:[{name:'Fixture',quantity:1,vatRate:21,priceBeforeVat:100,vatAmount:21,priceAfterVat:121}],totalPrice:121};

test('MAPR accepts whole seconds while fiscal instant and offset remain unchanged',()=>{
 for(const [input,expected] of [
  ['2026-10-28T23:35:52.000Z','2026-10-28T23:35:52Z'],
  ['2026-10-29T00:35:52.000+01:00','2026-10-29T00:35:52 01:00'],
  ['2026-06-12T10:00:00.000 02:00','2026-06-12T10:00:00 02:00'],
  ['2026-10-29T00:35:52+01:00','2026-10-29T00:35:52 01:00'],
  ['2026-10-29T00:35:52-03:00','2026-10-29T00:35:52-03:00']
 ]){
  assert.equal(dateTimeForMapr(input),expected);
  const instant=value=>new Date(value.replace(/ (\d{2}:\d{2})$/,'+$1')).getTime();
  assert.equal(instant(input),instant(expected));
 }
});

test('inventory and authenticated KUF preview send compatible dates and distinguish HTTP failures',async()=>{
 const previous=global.fetch;let calls=0,status=200,allowed=true;
 global.fetch=async(url,options)=>{
  calls++;assert.equal(url,'https://mapr.tax.gov.me/ic/api/verifyInvoice');
  assert.equal(new URLSearchParams(options.body).get('dateTimeCreated'),'2026-10-28T23:35:52Z');
  return status===200?Response.json(payload):new Response('',{status});
 };
 try{
  const load=sourceLoader({
   '@/lib/auth':{getCurrentUser:async()=>({rola:'admin_agencije'}),isDirectFiscalTenantUser:()=>false},
   '@/lib/permissions':{hasAnyPermission:async()=>allowed},
   '@/lib/work-context':{readWorkContext:async()=>({firmaId:'fixture'})}
  });
  const {fetchMaprInvoice}=load('src/lib/mapr-invoice.ts');
  const {POST}=load('src/app/api/mapr/verify/route.ts');
  const qrUrl=link('2026-10-28T23:35:52.000Z');
  assert.equal((await fetchMaprInvoice(qrUrl)).total,121);
  assert.equal((await (await POST({json:async()=>({qrUrl})})).json()).success,true);
  for(const code of [404,429,503]){
   status=code;
   await assert.rejects(()=>fetchMaprInvoice(qrUrl),error=>error.message.includes(`HTTP ${code}`));
   const response=await POST({json:async()=>({qrUrl})});
   assert.equal(response.status,502);assert.match((await response.json()).message,new RegExp(`HTTP ${code}`));
  }
  allowed=false;const before=calls;
  assert.equal((await POST({json:async()=>({qrUrl})})).status,403);assert.equal(calls,before);
 }finally{global.fetch=previous;}
});
