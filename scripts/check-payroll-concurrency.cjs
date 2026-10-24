/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test runner. */
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{PrismaClient}=require('@prisma/client');
const {sourceLoader}=require('../tests/helpers/source-loader.cjs');
if(!process.env.TEST_DATABASE_URL||!/_test(?:_|$)/.test(new URL(process.env.TEST_DATABASE_URL).pathname))throw Error('Isolated TEST_DATABASE_URL required');
const db=new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL}}});
let agency,firm,year,admin;
const response=async(fn,id)=>{const f=new FormData();f.set('obracun_id',id);try{await fn(f);throw Error('No redirect');}catch(e){if(!e.message.startsWith('REDIRECT:'))throw e;return e.message;}};
(async()=>{
 agency=await db.agencija.create({data:{naziv:'Payroll concurrency'}});
 firm=await db.firma.create({data:{agencija_id:agency.id,naziv:'Payroll concurrent employer'}});
 year=await db.poslovnaGodina.create({data:{firma_id:firm.id,godina:2026,datum_od:new Date('2026-01-01'),datum_do:new Date('2026-12-31')}});
 admin=await db.korisnik.create({data:{agencija_id:agency.id,rola:'admin_agencije',korisnicko_ime:randomUUID(),lozinka_hash:'disabled'}});
 const scope={agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id};
 const kind=await db.vrstaNaloga.create({data:{agencija_id:agency.id,sifra:randomUUID(),naziv:'Payroll fixture',prefiks:'PTEST'}});
 const debit=await db.firmaKonto.create({data:{firma_id:firm.id,sifra:'5200',naziv:'Fixture debit',tip_konta:'analiticko'}});
 const credit=await db.firmaKonto.create({data:{firma_id:firm.id,sifra:'4500',naziv:'Fixture credit',tip_konta:'analiticko'}});
 await db.plateKontiranjePodesavanje.create({data:{...scope,kategorija:'REDOVAN_RAD',vrsta_naloga_id:kind.id,pravila:{create:{komponenta:'NETO_ZA_ISPLATU',naziv:'Net fixture',grupa:'Fixture',izvorno_polje:'neto_za_isplatu_cent',redosljed:1,duguje_konto_id:debit.id,potrazuje_konto_id:credit.id}}}});
 const make=n=>db.plateObracun.create({data:{...scope,broj:n,godina:2026,mjesec:6,datum_od:new Date('2026-06-01'),datum_do:new Date('2026-06-30'),datum_obracuna:new Date('2026-06-30'),fond_sati:176,status:'CALCULATED',stavke:{create:{agencija_id:agency.id,firma_id:firm.id,radnik_id:randomUUID(),sifra_primanja_id:randomUUID(),ioppd_sifra_id:randomUUID(),vrsta_obracuna_id:randomUUID(),sifra_primanja:'001',naziv_primanja:'Fixture',redni_broj:1,datum_od:new Date('2026-06-01'),datum_do:new Date('2026-06-30'),fond_sati:176,ukupno_sati:176,neto_za_isplatu_cent:10000,detalji:{monthlyHistoryKey:"[]"}}}}});
 const loadFor=prisma=>sourceLoader({'server-only':{},'@/lib/prisma':{prisma},'@/lib/auth':{requireAnyRole:async()=>admin},'@/lib/work-context':{readWorkContext:async()=>({firmaId:firm.id,poslovnaGodinaId:year.id})},'next/headers':{headers:async()=>new Map()},'next/cache':{revalidatePath(){}},'next/navigation':{redirect:u=>{throw Error('REDIRECT:'+u);}}})('src/app/agencija/plate/actions.ts');
 const actions=loadFor(db),first=await make(1);
 const replies=await Promise.all([response(actions.postPayrollCalculation,first.id),response(actions.postPayrollCalculation,first.id)]);
 assert.equal(replies.filter(x=>x.includes('obracun_proknjizen')).length,1);assert.equal(replies.filter(x=>x.includes('obracun_vec_proknjizen')).length,1);
 assert.equal(await db.nalog.count({where:{izvorni_dokument_id:first.id}}),1);assert.equal(await db.auditLog.count({where:{entitet_id:first.id,akcija:'post_payroll'}}),1);
 const service=sourceLoader({'@/lib/prisma':{prisma:db},'next/headers':{headers:async()=>new Map()}})('src/lib/payroll-journal.ts');
 const actor={userId:admin.id,agencyId:agency.id};
 const journalId=(await db.plateObracun.findUniqueOrThrow({where:{id:first.id}})).nalog_id;
 const reversals=await Promise.all([service.reopenPayrollJournal(actor,journalId),service.reopenPayrollJournal(actor,journalId)]);
 assert.equal(reversals.filter(r=>!r.existing).length,1);assert.equal(await db.auditLog.count({where:{entitet_id:first.id,akcija:'reopen_payroll'}}),1);
 assert.equal((await db.plateObracun.findUniqueOrThrow({where:{id:first.id}})).status,'CALCULATED');assert.equal((await db.nalog.findUniqueOrThrow({where:{id:journalId}})).status,'DRAFT');
 const reposts=await Promise.all([response(actions.postPayrollCalculation,first.id),response(actions.postPayrollCalculation,first.id)]);
 assert.equal(reposts.filter(x=>x.includes('obracun_proknjizen')).length,1);assert.equal(reposts.filter(x=>x.includes('obracun_vec_proknjizen')).length,1);
 assert.equal(await db.nalog.count({where:{izvorni_dokument_id:first.id}}),1);assert.equal((await db.plateObracun.findUniqueOrThrow({where:{id:first.id}})).nalog_id,journalId);
 const second=await make(2);
 let acquired,release,entered;const locked=new Promise(r=>acquired=r),gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const closing=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM poslovne_godine WHERE id=${year.id}::uuid FOR UPDATE`;acquired();await gate;await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:true}});},{timeout:15000});
 await locked;
 const observed=new Proxy(db,{get(t,k){if(k==='$transaction')return (...args)=>{entered();return db.$transaction(...args);};return t[k];}});
 const posting=response(loadFor(observed).postPayrollCalculation,second.id);
 try{await started;}finally{release();}
 await closing;assert.match(await posting,/godina_zakljucena/);
 await assert.rejects(service.reopenPayrollJournal(actor,journalId),/godina_zakljucena/);
 assert.equal((await db.nalog.findUniqueOrThrow({where:{id:journalId}})).status,'POSTED');
 assert.equal((await db.plateObracun.findUniqueOrThrow({where:{id:second.id}})).status,'CALCULATED');assert.equal(await db.nalog.count({where:{izvorni_dokument_id:second.id}}),0);
 console.log('PASS payroll concurrency: real parallel posting/reopening/reposting preserve one journal; closed year blocks both actions');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{try{if(agency)await db.$transaction(async tx=>{
 if(firm){await tx.plateObracunStavka.deleteMany({where:{firma_id:firm.id}});await tx.plateObracun.deleteMany({where:{firma_id:firm.id}});await tx.plateKontiranjePodesavanje.deleteMany({where:{firma_id:firm.id}});await tx.stavkaNaloga.deleteMany({where:{nalog:{firma_id:firm.id}}});await tx.nalog.deleteMany({where:{firma_id:firm.id}});await tx.firmaKonto.deleteMany({where:{firma_id:firm.id}});await tx.poslovnaGodina.deleteMany({where:{firma_id:firm.id}});}
 await tx.aktivnostDogadjaj.deleteMany({where:{agencija_id:agency.id}});await tx.auditLog.deleteMany({where:{agencija_id:agency.id}});await tx.vrstaNaloga.deleteMany({where:{agencija_id:agency.id}});await tx.korisnik.deleteMany({where:{agencija_id:agency.id}});if(firm)await tx.firma.delete({where:{id:firm.id}});await tx.agencija.delete({where:{id:agency.id}});
 });}finally{await db.$disconnect();}});
