/* eslint-disable @typescript-eslint/no-require-imports -- isolated PostgreSQL concurrency regression. */
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{PrismaClient}=require('@prisma/client');
const {sourceLoader}=require('../tests/helpers/source-loader.cjs');
if(!process.env.TEST_DATABASE_URL||!/_test(?:_|$)/.test(new URL(process.env.TEST_DATABASE_URL).pathname))throw Error('TEST_DATABASE_URL mora biti zasebna _test baza.');
process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
const db=new PrismaClient(),date=s=>new Date(s+'T00:00:00Z');
const load=sourceLoader({'@/lib/prisma':{prisma:db}}),service=load('src/lib/settlements.ts');
(async()=>{let agency,company,admin;
 try{
  agency=await db.agencija.create({data:{naziv:'Settlement concurrency'}});
  company=await db.firma.create({data:{agencija_id:agency.id,naziv:'Settlement concurrency fixture'}});
  admin=await db.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
  const year=await db.poslovnaGodina.create({data:{firma_id:company.id,godina:2026,datum_od:date('2026-01-01'),datum_do:date('2026-12-31')}});
  const partner=await db.komitent.create({data:{agencija_id:agency.id,scope:'AGENCY',naziv:'Concurrency partner'}});
  const account=await db.firmaKonto.create({data:{firma_id:company.id,sifra:'2020',naziv:'Kupci',tip_konta:'analiticko',analitika_obavezna:true,override_type:'CUSTOM'}});
  const type=await db.vrstaNaloga.create({data:{sifra:randomUUID(),naziv:'QA',prefiks:'QA'}});
  for(const [index,amount] of [100,-100].entries())await db.nalog.create({data:{agencija_id:agency.id,firma_id:company.id,poslovna_godina_id:year.id,vrsta_naloga_id:type.id,broj:index+1,datum:date('2026-02-01'),status:'POSTED',kreirao_korisnik_id:admin.id,stavke:{create:{konto_id:account.id,komitent_id:partner.id,duguje:amount>0?'100':'0',potrazuje:amount<0?'100':'0',redni_broj:1}}}});
  const scope={agencyId:agency.id,companyId:company.id,yearId:year.id,userId:admin.id};
  const input={date:'2026-12-31',accountId:account.id,partnerIds:[partner.id],mode:'EXACT'};
  const result=await Promise.all([db.$transaction(tx=>service.settleInTransaction(tx,scope,input)),db.$transaction(tx=>service.settleInTransaction(tx,scope,input))]);
  assert.deepEqual(result.sort(),[0,1]);assert.equal(await db.zatvaranjeStavki.count({where:{firma_id:company.id,is_deleted:false}}),1);
  const ledger=await service.loadSettlementLedger(db,scope,'2026-12-31');assert(ledger.items.every(i=>i.remainingCents===0));
  console.log('Concurrent exact settlement: one closing edge, no over-allocation.');
 }finally{
  if(company)await db.$transaction(tx=>load('src/lib/company-purge.ts').purgeCompanyData(tx,{agencijaId:agency.id,firmaId:company.id,potvrdaNaziva:company.naziv,korisnikId:admin?.id}));
  await db.$disconnect();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
