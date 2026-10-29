/* eslint-disable @typescript-eslint/no-require-imports -- Real isolated DB, no real mail requests. */
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
if(!process.env.TEST_DATABASE_URL||!/_test(?:_|$)/.test(new URL(process.env.TEST_DATABASE_URL).pathname))throw Error('Isolated TEST_DATABASE_URL required');
process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
const assert=require('node:assert/strict'),{randomUUID,randomBytes}=require('node:crypto'),{PrismaClient}=require('@prisma/client');
const {sourceLoader,transactionProxy}=require('../tests/helpers/source-loader.cjs'),{migrateLegacyMail}=require('./migrate-imap-account.cjs');
const db=new PrismaClient(),rollback=Error('ROLLBACK_MAIL_ACCOUNTS');
const form=o=>{const f=new FormData();for(const[k,v]of Object.entries(o))f.set(k,String(v));return f};
async function call(action,input){try{await action(form(input));throw Error('NO_REDIRECT')}catch(e){if(!e.message.startsWith('REDIRECT:'))throw e;return e.message}}
(async()=>{try{await db.$transaction(async tx=>{
 process.env.MAIL_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const agency=await tx.agencija.create({data:{naziv:'Mail accounts QA'}}),other=await tx.agencija.create({data:{naziv:'Other mail QA'}});
 const user=await tx.korisnik.create({data:{agencija_id:agency.id,rola:'admin_agencije',korisnicko_ime:randomUUID(),lozinka_hash:'disabled'}});
 const firm=await tx.firma.create({data:{agencija_id:agency.id,naziv:'Mail firm QA'}}),sibling=await tx.firma.create({data:{agencija_id:agency.id,naziv:'Mail sibling QA'}});
 const year=await tx.poslovnaGodina.create({data:{firma_id:firm.id,godina:2026,datum_od:new Date('2026-01-01'),datum_do:new Date('2026-12-31')}});
 const setting=await tx.firmaMailPodesavanje.create({data:{agencija_id:agency.id,firma_id:firm.id,folder:'Izvodi',ukljuci_inbox:false,pravila:[{sender:'bank@example.com',subject:'Izvod',attachment:''}]}});
 const history=await tx.mailIzvodObrada.create({data:{agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id,kljuc:'legacy-hash:1',poruka_kljuc:'legacy-hash',naziv_priloga:'izvod.xml',status:'ERROR',updated_by:user.id}});
 const env={MAIL_ENCRYPTION_KEY:process.env.MAIL_ENCRYPTION_KEY,IMAP_AGENCY_ID:agency.id,IMAP_HOST:'imap.example.com',IMAP_PORT:'993',IMAP_SECURE:'true',IMAP_USER:'qa@example.com',IMAP_PASS:' unchanged $ pass ',IMAP_FOLDER:'INBOX',BANK_AUTOMATION_ENABLED:'true'};
 const proxy=transactionProxy(tx),migrated=await migrateLegacyMail(proxy,env),account=migrated.account;
 assert.equal(migrated.linkedCompanies,1);assert.equal(migrated.historyRecords,1);assert.equal(account.automatska_obrada,true);
 let pref=await tx.firmaMailPodesavanje.findUniqueOrThrow({where:{id:setting.id}});assert.equal(pref.mail_nalog_id,account.id);assert.deepEqual(pref.pravila,setting.pravila);assert.equal(pref.folder,'Izvodi');
 const savedHistory=await tx.mailIzvodObrada.findUniqueOrThrow({where:{id:history.id}});assert.equal(savedHistory.kljuc,account.id+':legacy-hash:1');assert.equal(savedHistory.poruka_kljuc,account.id+':legacy-hash');
 assert.equal((await migrateLegacyMail(proxy,env)).created,false);assert.equal(await tx.agencijaMailNalog.count({where:{agencija_id:agency.id}}),1);assert.equal(await tx.auditLog.count({where:{agencija_id:agency.id,akcija:'MIGRATE_IMAP_ACCOUNT'}}),1);
 const mocks={'@/lib/prisma':{prisma:proxy},'@/app/agencija/izvodi/imap/access':{requireImapAgency:async()=>user},'next/navigation':{redirect:u=>{throw Error('REDIRECT:'+u)}},'next/headers':{headers:async()=>new Map()},'next/cache':{revalidatePath(){}}};
 const load=sourceLoader(mocks),secret=load('src/lib/mail-secrets.ts'),service=load('src/lib/mail-accounts.ts'),configs=load('src/lib/company-mail-settings.ts');
 assert.equal(secret.decryptMailPassword(account.lozinka_sifrovana,agency.id,account.id),env.IMAP_PASS);
 assert.ok(!JSON.stringify(await service.agencyMailAccounts(agency.id)).includes('lozinka_sifrovana'));assert.equal((await service.agencyMailAccounts(other.id)).length,0);
 const opts=await service.mailAccountOptions(agency.id,account.id,firm.id);assert.equal(opts.auth.pass,env.IMAP_PASS);assert.equal(opts.tls.rejectUnauthorized,true);assert.equal(opts.logger,false);
 await assert.rejects(service.mailAccountOptions(other.id,account.id),/dostupan/);await assert.rejects(service.mailAccountOptions(agency.id,account.id,sibling.id),/dostupan/);
 assert.equal((await configs.getCompanyMailConfigs(agency.id))[0].mailAccountId,account.id);assert.equal((await configs.getCompanyMailConfigs(other.id)).length,0);
 // Composite FK prevents assigning another agency's credentials even by direct SQL.
 const foreign=await tx.agencijaMailNalog.create({data:{agencija_id:other.id,naziv:'Foreign',host:'imap.other.test',korisnicko_ime:'other',lozinka_sifrovana:'fixture'}});
 await assert.rejects(proxy.$transaction(t=>t.firmaMailPodesavanje.update({where:{id:pref.id},data:{mail_nalog_id:foreign.id}})));
 const actions=load('src/app/agencija/podesavanja/mail-nalozi/actions.ts');
 const input={naziv:'Another mail',host:'imap.second.test',korisnicko_ime:'second@example.com',lozinka:'new pass',aktivan:'on'};
 assert.match(await call(actions.saveMailAccount,input),/sacuvano/);
 const second=await tx.agencijaMailNalog.findFirstOrThrow({where:{agencija_id:agency.id,host:input.host}});assert.equal(second.automatska_obrada,false,'new accounts do not opt into automatic financial posting');
 assert.equal(secret.decryptMailPassword(second.lozinka_sifrovana,agency.id,second.id),'new pass');
 const edit={...input,id:second.id,version:second.updated_at.toISOString(),lozinka:''};
 assert.match(await call(actions.saveMailAccount,{...edit,version:'stale'}),/greska/);
 assert.match(await call(actions.saveMailAccount,{...edit,host:'different.example.com'}),/greska/);
 assert.match(await call(actions.saveMailAccount,edit),/sacuvano/);assert.equal((await tx.agencijaMailNalog.findUniqueOrThrow({where:{id:second.id}})).lozinka_sifrovana,second.lozinka_sifrovana);
 const failed=sourceLoader({...mocks,'@/lib/audit':{auditLogInTransaction:async()=>{throw Error('AUDIT_FAILURE')}}})('src/app/agencija/podesavanja/mail-nalozi/actions.ts');
 assert.match(await call(failed.saveMailAccount,{...input,host:'rollback.example.com'}),/greska/);assert.equal(await tx.agencijaMailNalog.count({where:{host:'rollback.example.com'}}),0);
 await tx.agencijaMailNalog.update({where:{id:account.id},data:{aktivan:false}});assert.equal((await configs.getCompanyMailConfigs(agency.id)).length,0);await assert.rejects(service.mailAccountOptions(agency.id,account.id),/dostupan/);await tx.agencijaMailNalog.update({where:{id:account.id},data:{aktivan:true,automatska_obrada:false}});assert.equal((await configs.getCompanyMailConfigs(agency.id,true)).length,0);
 // Company settings cannot select another tenant and keep their history when changing accounts.
 const settingsMocks={...mocks,
  '@/app/agencija/izvodi/imap/access':{requireImapAgency:async()=>user,requireImapCompany:async id=>{assert.equal(id,firm.id);return{user,firma:firm}}},
  '@/app/agencija/izvodi/_shared':{getIzvodiContext:async()=>({user,firma:firm,godina:year})},
  '@/lib/imap-mail':{MailError:class extends Error{},listMailFolders:async(a,id)=>{assert.equal(a,agency.id);assert.ok([account.id,second.id].includes(id));return[{path:'Izvodi',selectable:true}]}}
 };
 const settingsActions=sourceLoader(settingsMocks)('src/app/agencija/izvodi/podesavanja/mail-actions.ts');
 const current=await tx.firmaMailPodesavanje.findUniqueOrThrow({where:{id:setting.id}});
 const values={firma_id:firm.id,godina_id:year.id,version:current.updated_at.toISOString(),mail_nalog_id:second.id,folder:'Izvodi',aktivno:'on',pravila:JSON.stringify(setting.pravila)};
 let result=await settingsActions.saveCompanyMailSettings({message:'',ok:false},form({...values,mail_nalog_id:foreign.id}));assert.equal(result.ok,false);
 result=await settingsActions.saveCompanyMailSettings({message:'',ok:false},form({...values,version:'stale'}));assert.equal(result.ok,false);
 assert.match(await call(f=>settingsActions.saveCompanyMailSettings({message:'',ok:false},f),values),/mail_sacuvana/);
 assert.equal((await tx.firmaMailPodesavanje.findUniqueOrThrow({where:{id:setting.id}})).mail_nalog_id,second.id);
 assert.equal((await tx.mailIzvodObrada.findUniqueOrThrow({where:{id:history.id}})).mail_nalog_id,account.id);
 await assert.rejects(service.mailAccountOptions(agency.id,account.id,firm.id),/dostupan/);
 const auditFailure=sourceLoader({...settingsMocks,'@/lib/audit':{auditLogInTransaction:async()=>{throw Error('AUDIT_FAILURE')}}})('src/app/agencija/izvodi/podesavanja/mail-actions.ts');
 const latest=await tx.firmaMailPodesavanje.findUniqueOrThrow({where:{id:setting.id}});
 result=await auditFailure.saveCompanyMailSettings({message:'',ok:false},form({...values,version:latest.updated_at.toISOString(),mail_nalog_id:account.id}));assert.equal(result.ok,false);
 assert.equal((await tx.firmaMailPodesavanje.findUniqueOrThrow({where:{id:setting.id}})).mail_nalog_id,second.id,'account assignment and audit roll back together');
 const publicPage=await load('src/app/agencija/podesavanja/mail-nalozi/page.tsx').default({searchParams:Promise.resolve({})});
 const html=require('react-dom/server').renderToStaticMarkup(publicPage);assert.ok(!html.includes(account.lozinka_sifrovana));assert.ok(!html.includes(env.IMAP_PASS));assert.match(html,/Mail nalozi agencije/);
 const audit=JSON.stringify(await tx.auditLog.findMany({where:{agencija_id:agency.id}}));assert.ok(!audit.includes(env.IMAP_PASS));assert.ok(!audit.includes(account.lozinka_sifrovana));
 await load('src/lib/company-purge.ts').purgeCompanyData(tx,{agencijaId:agency.id,firmaId:firm.id,potvrdaNaziva:firm.naziv,korisnikId:user.id});
 assert.equal(await tx.mailIzvodObrada.count({where:{firma_id:firm.id}}),0);assert.equal(await tx.firmaMailPodesavanje.count({where:{firma_id:firm.id}}),0);assert.ok(await tx.agencijaMailNalog.findUnique({where:{id:account.id}}));
 console.log('PASS mail accounts: encrypted DB transfer, preserved folders/rules/history, idempotence, tenant/firm/FK isolation, no UI/audit secrets, update/version guards, opt-in automation, rollback and company purge retains agency account');throw rollback;
},{timeout:90000})}catch(e){if(e!==rollback)throw e}finally{await db.$disconnect()}})().catch(e=>{console.error(e);process.exitCode=1});
