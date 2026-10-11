/* eslint-disable @typescript-eslint/no-require-imports -- Rollback regression with simulated MAPR. */
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PrismaClient}=require('@prisma/client');
const {sourceLoader,transactionProxy}=require('../tests/helpers/source-loader.cjs');
const db=new PrismaClient(),rollback=new Error('ROLLBACK_MAPR_CACHE');
const originalFetch=global.fetch;
(async()=>{try {await db.$transaction(async tx=>{
 const agency=await tx.agencija.create({data:{naziv:'MAPR cache QA'}});
 const firm=await tx.firma.create({data:{agencija_id:agency.id,naziv:'MAPR cache fixture'}});
 const year=await tx.poslovnaGodina.create({data:{firma_id:firm.id,godina:2026,datum_od:new Date('2026-01-01Z'),datum_do:new Date('2026-12-31Z')}});
 const admin=await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
 const rt=await tx.racunVrsta.create({data:{agencija_id:agency.id,firma_id:firm.id,dokument_tip:'KUF',sifra:'TEST',naziv:'QA'}});
 const book=await tx.kufBook.create({data:{agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id,racun_vrsta_id:rt.id,redni_broj:1,internal_kuf_number:'KUF-QA',mjesec:6,kuf_date:new Date('2026-06-01Z')}});
 await tx.firmaKonto.create({data:{firma_id:firm.id,sifra:'5000',naziv:'Trošak',tip_konta:'analiticko'}});
 await tx.pdvStopa.create({data:{agencija_id:agency.id,sifra:'R21',naziv:'PDV21',procenat:'21'}});
 let user=admin,context={firmaId:firm.id,poslovnaGodinaId:year.id},allowed=true,calls=0,offline=false;
 const link=iic=>'https://mapr.tax.gov.me/ic/#/verify?'+new URLSearchParams({iic,tin:'01234567',crtd:'2026-06-12T10:00:00+02:00',prc:'121.00'});
 global.fetch=async(url,options)=>{
  assert.equal(url,'https://mapr.tax.gov.me/ic/api/verifyInvoice');calls++;
  if(offline) throw Error('MAPR unavailable');
  const q=new URLSearchParams(options.body);
  return Response.json({seller:{name:'QA supplier',idNum:q.get('tin')},iic:q.get('iic'),dateTimeCreated:'2026-06-12T10:00:00+02:00',invoiceNumber:q.get('iic')+'/2026',sameTaxes:[{vatRate:21,priceBeforeVat:100,vatAmount:21}],totalPriceToPay:121});
 };
 const mocks={'server-only':{},'@/lib/prisma':{prisma:transactionProxy(tx)},'@/lib/auth':{getCurrentUser:async()=>user,isDirectFiscalTenantUser:()=>false},'@/lib/work-context':{readWorkContext:async()=>context},'@/lib/permissions':{hasPermission:async()=>allowed},'next/headers':{headers:async()=>new Map()}};
 // New loader instances emulate independent requests/workers: nothing depends on process memory.
 const request=async(links,extra={})=>{
  const route=sourceLoader(mocks)('src/app/api/racuni/import/route.ts');
  const response=await route.POST({json:async()=>({documentType:'KUF',bookId:book.id,links,...extra})});
  return {status:response.status,...await response.json()};
 };
 let result=await request([link('A')]);assert.equal(result.results[0].requiresAccount,true);assert.equal(calls,1);
 assert.equal(await tx.maprImportPodatak.count({where:{firma_id:firm.id}}),1);
 assert.equal(await tx.kufEntry.count({where:{firma_id:firm.id}}),0);
 offline=true;
 result=await request([link('A')],{supplierAccountCodes:{'01234567':'9999'}});assert.equal(result.results[0].requiresAccount,true);assert.equal(calls,1);
 result=await request([link('A').replace('#/verify?','?')],{supplierAccountCodes:{'01234567':'5000'},invoices:[{total:1}]});
 assert.equal(result.results[0].status,'success');assert.equal(calls,1);
 let entry=await tx.kufEntry.findFirstOrThrow({where:{firma_id:firm.id}});assert.equal(String(entry.total_gross),'121');
 assert.equal(await tx.kufEntryTaxLine.count({where:{kuf_entry_id:entry.id}}),1);
 assert.equal(await tx.maprImportPodatak.count({where:{firma_id:firm.id}}),0);
 assert.equal((await request([link('A')])).results[0].status,'duplicate');assert.equal(calls,1);
 // Missing external responses remain retryable and are never cached.
 assert.equal((await request([link('B')])).results[0].status,'error');assert.equal(calls,2);
 assert.equal(await tx.maprImportPodatak.count({where:{firma_id:firm.id}}),0);
 offline=false;assert.equal((await request([link('B')])).results[0].status,'success');assert.equal(calls,3);
 // A cached invoice with a corrected VAT configuration also resumes offline.
 const rate=await tx.pdvStopa.findFirstOrThrow({where:{agencija_id:agency.id}});
 await tx.pdvStopa.update({where:{id:rate.id},data:{aktivna:false}});
 assert.equal((await request([link('C')])).results[0].status,'error');assert.equal(calls,4);
 assert.equal(await tx.maprImportPodatak.count({where:{firma_id:firm.id}}),1);
 await tx.pdvStopa.update({where:{id:rate.id},data:{aktivna:true}});offline=true;
 assert.equal((await request([link('C')])).results[0].status,'success');assert.equal(calls,4);
 assert.equal(await tx.maprImportPodatak.count({where:{firma_id:firm.id}}),0);
 // Failure after KUF creation must roll back both creation and snapshot consumption.
 offline=false;await tx.pdvStopa.update({where:{id:rate.id},data:{aktivna:false}});
 await request([link('D')]);const pending=await tx.maprImportPodatak.findFirstOrThrow({where:{firma_id:firm.id}});
 await tx.pdvStopa.update({where:{id:rate.id},data:{aktivna:true}});offline=true;
 const realAudit=sourceLoader(mocks)('src/lib/audit.ts').auditLogInTransaction;
 mocks['@/lib/audit']={auditLogInTransaction:async(t,data)=>{if(data.akcija==='mapr_cache_consumed')throw Error('QA audit failure');return realAudit(t,data);}};
 await assert.rejects(()=>request([link('D')]),/QA audit failure/);
 assert.equal(await tx.kufEntry.count({where:{firma_id:firm.id,fiscal_iic:'D'}}),0);
 assert.ok(await tx.maprImportPodatak.findUnique({where:{id:pending.id}}));delete mocks['@/lib/audit'];
 // Also remove leftovers on the fast duplicate path without fetching MAPR.
 await tx.maprImportPodatak.create({data:{agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id,fiskalni_kljuc:'A|01234567|2026-06-12T08:00:00.000Z',podaci:{unused:true},created_by:admin.id}});
 assert.equal((await request([link('A')])).results[0].status,'duplicate');
 assert.equal(await tx.maprImportPodatak.count({where:{firma_id:firm.id}}),1);
 // A different authorised company cannot reuse another company’s snapshot.
 const other=await tx.firma.create({data:{agencija_id:agency.id,naziv:'Other cached scope'}});
 const otherYear=await tx.poslovnaGodina.create({data:{firma_id:other.id,godina:2026,datum_od:new Date('2026-01-01Z'),datum_do:new Date('2026-12-31Z')}});
 const otherType=await tx.racunVrsta.create({data:{agencija_id:agency.id,firma_id:other.id,dokument_tip:'KUF',sifra:'TEST',naziv:'QA'}});
 const otherBook=await tx.kufBook.create({data:{agencija_id:agency.id,firma_id:other.id,poslovna_godina_id:otherYear.id,racun_vrsta_id:otherType.id,redni_broj:1,internal_kuf_number:'KUF-QA',mjesec:6,kuf_date:new Date('2026-06-01Z')}});
 context={firmaId:other.id,poslovnaGodinaId:otherYear.id};
 assert.equal((await request([link('A')],{bookId:otherBook.id})).results[0].status,'error');assert.equal(calls,6);
 context={firmaId:firm.id,poslovnaGodinaId:year.id};
 // The one-time migration removes historical duplicates, preserving pending/foreign data.
 await tx.maprImportPodatak.create({data:{agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id,fiskalni_kljuc:'A|01234567|2026-06-12T08:00:00.000Z',podaci:{unused:true},created_by:admin.id}});
 await tx.maprImportPodatak.create({data:{agencija_id:agency.id,firma_id:other.id,poslovna_godina_id:otherYear.id,fiskalni_kljuc:'A|01234567|2026-06-12T08:00:00.000Z',podaci:{pending:true},created_by:admin.id}});
 await tx.$executeRawUnsafe(require('node:fs').readFileSync('prisma/migrations/20261012090000_mapr_import_cleanup/migration.sql','utf8'));
 assert.equal(await tx.maprImportPodatak.count({where:{firma_id:firm.id}}),1);
 assert.ok(await tx.maprImportPodatak.findUnique({where:{id:pending.id}}));
 assert.equal(await tx.maprImportPodatak.count({where:{firma_id:other.id}}),1);
 // Cached payloads never bypass rights, year or book checks.
 allowed=false;assert.equal((await request([link('C')])).status,403);allowed=true;
 await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:true}});assert.equal((await request([link('C')])).status,400);
 await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:false}});
 await tx.kufBook.update({where:{id:book.id},data:{status:'POSTED'}});assert.equal((await request([link('C')])).status,400);await tx.kufBook.update({where:{id:book.id},data:{status:'OPEN'}});
 user={...admin,rola:'korisnik_agencije'};assert.equal((await request([link('C')])).status,400);user=admin;
 user={...admin,agencija_id:randomUUID()};assert.equal((await request([link('C')])).status,400);user=admin;
 context={firmaId:firm.id,poslovnaGodinaId:randomUUID()};assert.equal((await request([link('C')])).status,400);context={firmaId:firm.id,poslovnaGodinaId:year.id};
 assert.equal(calls,6);
 assert.equal(await tx.auditLog.count({where:{firma_id:firm.id,akcija:'mapr_read'}}),4);
 await sourceLoader(mocks)('src/lib/company-purge.ts').purgeCompanyData(tx,{agencijaId:agency.id,firmaId:firm.id,potvrdaNaziva:firm.naziv,korisnikId:admin.id});
 assert.equal(await tx.maprImportPodatak.count({where:{firma_id:firm.id}}),0);
 assert.equal(await tx.kufEntry.count({where:{firma_id:firm.id}}),0);
 console.log('PASS MAPR cache lifecycle, atomic consumption and duplicate cleanup: one fetch, offline account/VAT retry, URL identity, trusted amounts, duplicates, locks, rights, scope, audit and company purge');
 throw rollback;
 },{timeout:60000});}catch(e){if(e!==rollback)throw e;}finally{global.fetch=originalFetch;await db.$disconnect();}})().catch(e=>{console.error(e);process.exitCode=1;});
