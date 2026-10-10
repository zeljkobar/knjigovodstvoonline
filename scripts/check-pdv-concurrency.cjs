/* eslint-disable @typescript-eslint/no-require-imports -- Node regression runner. */
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{PrismaClient}=require('@prisma/client'),{sourceLoader}=require('../tests/helpers/source-loader.cjs');
if(!process.env.TEST_DATABASE_URL||!/_test(?:_|$)/.test(new URL(process.env.TEST_DATABASE_URL).pathname))throw Error('Isolated test database required');
const db=new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL}}});
let agency,firm,admin,release;const form=new FormData();form.set('potvrda','DA');
(async()=>{try{
 agency=await db.agencija.create({data:{naziv:'PDV concurrency'}});
 firm=await db.firma.create({data:{agencija_id:agency.id,naziv:'PDV concurrent fixture',pdv_obveznik:true}});
 admin=await db.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),rola:'admin_agencije',lozinka_hash:'disabled'}});
 const year=await db.poslovnaGodina.create({data:{firma_id:firm.id,godina:2026,datum_od:new Date('2026-01-01'),datum_do:new Date('2026-12-31')}});
 const scope={agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id};
 const type=await db.racunVrsta.create({data:{agencija_id:agency.id,firma_id:firm.id,dokument_tip:'KIF',sifra:randomUUID(),naziv:'Fixture'}});
 const baseMocks={'@/lib/prisma':{prisma:db},'server-only':{}};
 const load=sourceLoader(baseMocks),context={agencijaId:agency.id,user:admin,firma:firm,poslovnaGodina:year};
 const mutate=load('src/lib/pdv-period-flow.ts').mutatePdv;
 await mutate(context,6,'refresh',new FormData());
 let reached;const ready=new Promise(r=>{reached=r;});const gate=new Promise(r=>{release=r;});
 const realAudit=load('src/lib/audit.ts');
 const closing=sourceLoader({...baseMocks,'@/lib/audit':{auditLogInTransaction:async(tx,input)=>{if(input.akcija==='pdv_period_zakljucan'){reached();await gate;}return realAudit.auditLogInTransaction(tx,input);}}})('src/lib/pdv-period-flow.ts').mutatePdv(context,6,'lock',form);
 await ready;
 const bookData={...scope,racun_vrsta_id:type.id,mjesec:6,kif_date:new Date('2026-06-30'),redni_broj:1,internal_kif_number:'race'};
 try {
  await assert.rejects(()=>db.$transaction(async tx=>{await tx.$executeRawUnsafe("SET LOCAL lock_timeout='150ms'");await tx.kifBook.create({data:bookData});}),/lock timeout|canceling statement/);
 } finally {release();}
 await closing;
 await assert.rejects(()=>db.kifBook.create({data:bookData}),/PDV period je zaključan/);
 // Repeated/concurrent closing cannot manufacture another immutable version.
 const again=await Promise.allSettled([mutate(context,6,'lock',form),mutate(context,6,'lock',form)]);
 assert.ok(again.every(r=>r.status==='rejected'));assert.equal(await db.pdvVerzija.count({where:{pdv_period:{firma_id:firm.id}}}),1);
 console.log('PASS PDV concurrency: input waits for closing, rejects after commit; repeated closing preserves one version');
}finally{
 if(release)release();
 if(firm&&admin)await db.$transaction(tx=>sourceLoader({})('src/lib/company-purge.ts').purgeCompanyData(tx,{agencijaId:agency.id,firmaId:firm.id,potvrdaNaziva:firm.naziv,korisnikId:admin.id}));
 if(agency){await db.aktivnostDogadjaj.deleteMany({where:{agencija_id:agency.id}});await db.auditLog.deleteMany({where:{agencija_id:agency.id}});await db.korisnik.deleteMany({where:{agencija_id:agency.id}});await db.agencija.delete({where:{id:agency.id}});}
 await db.$disconnect();
}})().catch(e=>{console.error(e);process.exitCode=1;});
