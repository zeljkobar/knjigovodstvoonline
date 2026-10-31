/* eslint-disable @typescript-eslint/no-require-imports -- Isolated committed concurrency fixtures. */
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
if(!process.env.TEST_DATABASE_URL||!/_test(?:_|$)/i.test(new URL(process.env.TEST_DATABASE_URL).pathname))throw Error('Use an isolated TEST_DATABASE_URL containing _test.');
process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
const assert=require('node:assert/strict'),{randomUUID,randomBytes}=require('node:crypto'),{PrismaClient}=require('@prisma/client'),{sourceLoader}=require('../tests/helpers/source-loader.cjs');
const db=new PrismaClient(),oldKey=process.env.FISCAL_PORTAL_ENCRYPTION_KEY;
const form=data=>{const f=new FormData();for(const[k,v]of Object.entries(data))for(const x of [].concat(v))f.append(k,String(x));return f;};
(async()=>{let agency,firm,admin;try{
 process.env.FISCAL_PORTAL_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 agency=await db.agencija.create({data:{naziv:'Pazar race QA'}});firm=await db.firma.create({data:{agencija_id:agency.id,naziv:'Pazar race fixture',pib:'12345678'}});
 admin=await db.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
 const year=await db.poslovnaGodina.create({data:{firma_id:firm.id,godina:2026,datum_od:new Date('2026-01-01Z'),datum_do:new Date('2026-12-31Z')}}),type=await db.racunVrsta.create({data:{agencija_id:agency.id,firma_id:firm.id,dokument_tip:'KIF',sifra:'QA',naziv:'QA'}});
 const book=await db.kifBook.create({data:{agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id,racun_vrsta_id:type.id,redni_broj:1,internal_kif_number:'QA',mjesec:9,kif_date:new Date('2026-09-30Z')}});
 const rate=await db.pdvStopa.create({data:{agencija_id:agency.id,sifra:'R21',naziv:'21%',procenat:'21'}});await db.firmaKonto.create({data:{firma_id:firm.id,sifra:'6000',naziv:'Prihod',tip_konta:'analiticko'}});
 const config=await db.firmaFiskalniPortal.create({data:{agencija_id:agency.id,firma_id:firm.id,provider:'VG_EFISKAL'}});
 const mocks={'@/lib/prisma':{prisma:db},'@/lib/auth':{requireAnyRole:async()=>admin,getCurrentUser:async()=>admin,isDirectFiscalTenantUser:()=>false},'@/lib/work-context':{readWorkContext:async()=>({firmaId:firm.id,poslovnaGodinaId:year.id})},'next/cache':{revalidatePath(){}},'next/navigation':{redirect(url){throw Error('REDIRECT:'+url);}},'next/headers':{headers:async()=>new Map()}};
 const load=sourceLoader(mocks),sign=load('src/lib/fiscal-portal-secrets.ts').signPazarImport;
 const token=sign({agencyId:agency.id,companyId:firm.id,companyPib:firm.pib,yearId:year.id,bookId:book.id,userId:admin.id,configId:config.id,configVersion:config.updated_at.toISOString(),provider:'VG_EFISKAL',deviceId:'QA',cashRegister:'VG · KASA [QA]',from:'2026-09-01',to:'2026-09-30',digest:'fixture',expires:Date.now()+60000});
 const data={kif_book_id:book.id,pazar_period_type:'MONTHLY',pazar_month:'2026-09',pazar_cash_register:'VG · KASA [QA]',invoice_total:'121',revenue_account_code:'6000',pazar_import_token:token,vat_rate_id:rate.id,tax_base:'100',output_vat_amount:'21',pazar_payment_method:'CASH',pazar_payment_amount:'121'};
 const create=load('src/app/agencija/racuni/actions.ts').createKifPazar;
 const run=async()=>{try{await create(form(data));throw Error('Missing redirect');}catch(e){if(!e.message.startsWith('REDIRECT:'))throw e;return e.message;}};
 const replies=await Promise.all([run(),run()]);assert.equal(replies.filter(r=>r.includes('kif_pazar_sacuvan')).length,1,replies.join('\n'));assert.equal(replies.filter(r=>r.includes('kif_pazar_uvoz')).length,1,replies.join('\n'));
 assert.equal(await db.kifEntry.count({where:{firma_id:firm.id}}),1);assert.equal(await db.auditLog.count({where:{firma_id:firm.id,akcija:'create_pazar'}}),1);assert.equal(await db.nalog.count({where:{firma_id:firm.id}}),0);
 console.log('PASS simultaneous imports: one active pazar, one audit, no automatic journal, second request rejected after company lock.');
}finally{
 if(firm){const {purgeCompanyData}=sourceLoader({'@/lib/prisma':{prisma:db}})('src/lib/company-purge.ts');await db.$transaction(tx=>purgeCompanyData(tx,{agencijaId:agency.id,firmaId:firm.id,potvrdaNaziva:firm.naziv,korisnikId:admin.id}));}
 await db.$disconnect();if(oldKey===undefined)delete process.env.FISCAL_PORTAL_ENCRYPTION_KEY;else process.env.FISCAL_PORTAL_ENCRYPTION_KEY=oldKey;
}})().catch(e=>{console.error(e);process.exitCode=1});
