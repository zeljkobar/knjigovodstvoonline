/* eslint-disable @typescript-eslint/no-require-imports -- Real PostgreSQL regression; fixtures roll back. */
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
if(!process.env.TEST_DATABASE_URL||!/_test(?:_|$)/.test(new URL(process.env.TEST_DATABASE_URL).pathname))throw Error('Isolated TEST_DATABASE_URL required');
process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{PrismaClient}=require('@prisma/client');
const {sourceLoader,transactionProxy}=require('../tests/helpers/source-loader.cjs');
const db=new PrismaClient(),rollback=Error('ROLLBACK_FOREIGN_POSTING'),date=s=>new Date(s+'T00:00:00Z');
const form=o=>{const f=new FormData();for(const[k,v]of Object.entries(o))f.set(k,String(v));return f;};
async function call(action,o){try{await action(form(o));throw Error('No redirect')}catch(e){if(!e.message.startsWith('REDIRECT:'))throw e;return e.message}}
(async()=>{try{await db.$transaction(async tx=>{
 const agency=await tx.agencija.create({data:{naziv:'Foreign accounts QA'}}),other=await tx.agencija.create({data:{naziv:'Other agency QA'}});
 const template=await tx.firma.create({data:{agencija_id:agency.id,naziv:'Template QA',pdv_obveznik:true}}),firm=await tx.firma.create({data:{agencija_id:agency.id,naziv:'Target QA',pdv_obveznik:true}});
 const year=await tx.poslovnaGodina.create({data:{firma_id:firm.id,godina:2026,datum_od:date('2026-01-01'),datum_do:date('2026-12-31')}});
 const admin=await tx.korisnik.create({data:{agencija_id:agency.id,rola:'admin_agencije',korisnicko_ime:randomUUID(),lozinka_hash:'disabled'}}),worker=await tx.korisnik.create({data:{agencija_id:agency.id,rola:'korisnik_agencije',korisnicko_ime:randomUUID(),lozinka_hash:'disabled'}});
 const foreignUser=await tx.korisnik.create({data:{agencija_id:other.id,rola:'admin_agencije',korisnicko_ime:randomUUID(),lozinka_hash:'disabled'}});
 const kind=await tx.vrstaNaloga.create({data:{agencija_id:agency.id,sifra:randomUUID(),naziv:'QA',prefiks:'QA'}});
 const rate=await tx.pdvStopa.create({data:{agencija_id:agency.id,sifra:'R21',naziv:'21%',procenat:'21'}});
 const domestic=await tx.komitent.create({data:{agencija_id:agency.id,scope:'AGENCY',naziv:'Domestic QA'}}),foreign=await tx.komitent.create({data:{agencija_id:agency.id,scope:'AGENCY',naziv:'Foreign QA',is_foreign:true,country_code:'DE',foreign_tax_number:'QA123'}});
 for(const company of [template,firm])for(const code of ['2020','2030','4330','4340','2031','4341','6000','5000','4700','2700'])await tx.firmaKonto.create({data:{firma_id:company.id,sifra:code,naziv:'QA '+code,tip_konta:'analiticko',analitika_obavezna:['2020','2030','4330','4340','2031','4341'].includes(code)}});
 await tx.firmaKonto.create({data:{firma_id:template.id,sifra:'2099',naziv:'Disabled QA',tip_konta:'analiticko',aktivan:false,override_type:'DEACTIVATED'}});
 let user=admin,currentFirm=template.id;
 const mocks={'@/lib/prisma':{prisma:transactionProxy(tx)},'@/lib/auth':{requireRole:async role=>{if(user.rola!==role)throw Error('ROLE_DENIED');return user},requireAnyRole:async roles=>{if(!roles.includes(user.rola))throw Error('ROLE_DENIED');return user}},'@/lib/work-context':{readWorkContext:async()=>({firmaId:currentFirm,poslovnaGodinaId:year.id})},'next/cache':{revalidatePath(){}},'next/headers':{headers:async()=>new Map()},'next/navigation':{redirect:u=>{throw Error('REDIRECT:'+u)}}};
 const load=sourceLoader(mocks),actions=load('src/app/agencija/racuni/actions.ts'),helper=load('src/lib/posting-template.ts'),post=load('src/lib/invoice-book-posting.ts').postInvoiceBookInContext;
 const foreignField=load('src/lib/account-plan.ts').invoicePostingForeignTotalField;
 const makeType=(company,doc)=>tx.racunVrsta.create({data:{agencija_id:agency.id,firma_id:company,dokument_tip:doc,sifra:doc,naziv:doc,vrsta_naloga_id:company===template.id?kind.id:null}});
 const execution={agencyId:agency.id,companyId:firm.id,yearId:year.id,userId:admin.id};
 const setting=(type,doc,foreignCode)=>({racun_vrsta_id:type.id,vrsta_naloga_id:kind.id,sifra_konta_UKUPAN_IZNOS:doc==='KIF'?'2020':'4330',sifra_konta_OSNOVICA_R21:doc==='KIF'?'6000':'5000',konto_izvor_OSNOVICA_R21:'FIXED',sifra_konta_PDV_R21:doc==='KIF'?'4700':'2700',[`sifra_konta_${foreignField}`]:foreignCode});
 let bookSequence=0;
 for(const doc of ['KIF','KUF']){
  const kif=doc==='KIF',sourceType=await makeType(template.id,doc),localType=await makeType(firm.id,doc),foreignCode=kif?'2030':'4340';
  const saved=setting(sourceType,doc,'');currentFirm=template.id;
  assert.match(await call(actions.saveInvoicePostingRules,saved),/sema_sacuvana/,'domestic-only setup remains valid');
  assert.equal(await tx.racunKontiranjePravilo.count({where:{racun_vrsta_id:sourceType.id,polje_sifra:foreignField}}),0);
  for(const code of ['bad-code','2099'])assert.match(await call(actions.saveInvoicePostingRules,{...saved,[`sifra_konta_${foreignField}`]:code}),/sema_ino_konto/);
  user=foreignUser;assert.match(await call(actions.saveInvoicePostingRules,saved),/sema_vrsta/);user=worker;await assert.rejects(call(actions.saveInvoicePostingRules,saved),/ROLE_DENIED/);user=admin;
  const scope={agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id};
  await tx.agencijaKnjizenjeTemplate.upsert({where:{agencija_id:agency.id},create:{agencija_id:agency.id,firma_id:template.id},update:{firma_id:template.id}});
  const n=++bookSequence;
  const book=await tx[kif?'kifBook':'kufBook'].create({data:{...scope,racun_vrsta_id:localType.id,redni_broj:n,mjesec:6,[kif?'internal_kif_number':'internal_kuf_number']:doc+'-QA',[kif?'kif_date':'kuf_date']:date('2026-06-30')}});
  let entrySequence=0;
  const makeEntry=(partner,amount='121',extra={})=>{
   const number=++entrySequence,negative=amount.startsWith('-');
   return tx[kif?'kifEntry':'kufEntry'].create({data:{...scope,[kif?'kif_book_id':'kuf_book_id']:book.id,[kif?'kupac_id':'dobavljac_id']:partner.id,redni_broj:number,[kif?'internal_kif_number':'internal_kuf_number']:doc+'-ENTRY-'+number,[kif?'customer_invoice_number':'supplier_invoice_number']:'QA-'+number,invoice_date:date('2026-06-12'),...(!kif?{receipt_date:date('2026-06-12')}:{sep_automation:true}),total_base:negative?'-100':'100',total_gross:amount,...(kif?{total_output_vat:negative?'-21':'21'}:{total_input_vat:negative?'-21':'21',deductible_vat:negative?'-21':'21'}),...extra,tax_lines:{create:{vat_rate_id:rate.id,vat_rate_code:'R21',vat_rate_name:'21%',vat_rate_percent:'21',tax_base:negative?'-100':'100',...(kif?{output_vat_amount:negative?'-21':'21'}:{input_vat_amount:negative?'-21':'21',deductible_vat_amount:negative?'-21':'21'}),total_with_vat:amount}}}});
  };
  // Domestic + foreign in one book. Explicit VAT type deliberately disagrees with nationality.
  const domesticEntry=await makeEntry(domestic,'121',{vat_transaction_type:kif?'EXPORT':'IMPORT'}),foreignEntry=await makeEntry(foreign,'121',{vat_transaction_type:'DOMESTIC'});
  let result=await post({documentType:doc,bookId:book.id,finalize:true},execution);
  assert.equal(result.reason,'knjizenje_ino_konto');assert.match(result.detail,/Foreign QA/);
  assert.equal(await tx.nalog.count({where:{izvorni_dokument_id:book.id}}),0,'failure rolls back journal and earlier domestic entry');
  assert.equal((await tx[kif?'kifEntry':'kufEntry'].findUniqueOrThrow({where:{id:domesticEntry.id}})).posting_status,'UNPOSTED');
  const failingSave=sourceLoader({...mocks,'@/lib/audit':{auditLogInTransaction:async()=>{throw Error('AUDIT_FAILURE')}}})('src/app/agencija/racuni/actions.ts');
  await assert.rejects(call(failingSave.saveInvoicePostingRules,{...saved,[`sifra_konta_${foreignField}`]:foreignCode}),/AUDIT_FAILURE/);
  assert.equal(await tx.racunKontiranjePravilo.count({where:{racun_vrsta_id:sourceType.id,polje_sifra:foreignField}}),0);
  assert.match(await call(actions.saveInvoicePostingRules,{...saved,[`sifra_konta_${foreignField}`]:foreignCode}),/sema_sacuvana/);
  assert.equal((await helper.effectiveInvoiceType(tx,firm.id,localType.id)).kontiranjePravila.find(r=>r.polje_sifra===foreignField).sifra_konta,foreignCode);
  // Deactivation is checked in the target company, not the source/template.
  await tx.firmaKonto.updateMany({where:{firma_id:firm.id,sifra:foreignCode},data:{aktivan:false}});
  assert.equal((await post({documentType:doc,bookId:book.id,finalize:true},execution)).reason,'knjizenje_konto');
  await tx.firmaKonto.updateMany({where:{firma_id:firm.id,sifra:foreignCode},data:{aktivan:true}});
  await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:true}});assert.equal((await post({documentType:doc,bookId:book.id},execution)).reason,'knjizenje_kontekst');await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:false}});
  const period=await tx.pdvPeriod.create({data:{...scope,mjesec:6,datum_od:date('2026-06-01'),datum_do:date('2026-06-30'),status:'LOCKED'}});
  assert.equal((await post({documentType:doc,bookId:book.id},execution)).reason,'knjizenje_period');await tx.pdvPeriod.update({where:{id:period.id},data:{status:'OPEN'}});await tx.pdvPeriod.delete({where:{id:period.id}});
  assert.equal((await post({documentType:doc,bookId:book.id},{...execution,userId:worker.id})).reason,'knjizenje_kontekst');
  await assert.rejects(post({documentType:doc,bookId:book.id},{...execution,agencyId:other.id}),/INVOICE_ACCESS_DENIED/);
  result=await post({documentType:doc,bookId:book.id,finalize:true},execution);assert.equal(result.ok,true,JSON.stringify(result));
  const journalId=result.journalId,lines=()=>tx.stavkaNaloga.findMany({where:{nalog_id:journalId},include:{firma_konto:true}});
  let rows=await lines();assert.equal(rows.length,6,'foreign companion never doubles the gross amount');
  assert.equal(rows.find(l=>l.komitent_id===domestic.id&&l.firma_konto.sifra===(kif?'2020':'4330'))[kif?'duguje':'potrazuje'].toString(),'121');
  assert.equal(rows.find(l=>l.komitent_id===foreign.id&&l.firma_konto.sifra===foreignCode)[kif?'duguje':'potrazuje'].toString(),'121');
  assert.ok(rows.every(l=>l.firma_konto.firma_id===firm.id));
  assert.equal(rows.reduce((s,l)=>s+Math.round(Number(l.duguje)*100)-Math.round(Number(l.potrazuje)*100),0),0);
  assert.equal((await tx[kif?'kifEntry':'kufEntry'].findUniqueOrThrow({where:{id:foreignEntry.id}})).vat_transaction_type,'DOMESTIC');
  const before=rows.map(l=>l.id).sort();
  // A local override takes priority. Later invoices append to the existing POSTED journal.
  const override=kif?'2031':'4341';currentFirm=firm.id;
  assert.match(await call(actions.saveInvoicePostingRules,setting(localType,doc,override)),/sema_sacuvana/);
  const reversal=await makeEntry(foreign,'-121');
  result=await post({documentType:doc,bookId:book.id,finalize:true},execution);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.journalId,journalId);
  rows=await lines();assert.ok(before.every(id=>rows.some(l=>l.id===id)),'old posted entries remain unchanged');
  assert.equal(rows.find(l=>l.firma_konto.sifra===override)[kif?'duguje':'potrazuje'].toString(),'-121');
  assert.equal((await tx[kif?'kifEntry':'kufEntry'].findUniqueOrThrow({where:{id:reversal.id}})).journal_id,journalId);
  assert.equal(await tx.nalog.count({where:{izvorni_dokument_id:book.id}}),1);
  assert.equal((await helper.effectiveInvoiceType(tx,firm.id,localType.id)).kontiranjePravila.find(r=>r.polje_sifra===foreignField).sifra_konta,override);
  // Removing the override resumes live template inheritance.
  assert.match(await call(actions.saveInvoicePostingRules,setting(localType,doc,'')),/sema_sacuvana/);
  assert.equal((await helper.effectiveInvoiceType(tx,firm.id,localType.id)).kontiranjePravila.find(r=>r.polje_sifra===foreignField).sifra_konta,foreignCode);
 }
 // Existing settings-copy and purge paths automatically include the companion rule.
 const copiedFirm=await tx.firma.create({data:{agencija_id:agency.id,naziv:'Copied settings QA'}});currentFirm=copiedFirm.id;
 assert.match(await call(actions.importInvoiceSettingsFromCompany,{source_firma_id:template.id}),/uvoz_podesavanja_sacuvana/);
 const copiedRules=await tx.racunKontiranjePravilo.findMany({where:{racun_vrsta:{firma_id:copiedFirm.id},polje_sifra:foreignField}});assert.equal(copiedRules.length,2);
 assert.deepEqual(copiedRules.map(r=>r.sifra_konta).sort(),['2030','4340']);
 await load('src/lib/company-purge.ts').purgeCompanyData(tx,{agencijaId:agency.id,firmaId:copiedFirm.id,potvrdaNaziva:copiedFirm.naziv,korisnikId:admin.id});
 assert.equal(await tx.racunKontiranjePravilo.count({where:{id:{in:copiedRules.map(r=>r.id)}}}),0);
 assert.equal(await tx.racunKontiranjePravilo.count({where:{racun_vrsta:{firma_id:template.id},polje_sifra:foreignField}}),2);
 console.log('PASS foreign KIF/KUF: save/validation, mixed partners, VAT independence, no double gross, template/live override/copy, append/negative amounts, locks/scope/rights, audit rollback, purge');
 throw rollback;
},{timeout:90000})}catch(e){if(e!==rollback)throw e}finally{await db.$disconnect()}})().catch(e=>{console.error(e);process.exitCode=1});
