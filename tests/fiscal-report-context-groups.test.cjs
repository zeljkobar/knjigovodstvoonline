/* eslint-disable @typescript-eslint/no-require-imports -- Historical group and export contracts. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const {fiscalContextRows}=sourceLoader()('src/lib/fiscal-report-context-groups.ts');
const context=(extra={})=>({apiCompanyId:'company',environment:'Test',businessUnitCode:'UNIT',deviceCode:'001',operatorCode:'OP',...extra});
const doc=(extra={})=>({id:'i',localNumber:'1',officialNumber:'1',date:new Date('2026-10-01Z'),documentType:'INVOICE',channel:'OFFICE',register:'',buyer:'Kupac',buyerTaxNumber:'001',lines:[],paymentMethods:[],correction:false,base:100n,vat:21n,gross:121n,fiscalContext:context(),...extra});
const report=(documents)=>({filters:{environment:'Test',periodFrom:'2026-01-01',periodTo:'2026-12-31'},documents,totals:{count:documents.length,ordinaryCount:documents.filter(d=>!d.correction).length,correctionCount:documents.filter(d=>d.correction).length,salesGross:documents.filter(d=>!d.correction).reduce((s,d)=>s+d.gross,0n),correctionsGross:documents.filter(d=>d.correction).reduce((s,d)=>s+d.gross,0n),base:documents.reduce((s,d)=>s+d.base,0n),vat:documents.reduce((s,d)=>s+d.vat,0n),gross:documents.reduce((s,d)=>s+d.gross,0n)},taxes:[]});
test('historical group sums include unknown documents and assign correction to its own operator',()=>{
 const documents=[doc(),doc({id:'c',correction:true,base:-40n,vat:-8n,gross:-48n,fiscalContext:context({operatorCode:'RETURN-OP'})}),doc({id:'legacy',fiscalContext:null})];
 for(const kind of ['operateri','uredjaji','jedinice']) {
  const rows=fiscalContextRows(documents,kind);assert.equal(rows.reduce((s,r)=>s+r.gross,0n),194n);assert.equal(rows.reduce((s,r)=>s+r.ordinaryCount+r.correctionCount,0),3);
  assert.equal(rows.at(-1).historical,false);assert.equal(rows.at(-1).gross,121n);
 }
 const operators=fiscalContextRows(documents,'operateri');assert.equal(operators.find(r=>r.code==='OP').gross,121n);assert.equal(operators.find(r=>r.code==='RETURN-OP').gross,-48n);
});
test('ENU identity includes unit, API company and environment; unit and operator grouping use their own codes',()=>{
 const documents=[doc(),doc({id:'unit',fiscalContext:context({businessUnitCode:'OTHER'})}),doc({id:'company',fiscalContext:context({apiCompanyId:'other-company'})}),doc({id:'env',fiscalContext:context({environment:'Production'})})];
 assert.equal(fiscalContextRows(documents,'uredjaji').length,4);
 assert.equal(fiscalContextRows(documents,'operateri').length,3);
 assert.equal(fiscalContextRows([doc(),doc({fiscalContext:context({deviceCode:'OTHER'})})],'jedinice').length,1);
});
test('XLSX grouped sheets preserve leading zeros, text input and exact money, including unknown group',()=>{
 const XLSX=require('xlsx');const {fiscalReportWorkbook}=sourceLoader()('src/lib/fiscal-report-xlsx.ts');
 const data=report([doc({fiscalContext:context({operatorCode:'=FORMULA'})}),doc({id:'missing',fiscalContext:null})]);
 for(const [kind,sheet] of [['operateri','Operateri'],['uredjaji','ENU uređaji'],['jedinice','Poslovne jedinice']]) {
  const wb=XLSX.read(fiscalReportWorkbook(data,{naziv:'Firma',pib:'001'},new Date(),kind),{type:'buffer'}),ws=wb.Sheets[sheet];assert(ws);assert.equal(ws.A2.t,'s');assert.equal(ws.A2.f,undefined);assert.equal(ws.J2.v,1.21);assert.equal(ws.A3.v,'Nije evidentirano');
  if(kind==='uredjaji')assert.equal(ws.A2.v,'001');
 }
});
test('group screen computes full period before 50-row pagination and clamps the authorized channel',async()=>{
 const {renderToStaticMarkup}=require('react-dom/server');let reads=0;
 const docs=Array.from({length:55},(_,i)=>doc({id:String(i),fiscalContext:context({operatorCode:'OP-'+i})}));
 const load=sourceLoader({
 '@/lib/fiscal-report-detail':{loadReportRegisters:async()=>[]},
 '@/lib/agency-fiscal-report':{getAgencyFiscalReportContext:async()=>({user:{agencija_id:'a'},firma:{id:'f'},year:{id:'y'},channels:['POS']})},
 '@/lib/direct-portal-reports':{parseDirectPortalReportFilters:()=>({salesChannel:'OFFICE',environment:'Test'}),directPortalReportQuery:()=> 'okruzenje=Test&kanal=POS'},
 '@/lib/fiscal-export-data':{loadBoundedFiscalExport:async(c,f,k)=>{reads++;assert.equal(c.firma.id,'f');assert.equal(f.salesChannel,'POS');assert.equal(k,'operateri');return report(docs);}}
 });
 const {FiscalGroupedReportPage}=load('src/components/FiscalBuyerReportPage.tsx');
 const html=renderToStaticMarkup(await FiscalGroupedReportPage({params:{strana:'2'},kind:'operateri'}));
 assert.equal(reads,1);assert(html.includes('55 dokumenata'));assert(html.includes('Strana 2 od 2'));assert.equal((html.match(/Snimak prvog slanja/g)||[]).length,5);assert(html.includes('tip=operateri'));
});
test('A4 prints grouped ENU and unknown coverage with the same export filter',async()=>{
 const {renderToStaticMarkup}=require('react-dom/server');let audits=[];
 const data=report([doc(),doc({id:'legacy',fiscalContext:null})]);
 const load=sourceLoader({
 '@/lib/fiscal-report-detail':{loadReportRegisters:async()=>[]},
 '@/lib/agency-fiscal-export':{loadAgencyFiscalExport:async params=>{assert.equal(params.tip,'uredjaji');return{context:{user:{agencija_id:'a',id:'u'},firma:{id:'f',naziv:'Firma',pib:'001'}},filters:data.filters,report:data,generatedAt:new Date(),kind:'uredjaji'};}},
 '@/lib/audit':{auditLog:async value=>audits.push(value)}
 });
 const Print=load('src/app/stampa/pos/promet/page.tsx').default;
 const html=renderToStaticMarkup(await Print({searchParams:Promise.resolve({tip:'uredjaji'})}));
 assert(html.includes('Promet po ENU uređajima'));assert(html.includes('Bez istorijskog konteksta: 1'));assert(html.includes('Jedinica: UNIT'));assert(html.includes('tip=uredjaji'));assert.equal(audits[0].novaVrijednost.tip,'uredjaji');
});
test('portal CSV carries grouped codes and totals under its export permission and audit',async()=>{
 for(const kind of ['operateri','uredjaji','jedinice']) {
  let exported,audit;
  const data=report([doc(),doc({id:'missing',fiscalContext:null})]);
  const load=sourceLoader({
 '@/lib/fiscal-report-detail':{loadReportRegisters:async()=>[]},
   '@/lib/direct-portal':{requireDirectPortalContext:async permission=>{assert.equal(permission.akcija,'export');return{user:{id:'u',agencija_id:'a'},firma:{id:'f'},year:{id:'y'}};}},
   '@/lib/direct-portal-reports':{parseDirectPortalReportKind:v=>v,parseDirectPortalReportFilters:()=>data.filters,directPortalCsv:rows=>{exported=rows;return'CSV';},directPortalReportChannelLabels:{},directPortalReportDocumentLabels:{},directPortalReportPaymentLabels:{}},
   '@/lib/fiscal-export-data':{loadBoundedFiscalExport:async(c,f,k)=>{assert.equal(c.firma.id,'f');assert.equal(k,kind);return data;}},
   '@/lib/audit':{auditLog:async value=>{audit=value;}}
  });
  const {GET}=load('src/app/portal/izvjestaji/export/route.ts');
  const result=await GET(new Request('http://localhost/export?tip='+kind));assert.equal(result.status,200);
  const index=exported.findIndex(row=>row[0]==='Fiskalni kod');assert(index>=0);assert.equal(exported[index+2][0],'Nije evidentirano');assert.equal(exported[index+1][9],'1,21');assert.equal(audit.novaVrijednost.tip,kind);
 }
});
