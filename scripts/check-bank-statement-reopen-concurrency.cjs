/* eslint-disable @typescript-eslint/no-require-imports -- Concurrent real DB regression, test DB only. */
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PrismaClient}=require('@prisma/client');
const {sourceLoader}=require('../tests/helpers/source-loader.cjs');
if(!process.env.TEST_DATABASE_URL||!/_test(?:_|$)/i.test(new URL(process.env.TEST_DATABASE_URL).pathname))throw Error('Use a separate TEST_DATABASE_URL with _test in its name.');
const db=new PrismaClient({datasources:{db:{url:process.env.TEST_DATABASE_URL}}});
const date=s=>new Date(s+'T00:00:00Z');
const form=data=>{const f=new FormData();for(const[k,v]of Object.entries(data))f.set(k,String(v));return f;};
async function reply(action,data){try{await action(form(data));return'OK';}catch(e){if(!e.message.startsWith('REDIRECT:'))throw e;return decodeURIComponent(e.message);}}
(async()=>{let company,agency,admin;try{
 agency=await db.agencija.create({data:{naziv:'Concurrent bank fixture'}});
 company=await db.firma.create({data:{agencija_id:agency.id,naziv:'Concurrent statement '+randomUUID()}});
 const year=await db.poslovnaGodina.create({data:{firma_id:company.id,godina:2026,datum_od:date('2026-01-01'),datum_do:date('2026-12-31')}});
 admin=await db.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
 const type=await db.vrstaNaloga.findFirst({where:{sifra:'BANK_STATEMENT',aktivan:true}})||await db.vrstaNaloga.create({data:{sifra:'BANK_STATEMENT',naziv:'Izvodi',prefiks:'IZV',sistemska:true}});
 const bankAccount=await db.firmaKonto.create({data:{firma_id:company.id,sifra:'2410',naziv:'Bank',tip_konta:'analiticko'}});
 const income=await db.firmaKonto.create({data:{firma_id:company.id,sifra:'6000',naziv:'Income',tip_konta:'analiticko'}});
 const bank=await db.firmaBankovniRacun.create({data:{agencija_id:agency.id,firma_id:company.id,naziv_banke:'Fixture bank',broj_racuna:'530-5555-55'}});
 await db.bankStatementAccountSetting.create({data:{agencija_id:agency.id,firma_id:company.id,company_bank_account_id:bank.id,bank_account_konto_id:bankAccount.id,journal_type_id:type.id}});
 const scope={agencija_id:agency.id,firma_id:company.id,poslovna_godina_id:year.id};
 const statement=await db.bankStatement.create({data:{...scope,company_bank_account_id:bank.id,bank_account_konto_id:bankAccount.id,statement_number:'1',statement_date:date('2026-06-20'),status:'READY',total_inflow:'20',closing_balance:'20',lines:{create:{line_number:1,posting_date:date('2026-06-20'),direction:'INFLOW',inflow_amount:'20',credit_account_id:income.id,description:'Payment',posting_status:'READY'}}}});
 const line=await db.bankStatementLine.findFirstOrThrow({where:{bank_statement_id:statement.id}});
 const load=sourceLoader({'@/lib/prisma':{prisma:db},'@/lib/auth':{getCurrentUser:async()=>admin,isDirectFiscalTenantUser:()=>false,requireAnyRole:async()=>admin},'@/lib/work-context':{readWorkContext:async()=>({firmaId:company.id,poslovnaGodinaId:year.id})},'next/cache':{revalidatePath(){}},'next/headers':{headers:async()=>new Map()},'next/navigation':{redirect:url=>{throw Error('REDIRECT:'+url);}}});
 const service=load('src/lib/bank-statement-service.ts'),life=load('src/lib/bank-statement-lifecycle.ts');
 assert.match(await reply(service.postSelectedBankStatements,{statement_id:statement.id}),/izvodi_proknjizeni/);
 const posted=await db.bankStatement.findUniqueOrThrow({where:{id:statement.id}});
 const actor={userId:admin.id,agencyId:agency.id};
 await Promise.all([life.reopenBankStatement(actor,{statementId:statement.id}),life.reopenBankStatement(actor,{statementId:statement.id})]);
 assert.equal(await db.auditLog.count({where:{entitet_id:statement.id,akcija:'reopen_statement'}}),1);
 assert.equal((await db.nalog.findUniqueOrThrow({where:{id:posted.journal_id}})).status,'DRAFT');
 const draft=await db.bankStatement.findUniqueOrThrow({where:{id:statement.id}});
 const edit={statement_id:statement.id,statement_version:draft.updated_at.toISOString(),line_id:line.id,line_direction:'INFLOW',credit_account_code:'6000'};
 const edits=await Promise.all([reply(service.updateBankStatementLines,edit),reply(service.updateBankStatementLines,edit)]);
 assert.equal(edits.filter(r=>r.includes('stavke_sacuvane')).length,1,edits.join('\n'));assert.equal(edits.filter(r=>r.includes('izvod_promijenjen')).length,1,edits.join('\n'));
 const posts=await Promise.all([reply(service.postSelectedBankStatements,{statement_id:statement.id}),reply(service.postSelectedBankStatements,{statement_id:statement.id})]);
 assert.equal(posts.filter(r=>r.includes('izvodi_proknjizeni')).length,1,posts.join('\n'));
 assert.equal(await db.nalog.count({where:{izvorni_dokument_id:statement.id}}),1);
 assert.equal(await db.stavkaNaloga.count({where:{nalog_id:posted.journal_id}}),2);
 const totals=await db.stavkaNaloga.aggregate({where:{nalog_id:posted.journal_id},_sum:{duguje:true,potrazuje:true}});assert.equal(Number(totals._sum.duguje),20);assert.equal(Number(totals._sum.potrazuje),20);
 // A closing year wins before the waiting reopen; there is no partially reopened state.
 let release,lockedResolve;const locked=new Promise(resolve=>{lockedResolve=resolve;});const gate=new Promise(resolve=>{release=resolve;});
 const closing=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM firme WHERE id=${company.id}::uuid FOR UPDATE`;await tx.$queryRaw`SELECT id FROM poslovne_godine WHERE id=${year.id}::uuid FOR UPDATE`;await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:true}});lockedResolve();await gate;},{timeout:15000});
 await locked;const waiting=life.reopenBankStatement(actor,{statementId:statement.id});release();await closing;await assert.rejects(()=>waiting,/godina_zakljucena/);
 assert.equal((await db.bankStatement.findUniqueOrThrow({where:{id:statement.id}})).status,'POSTED');assert.equal((await db.nalog.findUniqueOrThrow({where:{id:posted.journal_id}})).status,'POSTED');
 await db.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:false}});
 console.log('PASS concurrent bank reopen/edit/repost: one audit, stale edit rejected, one unchanged journal/number, no duplicate lines, concurrent year close blocks reopen.');
}finally{
 if(company){const {purgeCompanyData}=sourceLoader({'@/lib/prisma':{prisma:db}})('src/lib/company-purge.ts');await db.$transaction(tx=>purgeCompanyData(tx,{agencijaId:agency.id,firmaId:company.id,potvrdaNaziva:company.naziv,korisnikId:admin?.id}),{timeout:30000});}
 await db.$disconnect();
}})().catch(e=>{console.error(e);process.exitCode=1});
