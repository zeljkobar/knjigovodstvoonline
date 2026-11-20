/* eslint-disable @typescript-eslint/no-require-imports -- A4 shared export rendering. */
const {test}=require('node:test'),assert=require('node:assert/strict'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {sourceLoader}=require('./helpers/source-loader.cjs');
function fixture(result){let audit=0;const load=sourceLoader({
 '@/lib/agency-fiscal-export':{loadAgencyFiscalExport:async params=>{assert.equal(params.okruzenje,'Test');return result;}},
 '@/lib/audit':{auditLog:async()=>{audit++;}},
 '@/components/PrintButton':{PrintButton:({label})=>React.createElement('button',{},label)},
 'next/link':{__esModule:true,default:({children,...props})=>{delete props.prefetch;return React.createElement('a',props,children);}}
 });return{page:load('src/app/stampa/pos/promet/page.tsx').default,audit:()=>audit};}
test('A4 renders complete shared totals, test label and original filter links without creating documents',async()=>{
 const filters={periodFrom:'2026-10-01',periodTo:'2026-10-31',environment:'Test',salesChannel:'OFFICE',registerId:'',buyer:'Kupac'};
 const report={totals:{ordinaryCount:1,correctionCount:1,salesGross:18150n,correctionsGross:-6050n,base:10000n,vat:2100n,gross:12100n},taxes:[],documents:[{id:'sale',date:new Date('2026-10-28T12:00Z'),officialNumber:'001',documentType:'INVOICE',channel:'OFFICE',register:'—',buyer:'<Kupac>',buyerTaxNumber:'00123456',base:15000n,vat:3150n,gross:18150n},{id:'correction',date:new Date('2026-10-29T12:00Z'),officialNumber:'002',documentType:'OFFICE_STORNO',channel:'OFFICE',register:'—',buyer:'<Kupac>',buyerTaxNumber:'00123456',base:-5000n,vat:-1050n,gross:-6050n}]};
 const f=fixture({context:{user:{id:'u',agencija_id:'a'},firma:{id:'f',naziv:'Firma',pib:'00001234'}},filters,report,generatedAt:new Date('2026-11-19Z')});
 const html=renderToStaticMarkup(await f.page({searchParams:Promise.resolve({okruzenje:'Test'})}));
 assert.match(html,/121,00/);assert.match(html,/-60,50/);assert.match(html,/Test/);assert.match(html,/&lt;Kupac&gt;/);assert.match(html,/2 dokumenata/);assert.match(html,/okruzenje=Test/);assert.match(html,/Štampaj \/ sačuvaj kao PDF/);assert.equal(f.audit(),1);
});
test('print denies inaccessible or oversized export without exposing data or auditing success',async()=>{
 const f=fixture({error:'Nemate pravo izvoza.',status:403});const html=renderToStaticMarkup(await f.page({searchParams:Promise.resolve({okruzenje:'Test'})}));assert.match(html,/Nemate pravo izvoza/);assert(!html.includes('<table'));assert.equal(f.audit(),0);
});
