// Database regression. All fixtures and attempted changes roll back.
require('@next/env').loadEnvConfig(process.cwd(), false, {info(){},error(){}});
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {PrismaClient} = require('@prisma/client');
const db = new PrismaClient();
const rollback = new Error('ROLLBACK');
(async()=>{
 try { await db.$transaction(async tx=>{
  const agency=await tx.agencija.create({data:{naziv:'Account length regression'}});
  const firm=await tx.firma.create({data:{agencija_id:agency.id,naziv:'Account length fixture'}});
  const year=await tx.poslovnaGodina.create({data:{firma_id:firm.id,godina:2026,datum_od:new Date('2026-01-01'),datum_do:new Date('2026-12-31')}});
  const type=await tx.vrstaNaloga.create({data:{sifra:randomUUID(),naziv:'Fixture',prefiks:'TEST',agencija_id:agency.id}});
  const journal=await tx.nalog.create({data:{firma_id:firm.id,agencija_id:agency.id,poslovna_godina_id:year.id,vrsta_naloga_id:type.id,broj:1,datum:new Date('2026-01-01'),status:'POSTED'}});
  async function rejected(action) {
   await tx.$executeRawUnsafe('SAVEPOINT account_length_check');
   let error;try {await action();} catch(e){error=e;}
   await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT account_length_check');
   assert.ok(error,'Expected DB rejection');
   assert.match(error.message,/analytic_min_length|najmanje 4 cifre/);
  }
  for(const code of ['5','52','522']) {
   await rejected(()=>tx.konto.create({data:{sifra:code,naziv:'Blocked',tip_konta:'analiticko'}}));
   await rejected(()=>tx.agencijaKonto.create({data:{agencija_id:agency.id,sifra:code,naziv:'Blocked',tip_konta:'analiticko'}}));
   await rejected(()=>tx.firmaKonto.create({data:{firma_id:firm.id,sifra:code,naziv:'Blocked',tip_konta:'analiticko'}}));
   const short=await tx.firmaKonto.create({data:{firma_id:firm.id,sifra:code,naziv:'Synthetic',tip_konta:'sinteticko'}});
   await rejected(()=>tx.stavkaNaloga.create({data:{nalog_id:journal.id,konto_id:short.id,redni_broj:1,duguje:'1'}}));
  }
  const valid=await tx.firmaKonto.create({data:{firma_id:firm.id,sifra:'5220',naziv:'Valid',tip_konta:'analiticko'}});
  const line=await tx.stavkaNaloga.create({data:{nalog_id:journal.id,konto_id:valid.id,redni_broj:1,duguje:'1'}});
  const short=await tx.firmaKonto.findUniqueOrThrow({where:{firma_id_sifra:{firma_id:firm.id,sifra:'522'}}});
  await rejected(()=>tx.stavkaNaloga.update({where:{id:line.id},data:{konto_id:short.id}}));
  // Existing local historical entries are deliberately not rewritten by migration.
  const legacy=await tx.nalog.findFirst({where:{status:'POSTED',stavke:{some:{firma_konto:{sifra:{in:['5','52','522']}}}}}});
  if(legacy) {
   await tx.nalog.update({where:{id:legacy.id},data:{status:'DRAFT'}});
   await rejected(()=>tx.nalog.update({where:{id:legacy.id},data:{status:'POSTED'}}));
  }
  for(const code of ['5220','5250']) assert.equal((await tx.konto.findUniqueOrThrow({where:{sifra:code}})).tip_konta,'analiticko');
  throw rollback;
 },{timeout:30000}); } catch(e) {if(e!==rollback) throw e;}
 console.log('PASS: short accounts rejected at all three levels and in journal writes; 4-digit posting accepted; fixtures rolled back.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());
