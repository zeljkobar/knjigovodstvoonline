// Two real PostgreSQL connections/transactions: never emulate concurrency with mocks.
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PrismaClient}=require('@prisma/client');
const {sourceLoader}=require('../tests/helpers/source-loader.cjs');
if(!process.env.TEST_DATABASE_URL||!/_test(?:_|$)/i.test(new URL(process.env.TEST_DATABASE_URL).pathname)) throw new Error('Concurrency tests require isolated TEST_DATABASE_URL with _test in its name.');
const db=new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL}}});
let agency,firm,user,year,type,partner;
const form=data=>{const f=new FormData();Object.entries(data).forEach(([k,v])=>f.set(k,String(v)));return f;};
async function response(fn,data){try{await fn(form(data));throw new Error('Missing redirect');}catch(e){if(!e.message.startsWith('REDIRECT:'))throw e;return e.message;}}
(async()=>{
 agency=await db.agencija.create({data:{naziv:'Concurrent fixture'}});
 firm=await db.firma.create({data:{agencija_id:agency.id,naziv:'Concurrent fixture',pdv_obveznik:true}});
 year=await db.poslovnaGodina.create({data:{firma_id:firm.id,godina:2026,datum_od:new Date('2026-01-01'),datum_do:new Date('2026-12-31')}});
 user=await db.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
 type=await db.vrstaNaloga.create({data:{sifra:randomUUID(),naziv:'Concurrent journal',prefiks:'CQ',agencija_id:agency.id}});
 partner=await db.komitent.create({data:{naziv:'Concurrent buyer',agencija_id:agency.id,firma_id:firm.id}});
 const scope={agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id};
 const accounts={};
 for(const code of ['2010','6000','2600']) accounts[code]=await db.firmaKonto.create({data:{firma_id:firm.id,sifra:code,naziv:code,tip_konta:'analiticko',analitika_obavezna:code==='2010'}});
 const load=sourceLoader({'server-only':{},'@/lib/prisma':{prisma:db},'@/lib/auth':{requireAnyRole:async()=>user,getCurrentUser:async()=>user,isDirectFiscalTenantUser:()=>false},'@/lib/work-context':{readWorkContext:async()=>({firmaId:firm.id,poslovnaGodinaId:year.id})},'next/headers':{headers:async()=>new Map()},'next/cache':{revalidatePath(){}},'next/navigation':{redirect(url){throw new Error('REDIRECT:'+url);}}});
 const journals=load('src/app/agencija/nalozi/actions.ts');
 const invoices=load('src/app/agencija/racuni/actions.ts');
 const makeJournal=number=>db.nalog.create({data:{...scope,vrsta_naloga_id:type.id,broj:number,sifra:'CQ-'+number,datum:new Date('2026-06-15'),status:'DRAFT',kreirao_korisnik_id:user.id,stavke:{create:[{konto_id:accounts['2010'].id,komitent_id:partner.id,duguje:'121',potrazuje:'0',redni_broj:1},{konto_id:accounts['6000'].id,duguje:'0',potrazuje:'121',redni_broj:2}]}}});
 const journal=await makeJournal(1);
 const replies=await Promise.all([response(journals.postJournal,{nalog_id:journal.id}),response(journals.postJournal,{nalog_id:journal.id})]);
 assert.equal(replies.filter(r=>r.includes('nalog_proknjizen')).length,1);
 assert.equal(await db.auditLog.count({where:{entitet_id:journal.id,akcija:'post'}}),1);
 assert.equal(await db.stavkaNaloga.count({where:{nalog_id:journal.id}}),2);
 console.log('PASS concurrent journal posting: exactly one transition and audit');
 // Hold the year lock in a second transaction, then close the year while posting waits.
 const stale=await makeJournal(2);
 let release,locked;
 const gate=new Promise(resolve=>{release=resolve;});
 const acquired=new Promise(resolve=>{locked=resolve;});
 const close=db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM poslovne_godine WHERE id=${year.id}::uuid FOR UPDATE`;
  locked();await gate;await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:true}});
 });
 await acquired;
 const posting=response(journals.postJournal,{nalog_id:stale.id});
 release();await close;
 assert.match(await posting,/godina_zakljucena/);
 assert.equal((await db.nalog.findUniqueOrThrow({where:{id:stale.id}})).status,'DRAFT');
 await db.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:false}});
 console.log('PASS closing year during posting prevents stale write');
 const rate=await db.pdvStopa.create({data:{agencija_id:agency.id,sifra:'R21',naziv:'21%',procenat:'21'}});
 const kind=await db.racunVrsta.create({data:{agencija_id:agency.id,firma_id:firm.id,dokument_tip:'KIF',sifra:'TEST',naziv:'Concurrent book',vrsta_naloga_id:type.id}});
 for(const [field,direction,account] of [['UKUPAN_IZNOS','D','2010'],['OSNOVICA_R21','P','6000'],['PDV_R21','P','2600']]) await db.racunKontiranjePravilo.create({data:{racun_vrsta_id:kind.id,polje_sifra:field,polje_naziv:field,smjer:direction,konto_izvor:'FIXED',sifra_konta:account}});
 const book=await db.kifBook.create({data:{...scope,racun_vrsta_id:kind.id,redni_broj:1,internal_kif_number:'CQ',mjesec:6,kif_date:new Date('2026-06-15')}});
 const entry=await db.kifEntry.create({data:{...scope,kif_book_id:book.id,kupac_id:partner.id,redni_broj:1,internal_kif_number:'CQ-1',customer_invoice_number:'1',invoice_date:new Date('2026-06-15'),total_base:'100',total_output_vat:'21',total_gross:'121',tax_lines:{create:{vat_rate_id:rate.id,vat_rate_code:'R21',vat_rate_name:'21%',vat_rate_percent:'21',tax_base:'100',output_vat_amount:'21',total_with_vat:'121'}}}});
 const books=await Promise.all([response(invoices.postInvoiceBook,{dokument_tip:'KIF',book_id:book.id}),response(invoices.postInvoiceBook,{dokument_tip:'KIF',book_id:book.id})]);
 assert.equal(books.filter(r=>r.includes('knjizenje_kreiran')).length,1);
 assert.equal(books.filter(r=>r.includes('knjizenje_nema')).length,1);
 const saved=await db.kifEntry.findUniqueOrThrow({where:{id:entry.id}});
 assert.equal(await db.stavkaNaloga.count({where:{nalog_id:saved.journal_id}}),3);
 assert.equal(await db.nalog.count({where:{izvorni_dokument_id:book.id}}),1);
 console.log('PASS concurrent KIF posting: one journal, three lines, one linked entry');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
 try{
  if(agency) await db.$transaction(async tx=>{
   // Delete only records belonging to this freshly created fixture, even on failure.
   if(firm){
    await tx.kifEntryTaxLine.deleteMany({where:{kif_entry:{firma_id:firm.id}}});
    await tx.kifEntry.deleteMany({where:{firma_id:firm.id}});
    await tx.kifBook.deleteMany({where:{firma_id:firm.id}});
    await tx.racunKontiranjePravilo.deleteMany({where:{racun_vrsta:{firma_id:firm.id}}});
    await tx.racunVrsta.deleteMany({where:{firma_id:firm.id}});
    await tx.stavkaNaloga.deleteMany({where:{nalog:{firma_id:firm.id}}});
    await tx.nalog.deleteMany({where:{firma_id:firm.id}});
    await tx.firmaKonto.deleteMany({where:{firma_id:firm.id}});
    await tx.komitent.deleteMany({where:{firma_id:firm.id}});
    await tx.poslovnaGodina.deleteMany({where:{firma_id:firm.id}});
   }
   await tx.aktivnostDogadjaj.deleteMany({where:{agencija_id:agency.id}});
   await tx.auditLog.deleteMany({where:{agencija_id:agency.id}});
   await tx.pdvStopa.deleteMany({where:{agencija_id:agency.id}});
   await tx.vrstaNaloga.deleteMany({where:{agencija_id:agency.id}});
   await tx.korisnik.deleteMany({where:{agencija_id:agency.id}});
   if(firm) await tx.firma.delete({where:{id:firm.id}});
   await tx.agencija.delete({where:{id:agency.id}});
  });
 }finally{await db.$disconnect();}
});
