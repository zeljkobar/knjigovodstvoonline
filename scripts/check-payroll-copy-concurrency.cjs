/* eslint-disable @typescript-eslint/no-require-imports -- Real isolated PostgreSQL concurrency regression. */
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
if(!process.env.TEST_DATABASE_URL||!/_test(?:_|$)/.test(new URL(process.env.TEST_DATABASE_URL).pathname))throw Error('Isolated TEST_DATABASE_URL required');
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{PrismaClient}=require('@prisma/client');
const {sourceLoader}=require('../tests/helpers/source-loader.cjs');
const db=new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL}}}),date=s=>new Date(s+'T00:00:00Z');
let agency,firm,user,kind,ioppd;
(async()=>{
 agency=await db.agencija.create({data:{naziv:'Payroll copy concurrent QA'}});
 firm=await db.firma.create({data:{agencija_id:agency.id,naziv:'Payroll copy concurrent QA'}});
 user=await db.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
 const year=await db.poslovnaGodina.create({data:{firma_id:firm.id,godina:2026,datum_od:date('2026-01-01'),datum_do:date('2026-12-31')}});
 kind=await db.plateVrstaObracuna.create({data:{sifra:randomUUID(),naziv:'Copy QA',input_type:'NET',algoritam:'NET_TO_GROSS',valid_from:date('2026-01-01')}});
 ioppd=await db.plateIoppdSifra.create({data:{sifra:randomUUID(),naziv:'Copy QA',valid_from:date('2026-01-01')}});
 const income=await db.plateSifraPrimanja.create({data:{agencija_id:agency.id,firma_id:firm.id,sifra:'001',naziv:'Copy QA',ioppd_sifra_id:ioppd.id,vrsta_obracuna_id:kind.id,valid_from:date('2026-01-01'),koristi_porez:false,koristi_zaposleni_pio:false,koristi_zaposleni_nezaposleni:false,koristi_poslodavac_nezaposleni:false,koristi_fond_rada:false,koristi_sindikat:false,koristi_privredna_komora:false}});
 const employee=await db.plateRadnik.create({data:{agencija_id:agency.id,firma_id:firm.id,ime:'QA',prezime:'Concurrent',jmbg:'0000000000000',opstina:'QA'}});
 await db.plateObracun.create({data:{agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id,broj:1,godina:2026,mjesec:8,datum_od:date('2026-08-01'),datum_do:date('2026-08-31'),datum_obracuna:date('2026-08-31'),fond_sati:176,status:'CALCULATED',stavke:{create:{agencija_id:agency.id,firma_id:firm.id,radnik_id:employee.id,sifra_primanja_id:income.id,ioppd_sifra_id:ioppd.id,vrsta_obracuna_id:kind.id,sifra_primanja:'001',naziv_primanja:'Copy QA',redni_broj:1,datum_od:date('2026-08-01'),datum_do:date('2026-08-31'),fond_sati:176,ukupno_sati:176,input_neto_cent:60000,status:'CALCULATED'}}}});
 const loadFor=prisma=>sourceLoader({'@/lib/prisma':{prisma},'next/headers':{headers:async()=>new Map()}})('src/lib/payroll-copy.ts');
 const svc=loadFor(db),actor={userId:user.id,agencyId:agency.id};
 const rows=await svc.payrollCopyPreview(actor,'2026-08','2026-09'),selection=rows.map(r=>({companyId:r.companyId,version:r.version}));
 const results=await Promise.all([svc.copyPayrollMonths(actor,'2026-08','2026-09',selection),svc.copyPayrollMonths(actor,'2026-08','2026-09',selection)]);
 assert.equal(results.flat().filter(r=>r.ok).length,1);assert.equal(await db.plateObracun.count({where:{firma_id:firm.id,mjesec:9}}),1);
 const october=(await svc.payrollCopyPreview(actor,'2026-08','2026-10')).map(r=>({companyId:r.companyId,version:r.version}));
 let acquired,release,entered;const locked=new Promise(r=>acquired=r),gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const closing=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM poslovne_godine WHERE id=${year.id}::uuid FOR UPDATE`;acquired();await gate;await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:true}});},{timeout:15000});
 await locked;
 const observed=new Proxy(db,{get(t,k){if(k==='$transaction')return(...args)=>{entered();return db.$transaction(...args)};return t[k]}});
 const copy=loadFor(observed).copyPayrollMonths(actor,'2026-08','2026-10',october);
 try{await started}finally{release()}
 await closing;const blocked=await copy;assert.equal(blocked[0].ok,false);assert.match(blocked[0].message,/zaključana/);assert.equal(await db.plateObracun.count({where:{firma_id:firm.id,mjesec:10}}),0);
 console.log('PASS payroll copy concurrency: two real requests produce one copy; year closing after preview blocks the stale request');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{try{if(agency)await db.$transaction(async tx=>{
 await tx.plateObracunStavka.deleteMany({where:{agencija_id:agency.id}});await tx.plateObracunRadnik.deleteMany({where:{agencija_id:agency.id}});await tx.plateObracun.deleteMany({where:{agencija_id:agency.id}});await tx.plateRadnik.deleteMany({where:{agencija_id:agency.id}});await tx.plateSifraPrimanja.deleteMany({where:{agencija_id:agency.id}});await tx.auditLog.deleteMany({where:{agencija_id:agency.id}});await tx.aktivnostDogadjaj.deleteMany({where:{agencija_id:agency.id}});if(firm)await tx.poslovnaGodina.deleteMany({where:{firma_id:firm.id}});await tx.korisnik.deleteMany({where:{agencija_id:agency.id}});if(firm)await tx.firma.delete({where:{id:firm.id}});await tx.agencija.delete({where:{id:agency.id}});if(kind)await tx.plateVrstaObracuna.delete({where:{id:kind.id}});if(ioppd)await tx.plateIoppdSifra.delete({where:{id:ioppd.id}});
 });}finally{await db.$disconnect()}});
