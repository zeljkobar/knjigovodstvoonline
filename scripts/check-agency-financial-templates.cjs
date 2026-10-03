require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PrismaClient}=require('@prisma/client');
const {sourceLoader,transactionProxy}=require('../tests/helpers/source-loader.cjs');
const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
const db=new PrismaClient();const rollback=new Error('ROLLBACK');
(async()=>{try {await db.$transaction(async tx=>{
 const agency=await tx.agencija.create({data:{naziv:'Shared report fixture'}});
 const other=await tx.agencija.create({data:{naziv:'Other fixture'}});
 const user=await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
 const companies=[];for(let i=0;i<2;i++)companies.push(await tx.firma.create({data:{agencija_id:agency.id,naziv:'Report company '+i}}));
 const load=sourceLoader({'@/lib/prisma':{prisma:transactionProxy(tx)},'server-only':{},
  '@/lib/auth':{requireRole:async role=>{if(user.rola!==role)throw new Error('DENIED');return user;}},
  '@/lib/work-context':{readWorkContext:async()=>{throw new Error('Company context must not be required');}},
  'next/cache':{revalidatePath(){}},'next/headers':{headers:async()=>new Map()},
  'next/navigation':{redirect:url=>{throw new Error('REDIRECT:'+url);}},
  'next/link':{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)}});
 const reports=load('src/lib/financial-reports.ts');const actions=load('src/app/agencija/zavrsni-racun/actions.ts');
 for(const [getter,save,page] of [
  ['getIncomeStatementSettings','saveIncomeStatementSettings',''],
  ['getBalanceSheetSettings','saveBalanceSheetSettings','/bilans-stanja'],
  ['getStatisticalAnnexSettings','saveStatisticalAnnexSettings','/statisticki-aneks']]) {
  const system=await reports[getter](agency.id);
  assert.equal(system.source,'system');
  const form=new FormData();for(const row of system.template.pozicije)for(const key of ['rbr','aop','pozicija','uslov','formula','konto','preskoci_konta','znak','nivo','grupa','bold','prikazi','rucni_unos'])form.append(key,typeof row[key]==='boolean'?(row[key]?'1':'0'):String(row[key]??''));
  await assert.rejects(actions[save](form),/REDIRECT:.*sacuvano/);
  const first=await reports[getter](agency.id,companies[0].id),second=await reports[getter](agency.id,companies[1].id);
  assert.equal(first.source,'agency');assert.equal(first.template.id,second.template.id);
  assert.equal(first.template.firma_id,null);assert.equal(first.template.pozicije.length,system.template.pozicije.length);
  assert.equal((await reports[getter](other.id)).source,'system');
  await assert.rejects(actions[save](form),/REDIRECT:.*sacuvano/);
  assert.equal(await tx.finansijskiIzvjestajSablon.count({where:{agencija_id:agency.id,tip_sifra:first.template.tip_sifra}}),1);
  const html=renderToStaticMarkup(await load('src/app/agencija/zavrsni-racun/podesavanja'+page+'/page.tsx').default({}));
  assert.match(html,/Povezivanje konta važi za sve firme agencije/);
  user.rola='korisnik_agencije';await assert.rejects(actions[save](form),/DENIED/);user.rola='admin_agencije';
 }
 assert.equal(await tx.auditLog.count({where:{agencija_id:agency.id,modul:'zavrsni_racun',firma_id:null}}),6);
 await load('src/lib/company-purge.ts').purgeCompanyData(tx,{agencijaId:agency.id,firmaId:companies[0].id,potvrdaNaziva:companies[0].naziv,korisnikId:user.id});
 assert.equal(await tx.finansijskiIzvjestajSablon.count({where:{agencija_id:agency.id,firma_id:null}}),3);
 throw rollback;
},{timeout:30000});}catch(e){if(e!==rollback)throw e;}console.log('PASS agency templates: three reports, no company context, shared across firms, tenant isolation, admin-only, repeated save, transactional audit; rollback.');})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());
