/* eslint-disable @typescript-eslint/no-require-imports -- Durable delivery and privacy regression tests. */
const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const context={surface:'PORTAL',user:{id:'user',agencija_id:'agency'},firma:{id:'firm'},year:{id:'year'},channels:['OFFICE']};
function queueFixture({allowed=true,auditFails=false}={}){
 let row={id:'draft',agencija_id:'agency',firma_id:'firm',poslovna_godina_id:'year',povrsina:'PORTAL',korisnik_id:'user',status:'DRAFT',prilog:Buffer.from('pdf'),expires_at:new Date(Date.now()+86400000),sha256:'hash',izvor:{type:'invoice',channels:['OFFICE'],partnerKey:'partner'}};let contacts=0;
 const tx={$executeRaw:async()=>{},fiskalnaDostava:{count:async()=>0,updateMany:async q=>{assert.equal(q.where.firma_id,'firm');if(row.status!==q.where.status)return{count:0};row={...row,...q.data};return{count:1};}},fiskalniKontakt:{count:async()=>0,updateMany:async()=>{},create:async()=>{contacts++;return{id:'contact'};}}};
 const service=sourceLoader({'./prisma':{prisma:{fiskalnaDostava:{findFirst:async q=>{assert.equal(q.where.agencija_id,'agency');assert.equal(q.where.firma_id,'firm');return row;}},$transaction:async fn=>{const old=row,before=contacts;try{return await fn(tx);}catch(e){row=old;contacts=before;throw e;}}}},'./fiscal-delivery-context':{deliveryAllowed:async()=>allowed},'./audit':{auditLogInTransaction:async()=>{if(auditFails)throw Error('AUDIT');}}})('src/lib/fiscal-delivery.ts');
 return{service,state:()=>({row,contacts})};
}
function form(){const f=new FormData();f.set('primalac','Buyer@Example.test');f.set('naslov','Faktura 001');f.set('poruka','U prilogu.');return f;}
test('explicit queue commits recipient snapshot once; double click cannot queue a second send or save contacts by default',async()=>{
 const f=queueFixture();await f.service.queueDelivery(context,'draft',form());assert.equal(f.state().row.status,'QUEUED');assert.equal(f.state().row.primalac,'buyer@example.test');assert.equal(f.state().contacts,0);await assert.rejects(f.service.queueDelivery(context,'draft',form()));
});
test('denied rights and audit failure leave draft and contacts unchanged',async()=>{
 const denied=queueFixture({allowed:false});await assert.rejects(denied.service.queueDelivery(context,'draft',form()),/NEMA_PRAVA/);
 const f=queueFixture({auditFails:true}),data=form();data.set('save_contact','on');data.set('contact_name','Računovodstvo');await assert.rejects(f.service.queueDelivery(context,'draft',data),/AUDIT/);assert.equal(f.state().row.status,'DRAFT');assert.equal(f.state().contacts,0);
});
test('header injection and multi-recipient text are rejected; repeat requires an explicit terminal status and acknowledgement',async()=>{
 const f=queueFixture();for(const value of ['a@example.test\r\nBcc:x@example.test','a@example.test,b@example.test','Name <a@example.test>'])assert.throws(()=>f.service.singleEmail(value));await assert.rejects(f.service.repeatDelivery(context,'draft',true));
});
function workerFixture({allowed=true,error=null,partial=false}={}){
 let row={id:'job',korisnik_id:'user',agencija_id:'agency',firma_id:'firm',status:'QUEUED',prilog:Buffer.from('pdf'),sha256:createHash('sha256').update('pdf').digest('hex'),expires_at:new Date(Date.now()+86400000),primalac:'a@example.test',naslov:'Invoice',poruka:'Message',naziv:'invoice.pdf',mime:'application/pdf'};let sends=0;
 const tx={fiskalnaDostava:{findFirst:async()=>row.status==='QUEUED'?row:null,updateMany:async q=>{if(q.where.id&&q.where.status===row.status){row={...row,...q.data};return{count:1};}return{count:0};}}};
 const worker=sourceLoader({'./prisma':{rawPrisma:{$transaction:async fn=>fn(tx),fiskalnaDostava:{findMany:async()=>[],updateMany:async()=>({count:0})}}},'./fiscal-delivery-context':{queuedDeliveryAllowed:async()=>allowed},'./audit':{auditLogInTransaction:async()=>{}},'./email':{SYSTEM_EMAIL_FROM:'System <system@example.test>'},nodemailer:{createTransport:()=>({close:()=>{},sendMail:async data=>{sends++;assert.equal(data.attachments[0].content.toString(),'pdf');assert.equal(data.from,'System <system@example.test>');if(error)throw error;return{messageId:'smtp-message',accepted:['a@example.test'],rejected:partial?['copy@example.test']:[]};}})}})('src/lib/fiscal-delivery-worker.ts');return{worker,state:()=>({row,sends})};
}
test('worker rechecks author rights, never resends a completed claim and preserves ambiguous SMTP outcomes',async()=>{
 const env={...process.env};Object.assign(process.env,{FISCAL_MAIL_ENABLED:'true',SMTP_HOST:'fixture.invalid',SMTP_PORT:'587',SMTP_USER:'fixture',SMTP_PASS:'fixture'});
 try{
 const denied=workerFixture({allowed:false});await denied.worker.runFiscalDeliveryOnce();assert.equal(denied.state().sends,0);assert.equal(denied.state().row.status,'BLOCKED');
 const accepted=workerFixture();await accepted.worker.runFiscalDeliveryOnce();await accepted.worker.runFiscalDeliveryOnce();assert.equal(accepted.state().sends,1);assert.equal(accepted.state().row.status,'ACCEPTED');
 const unknown=workerFixture({error:{code:'ECONNRESET'}});await unknown.worker.runFiscalDeliveryOnce();await unknown.worker.runFiscalDeliveryOnce();assert.equal(unknown.state().row.status,'UNKNOWN');assert.equal(unknown.state().sends,1);
 const failed=workerFixture({error:{responseCode:550}});await failed.worker.runFiscalDeliveryOnce();assert.equal(failed.state().row.status,'FAILED');
 const partial=workerFixture({partial:true});await partial.worker.runFiscalDeliveryOnce();assert.equal(partial.state().row.status,'UNKNOWN');
 }finally{for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);}
});
test('PDF report escapes customer strings and renders money from shared Excel sheets with exact decimals',()=>{
 const pdf=sourceLoader()('src/lib/fiscal-pdf.ts');const report={filters:{environment:'Test',periodFrom:'2026-01-01',periodTo:'2026-12-31'},totals:{ordinaryCount:1,correctionCount:0,salesGross:18150n,correctionsGross:0n,base:15000n,vat:3150n,gross:18150n},documents:[{id:'id',localNumber:'001',officialNumber:'official',date:new Date('2026-10-01Z'),documentType:'INVOICE',channel:'OFFICE',register:'',buyer:'<script>x</script>',buyerTaxNumber:'001',base:15000n,vat:3150n,gross:18150n,lines:[]}],taxes:[]};const html=pdf.fiscalReportHtml(report,{naziv:'Firma',pib:'001'},new Date(),'promet');assert.match(html,/181,50/);assert.match(html,/TESTNO OKRUŽENJE/);assert.doesNotMatch(html,/<script>x/);assert.match(html,/&lt;script&gt;/);
});
test('invoice PDF refuses mismatched API identity and unconfirmed or inconsistent amounts before rendering',async()=>{
 const local={fiscal_api_invoice_id:'id',fiscal_environment:'Test',jikr:'jikr',iic:'iic',issuer_snapshot:{naziv:'Firm',pib:'001'},interni_broj:'001',firma:{fiscalCompanyLink:{fiscal_api_company_id:'company'}}};
 const base={id:'id',companyId:'company',environment:'Test',currency:'EUR',status:'Fiscalized',officialInvoiceNumber:'001',iic:'iic',jikr:'jikr',qrCodeData:'https://example.test/verify',buyer:{name:'Buyer'},items:[{grossAmount:10}],payments:[{amount:10}],totalNetAmount:10,totalVatAmount:0,totalGrossAmount:10};let renders=0;
 for(const extra of [{companyId:'foreign'},{environment:'Production'},{status:'Draft'},{totalGrossAmount:20}]){const module=sourceLoader({'./fiscal-admin-api':{fiscalAdminApi:{getInvoice:async()=>({data:{...base,...extra}})}},'./fiscal-pdf':{htmlEscape:String,htmlPdf:async()=>{renders++;},pdfDocument:()=>''}})('src/lib/fiscal-invoice-pdf.ts');await assert.rejects(module.fiscalInvoicePdf(local,{id:'user',name:'user'}));}assert.equal(renders,0);
});
test('attachment route reauthorizes current scope and does not expose unavailable bytes',async()=>{
 let bytesRead=0;const route=sourceLoader({'@/lib/fiscal-delivery-context':{deliveryContext:async surface=>{assert.equal(surface,'PORTAL');return context;}},'@/lib/fiscal-delivery':{authorizedDelivery:async()=>{bytesRead++;throw Error('FOREIGN_OR_REVOKED');}}})('src/app/api/fiskalne-dostave/[id]/route.ts');const response=await route.GET(new Request('http://localhost/api/fiskalne-dostave/foreign?povrsina=PORTAL'),{params:Promise.resolve({id:'foreign'})});assert.equal(response.status,404);assert.equal(bytesRead,1);assert.equal(await response.text(),'Prilog nije dostupan.');
});
test('mail page render only prepares UI; company-scoped contact/history reads do not send or queue mail',async()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');let reads=0;
 const page=sourceLoader({'@/lib/fiscal-delivery-context':{deliveryContext:async()=>({...context,firma:{...context.firma,naziv:'Firm',pib:'001'},year:{id:'year',datum_od:new Date('2026-01-01'),datum_do:new Date('2026-12-31')}}),deliveryBase:()=>'/portal/dostava',deliveryAllowed:async()=>true},'@/lib/fiscal-delivery-worker':{fiscalMailConfigured:()=>false},'@/lib/prisma':{prisma:{fiskalniKontakt:{findMany:async q=>{reads++;assert.equal(q.where.firma_id,'firm');return[];}},fiskalnaDostava:{findMany:async q=>{reads++;assert.equal(q.where.agencija_id,'agency');assert.equal(q.select.prilog,undefined);return[];}}}},'next/link':{__esModule:true,default:({children,prefetch,...props})=>React.createElement('a',props,children)}})('src/components/FiscalDeliveryPage.tsx');
 const html=renderToStaticMarkup(await page.FiscalDeliveryPage({surface:'PORTAL',query:{tip:'promet'},action:async()=>{throw Error('MUST_NOT_SEND_DURING_RENDER');}}));assert.equal(reads,2);assert.match(html,/Pripremi prilog \(bez slanja\)/);assert.match(html,/Dodaj opšti kontakt firme/);assert.match(html,/Istorija dostava/);
});
