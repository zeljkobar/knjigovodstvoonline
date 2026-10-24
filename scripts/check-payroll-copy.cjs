/* eslint-disable @typescript-eslint/no-require-imports -- Real DB rollback regression; no external services. */
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{PrismaClient}=require('@prisma/client');
const {sourceLoader,transactionProxy}=require('../tests/helpers/source-loader.cjs');
const db=new PrismaClient(),rollback=Error('ROLLBACK_PAYROLL_COPY'),date=s=>new Date(s+'T00:00:00Z');
(async()=>{try{await db.$transaction(async tx=>{
 const agency=await tx.agencija.create({data:{naziv:'Payroll copy QA'}}),foreign=await tx.agencija.create({data:{naziv:'Foreign copy QA'}});
 const admin=await tx.korisnik.create({data:{agencija_id:agency.id,rola:'admin_agencije',korisnicko_ime:randomUUID(),lozinka_hash:'disabled'}});
 const worker=await tx.korisnik.create({data:{agencija_id:agency.id,rola:'korisnik_agencije',korisnicko_ime:randomUUID(),lozinka_hash:'disabled'}});
 const kind=await tx.plateVrstaObracuna.create({data:{sifra:randomUUID(),naziv:'NET QA',input_type:'NET',algoritam:'NET_TO_GROSS',valid_from:date('2020-01-01')}});
 const ioppd=await tx.plateIoppdSifra.create({data:{sifra:randomUUID(),naziv:'QA',valid_from:date('2020-01-01')}});
 // Isolated monetary fixture: employee contribution changes from 10% to 20% in September.
 await tx.plateDoprinosStopa.updateMany({data:{aktivan:false}});
 for(const [start,end,rate] of [['2020-01-01','2026-08-31','0.10'],['2026-09-01',null,'0.20']])await tx.plateDoprinosStopa.create({data:{sifra:'EMPLOYEE_PIO',naziv:'QA',payer_type:'EMPLOYEE',stopa:rate,valid_from:date(start),valid_to:end?date(end):null}});
 const income=await tx.plateSifraPrimanja.create({data:{agencija_id:agency.id,sifra:'001',naziv:'QA salary',ioppd_sifra_id:ioppd.id,vrsta_obracuna_id:kind.id,valid_from:date('2020-01-01'),koristi_porez:false,koristi_zaposleni_pio:true,koristi_zaposleni_nezaposleni:false,koristi_poslodavac_nezaposleni:false,koristi_fond_rada:false,koristi_sindikat:false,koristi_privredna_komora:false}});
 const fixtures=[];
 async function employer(name,agencyId=agency.id){
  const firm=await tx.firma.create({data:{agencija_id:agencyId,naziv:name}});
  const years=[];for(const n of [2026,2027])years.push(await tx.poslovnaGodina.create({data:{firma_id:firm.id,godina:n,datum_od:date(`${n}-01-01`),datum_do:date(`${n}-12-31`)}}));
  const employee=await tx.plateRadnik.create({data:{agencija_id:agencyId,firma_id:firm.id,ime:'QA',prezime:name,jmbg:'0000000000000',opstina:'QA',datum_pocetka:date('2025-01-01'),neto_iznos_cent:99000}});
  const source=await tx.plateObracun.create({data:{agencija_id:agencyId,firma_id:firm.id,poslovna_godina_id:years[0].id,broj:1,godina:2026,mjesec:8,datum_od:date('2026-08-01'),datum_do:date('2026-08-31'),datum_obracuna:date('2026-08-31'),datum_isplate:date('2026-09-10'),fond_sati:176,status:'CALCULATED',radnici:{create:{agencija_id:agencyId,firma_id:firm.id,radnik_id:employee.id,snapshot:{ime:'QA'},fond_sati:176,ukupno_sati:176}},stavke:{create:{agencija_id:agencyId,firma_id:firm.id,radnik_id:employee.id,sifra_primanja_id:income.id,ioppd_sifra_id:ioppd.id,vrsta_obracuna_id:kind.id,sifra_primanja:'001',naziv_primanja:'QA salary',redni_broj:1,datum_od:date('2026-08-01'),datum_do:date('2026-08-31'),fond_sati:176,ukupno_sati:176,input_neto_cent:60000,neto_cent:60000,neto_za_isplatu_cent:60000,bruto_cent:111,status:'CALCULATED'}}}});
  const fixture={firm,years,employee,source};fixtures.push(fixture);return fixture;
 }
 const a=await employer('A selected'),b=await employer('B unselected'),c=await employer('C locked'),f=await employer('Foreign',foreign.id);
 const proxy=transactionProxy(tx),mocks={'@/lib/prisma':{prisma:proxy},'next/headers':{headers:async()=>new Map()}};
 const load=sourceLoader(mocks),service=load('src/lib/payroll-copy.ts'),actor={userId:admin.id,agencyId:agency.id};
 const list=()=>service.payrollCopyPreview(actor,'2026-08','2026-09');
 const choice=row=>({companyId:row.companyId,version:row.version});
 let rows=await list();assert.equal(rows.length,3);assert.ok(!rows.some(r=>r.companyId===f.firm.id));
 await assert.rejects(service.copyPayrollMonths(actor,'2026-08','2026-08',[]),/različit/);
 await tx.poslovnaGodina.update({where:{id:c.years[0].id},data:{zakljucena:true}});
 let results=await service.copyPayrollMonths(actor,'2026-08','2026-09',rows.filter(r=>[a.firm.id,c.firm.id].includes(r.companyId)).map(choice));
 assert.equal(results.find(r=>r.companyId===a.firm.id).ok,true);assert.equal(results.find(r=>r.companyId===c.firm.id).ok,false);
 const copied=await tx.plateObracun.findUniqueOrThrow({where:{id:results.find(r=>r.ok).calculations[0].id},include:{stavke:true,radnici:true}});
 assert.equal(copied.status,'CALCULATED');assert.equal(copied.nalog_id,null);assert.ok(copied.calculated_at);assert.equal(copied.radnici[0].email_sent,false);
 assert.equal(copied.datum_od.toISOString().slice(0,10),'2026-09-01');assert.equal(copied.datum_do.toISOString().slice(0,10),'2026-09-30');assert.equal(copied.datum_isplate.toISOString().slice(0,10),'2026-10-10');
 assert.equal(copied.stavke[0].datum_do.toISOString().slice(0,10),'2026-09-30');assert.equal(copied.stavke[0].input_neto_cent,60000);assert.equal(copied.stavke[0].neto_cent,60000);assert.equal(copied.stavke[0].bruto_cent,75000);assert.equal(copied.stavke[0].zaposleni_pio_cent,15000);
 assert.equal(copied.stavke[0].fond_sati,176);assert.equal(copied.stavke[0].ukupno_sati,176);assert.notEqual(copied.stavke[0].id,(await tx.plateObracunStavka.findFirst({where:{obracun_id:a.source.id}})).id);
 assert.equal(await tx.plateObracun.count({where:{firma_id:b.firm.id,mjesec:9}}),0,'unselected firms untouched');assert.equal(await tx.nalog.count({where:{firma_id:a.firm.id}}),0);
 results=await service.copyPayrollMonths(actor,'2026-08','2026-09',[choice(rows.find(r=>r.companyId===a.firm.id))]);assert.equal(results[0].ok,false);assert.match(results[0].message,/već postoji/);assert.equal(await tx.plateObracun.count({where:{firma_id:a.firm.id,mjesec:9}}),1);
 assert.match((await list()).find(r=>r.companyId===a.firm.id).reason,/već postoji/);
 results=await service.copyPayrollMonths(actor,'2026-08','2026-09',[{companyId:f.firm.id,version:rows[0].version}]);assert.equal(results[0].name,'Nedostupna firma');
 // Scope and explicit permissions are enforced inside the service, not only in the UI.
 const wa={userId:worker.id,agencyId:agency.id};assert.equal((await service.payrollCopyPreview(wa,'2026-08','2026-09')).length,0);
 await tx.korisnikFirma.create({data:{korisnik_id:worker.id,firma_id:b.firm.id}});
 for(const akcija of ['view','create','update'])await tx.korisnikPravo.create({data:{agencija_id:agency.id,korisnik_id:worker.id,firma_id:b.firm.id,modul:'plate',akcija,dozvoljeno:true}});
 const wr=await service.payrollCopyPreview(wa,'2026-08','2026-09');assert.deepEqual(wr.map(r=>r.companyId),[b.firm.id]);
 await tx.korisnikPravo.updateMany({where:{korisnik_id:worker.id,akcija:'update'},data:{dozvoljeno:false}});
 assert.equal((await service.copyPayrollMonths(wa,'2026-08','2026-09',wr.map(choice)))[0].ok,false);
 // A changed source requires a fresh selection; no partial target survives failure.
 const br=(await list()).find(r=>r.companyId===b.firm.id);
 await tx.plateObracun.update({where:{id:b.source.id},data:{napomena:'changed after preview'}});
 results=await service.copyPayrollMonths(actor,'2026-08','2026-09',[choice(br)]);assert.match(results[0].message,/promijenjeni/);
 const fresh=()=>list().then(all=>all.find(r=>r.companyId===b.firm.id));
 const period=await tx.pdvPeriod.create({data:{agencija_id:agency.id,firma_id:b.firm.id,poslovna_godina_id:b.years[0].id,mjesec:9,datum_od:date('2026-09-01'),datum_do:date('2026-09-30'),status:'LOCKED'}});
 results=await service.copyPayrollMonths(actor,'2026-08','2026-09',[choice(await fresh())]);assert.match(results[0].message,/PDV period/);await tx.pdvPeriod.update({where:{id:period.id},data:{status:'OPEN'}});
 await tx.plateRadnik.update({where:{id:b.employee.id},data:{datum_prestanka:date('2026-08-31')}});
 results=await service.copyPayrollMonths(actor,'2026-08','2026-09',[choice(await fresh())]);assert.equal(results[0].ok,false);assert.equal(await tx.plateObracun.count({where:{firma_id:b.firm.id,mjesec:9}}),0);
 await tx.plateRadnik.update({where:{id:b.employee.id},data:{datum_prestanka:null}});
 const failing=sourceLoader({...mocks,'@/lib/audit':{auditLogInTransaction:async()=>{throw Error('audit failure')}}})('src/lib/payroll-copy.ts');
 results=await failing.copyPayrollMonths(actor,'2026-08','2026-09',[choice(await fresh())]);assert.equal(results[0].ok,false);assert.equal(await tx.plateObracun.count({where:{firma_id:b.firm.id,mjesec:9}}),0,'audit failure rolls back header, workers and results');
 // A target in a different year uses that firm's year, never the top-bar selection.
 const cross=await service.payrollCopyPreview(actor,'2026-08','2027-01');results=await service.copyPayrollMonths(actor,'2026-08','2027-01',[choice(cross.find(r=>r.companyId===b.firm.id))]);assert.equal(results[0].ok,true);
 const january=await tx.plateObracun.findUniqueOrThrow({where:{id:results[0].calculations[0].id}});assert.equal(january.poslovna_godina_id,b.years[1].id);assert.equal(january.datum_do.toISOString().slice(0,10),'2027-01-31');

 const sourceLine=await tx.plateObracunStavka.findFirstOrThrow({where:{obracun_id:b.source.id}});
 const {id:oldId,obracun_id:oldCalculation,obracun_radnik_id:oldWorker,...lineFields}=sourceLine;assert.ok(oldId&&oldCalculation);assert.ok(oldWorker===null||typeof oldWorker==='string');
 const supplement=await tx.plateObracun.create({data:{agencija_id:agency.id,firma_id:b.firm.id,poslovna_godina_id:b.years[0].id,broj:20,godina:2026,mjesec:8,datum_od:date('2026-08-01'),datum_do:date('2026-08-31'),datum_obracuna:date('2026-08-31'),fond_sati:176,status:'CALCULATED',stavke:{create:{...lineFields,input_neto_cent:10000}}}});
 const february=await service.payrollCopyPreview(actor,'2026-08','2027-02');assert.equal(february.find(r=>r.companyId===b.firm.id).count,2);
 results=await service.copyPayrollMonths(actor,'2026-08','2027-02',[choice(february.find(r=>r.companyId===b.firm.id))]);assert.equal(results[0].ok,true);assert.equal(results[0].calculations.length,2);
 const both=await tx.plateObracun.findMany({where:{id:{in:results[0].calculations.map(c=>c.id)}},include:{stavke:true},orderBy:{broj:'asc'}});
 assert.equal(both.flatMap(c=>c.stavke).reduce((s,l)=>s+l.neto_cent,0),70000);assert.ok(both.every(c=>c.status==='CALCULATED'&&c.datum_do.toISOString().startsWith('2027-02-28')));
 assert.ok(both[1].stavke[0].detalji.monthlyHistoryKey.includes(both[0].stavke[0].id),'supplementary calculation remembers the copied preceding monthly lines');
 await tx.plateObracunStavka.updateMany({where:{obracun_id:supplement.id},data:{vrsta_obracuna_id:randomUUID()}});
 const march=await service.payrollCopyPreview(actor,'2026-08','2027-03');results=await service.copyPayrollMonths(actor,'2026-08','2027-03',[choice(march.find(r=>r.companyId===b.firm.id))]);assert.equal(results[0].ok,false);assert.equal(await tx.plateObracun.count({where:{firma_id:b.firm.id,godina:2027,mjesec:3}}),0,'failure in the second source rolls back the first copy as well');
 assert.equal(await tx.auditLog.count({where:{firma_id:a.firm.id,akcija:'copy_calculated_payroll'}}),1);
 assert.equal((await tx.plateObracun.findUniqueOrThrow({where:{id:a.source.id}})).status,'CALCULATED');
 const journalType=await tx.vrstaNaloga.create({data:{sifra:randomUUID(),naziv:'QA payroll',prefiks:'QA',agencija_id:agency.id}});
 const debit=await tx.firmaKonto.create({data:{firma_id:a.firm.id,sifra:'5200',naziv:'QA debit',tip_konta:'analiticko'}}),credit=await tx.firmaKonto.create({data:{firma_id:a.firm.id,sifra:'4500',naziv:'QA credit',tip_konta:'analiticko'}});
 const components=load('src/lib/payroll-posting.ts').payrollPostingComponents.filter(c=>!c.aggregate);
 await tx.plateKontiranjePodesavanje.create({data:{agencija_id:agency.id,firma_id:a.firm.id,poslovna_godina_id:a.years[0].id,kategorija:'REDOVAN_RAD',vrsta_naloga_id:journalType.id,pravila:{create:components.map(c=>({komponenta:c.code,naziv:c.label,grupa:c.group,izvorno_polje:c.sourceField,redosljed:c.order,duguje_konto_id:debit.id,potrazuje_konto_id:credit.id}))}}});
 const actions=sourceLoader({...mocks,'@/lib/auth':{requireAnyRole:async()=>admin},'@/lib/work-context':{readWorkContext:async()=>({firmaId:a.firm.id,poslovnaGodinaId:a.years[0].id})},'next/cache':{revalidatePath(){}},'next/navigation':{redirect:url=>{throw Error('REDIRECT:'+url)}}})('src/app/agencija/plate/actions.ts');
 const form=new FormData();form.set('obracun_id',copied.id);await assert.rejects(actions.postPayrollCalculation(form),/obracun_proknjizen/);
 assert.equal((await tx.plateObracun.findUniqueOrThrow({where:{id:copied.id}})).status,'POSTED','copied calculations remain compatible with the ordinary posting workflow');

 console.log('PASS: selected agency payroll copy, month ends and next year, fresh calculations/rates, no draft/journal, scope/rights, duplicate/version/period guards and audit rollback');throw rollback;
},{timeout:60000})}catch(e){if(e!==rollback)throw e}finally{await db.$disconnect()}})().catch(e=>{console.error(e);process.exitCode=1});
