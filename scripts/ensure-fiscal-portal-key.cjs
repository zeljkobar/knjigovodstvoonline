/* eslint-disable @typescript-eslint/no-require-imports -- Deployment helper; never prints secrets. */
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const fs=require('node:fs'),{randomBytes}=require('node:crypto'),{PrismaClient}=require('@prisma/client');
(async()=>{
 const existing=process.env.FISCAL_PORTAL_ENCRYPTION_KEY;
 if(existing){if(!/^[A-Za-z0-9+/]{43}=$/.test(existing))throw Error('INVALID_KEY');console.log('Fiskalni portali: postojeći ključ je podešen i nije mijenjan.');return;}
 const db=new PrismaClient();
 try{if(await db.firmaFiskalniPortal.count())throw Error('RESTORE_KEY');
  let raw=fs.readFileSync('.env','utf8');const value=randomBytes(32).toString('base64');
  if(/^\s*FISCAL_PORTAL_ENCRYPTION_KEY\s*=/m.test(raw))raw=raw.replace(/^\s*FISCAL_PORTAL_ENCRYPTION_KEY\s*=.*$/m,'FISCAL_PORTAL_ENCRYPTION_KEY="'+value+'"');
  else raw+='\n# Ključ fiskalnih portala; sačuvati uz sigurni backup baze.\nFISCAL_PORTAL_ENCRYPTION_KEY="'+value+'"\n';
  fs.writeFileSync('.env',raw,{mode:0o600});fs.chmodSync('.env',0o600);
  console.log('Fiskalni portali: novi ključ je sačuvan u .env bez ispisa. Sačuvajte ga uz backup i restartujte aplikaciju.');
 }finally{await db.$disconnect();}
})().catch(()=>{console.error('Ključ nije podešen. Provjerite migracije, .env i postojeće naloge; za postojeće podatke vratite prvobitni ključ iz backupa.');process.exitCode=1;});
