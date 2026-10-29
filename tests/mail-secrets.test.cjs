/* eslint-disable @typescript-eslint/no-require-imports -- Test actual encryption and public output. */
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomBytes}=require('node:crypto');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const secret=sourceLoader()('src/lib/mail-secrets.ts');
test('mail passwords use random authenticated ciphertext bound to tenant and account',()=>{
 const old=process.env.MAIL_ENCRYPTION_KEY;
 try{
  process.env.MAIL_ENCRYPTION_KEY=randomBytes(32).toString('base64');
  const password='  $čuvaj tačno!  ',a=secret.encryptMailPassword(password,'agency','one'),b=secret.encryptMailPassword(password,'agency','one');
  assert.notEqual(a,b);assert.ok(!a.includes(password));assert.equal(secret.decryptMailPassword(a,'agency','one'),password);
  assert.throws(()=>secret.decryptMailPassword(a,'other','one'),/INVALID/);assert.throws(()=>secret.decryptMailPassword(a,'agency','two'),/INVALID/);
  assert.throws(()=>secret.decryptMailPassword(a.slice(0,-4)+'AAAA','agency','one'),/INVALID/);
  process.env.MAIL_ENCRYPTION_KEY=randomBytes(32).toString('base64');assert.throws(()=>secret.decryptMailPassword(a,'agency','one'),/INVALID/);
  process.env.MAIL_ENCRYPTION_KEY='';assert.equal(secret.mailKeyConfigured(),false);assert.throws(()=>secret.encryptMailPassword(password,'agency','one'),/KEY/);
 }finally{if(old===undefined)delete process.env.MAIL_ENCRYPTION_KEY;else process.env.MAIL_ENCRYPTION_KEY=old;}
});
