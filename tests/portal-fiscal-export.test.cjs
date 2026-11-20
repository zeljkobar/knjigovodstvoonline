/* eslint-disable @typescript-eslint/no-require-imports -- Portal XLSX and CSV permission contract. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
function fixture({deny=false,invalid=false,large=false}={}) {
 let checks=0,reads=0,audits=[],writtenKind;
 const load=sourceLoader({
 '@/lib/direct-portal':{requireDirectPortalContext:async permission=>{checks++;assert.deepEqual(permission,{modul:'izvjestaji',akcija:'export'});if(deny)throw Error('DENIED');return{user:{id:'u',agencija_id:'a'},firma:{id:'f',naziv:'Firma',pib:'001'},year:{id:'y'}};}},
 '@/lib/fiscal-export-data':{loadBoundedFiscalExport:async(context,filters,kind)=>{reads++;assert(['promet','artikli','placanja','zurnal','korekcije','kupci','operateri','uredjaji','jedinice','avansi'].includes(kind));assert.equal(context.firma.id,'f');assert.equal(filters.environment,'Test');return large?null:{documents:[],advances:[],items:[],payments:[],channels:[]};}},
 '@/lib/direct-portal-reports':{parseDirectPortalReportKind:v=>['promet','artikli','placanja','zurnal','korekcije','kupci','operateri','uredjaji','jedinice','avansi'].includes(v)?v:null,parseDirectPortalReportFilters:()=>({environment:'Test',periodFrom:'2026-10-01',periodTo:'2026-10-31',invalidPeriod:invalid}),directPortalCsv:()=> 'CSV'},
 '@/lib/fiscal-report-xlsx':{fiscalReportWorkbook:(_r,_c,_d,kind)=>{writtenKind=kind;return Buffer.from('XLSX');}},
 '@/lib/audit':{auditLog:async q=>audits.push(q)}
 });
 return{GET:load('src/app/portal/izvjestaji/export/route.ts').GET,stats:()=>({checks,reads,audits,writtenKind})};
}
test('portal exports all supported XLSX kinds only with own portal export context and audit',async()=>{
 for(const kind of ['promet','artikli','placanja','zurnal','korekcije','kupci','operateri','uredjaji','jedinice','avansi']){const f=fixture();const response=await f.GET(new Request(`http://localhost/export?tip=${kind}&format=xlsx`));assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/spreadsheetml/);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(f.stats().writtenKind,kind);assert.equal(f.stats().audits[0].akcija,'export_xlsx');}
});
test('portal rejects rights, invalid periods, formats and oversized exports without success audit',async()=>{
 const denied=fixture({deny:true});await assert.rejects(denied.GET(new Request('http://localhost/export?tip=promet&format=xlsx')),/DENIED/);assert.equal(denied.stats().reads,0);
 for(const [options,query,status] of [[{invalid:true},'tip=promet&format=xlsx',400],[{},'tip=promet&format=exe',400],[{large:true},'tip=promet&format=xlsx',413]]) {const f=fixture(options);assert.equal((await f.GET(new Request('http://localhost/export?'+query))).status,status);assert.equal(f.stats().audits.length,0);}
 const csv=fixture();const response=await csv.GET(new Request('http://localhost/export?tip=promet'));assert.match(response.headers.get('Content-Type'),/text\/csv/);assert.equal(csv.stats().audits[0].akcija,'export_csv');
});
