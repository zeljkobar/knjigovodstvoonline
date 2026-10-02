require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {PrismaClient}=require('@prisma/client');
const {sourceLoader,transactionProxy}=require('../tests/helpers/source-loader.cjs');
const db=new PrismaClient(),rollback=Error('ROLLBACK');
(async()=>{try{await db.$transaction(async tx=>{
 const agency=await tx.agencija.create({data:{naziv:'Stats'}}),foreign=await tx.agencija.create({data:{naziv:'Foreign'}});
 const firm=await tx.firma.create({data:{agencija_id:agency.id,naziv:'Stats company'}}),other=await tx.firma.create({data:{agencija_id:foreign.id,naziv:'Other'}});
 const year=await tx.poslovnaGodina.create({data:{firma_id:firm.id,godina:2026,datum_od:new Date('2026-01-01'),datum_do:new Date('2026-12-31')}});
 const user=await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}}),worker=await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'korisnik_agencije'}});
 const partner=await tx.komitent.create({data:{agencija_id:agency.id,firma_id:firm.id,naziv:'Partner'}});
 const type=await tx.vrstaNaloga.create({data:{agencija_id:agency.id,sifra:randomUUID(),naziv:'Stats',prefiks:'T'}});
 const scope={agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id};
 const jan=new Date('2026-01-15'),feb=new Date('2026-02-15');
 const posted=await tx.nalog.create({data:{...scope,vrsta_naloga_id:type.id,broj:1,datum:jan,status:'POSTED'}});
 const draft=await tx.nalog.create({data:{...scope,vrsta_naloga_id:type.id,broj:2,datum:feb,status:'DRAFT'}});
 await tx.nalog.create({data:{...scope,vrsta_naloga_id:type.id,broj:3,datum:feb,status:'POSTED',is_deleted:true}});
 for(const [i,journal] of [posted,draft].entries()){
 await tx.kufEntry.create({data:{...scope,redni_broj:i+1,internal_kuf_number:'KUF-'+i,supplier_invoice_number:'S-'+i,dobavljac_id:partner.id,invoice_date:jan,receipt_date:jan,posting_status:'POSTED',journal_id:journal.id}});
 await tx.kifEntry.create({data:{...scope,redni_broj:i+1,internal_kif_number:'IK-'+i,customer_invoice_number:'KIF-'+i,kupac_id:partner.id,invoice_date:feb,posting_status:'POSTED',journal_id:journal.id}});
 }
 const account=await tx.firmaBankovniRacun.create({data:{agencija_id:agency.id,firma_id:firm.id,naziv_banke:'Bank',broj_racuna:'510-5-00'}});
 await tx.bankStatement.create({data:{...scope,company_bank_account_id:account.id,statement_number:'1',statement_date:jan,status:'POSTED',journal_id:posted.id}});
 await tx.bankStatement.create({data:{...scope,company_bank_account_id:account.id,statement_number:'2',statement_date:jan,status:'READY'}});
 for(const [i,category] of ['REDOVAN_RAD','UGOVOR_O_DJELU','ZAKUP','OSTALI_UGOVORI'].entries()) await tx.plateObracun.create({data:{...scope,broj:i+1,kategorija:category,godina:2026,mjesec:2,datum_od:new Date('2026-02-01'),datum_do:new Date('2026-02-28'),datum_obracuna:feb,fond_sati:160,status:'CALCULATED'}});
 await tx.plateObracun.create({data:{...scope,broj:8,kategorija:'REDOVAN_RAD',godina:2026,mjesec:2,datum_od:jan,datum_do:feb,datum_obracuna:feb,fond_sati:160,status:'DRAFT'}});
 for(const aktivan of [true,false])await tx.plateRadnik.create({data:{agencija_id:agency.id,firma_id:firm.id,ime:'Ime',prezime:'Prezime',aktivan}});
 await tx.firmaUgovor.create({data:{agencija_id:agency.id,firma_id:firm.id}});
 const load=sourceLoader({'server-only':{},'@/lib/prisma':{prisma:transactionProxy(tx)},
 '@/lib/auth':{requireAnyRole:async()=>user},'@/lib/work-context':{readWorkContext:async()=>({firmaId:firm.id,poslovnaGodinaId:year.id})},
 './statistics.module.css':Object.fromEntries(['page','cards','people','legend','incoming','outgoing','statements','chart','month','selected','track','sr'].map(k=>[k,k]))});
 const report=load('src/lib/agency-statistics.ts').loadAgencyStatistics;
 let result=await report(user,2026,null);
 assert.deepEqual(result.totals,{journals:1,incoming:1,outgoing:1,statements:1,payroll:1,service:1,rent:1,other:1});
 const html=require('react-dom/server').renderToStaticMarkup(await load('src/app/agencija/statistika/page.tsx').default({searchParams:Promise.resolve({godina:'2026'})}));
 assert.ok(html.includes('Statistika'));assert.ok(html.includes('Stats company'));assert.ok(!html.includes('Other'));
 if(process.env.STATS_QA_HTML){const fs=require('node:fs');fs.writeFileSync(process.env.STATS_QA_HTML,'<html lang="sr"><meta charset="utf-8"><style>'+fs.readFileSync('src/app/globals.css','utf8')+fs.readFileSync('src/app/agencija/statistika/statistics.module.css','utf8')+'</style><body style="padding:32px">'+html+'</body></html>');}
 assert.equal(result.workers,1);assert.equal(result.agencyWorkers,1);assert.equal(result.contracts,1);assert.equal(result.companies.length,1);
 assert.equal(result.months[0].counts.incoming,1);assert.equal(result.months[1].counts.outgoing,1);
 result=await report(user,2026,1);assert.equal(result.totals.outgoing,0);assert.equal(result.totals.payroll,0);assert.equal(result.workers,1);
 assert.equal((await report(user,2025,null)).totals.incoming,0);
 assert.equal((await report(user,2026,null,other.id)).rows.length,0);
 await tx.korisnikFirma.create({data:{korisnik_id:worker.id,firma_id:firm.id}});
 assert.equal((await report(worker,2026,null)).companies.length,0);
 await tx.korisnikPravo.create({data:{agencija_id:agency.id,korisnik_id:worker.id,firma_id:firm.id,modul:'ulazni_racuni',akcija:'view',dozvoljeno:true}});
 result=await report(worker,2026,null);assert.equal(result.totals.incoming,1);assert.equal(result.totals.outgoing,0);assert.equal(result.visible.payroll,false);assert.equal(result.workers,null);assert.equal(result.contracts,null);assert.equal(result.agencyWorkers,null);
 await tx.korisnikPravo.updateMany({where:{korisnik_id:worker.id},data:{dozvoljeno:false}});
 assert.equal((await report(worker,2026,null)).rows.length,0);
 assert.equal((await report({...worker,rola:'klijent'},2026,null)).rows.length,0);
 console.log('PASS statistics: document status and journal validity, month/year, payroll categories, current employees, contracts, agency/module scope and revocation');
 throw rollback;
},{timeout:60000});}catch(e){if(e!==rollback)throw e;}finally{await db.$disconnect();}})().catch(e=>{console.error(e);process.exitCode=1;});
