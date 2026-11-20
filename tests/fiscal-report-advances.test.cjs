/* eslint-disable @typescript-eslint/no-require-imports -- Separate advance evidence and export regression. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const {fiscalAdvanceRows}=sourceLoader()('src/lib/fiscal-report-advances.ts');
const source={id:'advance',number:'AV-1',buyer:'Kupac',buyerId:'buyer',gross:24200n,status:'Fiscalized'};
const usage=(extra={})=>({id:'final',avansni_racun_id:'advance',kupac_id:'buyer',iznos_avansa:'100.00',ukupno_sa_pdv:'363.00',fiscal_status:'Fiscalized',fiscal_environment:'Test',valuta:'EUR',is_deleted:false,document_type:'INVOICE',vrsta_racuna:'NORMAL',sales_channel:'OFFICE',fiscal_api_invoice_id:'remote-final',jikr:'J',official_invoice_number:'FINAL',interni_broj:'FINAL',avans_umanjenje:null,...extra});
const settlement={status:'Fiscalized',remoteId:'settlement',jikr:'SET-J',iic:'SET-I',officialInvoiceNumber:'SET-1',allocations:[{advanceItemId:'item',grossAmount:100}]};
test('advance usage and reduction are distinct; drafts are not assumed to reserve API balance',()=>{
 const [row]=fiscalAdvanceRows([source],[usage(),usage({id:'draft',fiscal_status:'DRAFT',iznos_avansa:'20.00'}),usage({id:'done',avans_umanjenje:settlement})],'Test');
 assert.equal(row.used,20000n);assert.equal(row.settled,10000n);assert.equal(row.unsettled,10000n);assert.equal(row.pending,2000n);assert(row.review);assert.equal(row.links[2].settlementNumber,'SET-1');assert.equal(row.remaining,undefined);assert.equal(row.reserved,undefined);
});
test('storno, deleted, wrong buyer/environment/currency and malformed reduction stay for review',()=>{
 for(const patch of [{fiscal_status:'StornoCreated'},{is_deleted:true},{kupac_id:'other'},{fiscal_environment:'Production'},{valuta:'USD'},{iznos_avansa:'500.00'}]) {
 const [row]=fiscalAdvanceRows([source],[usage(patch)],'Test');assert.equal(row.used,0n);assert.equal(row.settled,0n);assert(row.review);if(patch.valuta)assert.equal(row.pending,0n);
 }
 for(const state of [{...settlement,status:'Prepared'},{...settlement,jikr:null},{...settlement,allocations:[{advanceItemId:'item',grossAmount:99}]},{}]) {
 const [row]=fiscalAdvanceRows([source],[usage({avans_umanjenje:state})],'Test');assert.equal(row.settled,0n);assert.equal(row.unsettled,10000n);
 }
});
test('loader binds advances to active year and usages to selected source IDs across years in same tenant',async()=>{
 const queries=[];
 const invoice={id:'advance',kupac_id:'buyer',fiscal_status:'Fiscalized',vrsta_racuna:'ADVANCE',document_type:'INVOICE',sales_channel:'OFFICE',issued_at:new Date('2026-10-01Z'),interni_broj:'AV-1',broj_racuna:'AV-1',kupac:{naziv:'Kupac',pib:'001'},ukupno_osnovica:'200',ukupno_izlazni_pdv:'42',ukupno_sa_pdv:'242',stavke:[],poreske_stavke:[],placanja:[],pos_register:null};
 const load=sourceLoader({'@/lib/prisma':{prisma:{fiskalniIzlazniRacun:{findMany:async q=>{queries.push(q);return q.where.avansni_racun_id?[usage()]:[invoice];}}}}});
 const reports=load('src/lib/direct-portal-reports.ts');
 const c={user:{agencija_id:'a'},firma:{id:'f'},year:{id:'y'}};
 const f=reports.parseDirectPortalReportFilters({od:'2026-10-01',do:'2026-10-31',okruzenje:'Test'},{datum_od:new Date('2026-01-01Z'),datum_do:new Date('2026-12-31Z')});
 const data=await reports.loadDirectPortalReport(c,f,'avansi');
 assert.equal(queries[0].where.vrsta_racuna,'ADVANCE');assert.equal(queries[0].where.poslovna_godina_id,'y');assert.equal(queries[0].where.fiscal_environment,'Test');
 assert.equal(queries[1].where.agencija_id,'a');assert.equal(queries[1].where.firma_id,'f');assert.deepEqual(queries[1].where.avansni_racun_id.in,['advance']);assert.equal(queries[1].where.poslovna_godina_id,undefined);
 assert.equal(data.documents.length,1);assert.equal(data.totals.gross,24200n);assert.equal(data.advances[0].used,10000n);
});
test('usage cap rejects a large linked set before loading documents',async()=>{
 let count=0,loaded=false;
 const load=sourceLoader({'./prisma':{prisma:{$transaction:async(fn,opts)=>{assert.equal(opts.isolationLevel,'RepeatableRead');return fn({fiskalniIzlazniRacun:{count:async()=>++count===1?1:5001},stavkaIzlazneFakture:{count:async()=>1}});}}},'./direct-portal-reports':{reportWhere:()=>({agencija_id:'a',firma_id:'f'}),loadDirectPortalReport:async()=>{loaded=true;}}});
 const result=await load('src/lib/fiscal-export-data.ts').loadBoundedFiscalExport({user:{agencija_id:'a'},firma:{id:'f'}},{},'avansi');assert.equal(result,null);assert.equal(loaded,false);
});
test('advance workbook and A4 explain current evidence without adding final turnover or claiming availability',()=>{
 const {fiscalReportWorkbook}=sourceLoader()('src/lib/fiscal-report-xlsx.ts'),XLSX=require('xlsx');
 const data={filters:{environment:'Test',periodFrom:'2026-10-01',periodTo:'2026-10-31'},totals:{ordinaryCount:1,correctionCount:0,salesGross:24200n,correctionsGross:0n,base:20000n,vat:4200n,gross:24200n},documents:[],taxes:[],advances:fiscalAdvanceRows([source],[usage({avans_umanjenje:settlement})],'Test')};
 const wb=XLSX.read(fiscalReportWorkbook(data,{naziv:'Firma',pib:'001'},new Date(),'avansi'),{type:'buffer'});assert.equal(wb.Sheets.Avansi.C2.v,242);assert.equal(wb.Sheets.Avansi.D2.v,100);assert.equal(wb.Sheets['Korišćenja avansa'].E2.v,'Korišćenje i umanjenje potvrđeni');
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');const {FiscalAdvanceTable}=sourceLoader()('src/components/FiscalAdvanceTable.tsx');const html=renderToStaticMarkup(React.createElement(FiscalAdvanceTable,{report:data}));assert(html.includes('nije istorijski saldo'));assert(html.includes('rezervacije nijesu potvrđeni'));assert(html.includes('SET-J'));
});
