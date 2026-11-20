/* eslint-disable @typescript-eslint/no-require-imports -- Workbook contract regression. */
const {test}=require('node:test'),assert=require('node:assert/strict'),XLSX=require('xlsx');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const writer=sourceLoader()('src/lib/fiscal-report-xlsx.ts');
test('real XLSX keeps numeric cents, leading zero IDs and text formulas; invoice totals are not repeated per line',()=>{
 const documents=[{id:'id',localNumber:'001',officialNumber:'OFFICIAL',date:new Date('2026-10-28T12:00Z'),documentType:'INVOICE',channel:'OFFICE',register:'—',buyer:'=SUM(A1:A9)',buyerTaxNumber:'00123456',iic:'IKOF',jikr:'JIKR',base:15000n,vat:3150n,gross:18150n,
 lines:[{code:'001',name:'@DANGEROUS',unit:'kom',quantity:1000n,base:10000n,vat:2100n,gross:12100n},{code:'002',name:'Usluga',unit:'kom',quantity:1000n,base:5000n,vat:1050n,gross:6050n}]}];
 const report={filters:{environment:'Production',periodFrom:'2026-01-01',periodTo:'2026-12-31',salesChannel:'',registerId:'',buyer:''},totals:{ordinaryCount:1,correctionCount:0,salesGross:18150n,correctionsGross:0n,base:15000n,vat:3150n,gross:18150n},documents,taxes:[{name:'PDV 21%',rate:'21',base:15000n,vat:3150n,gross:18150n}]};
 const bytes=writer.fiscalReportWorkbook(report,{naziv:'Firma',pib:'00112233'},new Date('2026-11-19Z'));
 const wb=XLSX.read(bytes,{type:'buffer'});
 assert.deepEqual(wb.SheetNames,['Sažetak','Računi','Stavke','PDV']);
 const rows=XLSX.utils.sheet_to_json(wb.Sheets['Računi'],{header:1});assert.equal(rows.length,2);
 assert.equal(wb.Sheets['Računi'].I2.t,'s');assert.equal(rows[1][8],'00123456');assert.equal(rows[1][13],181.5);
 assert.equal(wb.Sheets['Računi'].H2.f,undefined);assert.equal(wb.Sheets['Računi'].H2.t,'s');assert.equal(rows[1][7],'=SUM(A1:A9)');
 const lines=XLSX.utils.sheet_to_json(wb.Sheets.Stavke,{header:1});assert.equal(lines.length,3);assert.equal(lines[1][3],'001');assert.equal(lines[1][6],1);
 assert.equal(Math.round((lines[1][9]+lines[2][9])*100),18150);
});
test('article and payment workbooks have their own grouped sheets and preserve contribution semantics',()=>{
 const base={filters:{environment:'Test',periodFrom:'2026-10-01',periodTo:'2026-10-31',salesChannel:'POS',registerId:'',buyer:'',item:'Selected'},totals:{ordinaryCount:1,correctionCount:0,salesGross:1000n,correctionsGross:0n,base:1000n,vat:0n,gross:1000n},documents:[{id:'i',localNumber:'1',officialNumber:'1',date:new Date('2026-10-01Z'),documentType:'POS_RECEIPT',channel:'POS',register:'Kasa',buyer:'Kupac',buyerTaxNumber:'001',base:3000n,vat:0n,gross:3000n,reportAmount:1000n,lines:[]}],taxes:[],items:[{code:'001',name:'Selected',group:'Grupa',unit:'kom',quantity:1000n,invoiceCount:1,base:1000n,vat:0n,gross:1000n}],payments:[{method:'CARD',amount:1000n}]};
 const article=XLSX.read(writer.fiscalReportWorkbook(base,{naziv:'Firma',pib:'001'},new Date('2026-11-19Z'),'artikli'),{type:'buffer'});
 assert(article.Sheets.Artikli);assert.equal(article.Sheets.Artikli.A2.v,'001');assert.equal(article.Sheets.Artikli.I2.v,10);
 assert.equal(article.Sheets['Računi'].N2.v,30);assert.equal(article.Sheets['Računi'].O2.v,10);
 const payments=XLSX.read(writer.fiscalReportWorkbook(base,{naziv:'Firma',pib:'001'},new Date('2026-11-19Z'),'placanja'),{type:'buffer'});
 assert.equal(payments.Sheets['Plaćanja'].B2.v,10);assert.equal(payments.Sheets['Plaćanja'].A2.v,'Kartica');
});
test('corrective journal workbook exports original references as text and negative cents as numbers',()=>{
 const report={filters:{environment:'Production',periodFrom:'2026-01-01',periodTo:'2026-12-31'},totals:{ordinaryCount:0,correctionCount:1,salesGross:0n,correctionsGross:-18150n,base:-15000n,vat:-3150n,gross:-18150n},documents:[{id:'c',localNumber:'2',officialNumber:'CORRECTION',date:new Date('2026-10-01Z'),documentType:'OFFICE_STORNO',channel:'OFFICE',register:'',buyer:'Kupac',buyerTaxNumber:'001',iic:'I',jikr:'J',base:-15000n,vat:-3150n,gross:-18150n,originalNumber:'0001',originalIic:'=ORIGINAL',correctionReason:'Povrat',lines:[]}],taxes:[]};
 const wb=XLSX.read(writer.fiscalReportWorkbook(report,{naziv:'Firma',pib:'001'},new Date(),'korekcije'),{type:'buffer'});
 assert.equal(wb.Sheets['Računi'].N2.v,-181.5);assert.equal(wb.Sheets['Računi'].P2.v,'0001');
 assert.equal(wb.Sheets['Računi'].Q2.t,'s');assert.equal(wb.Sheets['Računi'].Q2.f,undefined);
});
