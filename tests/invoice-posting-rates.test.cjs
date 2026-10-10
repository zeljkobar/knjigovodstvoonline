const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const {buildOutgoingInvoicePostingLines:build}=sourceLoader()('src/lib/outgoing-invoice.ts');
const rule=(namjena,rate,code)=>({namjena,pdv_stopa_sifra:rate,sifra_konta:code,smjer:namjena==='INVOICE_CUSTOMER'?'D':'P'});
const settings=[rule('INVOICE_CUSTOMER','GENERAL','2010'),rule('INVOICE_REVENUE','GENERAL','6000'),rule('INVOICE_OUTPUT_VAT','GENERAL','4700'),rule('INVOICE_REVENUE','CUSTOM_RATE','6010'),rule('INVOICE_OUTPUT_VAT','CUSTOM_RATE','4710')];
const lines=[{pdv_stopa_sifra:'R21',osnovica:'100',pdv_iznos:'21'},{pdv_stopa_sifra:'CUSTOM_RATE',osnovica:'200',pdv_iznos:'24.68'},{pdv_stopa_sifra:'CUSTOM_RATE',osnovica:'1',pdv_iznos:'0.12'},{pdv_stopa_sifra:'ZERO',osnovica:'10',pdv_iznos:'0'}];
test('Arbitrary rate codes split both revenue and VAT without duplicate GENERAL posting',()=>{
 const result=build({settings,lines,gross:35680n,cogs:0n});
 assert.deepEqual(result.map(r=>[r.code,r.amount]),[['2010',35680n],['6000',11000n],['4700',2100n],['6010',20100n],['4710',2480n]]);
 assert.equal(result.reduce((sum,r)=>sum+(r.direction==='D'?r.amount:-r.amount),0n),0n);
});
test('An explicit unconfigured rate or missing coverage blocks posting',()=>{
 assert.equal(build({settings:[...settings,rule('INVOICE_OUTPUT_VAT','R21','')],lines,gross:35680n,cogs:0n}),null);
 assert.equal(build({settings:settings.filter(r=>r.namjena!=='INVOICE_OUTPUT_VAT'||r.pdv_stopa_sifra!=='GENERAL'),lines,gross:35680n,cogs:0n}),null);
});
test('Legacy GENERAL rules still cover all rates; reversals preserve exact recorded amounts',()=>{
 const result=build({settings:settings.filter(r=>r.pdv_stopa_sifra==='GENERAL'),lines:lines.map(r=>({...r,osnovica:String(-Number(r.osnovica)),pdv_iznos:String(-Number(r.pdv_iznos))})),gross:-35680n,cogs:0n});
 assert.deepEqual(result.map(r=>[r.code,r.amount]),[['2010',-35680n],['6000',-31100n],['4700',-4580n]]);
});
