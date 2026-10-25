/* eslint-disable @typescript-eslint/no-require-imports */
// Actual PostgreSQL + actual actions/report loaders. Fixtures always roll back.
// Only session, Next response handling and UI wrappers are replaced; no external API.
require('@next/env').loadEnvConfig(process.cwd(), false, {info(){},error(){}});
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {PrismaClient} = require('@prisma/client');
const React = require('react');
const {sourceLoader,transactionProxy} = require('../tests/helpers/source-loader.cjs');
const db = new PrismaClient();
const rollback = new Error('ROLLBACK_KUF_DELETION');
const date = s=>new Date(s+'T00:00:00Z');
const form = data=>{const f=new FormData();for(const [k,v] of Object.entries(data)) for(const value of [].concat(v)) f.append(k,String(value));return f;};
async function response(action,data) {
  try { await action(form(data)); throw new Error('Expected redirect'); }
  catch(error) { if(!error.message.startsWith('REDIRECT:')) throw error; return decodeURIComponent(error.message); }
}
(async()=>{
 try { await db.$transaction(async tx=>{
  const agency=await tx.agencija.create({data:{naziv:'Accounting regression'}});
  const foreignAgency=await tx.agencija.create({data:{naziv:'Foreign regression'}});
  const firm=await tx.firma.create({data:{agencija_id:agency.id,naziv:'Ledger fixture',pdv_obveznik:true}});
  const other=await tx.firma.create({data:{agencija_id:foreignAgency.id,naziv:'Foreign fixture'}});
  const makeYear=f=>tx.poslovnaGodina.create({data:{firma_id:f,godina:2026,datum_od:date('2026-01-01'),datum_do:date('2026-12-31')}});
  const year=await makeYear(firm.id), foreignYear=await makeYear(other.id);
  const admin=await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
  const worker=await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'korisnik_agencije'}});
  const client=await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'klijent'}});
  for(const u of [worker,client]) await tx.korisnikFirma.create({data:{firma_id:firm.id,korisnik_id:u.id}});
  const partner=await tx.komitent.create({data:{agencija_id:agency.id,firma_id:firm.id,naziv:'Buyer fixture',is_foreign:true}});
  const type=await tx.vrstaNaloga.create({data:{sifra:randomUUID(),naziv:'Fixture journal',prefiks:'TEST',agencija_id:agency.id}});
  const accounts={};
  for(const code of ['2010','4300','6000','5000','2600','2700','2410']) accounts[code]=await tx.firmaKonto.create({data:{firma_id:firm.id,sifra:code,naziv:'Fixture '+code,tip_konta:'analiticko',analitika_obavezna:code==='2010'||code==='4300'}});
  const scope={agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id};
  let user=admin,context={firmaId:firm.id,poslovnaGodinaId:year.id};
  const load=sourceLoader({
   'server-only':{}, '@/lib/prisma':{prisma:transactionProxy(tx)},
   '@/lib/auth':{getCurrentUser:async()=>user,isDirectFiscalTenantUser:()=>false,requireAnyRole:async roles=>{if(!roles.includes(user.rola))throw new Error('DENIED_ROLE');return user;}},
   '@/lib/work-context':{readWorkContext:async()=>context},
   'next/cache':{revalidatePath(){}},'next/headers':{headers:async()=>new Map()},
   'next/navigation':{redirect(url){throw new Error('REDIRECT:'+url);},notFound(){throw new Error('NOT_FOUND');}},
   'next/link':{__esModule:true,default:({children,...p})=>React.createElement('a',p,children)},
   '@/components/AutoSubmitFilterForm':{AutoSubmitFilterForm:({children})=>React.createElement('form',{},children)},
   '@/components/BalanceLevelCheckboxes':{BalanceLevelCheckboxes:()=>null}
  });
  const invoices=load('src/app/agencija/racuni/actions.ts');
  const pdv=load('src/lib/pdv-service.ts');
  const rate=await tx.pdvStopa.create({data:{agencija_id:agency.id,sifra:'R21',naziv:'21%',procenat:'21'}});
  let entryNumber=0,bookNumber=0;
  const makeBook=async(kind,month=6,deleted=false)=>{
   const isKif=kind==='KIF';
   const rt=await tx.racunVrsta.create({data:{agencija_id:agency.id,firma_id:firm.id,dokument_tip:kind,sifra:randomUUID(),naziv:kind,vrsta_naloga_id:type.id}});
   const rules=[['UKUPAN_IZNOS',isKif?'D':'P',isKif?'2010':'4300'],['UKUPAN_IZNOS_INO',isKif?'D':'P',isKif?'2010':'4300'],['OSNOVICA_R21',isKif?'P':'D',isKif?'6000':'5000'],['PDV_R21',isKif?'P':'D',isKif?'2600':'2700']];
   for(const [field,direction,account] of rules) await tx.racunKontiranjePravilo.create({data:{racun_vrsta_id:rt.id,polje_sifra:field,polje_naziv:field,smjer:direction,konto_izvor:'FIXED',sifra_konta:account}});
   const n=++bookNumber;return tx[isKif?'kifBook':'kufBook'].create({data:{...scope,racun_vrsta_id:rt.id,redni_broj:n,mjesec:month,[isKif?'internal_kif_number':'internal_kuf_number']:kind+n,[isKif?'kif_date':'kuf_date']:date(`2026-${String(month).padStart(2,'0')}-15`),is_deleted:deleted}});
  };
  const makeEntry=async(kind,book,base=100,vat=21,extras={})=>{
   const kif=kind==='KIF',n=++entryNumber;
   const tax={vat_rate_id:rate.id,vat_rate_code:'R21',vat_rate_name:'21%',vat_rate_percent:'21',tax_base:String(base),total_with_vat:String(base+vat),...(kif?{output_vat_amount:String(vat)}:{input_vat_amount:String(vat),deductible_vat_amount:String(vat),non_deductible_vat_amount:'0'})};
   return tx[kif?'kifEntry':'kufEntry'].create({data:{...scope,[kif?'kif_book_id':'kuf_book_id']:book.id,[kif?'kupac_id':'dobavljac_id']:partner.id,redni_broj:n,[kif?'internal_kif_number':'internal_kuf_number']:'ENTRY-'+n,[kif?'customer_invoice_number':'supplier_invoice_number']:'INV-'+n,invoice_date:date('2026-05-01'),...(!kif?{receipt_date:date('2026-05-02'),deductible_vat:String(vat)}:{}),total_base:String(base),[kif?'total_output_vat':'total_input_vat']:String(vat),total_gross:String(base+vat),...extras,tax_lines:{create:tax}}});
  };
  const book=await makeBook('KUF');
  const first=await makeEntry('KUF',book), second=await makeEntry('KUF',book,200,42);
  // Same invoice text must not influence selection: ownership is by ID.
  await tx.kufEntry.update({where:{id:second.id},data:{supplier_invoice_number:first.supplier_invoice_number}});
  assert.match(await response(invoices.postInvoiceBook,{dokument_tip:'KUF',book_id:book.id}),/knjizenje_(kreiran|dopunjen|uspjeh)/);
  const saved=await tx.kufEntry.findUniqueOrThrow({where:{id:first.id}});
  const journalId=saved.journal_id;
  assert.match(await response(load("src/app/agencija/nalozi/actions.ts").postJournal,{nalog_id:journalId}),/nalog_proknjizen/);
  assert.equal(await tx.stavkaNaloga.count({where:{nalog_id:journalId,kuf_entry_id:first.id}}),3);
  const input={kuf_entry_id:first.id,kuf_book_id:book.id,reason:'Pogrešna firma',confirmed:'yes'};
  const remove=(data=input)=>invoices.deleteKufEntry({},form(data));
  assert.match((await remove({...input,confirmed:''})).error,/Potvrdite/);
  user=worker;assert.match((await remove()).error,/pravo/);user=admin;
  context={firmaId:other.id,poslovnaGodinaId:foreignYear.id};assert.match((await remove()).error,/pravo/);context={firmaId:firm.id,poslovnaGodinaId:year.id};
  await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:true}});
  assert.match((await remove()).error,/godina je zaključana/);
  await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:false}});
  const period=await tx.pdvPeriod.create({data:{...scope,mjesec:6,datum_od:date('2026-06-01'),datum_do:date('2026-06-30'),status:'LOCKED'}});
  assert.match((await remove()).error,/PDV mjesec je zaključan/);
  await tx.pdvPeriod.update({where:{id:period.id},data:{status:'OPEN'}});
  await tx.kufEntry.update({where:{id:first.id},data:{payment_status:'PAID'}});
  assert.match((await remove()).error,/plaćanje/);
  await tx.kufEntry.update({where:{id:first.id},data:{payment_status:'UNPAID'}});
  const line=await tx.stavkaNaloga.findFirstOrThrow({where:{kuf_entry_id:first.id}});
  await tx.stavkaNaloga.update({where:{id:line.id},data:{kuf_entry_id:null}});
  assert.match((await remove()).error,/potpunu vezu/);
  await tx.stavkaNaloga.update({where:{id:line.id},data:{kuf_entry_id:first.id}});
  await tx.stavkaNaloga.update({where:{id:line.id},data:{duguje:'999'}});
  assert.match((await remove()).error,/ravnotežu/);
  await tx.stavkaNaloga.update({where:{id:line.id},data:{duguje:line.duguje}});
  const service=load('src/lib/kuf-entry-deletion.ts');
  const serviceInput={id:first.id,bookId:book.id,firmaId:firm.id,agencijaId:agency.id,godinaId:year.id,userId:admin.id,reason:'Test',canDeleteJournal:false};
  await assert.rejects(()=>service.deleteKufEntryInTransaction(tx,serviceInput),/pravo brisanja stavki/);
  const failing=sourceLoader({'@/lib/audit':{auditLogInTransaction:async()=>{throw Error('AUDIT_FAIL');}}})('src/lib/kuf-entry-deletion.ts');
  await assert.rejects(()=>transactionProxy(tx).$transaction(t=>failing.deleteKufEntryInTransaction(t,{...serviceInput,canDeleteJournal:true})),/AUDIT_FAIL/);
  assert.equal(await tx.stavkaNaloga.count({where:{nalog_id:journalId}}),6);
  assert.equal((await tx.kufEntry.findUniqueOrThrow({where:{id:first.id}})).is_deleted,false);
  const kept=await tx.stavkaNaloga.findMany({where:{kuf_entry_id:second.id},orderBy:{id:'asc'}});
  assert.equal((await remove()).success,true);
  assert.equal((await tx.kufEntry.findUniqueOrThrow({where:{id:first.id}})).is_deleted,true);
  assert.deepEqual(await tx.stavkaNaloga.findMany({where:{kuf_entry_id:second.id},orderBy:{id:'asc'}}),kept);
  assert.equal((await tx.nalog.findUniqueOrThrow({where:{id:journalId}})).status,'POSTED');
  assert.equal((await remove()).success,true);
  assert.equal(await tx.auditLog.count({where:{entitet_id:first.id,akcija:'delete_entry_and_posting'}}),1);
  assert.equal((await remove({...input,kuf_entry_id:second.id})).success,true);
  assert.equal((await tx.nalog.findUniqueOrThrow({where:{id:journalId}})).is_deleted,true);
  const draft=await makeEntry('KUF',book);
  assert.equal((await remove({...input,kuf_entry_id:draft.id})).success,true);
  assert.equal(await tx.kufEntry.count({where:{id:draft.id}}),0);
  const imported=await makeEntry('KUF',book,100,21,{posting_mode:'SOURCE_DOCUMENT',source_type:'CALCULATION'});
  assert.match((await remove({...input,kuf_entry_id:imported.id})).error,/izvorne kalkulacije/);
  const calc=await pdv.calculatePdvReturn({agencijaId:agency.id,firmaId:firm.id,poslovnaGodinaId:year.id,godina:2026,mjesec:6});
  assert.equal(calc.totals.totalInput,21); // only untouched imported entry remains
  await load('src/lib/company-purge.ts').purgeCompanyData(tx,{agencijaId:agency.id,firmaId:firm.id,potvrdaNaziva:firm.naziv,korisnikId:admin.id});
  assert.equal(await tx.firma.count({where:{id:firm.id}}),0);
  assert.equal(await tx.firma.count({where:{id:other.id}}),1);
  console.log('PASS KUF deletion + company purge: actual posting IDs, duplicate text, permissions/scope, locks, paid/legacy/unbalanced guards, audit rollback, retained siblings, last journal, draft and source document');
  throw rollback;
 },{timeout:90000});} catch(error){if(error!==rollback)throw error;} finally{await db.$disconnect();}
})().catch(error=>{console.error(error);process.exitCode=1;});
