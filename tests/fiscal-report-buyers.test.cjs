/* eslint-disable @typescript-eslint/no-require-imports -- Historical buyer grouping regression. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const {fiscalBuyerRows,fiscalBuyerSnapshot}=sourceLoader()('src/lib/fiscal-report-buyers.ts');
const doc=(extra={})=>({id:'i',buyerId:'b',buyer:'Stari naziv',buyerTaxNumber:'001',buyerHistorical:true,correction:false,base:100n,vat:21n,gross:121n,...extra});
test('buyer grouping preserves exact cents, corrections, stable identity and historical versions',()=>{
 const documents=[doc(),doc({id:'c',correction:true,base:-40n,vat:-8n,gross:-48n}),doc({id:'other',buyerId:'another'}),doc({id:'version',buyer:'Novi naziv'}),doc({id:'fallback',buyerHistorical:false})];
 const rows=fiscalBuyerRows(documents);assert.equal(rows.length,4);
 const original=rows.find(row=>row.name==='Stari naziv'&&row.historical&&row.correctionCount===1);
 assert.equal(original.sales,121n);assert.equal(original.corrections,-48n);assert.equal(original.gross,73n);
 assert.equal(rows.reduce((sum,row)=>sum+row.gross,0n),documents.reduce((sum,row)=>sum+row.gross,0n));
 assert.equal(original.base+original.vat,original.gross);
});
test('snapshot never borrows changed tax number; legacy fallback is explicit',()=>{
 const current={naziv:'Današnji naziv',pib:'999',foreign_tax_number:null};
 assert.deepEqual(fiscalBuyerSnapshot({naziv:'Istorijski',pib:null},current),{name:'Istorijski',taxNumber:'',historical:true});
 assert.deepEqual(fiscalBuyerSnapshot({naziv:'Ino',foreignTaxNumber:'DE001'},current),{name:'Ino',taxNumber:'DE001',historical:true});
 assert.deepEqual(fiscalBuyerSnapshot(null,current),{name:'Današnji naziv',taxNumber:'999',historical:false});
});
test('buyer screen forces permitted channel and groups whole snapshot before pagination',async()=>{
 const {renderToStaticMarkup}=require('react-dom/server');let loaded;
 const load=sourceLoader({
 '@/lib/fiscal-report-detail':{loadReportRegisters:async()=>[]},
 '@/lib/agency-fiscal-report':{getAgencyFiscalReportContext:async()=>({user:{agencija_id:'a'},firma:{id:'f'},year:{id:'y'},channels:['POS']})},
 '@/lib/direct-portal-reports':{parseDirectPortalReportFilters:()=>({salesChannel:'OFFICE',environment:'Test'}),directPortalReportQuery:()=> 'okruzenje=Test&kanal=POS'},
 '@/lib/fiscal-export-data':{loadBoundedFiscalExport:async(context,filters,kind)=>{loaded={context,filters,kind};return{documents:[doc()],totals:{count:1,gross:121n}};}}
 });
 const {FiscalBuyerReportPage}=load('src/components/FiscalBuyerReportPage.tsx');
 const html=renderToStaticMarkup(await FiscalBuyerReportPage({params:{kanal:'OFFICE'}}));
 assert.equal(loaded.context.firma.id,'f');assert.equal(loaded.filters.salesChannel,'POS');assert.equal(loaded.kind,'kupci');assert(html.includes('Stari naziv'));assert(html.includes('tip=kupci'));
 const denied=sourceLoader({'@/lib/agency-fiscal-report':{getAgencyFiscalReportContext:async()=>null},'@/lib/fiscal-export-data':{loadBoundedFiscalExport:()=>{throw Error('MUST NOT READ');}}})('src/components/FiscalBuyerReportPage.tsx');
 await denied.FiscalBuyerReportPage({params:{}});
});
test('buyer workbook keeps leading zero PIB and exact grouped monetary values',()=>{
 const XLSX=require('xlsx');const {fiscalReportWorkbook}=sourceLoader()('src/lib/fiscal-report-xlsx.ts');
 const report={filters:{environment:'Test',periodFrom:'2026-01-01',periodTo:'2026-12-31'},documents:[doc({localNumber:'1',officialNumber:'1',date:new Date('2026-10-01Z'),documentType:'INVOICE',channel:'OFFICE',register:'',lines:[]})],totals:{ordinaryCount:1,correctionCount:0,salesGross:121n,correctionsGross:0n,base:100n,vat:21n,gross:121n},taxes:[]};
 const wb=XLSX.read(fiscalReportWorkbook(report,{naziv:'Firma',pib:'001'},new Date(),'kupci'),{type:'buffer'});
 assert.equal(wb.Sheets.Kupci.B2.v,'001');assert.equal(wb.Sheets.Kupci.B2.t,'s');assert.equal(wb.Sheets.Kupci.J2.v,1.21);
});
