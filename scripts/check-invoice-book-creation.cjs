/* eslint-disable @typescript-eslint/no-require-imports -- Rollback regression for real server actions. */
require('@next/env').loadEnvConfig(process.cwd(), false, {info(){},error(){}});
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PrismaClient}=require('@prisma/client');
const {sourceLoader,transactionProxy}=require('../tests/helpers/source-loader.cjs');
const db=new PrismaClient(), rollback=new Error('ROLLBACK');
(async()=>{
 try { await db.$transaction(async tx=>{
  const agency=await tx.agencija.create({data:{naziv:'Book lock regression'}});
  const firm=await tx.firma.create({data:{agencija_id:agency.id,naziv:'Book lock fixture'}});
  const year=await tx.poslovnaGodina.create({data:{firma_id:firm.id,godina:2026,datum_od:new Date('2026-01-01'),datum_do:new Date('2026-12-31')}});
  const user=await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
  const proxy=transactionProxy(tx);
  const mocks={
   '@/lib/prisma':{prisma:proxy},'@/lib/auth':{requireAnyRole:async()=>user},
   '@/lib/work-context':{readWorkContext:async()=>({firmaId:firm.id,poslovnaGodinaId:year.id})},
   'next/navigation':{redirect:url=>{throw new Error('REDIRECT:'+url)}},
   'next/headers':{headers:async()=>new Map()},'next/cache':{revalidatePath(){}}
  };
  const load=sourceLoader(mocks), actions=load('src/app/agencija/racuni/actions.ts');
  const period=await tx.pdvPeriod.create({data:{agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id,mjesec:10,datum_od:new Date('2026-10-01'),datum_do:new Date('2026-10-31'),status:'LOCKED'}});
  for(const kind of ['kuf','kif']){
   const type=await tx.racunVrsta.create({data:{agencija_id:agency.id,firma_id:firm.id,dokument_tip:kind.toUpperCase(),sifra:'TEST',naziv:'Test'}});
   const form=new FormData();form.set('mjesec','10');form.set('racun_vrsta_id',type.id);form.set(kind+'_date','2026-10-31');
   const action=kind==='kuf'?actions.createKufBook:actions.createKifBook;
   const model=kind==='kuf'?tx.kufBook:tx.kifBook;
   await assert.rejects(action(form),new RegExp('REDIRECT:.*'+kind+'_pdv_zakljucan'));
   assert.equal(await model.count({where:{firma_id:firm.id}}),0);
   // Tampered date may not route October evidence into an unlocked November.
   form.set(kind+'_date','2026-11-30');
   await assert.rejects(action(form),new RegExp('REDIRECT:.*'+kind+'_datum'));
   assert.equal(await model.count({where:{firma_id:firm.id}}),0);
   form.set('mjesec','11');
   await assert.rejects(action(form),new RegExp('REDIRECT:/agencija/racuni/'+kind+'/[0-9a-f-]+\\?poruka='));
   assert.equal(await model.count({where:{firma_id:firm.id,mjesec:11}}),1);
   // Controlled reopening of this disposable fixture allows the same October request.
   await tx.pdvPeriod.update({where:{id:period.id},data:{status:'OPEN'}});
   form.set('mjesec','10');form.set(kind+'_date','2026-10-31');
   await assert.rejects(action(form),new RegExp('REDIRECT:/agencija/racuni/'+kind+'/[0-9a-f-]+\\?poruka='));
   assert.equal(await model.count({where:{firma_id:firm.id,mjesec:10}}),1);
   await tx.pdvPeriod.update({where:{id:period.id},data:{status:'LOCKED'}});
  }
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
  for(const name of ['Kuf','Kif']){
   const Form=load('src/components/'+name+'BookForm.tsx')[name+'BookForm'];
   const props={year:2026,invoiceTypes:[{id:'fixture',sifra:'T',naziv:'Test'}]};
   const locked=renderToStaticMarkup(React.createElement(Form,{...props,lockedMonths:Array.from({length:12},(_,i)=>i+1)}));
   assert.match(locked,/PDV period za izabrani mjesec je zaključan/);
   assert.match(locked,/<button type="submit" disabled=""/);
   const open=renderToStaticMarkup(React.createElement(Form,props));
   assert.doesNotMatch(open,/PDV period za izabrani mjesec je zaključan/);
   assert.doesNotMatch(open,/<button type="submit" disabled/);
  }
  throw rollback;
 },{timeout:30000}); } catch(e){if(e!==rollback)throw e;}
 console.log('PASS KIF/KUF creation: locked period gives controlled redirect, no insert, date tampering rejected, open/reopened periods create normally, forms show lock and disable submit; rollback.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());
