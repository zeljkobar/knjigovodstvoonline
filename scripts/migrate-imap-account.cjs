/* eslint-disable @typescript-eslint/no-require-imports -- Deployment migration; never prints secrets. */
const {createCipheriv,createDecipheriv,randomBytes,randomUUID}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
function cryptKey(value){if(!/^[A-Za-z0-9+/]{43}=$/.test(value||''))throw Error('KEY');const key=Buffer.from(value,'base64');if(key.length!==32)throw Error('KEY');return key}
function encrypt(password,key,agency,id){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',cryptKey(key),iv);cipher.setAAD(Buffer.from(`mail:${agency}:${id}`));const data=Buffer.concat([cipher.update(password,'utf8'),cipher.final()]);return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),data.toString('base64')].join('.')}
function decrypt(value,key,agency,id){const[v,iv,tag,data,extra]=value.split('.');if(v!=='v1'||extra)throw Error('SECRET');const cipher=createDecipheriv('aes-256-gcm',cryptKey(key),Buffer.from(iv,'base64'));cipher.setAAD(Buffer.from(`mail:${agency}:${id}`));cipher.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([cipher.update(Buffer.from(data,'base64')),cipher.final()]).toString('utf8')}
async function migrateLegacyMail(db,env){
 const agencyId=env.IMAP_AGENCY_ID?.trim(),host=env.IMAP_HOST?.trim().toLowerCase(),username=env.IMAP_USER?.trim(),password=env.IMAP_PASS;
 if(!agencyId||!host||!username||!password||env.IMAP_PORT!=='993'||env.IMAP_SECURE!=='true'||env.IMAP_FOLDER!=='INBOX')throw Error('LEGACY_CONFIG');
 cryptKey(env.MAIL_ENCRYPTION_KEY);
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM agencije WHERE id=${agencyId}::uuid AND aktivan=true AND is_deleted=false FOR UPDATE`;
  const agency=await tx.agencija.findFirst({where:{id:agencyId,aktivan:true,is_deleted:false}});if(!agency)throw Error('AGENCY');
  const user=await tx.korisnik.findFirst({where:{agencija_id:agencyId,rola:'admin_agencije',aktivan:true,is_deleted:false},orderBy:{id:'asc'}});if(!user)throw Error('USER');
  let account=await tx.agencijaMailNalog.findUnique({where:{agencija_id_host_korisnicko_ime:{agencija_id:agencyId,host,korisnicko_ime:username}}});
  let created=false;
  if(account){if(account.is_deleted||!account.aktivan||decrypt(account.lozinka_sifrovana,env.MAIL_ENCRYPTION_KEY,agencyId,account.id)!==password)throw Error('EXISTING_ACCOUNT');}
  else{const id=randomUUID();account=await tx.agencijaMailNalog.create({data:{id,agencija_id:agencyId,naziv:'Postojeći mail agencije',host,port:993,korisnicko_ime:username,lozinka_sifrovana:encrypt(password,env.MAIL_ENCRYPTION_KEY,agencyId,id),automatska_obrada:env.BANK_AUTOMATION_ENABLED==='true',created_by:user.id,updated_by:user.id}});created=true;}
  const settings=await tx.firmaMailPodesavanje.updateMany({where:{agencija_id:agencyId,mail_nalog_id:null,firma:{agencija_id:agencyId}},data:{mail_nalog_id:account.id}});
  // Preserve successful origin keys: namespace the already-hashed legacy message key once.
  const history=await tx.$executeRaw`UPDATE mail_izvod_obrade SET mail_nalog_id=${account.id}::uuid,poruka_kljuc=${account.id}||':'||poruka_kljuc,kljuc=${account.id}||':'||kljuc WHERE agencija_id=${agencyId}::uuid AND mail_nalog_id IS NULL`;
  if(created||settings.count||history)await tx.auditLog.create({data:{korisnik_id:user.id,agencija_id:agencyId,modul:'izvodi',akcija:'MIGRATE_IMAP_ACCOUNT',tip_entiteta:'AgencijaMailNalog',entitet_id:account.id,nova_vrijednost:{created,linkedCompanies:settings.count,historyRecords:history}}});
  return {account,created,linkedCompanies:settings.count,historyRecords:history};
 });
}
exports.migrateLegacyMail=migrateLegacyMail;
exports.decryptMigrationPassword=decrypt;
async function main(){
 require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
 const {PrismaClient}=require('@prisma/client'),{ImapFlow}=require('imapflow');
 const db=new PrismaClient();
 try{
  const file=path.join(process.cwd(),'.env');let raw=fs.readFileSync(file,'utf8');
  if(!process.env.IMAP_AGENCY_ID){
   cryptKey(process.env.MAIL_ENCRYPTION_KEY);
   const accounts=await db.agencijaMailNalog.findMany({where:{is_deleted:false,aktivan:true}});
   if(!accounts.length)throw Error('NO_ACCOUNT');
   for(const a of accounts)decrypt(a.lozinka_sifrovana,process.env.MAIL_ENCRYPTION_KEY,a.agencija_id,a.id);
   console.log('Mail nalozi su već u bazi; nema stare IMAP konfiguracije za prenos.');return;
  }
  if(!process.env.MAIL_ENCRYPTION_KEY){
   if(await db.agencijaMailNalog.count())throw Error('MISSING_EXISTING_KEY');
   const key=randomBytes(32).toString('base64');
   if(/^\s*MAIL_ENCRYPTION_KEY\s*=/m.test(raw))raw=raw.replace(/^\s*MAIL_ENCRYPTION_KEY\s*=.*$/m,`MAIL_ENCRYPTION_KEY="${key}"`);else raw+=`\n# Šifrovanje mail lozinki; sačuvati ovaj ključ u sigurnoj rezervnoj kopiji.\nMAIL_ENCRYPTION_KEY="${key}"\n`;
   fs.writeFileSync(file,raw,{mode:0o600});fs.chmodSync(file,0o600);process.env.MAIL_ENCRYPTION_KEY=key;
  }
  const result=await migrateLegacyMail(db,process.env),a=result.account;
  const pass=decrypt(a.lozinka_sifrovana,process.env.MAIL_ENCRYPTION_KEY,a.agencija_id,a.id);
  const client=new ImapFlow({host:a.host,port:993,secure:true,servername:a.host,auth:{user:a.korisnicko_ime,pass},tls:{rejectUnauthorized:true,minVersion:'TLSv1.2',servername:a.host},logger:false,logRaw:false,emitLogs:false,disableAutoIdle:true,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:10000});
  let count;const timer=setTimeout(()=>client.close(),25000);client.on('error',()=>{});
  try{await client.connect();const box=await client.mailboxOpen('INBOX',{readOnly:true});if(!box.readOnly)throw Error('READONLY');count=box.exists;await client.logout();}finally{clearTimeout(timer);client.close();}
  // Remove only legacy IMAP credentials after successful DB decrypt and real read-only probe.
  raw=fs.readFileSync(file,'utf8').replace(/^\s*IMAP_(?:AGENCY_ID|HOST|PORT|SECURE|USER|PASS|FOLDER)\s*=.*(?:\r?\n|$)/gm,'');
  fs.writeFileSync(file,raw,{mode:0o600});fs.chmodSync(file,0o600);
  console.log(JSON.stringify({migrated:true,linkedCompanies:result.linkedCompanies,historyRecords:result.historyRecords,readOnlyTest:true,messageCount:count,legacyImapRemoved:true}));
 }finally{await db.$disconnect();}
}
if(require.main===module)main().catch(()=>{console.error('Prenos nije potpuno završen. Stari IMAP podaci ostaju u .env dok provjera veze ne uspije. Provjerite agenciju, migraciju baze, ključ i pristup mail serveru; ponovite istu komandu.');process.exitCode=1});
