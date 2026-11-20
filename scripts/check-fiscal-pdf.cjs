/* eslint-disable @typescript-eslint/no-require-imports -- Real Chromium PDF render with synthetic data only. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {sourceLoader}=require('../tests/helpers/source-loader.cjs');
const output=process.env.FISCAL_PDF_QA_DIR||'/tmp/fiscal-pdf-qa';fs.mkdirSync(output,{recursive:true});
(async()=>{
 const pdf=sourceLoader()('src/lib/fiscal-pdf.ts');
 const documents=Array.from({length:34},(_,i)=>({id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,localNumber:`001-${i}`,officialNumber:`ox123/${i+1}/2026/enu`,date:new Date('2026-10-28T12:00Z'),documentType:i===33?'OFFICE_STORNO':'INVOICE',channel:'OFFICE',register:'Kancelarija',buyer:'Željko Đuranović — čćšžđ i vrlo dugačak naziv kupca za provjeru preloma redova',buyerTaxNumber:'00123456',iic:'E64475783C24DAF61E645A5DF46DB217',jikr:`3490fc6f-039c-436a-8c2b-${String(i).padStart(12,'0')}`,base:i===33?-15000n:15000n,vat:i===33?-3150n:3150n,gross:i===33?-18150n:18150n,lines:[{code:'001',name:'Računovodstvene usluge <script>alert(1)</script>',unit:'kom',quantity:1000n,base:i===33?-15000n:15000n,vat:i===33?-3150n:3150n,gross:i===33?-18150n:18150n}]}));
 const report={filters:{environment:'Test',periodFrom:'2026-10-01',periodTo:'2026-10-31',salesChannel:'',registerId:'',buyer:''},totals:{ordinaryCount:33,correctionCount:1,salesGross:598950n,correctionsGross:-18150n,base:480000n,vat:100800n,gross:580800n},documents,taxes:[{name:'PDV 21%',rate:'21',base:480000n,vat:100800n,gross:580800n}]};
 const reportHtml=pdf.fiscalReportHtml(report,{naziv:'Summa — PDF provjera čćšžđ',pib:'00112233'},new Date('2026-11-20T12:00Z'),'zurnal');assert(!reportHtml.includes('<script>alert'));
 const bytes=await pdf.htmlPdf(reportHtml);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');fs.writeFileSync(path.join(output,'izvjestaj.pdf'),bytes);
 const remote={id:'api-invoice',companyId:'api-company',environment:'Test',currency:'EUR',invoiceType:'Normal',status:'Fiscalized',officialInvoiceNumber:'ox123/111/2026/enu',iic:'IKOF123',jikr:'JIKR123',qrCodeData:'https://mapr.tax.gov.me/ic/#/verify?iic=TEST&tin=00112233',issueDateTime:'2026-10-28T12:00Z',buyer:{name:'Željko Đuranović',identificationNumber:'00123456',address:'Adresa 10',town:'Bar'},items:[{name:'Računovodstvene usluge',itemCode:'001',unitOfMeasure:'kom',quantity:1,unitPrice:150,vatRate:21,discountAmount:0,netAmount:150,vatAmount:31.5,grossAmount:181.5}],payments:[{paymentType:'Account',amount:181.5}],totalNetAmount:150,totalVatAmount:31.5,totalGrossAmount:181.5};
 const invoice=sourceLoader({'./fiscal-admin-api':{fiscalAdminApi:{getInvoice:async()=>({data:remote})}}})('src/lib/fiscal-invoice-pdf.ts');
 const file=await invoice.fiscalInvoicePdf({fiscal_api_invoice_id:'api-invoice',fiscal_environment:'Test',iic:'IKOF123',jikr:'JIKR123',issuer_snapshot:{naziv:'Summa Summarum čćšžđ',pib:'00112233',adresa:'Ulica 1',grad:'Bar',ziroRacun:'530-001-13'},interni_broj:'IF-001',firma:{fiscalCompanyLink:{fiscal_api_company_id:'api-company'}}},{id:'test',name:'test'});fs.writeFileSync(path.join(output,'faktura.pdf'),file.bytes);
 const canvas=require('@napi-rs/canvas');global.DOMMatrix=canvas.DOMMatrix;global.ImageData=canvas.ImageData;global.Path2D=canvas.Path2D;
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
 for(const filename of ['izvjestaj','faktura']){
   const doc=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(path.join(output,filename+'.pdf'))),useSystemFonts:true}).promise;
   assert(doc.numPages>=1);console.log(filename,doc.numPages,'pages');
   for(const n of [...new Set([1,Math.min(2,doc.numPages),doc.numPages])]){const page=await doc.getPage(n),viewport=page.getViewport({scale:1.25});const image=canvas.createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));await page.render({canvasContext:image.getContext('2d'),viewport,canvas:image}).promise;fs.writeFileSync(path.join(output,`${filename}-${n}.png`),image.toBuffer('image/png'));}
   const first=await (await doc.getPage(1)).getTextContent();assert(first.items.some(x=>x.str?.includes(filename==='faktura'?'Faktura':'Sažetak')));await doc.cleanup();
 }
 console.log('Actual PDF generation and PDF.js rasterization PASS:',output);
})().catch(e=>{console.error(e);process.exitCode=1;});
