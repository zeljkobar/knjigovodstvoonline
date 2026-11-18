/* eslint-disable @typescript-eslint/no-require-imports -- PostgreSQL rollback regression. */
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PrismaClient}=require('@prisma/client');
const {sourceLoader}=require('../tests/helpers/source-loader.cjs');
const load=sourceLoader({'next/headers':{headers:async()=>new Map()}});
const {agencyPartnerClient}=load('src/lib/agency-partner-client.ts');
const {saveAgencyPartner}=load('src/lib/agency-partner-edit.ts');
const {purgeCompanyData}=load('src/lib/company-purge.ts');
const db=new PrismaClient(),rollback=new Error('ROLLBACK_AGENCY_PARTNERS');
const agencyA=randomUUID(),agencyB=randomUUID();let activeAgency=agencyA;
const scoped=agencyPartnerClient(db,async()=>activeAgency);
(async()=>{try{await scoped.$transaction(async tx=>{
 await tx.agencija.createMany({data:[{id:agencyA,naziv:'Override QA A'},{id:agencyB,naziv:'Override QA B'}]});
 const user=await tx.korisnik.create({data:{agencija_id:agencyA,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
 const firm=await tx.firma.create({data:{agencija_id:agencyA,naziv:'Override fixture'}});
 const partner=await tx.komitent.create({data:{naziv:'Canonical '+randomUUID(),pib:'QA'+randomUUID(),scope:'GLOBAL',adresa:'Global address'}});
 const fields=Object.fromEntries(load('src/lib/agency-partner-projection.ts').agencyPartnerFields.map(key=>[key,partner[key]]));
 const input={agencijaId:agencyA,firmaId:firm.id,userId:user.id,admin:true,partnerId:partner.id,version:0,
  data:{...fields,naziv:'Agency name '+randomUUID(),adresa:'Agency address',pib:'EDIT'+randomUUID()},
  settings:{tip_komitenta:'kupac_dobavljac',sifra_u_firmi:'QA',rok_placanja_dana:null,napomena:null}};
 await saveAgencyPartner(tx,input);
 const got=await tx.komitent.findUniqueOrThrow({where:{id:partner.id},select:{id:true,naziv:true,pib:true,scope:true}});
 assert.equal(got.id,partner.id);assert.equal(got.naziv,input.data.naziv);assert.equal(got.pib,input.data.pib);assert.equal(got.scope,'GLOBAL');assert.equal(got.agencijske_izmjene,undefined);
 assert.equal((await tx.komitent.findMany({where:{naziv:{equals:input.data.naziv}},take:20})).filter(p=>p.id===partner.id).length,1);
 assert.equal(await tx.komitent.count({where:{id:partner.id,naziv:partner.naziv}}),0);
 assert.equal(await tx.komitent.count({where:{id:partner.id,naziv:input.data.naziv}}),1);
 const nested=await tx.firmaKomitent.findUniqueOrThrow({where:{firma_id_komitent_id:{firma_id:firm.id,komitent_id:partner.id}},select:{komitent_id:true,komitent:{select:{naziv:true}}}});
 assert.equal(nested.komitent_id,partner.id);assert.equal(nested.komitent.naziv,input.data.naziv);
 const api=sourceLoader({
  '@/lib/prisma':{prisma:tx},
  '@/lib/auth':{getCurrentUser:async()=>({id:user.id,rola:'admin_agencije',agencija_id:agencyA}),isDirectFiscalTenantUser:()=>false},
  '@/lib/work-context':{readWorkContext:async()=>({firmaId:firm.id})},
  '@/lib/permissions':{hasAnyPermission:async()=>true,hasPermission:async()=>true}
 })('src/app/api/partners/search/route.ts');
 const response=await api.GET(new Request('http://localhost/api/partners/search?q='+encodeURIComponent(input.data.naziv)));
 const results=(await response.json()).results.filter(row=>row.id===partner.id);
 assert.equal(results.length,1);assert.equal(results[0].scope,'AGENCY');assert.equal(results[0].naziv,input.data.naziv);
 activeAgency=agencyB;
 assert.equal((await tx.komitent.findUniqueOrThrow({where:{id:partner.id}})).naziv,partner.naziv);
 assert.equal(await tx.komitent.count({where:{id:partner.id,naziv:input.data.naziv}}),0);
 activeAgency=agencyA;
 await assert.rejects(()=>saveAgencyPartner(tx,input),/partner_verzija/);
 await assert.rejects(()=>saveAgencyPartner(tx,{...input,agencijaId:agencyB}),/partner_greska/);
 const own=await tx.komitent.create({data:{naziv:'Not global',scope:'AGENCY',agencija_id:agencyA}});
 await assert.rejects(()=>saveAgencyPartner(tx,{...input,partnerId:own.id}),/partner_greska/);
 const raw=await tx.$queryRawUnsafe('SELECT naziv, pib, scope FROM komitenti WHERE id=$1::uuid',partner.id);
 assert.equal(raw[0].naziv,partner.naziv);assert.equal(raw[0].pib,partner.pib);assert.equal(raw[0].scope,'GLOBAL');
 const before=await tx.auditLog.count({where:{entitet_id:partner.id,akcija:'agency_override'}});assert.equal(before,1);
 // Audit failure must roll back the overlay and company settings together.
 await tx.$executeRawUnsafe('SAVEPOINT override_audit_qa');
 try{
  const failing=sourceLoader({'@/lib/audit':{auditLogInTransaction:async()=>{throw Error('QA audit failure');}}})('src/lib/agency-partner-edit.ts');
  await assert.rejects(()=>failing.saveAgencyPartner(tx,{...input,version:1,data:{...input.data,naziv:'Should rollback'}}),/QA audit failure/);
 }finally{await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT override_audit_qa');}
 assert.equal((await tx.komitent.findUniqueOrThrow({where:{id:partner.id}})).naziv,input.data.naziv);
 await purgeCompanyData(tx,{agencijaId:agencyA,firmaId:firm.id,potvrdaNaziva:firm.naziv,korisnikId:user.id});
 assert.ok(await tx.agencijaKomitentIzmjena.findUnique({where:{agencija_id_komitent_id:{agencija_id:agencyA,komitent_id:partner.id}}}));
 assert.equal(await tx.firma.count({where:{id:firm.id}}),0);
 console.log('Agency partner DB: identity, effective search/count, nested reads, tenant isolation, versions, audit rollback and company purge passed.');
 throw rollback;
},{timeout:60000});}catch(error){if(error!==rollback)throw error;}finally{await db.$disconnect();}})().catch(error=>{console.error(error);process.exitCode=1;});
