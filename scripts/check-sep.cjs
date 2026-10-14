/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS database regression runner. */
// Real PostgreSQL and real PFX validation; synthetic fixtures always roll back.
require('@next/env').loadEnvConfig(process.cwd(), false, { info(){}, error(){} });
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { File } = require('node:buffer');
const { sourceLoader, transactionProxy } = require('../tests/helpers/source-loader.cjs');
const db = new PrismaClient(), rollback = new Error('ROLLBACK_SEP_FIXTURES');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sep-regression-'));
const openssl = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
function run(args) {
  const result = spawnSync(openssl, args, { cwd:folder, encoding:'utf8' });
  if (result.status !== 0) throw new Error('Synthetic PFX generation failed');
}
run(['req','-x509','-newkey','rsa:2048','-nodes','-keyout','key.pem','-out','cert.pem','-days','1','-subj','/CN=SEP Local Regression']);
run(['pkcs12','-export','-out','test.pfx','-inkey','key.pem','-in','cert.pem','-passout','pass:fixture-password']);
const pfx = fs.readFileSync(path.join(folder,'test.pfx'));
const beforeKey = process.env.SEP_ENCRYPTION_KEY;
process.env.SEP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
global.File = File;
(async () => {
  try {
    await db.$transaction(async tx => {
      const agency = await tx.agencija.create({data:{naziv:'SEP regression agency'}});
      const foreign = await tx.agencija.create({data:{naziv:'SEP other agency'}});
      const admin = await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
      const other = await tx.korisnik.create({data:{agencija_id:foreign.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
      const firm = await tx.firma.create({data:{agencija_id:agency.id,naziv:'SEP regression company',pib:'00000000'}});
      let user = {...admin,agencija:{is_fiscal_direct_container:false}}, failAudit = false;
      const audit = sourceLoader({'server-only':{},'next/headers':{headers:async()=>new Map()},'./prisma':{prisma:tx}})('src/lib/audit.ts');
      const mocks = {
        'server-only':{}, 'next/cache':{revalidatePath(){}},
        'next/navigation':{redirect(url){throw new Error('REDIRECT:'+url);}},
        './auth':{getCurrentUser:async()=>user},
        './prisma':{prisma:transactionProxy(tx)}, '@/lib/prisma':{prisma:transactionProxy(tx)},
        './work-context':{readWorkContext:async()=>({firmaId:firm.id})},
        '@/lib/audit':{auditLogInTransaction:async(...args)=>{if(failAudit)throw new Error('AUDIT_FAILED');return audit.auditLogInTransaction(...args);}},
      };
      const load = sourceLoader(mocks);
      const actions = load('src/app/agencija/sep/actions.ts');
      const crypto = load('src/lib/sep-secrets.ts');
      async function save(password='fixture-password') {
        const form = new FormData();
        form.set('sertifikat',new File([pfx],'test.pfx'));form.set('naziv','SEP regression');
        form.set('lozinka',password);form.set('jmbg','0000000000000');
        try {await actions.saveSepCertificate(form);throw new Error('MISSING_REDIRECT');} catch(e) {return e.message;}
      }
      assert.match(await save('wrong-password'), /poruka=sertifikat/);
      assert.equal(await tx.agencijaSepSertifikat.count(),0);
      assert.match(await save(), /poruka=sacuvano/);
      const record = await tx.agencijaSepSertifikat.findFirstOrThrow({where:{korisnik_id:admin.id}});
      assert(!record.sifrovani_podaci.includes('fixture-password'));
      assert.equal(crypto.decryptSepCredentials(record.sifrovani_podaci,`${agency.id}:${admin.id}`).jmbg,'0000000000000');
      const auditRecord = await tx.auditLog.findFirstOrThrow({where:{modul:'sep'}});
      assert.equal(auditRecord.nova_vrijednost,null);assert.equal(auditRecord.stara_vrijednost,null);
      failAudit = true; assert.match(await save(), /poruka=sertifikat/); failAudit = false;
      assert.equal((await tx.agencijaSepSertifikat.findUniqueOrThrow({where:{id:record.id}})).sifrovani_podaci,record.sifrovani_podaci);
      user = {...other,agencija:{is_fiscal_direct_container:false}};
      try {await actions.removeSepCertificate();}catch(e){assert.match(e.message,/poruka=uklonjen/);}
      assert.equal((await tx.agencijaSepSertifikat.findUniqueOrThrow({where:{id:record.id}})).is_deleted,false);
      user = {...admin,rola:'korisnik_agencije',agencija:{is_fiscal_direct_container:false}};
      await assert.rejects(actions.removeSepCertificate(), /ACCESS_DENIED/);
      user.rola = 'admin_agencije';
      const context = load('src/lib/sep-context.ts');
      assert.equal((await context.getSepCompany(firm.id)).firm.id,firm.id);
      await assert.rejects(context.getSepCompany(randomUUID()),/CONTEXT_CHANGED/);
      try {await actions.removeSepCertificate();}catch(e){assert.match(e.message,/poruka=uklonjen/);}
      const removed = await tx.agencijaSepSertifikat.findUniqueOrThrow({where:{id:record.id}});
      assert.equal(removed.is_deleted,true);assert.equal(removed.sifrovani_podaci,null);
      assert.match(await save(), /poruka=sacuvano/);
      assert.equal(await tx.agencijaSepSertifikat.count({where:{korisnik_id:admin.id}}),1);
      console.log('SEP DB: PFX/password validation, encrypted scope, audit rollback, removal and replacement passed.');
      throw rollback;
    }, { timeout:30000 });
  } catch(e) {if(e!==rollback)throw e;}
  finally {
    await db.$disconnect();pfx.fill(0);
    if(beforeKey===undefined)delete process.env.SEP_ENCRYPTION_KEY;else process.env.SEP_ENCRYPTION_KEY=beforeKey;
    // Only this newly-created test directory is removed, never user certificates.
    for (const name of ['key.pem','cert.pem','test.pfx']) {
      const file = path.join(folder,name);
      if(fs.existsSync(file))fs.unlinkSync(file);
    }
    fs.rmdirSync(folder);
  }
})().catch(()=>{console.error('SEP DB regression failed. No real SEP requests were sent.');process.exitCode=1;});
