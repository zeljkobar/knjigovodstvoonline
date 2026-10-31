/* eslint-disable @typescript-eslint/no-require-imports -- Actual concurrent DB actions, isolated database only. */
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {PrismaClient}=require('@prisma/client');
const {sourceLoader}=require('../tests/helpers/source-loader.cjs');
if(!process.env.TEST_DATABASE_URL||!/_test(?:_|$)/i.test(new URL(process.env.TEST_DATABASE_URL).pathname))throw Error('Use isolated TEST_DATABASE_URL with _test in its name.');
process.env.SESSION_SECRET ||= randomUUID()+randomUUID();
const db=new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL}}});
const date=s=>new Date(s+'T00:00:00Z');
const form=data=>{const f=new FormData();for(const[k,v]of Object.entries(data))f.set(k,String(v));return f;};
(async()=>{let agency,company,user;try{
 agency=await db.agencija.create({data:{naziv:'Concurrent replacement agency'}});company=await db.firma.create({data:{agencija_id:agency.id,naziv:'Concurrent replacement '+randomUUID()}});
 const year=await db.poslovnaGodina.create({data:{firma_id:company.id,godina:2026,datum_od:date('2026-01-01'),datum_do:date('2026-12-31')}});
 user=await db.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
 const type=await db.vrstaNaloga.create({data:{agencija_id:agency.id,sifra:randomUUID(),naziv:'Fixture journal'}});
 const accounts={};for(const code of['2410','4140','4147','4148'])accounts[code]=await db.firmaKonto.create({data:{firma_id:company.id,sifra:code,naziv:'Fixture '+code,tip_konta:'analiticko'}});
 const scope={agencija_id:agency.id,firma_id:company.id,poslovna_godina_id:year.id};
 const journal=await db.nalog.create({data:{...scope,vrsta_naloga_id:type.id,broj:1,sifra:'FIX-1',datum:date('2026-06-20'),status:'POSTED',source_type:'MANUAL',source_module:'MANUAL',stavke:{create:[{konto_id:accounts['2410'].id,duguje:'100',potrazuje:'0',redni_broj:1},{konto_id:accounts['4140'].id,duguje:'0',potrazuje:'100',redni_broj:2}]}}});
 const load=sourceLoader({'@/lib/prisma':{prisma:db},'@/lib/auth':{requireAnyRole:async()=>user},'@/lib/work-context':{readWorkContext:async()=>({firmaId:company.id,poslovnaGodinaId:year.id})}});
 const service=load('src/lib/journal-account-replacement.ts');
 const preview=(from,to)=>service.previewAccountReplacement(form({from,to,journalTypeId:type.id,dateFrom:'',dateTo:''}));
 const first=await preview('4140','4147');
 const results=await Promise.allSettled([service.applyAccountReplacement(first.token),service.applyAccountReplacement(first.token)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await db.auditLog.count({where:{firma_id:company.id,akcija:'replace_journal_account'}}),1);
 assert.equal(await db.stavkaNaloga.count({where:{nalog_id:journal.id,konto_id:accounts['4147'].id}}),1);
 await service.applyAccountReplacement((await preview('4147','4140')).token);
 const a=await preview('4140','4147'),b=await preview('4140','4148');
 const competing=await Promise.allSettled([service.applyAccountReplacement(a.token),service.applyAccountReplacement(b.token)]);
 assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);assert.equal(competing.filter(r=>r.status==='rejected').length,1);
 const line=await db.stavkaNaloga.findFirstOrThrow({where:{nalog_id:journal.id,redni_broj:2}});
 const chosen=line.konto_id===accounts['4147'].id?'4147':'4148';
 await service.applyAccountReplacement((await preview(chosen,'4140')).token);
 const period=await db.pdvPeriod.create({data:{...scope,mjesec:6,datum_od:date('2026-06-01'),datum_do:date('2026-06-30'),status:'OPEN'}});
 const ready=await preview('4140','4147');
 let release,signal;const locked=new Promise(resolve=>{signal=resolve;});const gate=new Promise(resolve=>{release=resolve;});
 const closing=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM firme WHERE id=${company.id}::uuid FOR UPDATE`;await tx.$queryRaw`SELECT id FROM poslovne_godine WHERE id=${year.id}::uuid FOR UPDATE`;await tx.pdvPeriod.update({where:{id:period.id},data:{status:'LOCKED'}});signal();await gate;},{timeout:15000});
 await locked;const applying=service.applyAccountReplacement(ready.token);release();await closing;
 await assert.rejects(()=>applying,/promijenjeni|blokirana/);
 assert.equal((await db.stavkaNaloga.findUniqueOrThrow({where:{id:line.id}})).konto_id,accounts['4140'].id);
 assert.equal((await db.nalog.findUniqueOrThrow({where:{id:journal.id}})).status,'POSTED');
 assert.equal(await db.nalog.count({where:{firma_id:company.id}}),1);assert.equal(await db.stavkaNaloga.count({where:{nalog_id:journal.id}}),2);
 const total=await db.stavkaNaloga.aggregate({where:{nalog_id:journal.id},_sum:{duguje:true,potrazuje:true}});assert.equal(Number(total._sum.duguje),100);assert.equal(Number(total._sum.potrazuje),100);
 await db.pdvPeriod.update({where:{id:period.id},data:{status:'OPEN'}});
 console.log('PASS replacement concurrency: double confirmation changes once, competing targets cannot both apply, concurrent period locking prevents changes, original journal/amounts remain intact.');
}finally{
 if(company){const {purgeCompanyData}=sourceLoader({'@/lib/prisma':{prisma:db}})('src/lib/company-purge.ts');await db.$transaction(tx=>purgeCompanyData(tx,{agencijaId:agency.id,firmaId:company.id,potvrdaNaziva:company.naziv,korisnikId:user?.id}),{timeout:30000});}
 await db.$disconnect();
}})().catch(e=>{console.error(e);process.exitCode=1});
