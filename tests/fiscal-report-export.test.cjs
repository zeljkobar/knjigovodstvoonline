/* eslint-disable @typescript-eslint/no-require-imports -- Export backend access guards. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
function route({channels=['OFFICE','POS'],context=true,oversized=false}={}) {
 let writes=0,reads=0,required;
 const load=sourceLoader({
  '@/lib/agency-fiscal-report':{getAgencyFiscalReportContext:async action=>{required=action;return context?{user:{id:'u',agencija_id:'a'},firma:{id:'f',naziv:'Firma',pib:'001'},year:{id:'y'},channels}:null;}},
  '@/lib/direct-portal-reports':{
   parseDirectPortalReportFilters:params=>({periodFrom:'2026-01-01',periodTo:'2026-12-31',invalidPeriod:params.od==='invalid',salesChannel:params.kanal||'',environment:'Production'}),
   reportWhere:()=>({agencija_id:'a',firma_id:'f'}),loadDirectPortalReport:async()=>({documents:[]})
  },
  '@/lib/prisma':{prisma:{$transaction:async(fn,options)=>{assert.equal(options.isolationLevel,'RepeatableRead');reads++;return fn({fiskalniIzlazniRacun:{count:async q=>{assert.equal(q.where.firma_id,'f');return oversized?5001:1;}},stavkaIzlazneFakture:{count:async q=>{assert.equal(q.where.izlazna_faktura.agencija_id,'a');return 2;}}});}}},
  '@/lib/fiscal-report-xlsx':{fiscalReportWorkbook:()=>Buffer.from('xlsx')},'@/lib/audit':{auditLog:async()=>{writes++;}}
 });
 return{GET:load('src/app/agencija/pos/promet/export/route.ts').GET,stats:()=>({reads,writes,required})};
}
test('export denies absent rights, unauthorized channel and invalid period before data reads',async()=>{
 for(const [settings,query,status] of [[{context:false},'',403],[{channels:['POS']},'kanal=OFFICE',403],[{channels:['POS']},'',403],[{},'od=invalid',400]]){
 const f=route(settings),response=await f.GET(new Request('http://localhost/export?'+query));assert.equal(response.status,status);assert.equal(f.stats().reads,0);assert.equal(f.stats().writes,0);assert.equal(f.stats().required,'export');}
});
test('large export fails without partial workbook; successful export is audited and private',async()=>{
 const big=route({oversized:true});assert.equal((await big.GET(new Request('http://localhost/export'))).status,413);assert.equal(big.stats().writes,0);
 const ok=route();const response=await ok.GET(new Request('http://localhost/export'));assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.match(response.headers.get('Content-Type'),/spreadsheetml/);assert.equal(ok.stats().writes,1);
});
