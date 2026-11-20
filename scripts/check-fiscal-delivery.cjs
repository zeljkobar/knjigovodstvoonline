/* eslint-disable @typescript-eslint/no-require-imports -- Local rollback fixtures. No SMTP or fiscal API imports. */
require('dotenv').config();const assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto'),{PrismaClient}=require('@prisma/client');
const {sourceLoader,transactionProxy}=require('../tests/helpers/source-loader.cjs');const db=new PrismaClient(),rollback=Error('ROLLBACK_DELIVERY');
(async()=>{try{await db.$transaction(async tx=>{
 const agency=await tx.agencija.create({data:{naziv:'Delivery rollback fixture'}}),otherAgency=await tx.agencija.create({data:{naziv:'Foreign rollback fixture'}});
 const firm=await tx.firma.create({data:{agencija_id:agency.id,naziv:'Delivery rollback fixture'}}),other=await tx.firma.create({data:{agencija_id:otherAgency.id,naziv:'Foreign rollback fixture'}});
 const year=await tx.poslovnaGodina.create({data:{firma_id:firm.id,godina:2026,datum_od:new Date('2026-01-01Z'),datum_do:new Date('2026-12-31Z')}});
 const user=await tx.korisnik.create({data:{korisnicko_ime:randomUUID(),rola:'klijent',agencija_id:agency.id,lozinka_hash:'disabled-fixture'}});
 const context={surface:'PORTAL',user,firma:firm,year,channels:['OFFICE']};let failAudit=false;
 const service=sourceLoader({'./prisma':{prisma:transactionProxy(tx)},'./fiscal-delivery-context':{deliveryAllowed:async()=>true},'./audit':{auditLogInTransaction:async()=>{if(failAudit)throw Error('AUDIT_FAILED');}}})('src/lib/fiscal-delivery.ts');
 const bytes=Buffer.from('%PDF-fixture');const draft=await tx.fiskalnaDostava.create({data:{agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id,korisnik_id:user.id,povrsina:'PORTAL',izvor:{type:'invoice',channels:['OFFICE'],partnerKey:'FIRMA'},naziv:'fixture.pdf',mime:'application/pdf',prilog:bytes,sha256:createHash('sha256').update(bytes).digest('hex'),velicina:bytes.length,expires_at:new Date(Date.now()+86400000)}});
 await assert.rejects(service.authorizedDelivery({...context,firma:other,user:{...user,agencija_id:otherAgency.id}},draft.id),/DOSTAVA_NIJE_DOSTUPNA/);
 const form=new FormData();form.set('primalac','buyer@example.test');form.set('naslov','Invoice');form.set('poruka','Fixture');form.set('save_contact','on');form.set('contact_name','Accounting');form.set('default_contact','on');
 failAudit=true;await assert.rejects(service.queueDelivery(context,draft.id,form),/AUDIT_FAILED/);assert.equal((await tx.fiskalnaDostava.findUniqueOrThrow({where:{id:draft.id}})).status,'DRAFT');assert.equal(await tx.fiskalniKontakt.count({where:{firma_id:firm.id}}),0);
 failAudit=false;await service.queueDelivery(context,draft.id,form);await assert.rejects(service.queueDelivery(context,draft.id,form));assert.equal(await tx.fiskalniKontakt.count({where:{firma_id:firm.id}}),1);
 await tx.fiskalnaDostava.update({where:{id:draft.id},data:{status:'UNKNOWN'}});await assert.rejects(service.repeatDelivery(context,draft.id,false));const repeated=await service.repeatDelivery(context,draft.id,true);assert.notEqual(repeated.id,draft.id);assert.equal(repeated.sha256,draft.sha256);assert.deepEqual(Buffer.from(repeated.prilog),bytes);
 const contact=await tx.fiskalniKontakt.findFirstOrThrow({where:{firma_id:firm.id}});const removal=new FormData();removal.set('remove','true');await service.editDeliveryContact(context,contact.id,removal);assert.equal((await tx.fiskalniKontakt.findUniqueOrThrow({where:{id:contact.id}})).is_deleted,true);
 const purge=sourceLoader()('src/lib/company-purge.ts');await purge.purgeCompanyData(tx,{agencijaId:agency.id,firmaId:firm.id,potvrdaNaziva:firm.naziv,korisnikId:user.id});
 assert.equal(await tx.fiskalnaDostava.count({where:{firma_id:firm.id}}),0);assert.equal(await tx.fiskalniKontakt.count({where:{firma_id:firm.id}}),0);assert.equal(await tx.firma.count({where:{id:firm.id}}),0);assert.equal(await tx.firma.count({where:{id:other.id}}),1);
 console.log('Delivery scope, queue/contact audit rollback, duplicate protection, explicit repeat, soft-delete and full company purge PASS. Fixtures roll back.');throw rollback;
 },{timeout:30000});}catch(e){if(e!==rollback)throw e;}finally{await db.$disconnect();}})().catch(e=>{console.error(e);process.exitCode=1;});
