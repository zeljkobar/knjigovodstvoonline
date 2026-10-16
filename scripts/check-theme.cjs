/* eslint-disable @typescript-eslint/no-require-imports -- Isolated PostgreSQL rollback regression. */
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PrismaClient}=require('@prisma/client');
const {sourceLoader,transactionProxy}=require('../tests/helpers/source-loader.cjs');
const db=new PrismaClient(),rollback=new Error('THEME_ROLLBACK');
(async()=>{try{await db.$transaction(async tx=>{
 const agency=await tx.agencija.create({data:{naziv:'Theme fixture'}});
 const otherAgency=await tx.agencija.create({data:{naziv:'Other theme fixture'}});
 const user=await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
 const other=await tx.korisnik.create({data:{agencija_id:otherAgency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
 let actor=user;
 const mocks={'server-only':{},'@/lib/prisma':{prisma:transactionProxy(tx)},'@/lib/auth':{getCurrentUser:async()=>actor}};
 const load=sourceLoader(mocks),{saveTheme}=load('src/app/tema/actions.ts');
 assert.equal((await saveTheme('other','dark')).ok,false);
 actor=null;assert.equal((await saveTheme('green','dark')).ok,false);actor=user;
 for(const palette of ['blue','green','burgundy','graphite','purple'])for(const mode of ['light','dark']){
  assert.equal((await saveTheme(palette,mode,other.id)).ok,true);
  const saved=await tx.korisnik.findUniqueOrThrow({where:{id:user.id}});
  assert.equal(saved.tema_paleta,palette);assert.equal(saved.tema_rezim,mode);
 }
 const foreign=await tx.korisnik.findUniqueOrThrow({where:{id:other.id}});
 assert.equal(foreign.tema_paleta,'blue');assert.equal(foreign.tema_rezim,'light');
 assert.ok(await tx.auditLog.count({where:{korisnik_id:user.id,agencija_id:agency.id,akcija:'CHANGE_THEME'}})>0);
 await tx.korisnik.update({where:{id:user.id},data:{aktivan:false}});
 await assert.rejects(()=>saveTheme('green','light'),/THEME_ACCESS_DENIED/);
 await tx.korisnik.update({where:{id:user.id},data:{aktivan:true}});
 await tx.agencija.update({where:{id:agency.id},data:{aktivan:false}});
 await assert.rejects(()=>saveTheme('green','light'),/THEME_ACCESS_DENIED/);
 await tx.agencija.update({where:{id:agency.id},data:{aktivan:true}});
 const prior=await tx.korisnik.findUniqueOrThrow({where:{id:user.id}});
 mocks['@/lib/audit']={auditLogInTransaction:async()=>{throw Error('AUDIT_FAILURE');}};
 await assert.rejects(()=>sourceLoader(mocks)('src/app/tema/actions.ts').saveTheme('green','light'),/AUDIT_FAILURE/);
 assert.equal((await tx.korisnik.findUniqueOrThrow({where:{id:user.id}})).tema_paleta,prior.tema_paleta);
 actor=await tx.korisnik.create({data:{korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin'}});
 assert.equal((await saveTheme('graphite','dark')).ok,true);
 const firm=await tx.firma.create({data:{agencija_id:agency.id,naziv:'Theme purge fixture'}});
 await tx.korisnikFirma.create({data:{korisnik_id:user.id,firma_id:firm.id}});
 await load('src/lib/company-purge.ts').purgeCompanyData(tx,{agencijaId:agency.id,firmaId:firm.id,potvrdaNaziva:firm.naziv,korisnikId:user.id});
 const retained=await tx.korisnik.findUniqueOrThrow({where:{id:user.id}});assert.equal(retained.tema_paleta,prior.tema_paleta);assert.equal(retained.tema_rezim,prior.tema_rezim);
 console.log('PASS company purge: user theme retained after linked company deletion');
 console.log('PASS theme: all 10 combinations persist for own user only, invalid/anonymous/revoked access denied, cross-agency isolation and audit rollback');
 throw rollback;
},{timeout:30000});}catch(error){if(error!==rollback)throw error;}finally{await db.$disconnect();}})().catch(error=>{console.error(error);process.exitCode=1;});
