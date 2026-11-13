/* eslint-disable @typescript-eslint/no-require-imports -- PostgreSQL rollback regression. */
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{PrismaClient}=require('@prisma/client');
const {renderToStaticMarkup}=require('react-dom/server');
const {sourceLoader,transactionProxy}=require('../tests/helpers/source-loader.cjs');
const db=new PrismaClient(),rollback=Error('ROLLBACK_CORPORATE_TAX'),date=s=>new Date(s+'T00:00:00Z');
(async()=>{try{await db.$transaction(async tx=>{
 const agency=await tx.agencija.create({data:{naziv:'Corporate tax QA'}}),other=await tx.agencija.create({data:{naziv:'Corporate tax foreign QA'}});
 const company=await tx.firma.create({data:{agencija_id:agency.id,naziv:'PD fixture',pib:'99887766'}});
 const year=await tx.poslovnaGodina.create({data:{firma_id:company.id,godina:2026,datum_od:date('2026-01-01'),datum_do:date('2026-12-31')}});
 const admin=await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
 const worker=await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'korisnik_agencije'}});
 let currentUser=admin,currentCompany=company.id,currentYear=year.id;
 const mocks={'@/lib/prisma':{prisma:transactionProxy(tx)},'@/lib/auth':{getCurrentUser:async()=>currentUser,isDirectFiscalTenantUser:()=>false},'@/lib/work-context':{readWorkContext:async()=>({firmaId:currentCompany,poslovnaGodinaId:currentYear})},'next/cache':{revalidatePath(){}}};
 const load=sourceLoader(mocks),s=load('src/lib/corporate-tax-service.ts');
 const expected={companyId:company.id,yearId:year.id,revision:0};
 assert.equal((await s.loadCorporateTax()).saved,false);
 const correction=await tx.finansijskiIzvjestajKorekcija.create({data:{agencija_id:agency.id,firma_id:company.id,poslovna_godina_id:year.id,tip_sifra:'BILANS_USPJEHA',aop:'A201',kolona:'tekuca_godina',vrijednost:'-1053.45'}});
 const prefilled=await s.loadCorporateTax();
 assert.deepEqual(prefilled.statementResult,{x01:0,x02:105345});assert.deepEqual(prefilled.inputs,{...prefilled.statementResult,x05:0});
 assert.equal(prefilled.taxDepreciation,null);assert.equal(prefilled.taxDepreciationStatus,'missing');
 await tx.finansijskiIzvjestajKorekcija.update({where:{id:correction.id},data:{vrijednost:'2400.55'}});
 assert.deepEqual((await s.loadCorporateTax()).inputs,{x01:240055,x02:0,x05:0});
 const depreciationCorrection=await tx.finansijskiIzvjestajKorekcija.create({data:{agencija_id:agency.id,firma_id:company.id,poslovna_godina_id:year.id,tip_sifra:'BILANS_USPJEHA',aop:'A210a',kolona:'tekuca_godina',vrijednost:'120.45'}});
 const taxYear=await tx.osPoreskaGodina.create({data:{agencija_id:agency.id,firma_id:company.id,poslovna_godina_id:year.id,ulazi:{},created_by:admin.id,updated_by:admin.id}});
 const taxSnapshot={schema:1,from:'2026-01-01',to:'2026-12-31',result:{total:10000,extraWriteOff:2000,errors:[]}};
 const taxBatch=await tx.osPoreskiObracun.create({data:{agencija_id:agency.id,firma_id:company.id,poslovna_godina_id:year.id,poreska_godina_id:taxYear.id,revizija:1,ulazni_hash:'qa',snapshot:taxSnapshot,ukupna_amortizacija:'100',created_by:admin.id}});
 assert.equal((await s.loadCorporateTax()).taxDepreciation,null); // Draft is not a tax-return source.
 await tx.osPoreskiObracun.update({where:{id:taxBatch.id},data:{status:'CONFIRMED',potvrdjen_at:new Date(),potvrdjen_by:admin.id}});
 const automatic=await s.loadCorporateTax();assert.equal(automatic.inputs.x05,12045);assert.equal(automatic.inputs.x06,12000);
 assert.equal(automatic.taxDepreciationStatus,'confirmed');
 await tx.osPoreskiObracun.update({where:{id:taxBatch.id},data:{snapshot:{...taxSnapshot,from:'2025-01-01'}}});
 assert.equal((await s.loadCorporateTax()).taxDepreciationStatus,'invalid');
 await tx.osPoreskiObracun.update({where:{id:taxBatch.id},data:{snapshot:taxSnapshot}});
 await tx.finansijskiIzvjestajKorekcija.delete({where:{id:depreciationCorrection.id}});
 await assert.rejects(()=>s.exportCorporateTax(expected),/Sačuvajte/);
 const save={...expected,fields:{x01:'200000',x42:'10000',pg1_21:'5000'},amended:false};
 const failing=sourceLoader({...mocks,'@/lib/audit':{auditLogInTransaction:async()=>{throw Error('AUDIT_FAILURE');}}})('src/lib/corporate-tax-service.ts');
 await assert.rejects(()=>failing.saveCorporateTax(save),/AUDIT_FAILURE/);
 assert.equal((await tx.poslovnaGodina.findUnique({where:{id:year.id}})).porez_dobit_verzija,0);
 assert.deepEqual(await s.saveCorporateTax(save),{revision:1});
 const loaded=await s.loadCorporateTax();assert.equal(loaded.inputs.x01,20000000);assert.equal(loaded.revision,1);
 assert.deepEqual(loaded.statementResult,{x01:240055,x02:0});
 assert.equal(loaded.inputs.x02,0); // Existing return is never silently overwritten.
 assert.equal(loaded.inputs.x06,0);assert.equal(loaded.depreciationInputs.x06,12000);
 await assert.rejects(()=>s.saveCorporateTax(save),/drugom prozoru/);
 await assert.rejects(()=>s.exportCorporateTax(expected),/izmijenjena/);
 const exported=await s.exportCorporateTax({...expected,revision:1});assert.match(exported.xml,/<Iznos59>21600.00/);assert.match(exported.xml,/2026-01-01T00:00:00/);
 assert.equal(await tx.nalog.count({where:{firma_id:company.id}}),0);
 await assert.rejects(()=>s.saveCorporateTax({...save,revision:1,fields:{x59:'1'}}),/dozvoljeno/);
 await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:true}});
 await assert.rejects(()=>s.saveCorporateTax({...save,revision:1}),/zaključana/);
 assert.match((await s.exportCorporateTax({...expected,revision:1})).xml,/<PD /);
 await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:false}});
 currentUser=worker;await assert.rejects(()=>s.loadCorporateTax(),/pravo pregleda/);
 await tx.korisnikFirma.create({data:{korisnik_id:worker.id,firma_id:company.id}});
 const grant=action=>tx.korisnikPravo.create({data:{agencija_id:agency.id,korisnik_id:worker.id,firma_id:company.id,modul:'zavrsni_racun',akcija:action,dozvoljeno:true}});
 await grant('view');assert.equal((await s.loadCorporateTax()).canSave,false);
 assert.equal((await s.loadCorporateTax()).taxDepreciationStatus,'forbidden');
 await tx.korisnikPravo.create({data:{agencija_id:agency.id,korisnik_id:worker.id,firma_id:company.id,modul:'osnovna_sredstva',akcija:'view',dozvoljeno:true}});
 assert.equal((await s.loadCorporateTax()).taxDepreciation,12000);
 await assert.rejects(()=>s.saveCorporateTax({...save,revision:1}),/pravo čuvanja/);
 await assert.rejects(()=>s.exportCorporateTax({...expected,revision:1}),/pravo izvoza/);
 await grant('update');assert.deepEqual(await s.saveCorporateTax({...save,revision:1,amended:true}),{revision:2});
 currentUser={...admin,agencija_id:other.id};await assert.rejects(()=>s.loadCorporateTax(),/pristup/);currentUser=admin;
 await assert.rejects(()=>s.exportCorporateTax({...expected,companyId:randomUUID(),revision:2}),/kontekst/);
 const page=load('src/app/agencija/zavrsni-racun/porez-na-dobit/page.tsx').default;
 const html=renderToStaticMarkup(await page());assert.match(html,/Porez na dobit/);assert.match(html,/PG1/);assert.match(html,/2025\. godina/);assert.match(html,/2021\. godina/);assert.match(html,/Preuzmi XML/);
 const route=load('src/app/agencija/zavrsni-racun/porez-na-dobit/podaci/route.ts');
 const request=(body,headers={})=>new Request('http://localhost:3000/agencija/zavrsni-racun/porez-na-dobit/podaci',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
 assert.equal((await route.POST(request({intent:'export',...expected,revision:2}))).status,403);
 const response=await route.POST(request({intent:'export',...expected,revision:2,fields:{x01:'1'}},{'x-corporate-tax':'1'}));assert.equal(response.status,200);assert.match(await response.text(),/<Iznos1>200000.00/);
 assert.equal(await tx.auditLog.count({where:{firma_id:company.id,akcija:'save_corporate_tax'}}),2);
 const assetControls=load('src/lib/fixed-assets-final-controls.ts').fixedAssetFinalControls;
 const scope={agencija_id:agency.id,firma_id:company.id,poslovna_godina_id:year.id};
 const controls=()=>assetControls(tx,scope,year.datum_od,year.datum_do,true);
 assert.equal((await controls()).find(c=>c.id==='assets-paired-depreciation').level,'error');
 await tx.osnovnoSredstvo.create({data:{agencija_id:agency.id,firma_id:company.id,inventarski_broj:'LAND',naziv:'Zemljište',vrsta_imovine:'LAND',status:'ACTIVE',datum_raspolozivosti:year.datum_od}});
 assert.equal((await controls()).find(c=>c.id==='assets-required-depreciation').level,'info');
 const asset=await tx.osnovnoSredstvo.create({data:{agencija_id:agency.id,firma_id:company.id,inventarski_broj:'DEPR',naziv:'Oprema',vrsta_imovine:'MATERIAL',status:'ACTIVE',datum_raspolozivosti:year.datum_od}});
 const parameter=await tx.osParametar.create({data:{agencija_id:agency.id,firma_id:company.id,sredstvo_id:asset.id,vazi_od:year.datum_od,metoda:'LINEAR',algoritam:'MONTHLY_RATE_V2',godisnja_stopa:'50',osnovica:'100'}});
 const opening=await tx.osPromjena.create({data:{...scope,sredstvo_id:asset.id,datum:year.datum_od,vrsta:'OPENING',status:'CONFIRMED',delta_nabavna_vrijednost:'100',delta_ispravka_vrijednosti:'100'}});
 const zeroControl=(await controls()).find(c=>c.id==='assets-required-depreciation');assert.equal(zeroControl.level,'success',JSON.stringify(zeroControl));
 await tx.osPromjena.update({where:{id:opening.id},data:{delta_nabavna_vrijednost:'200'}});
 await tx.osParametar.update({where:{id:parameter.id},data:{osnovica:'200'}});
 assert.equal((await controls()).find(c=>c.id==='assets-required-depreciation').level,'error');
 const deniedControls=await assetControls(tx,scope,year.datum_od,year.datum_do,false);assert.equal(deniedControls[0].id,'assets-access');
 const controlPage=sourceLoader({...mocks,'@/lib/auth':{...mocks['@/lib/auth'],requireAnyRole:async()=>admin}})('src/app/agencija/zavrsni-racun/kontrole/page.tsx').default;
 const controlHtml=renderToStaticMarkup(await controlPage());assert.match(controlHtml,/Osnovna sredstva/);assert.match(controlHtml,/Nedostaje računovodstvena amortizacija/);assert.match(controlHtml,/Osnovna sredstva nemaju završenu amortizaciju/);
 const accountSettings=load('src/lib/corporate-tax-accounts-service.ts');
 const accountRules=load('src/lib/corporate-tax-accounts.ts').defaultTaxAccountRules().map(r=>({...r,accounts:({x19:'551',x20:'554',x13:'5599'})[r.key]??''}));
 assert.equal((await accountSettings.loadTaxAccountSettings()).revision,0);
 const config={agencyId:agency.id,revision:0,rules:accountRules};
 const failingSettings=sourceLoader({...mocks,'@/lib/audit':{auditLogInTransaction:async()=>{throw Error('AUDIT_SETTINGS_FAILURE');}}})('src/lib/corporate-tax-accounts-service.ts');
 await assert.rejects(()=>failingSettings.saveTaxAccountSettings(config),/AUDIT_SETTINGS_FAILURE/);
 assert.equal((await tx.agencija.findUnique({where:{id:agency.id}})).porez_dobit_konta_verzija,0);
 await accountSettings.saveTaxAccountSettings(config);
 await assert.rejects(()=>accountSettings.saveTaxAccountSettings(config),/drugom prozoru/);
 await assert.rejects(()=>accountSettings.saveTaxAccountSettings({...config,agencyId:other.id,revision:1}),/Agencija/);
 currentUser=worker;await assert.rejects(()=>accountSettings.saveTaxAccountSettings({...config,revision:1}),/administrator/);currentUser=admin;
 const accounts={};for(const code of ['1000','6000','5510','5540','5599'])accounts[code]=await tx.firmaKonto.create({data:{firma_id:company.id,sifra:code,naziv:code,tip_konta:'analiticko'}});
 const type=await tx.vrstaNaloga.create({data:{sifra:'PD_'+randomUUID().slice(0,8),naziv:'PD QA',prefiks:'PQ'}});
 let number=0;
 const journal=async(status,typeId=type.id,amount='100000',deleted=false)=>tx.nalog.create({data:{firma_id:company.id,poslovna_godina_id:year.id,vrsta_naloga_id:typeId,broj:++number,datum:year.datum_do,status,is_deleted:deleted,
  stavke:{create:[{konto_id:accounts['1000'].id,duguje:amount,potrazuje:'0',redni_broj:1},{konto_id:accounts['6000'].id,duguje:'0',potrazuje:amount,redni_broj:2}]}}});
 await journal('POSTED');await journal('DRAFT',type.id,'900000');await journal('POSTED',type.id,'900000',true);
 const types=load('src/lib/journals.ts').standardJournalTypes;
 for(const code of [types[0][0],types[8][0]]){const jt=await tx.vrstaNaloga.findUniqueOrThrow({where:{sifra:code}});await journal('POSTED',jt.id,'900000');}
 await tx.nalog.create({data:{...scope,vrsta_naloga_id:type.id,broj:++number,datum:year.datum_do,status:'POSTED',stavke:{create:[
  {konto_id:accounts['5510'].id,duguje:'1500',redni_broj:1},{konto_id:accounts['5540'].id,duguje:'200',redni_broj:2},
  {konto_id:accounts['5599'].id,duguje:'50',redni_broj:3},{konto_id:accounts['1000'].id,potrazuje:'1750',redni_broj:4}]}}});
 const mapped=await s.loadCorporateTax();assert.equal(mapped.accountPrefill.revenueCents,10000000);
 assert.deepEqual(mapped.accountPrefill.inputs,{x13:5000,x19:50000,x20:10000});assert.equal(mapped.inputs.x19,0);
 const freshYear=await tx.poslovnaGodina.create({data:{firma_id:company.id,godina:2025,datum_od:date('2025-01-01'),datum_do:date('2025-12-31')}});
 currentYear=freshYear.id;const fresh=await s.loadCorporateTax();assert.equal(fresh.inputs.x19,0);assert.equal(fresh.inputs.x20,0);currentYear=year.id;
 const settingsPage=sourceLoader({...mocks,'@/lib/auth':{...mocks['@/lib/auth'],requireRole:async()=>admin}})('src/app/agencija/zavrsni-racun/podesavanja/poreska-prijava/page.tsx').default;
 const settingsHtml=renderToStaticMarkup(await settingsPage({}));assert.match(settingsHtml,/Konta \/ grupe/);assert.match(settingsHtml,/accounts:x19/);assert.match(settingsHtml,/551/);
 // Shared 16/37 configuration, backwards-compatible reads and real posted GL allocation.
 assert.equal((settingsHtml.match(/name="accounts:x16_37"/g)||[]).length,1);
 assert(!settingsHtml.includes('name="accounts:x16"'));assert(!settingsHtml.includes('name="accounts:x37"'));
 await tx.agencija.update({where:{id:agency.id},data:{porez_dobit_konta:accountRules.filter(r=>r.key!=='x16_37')}});
 const legacyRules=(await accountSettings.loadTaxAccountSettings()).rules;
 assert.equal(legacyRules.find(r=>r.key==='x16_37').accounts,'');assert.equal(legacyRules.find(r=>r.key==='x19').accounts,'551');
 const jointRules=legacyRules.map(r=>r.key==='x16_37'?{...r,accounts:'450, 4500',exclude:'4509'}:r);
 await accountSettings.saveTaxAccountSettings({agencyId:agency.id,revision:1,rules:jointRules});
 await assert.rejects(()=>accountSettings.saveTaxAccountSettings({agencyId:agency.id,revision:2,rules:legacyRules.filter(r=>r.key!=='x16_37')}),/sve pozicije/);
 for(const code of ['4500','4501','4509','2410','5200','4600'])accounts[code]=await tx.firmaKonto.create({data:{firma_id:company.id,sifra:code,naziv:code,tip_konta:'analiticko'}});
 const jt={};for(const code of ['OPENING_BALANCE','PAYROLL','BANK_STATEMENT','FINAL_ACCOUNT','CORRECTION'])jt[code]=await tx.vrstaNaloga.findUniqueOrThrow({where:{sifra:code}});
 const liabilityJournal=(kind,lines,extra={})=>tx.nalog.create({data:{...scope,vrsta_naloga_id:jt[kind]?.id??type.id,broj:++number,datum:year.datum_do,status:'POSTED',...extra,
  stavke:{create:lines.map(([code,debit,credit],index)=>({konto_id:accounts[code].id,duguje:debit,potrazuje:credit,redni_broj:index+1}))}}});
 await liabilityJournal('OPENING_BALANCE',[['4500','0','10000'],['1000','10000','0']],{datum:year.datum_od});
 await liabilityJournal('PAYROLL',[['4500','0','60000'],['5200','60000','0']]);
 const firstPayment=await liabilityJournal('BANK_STATEMENT',[['4500','6000','0'],['2410','0','6000']]);
 let liabilityPrefill=(await s.loadCorporateTax()).accountPrefill;
 assert.equal(liabilityPrefill.inputs.x16,6000000);assert.equal(liabilityPrefill.inputs.x37,600000);
 assert.equal(liabilityPrefill.liabilities.remainingOld,400000);
 await liabilityJournal('MANUAL',[['4500','58000','0'],['2410','0','58000']]);
 // Another account has old debt but no payments: payment of 4500 cannot close it.
 await liabilityJournal('OPENING_BALANCE',[['4501','0','1000'],['1000','1000','0']],{datum:year.datum_od});
 await liabilityJournal('PAYROLL',[['4501','0','2000'],['5200','2000','0']]);
 for(const extra of [{status:'DRAFT'},{is_deleted:true},{poslovna_godina_id:freshYear.id},{datum:date('2027-01-01')}]) {
  await liabilityJournal('PAYROLL',[['4500','0','900000'],['5200','900000','0']],extra);
 }
 await liabilityJournal('FINAL_ACCOUNT',[['4500','900000','0'],['1000','0','900000']]);
 await liabilityJournal('PAYROLL',[['4509','0','900000'],['5200','900000','0']]);
 const foreignCompany=await tx.firma.create({data:{agencija_id:other.id,naziv:'PD foreign liability fixture'}});
 const foreignYear=await tx.poslovnaGodina.create({data:{firma_id:foreignCompany.id,godina:2026,datum_od:year.datum_od,datum_do:year.datum_do}});
 const foreignAccounts=[];for(const code of ['4500','5200'])foreignAccounts.push(await tx.firmaKonto.create({data:{firma_id:foreignCompany.id,sifra:code,naziv:code,tip_konta:'analiticko'}}));
 await tx.nalog.create({data:{agencija_id:other.id,firma_id:foreignCompany.id,poslovna_godina_id:foreignYear.id,vrsta_naloga_id:type.id,broj:1,datum:year.datum_do,status:'POSTED',
  stavke:{create:[{konto_id:foreignAccounts[0].id,potrazuje:'900000',redni_broj:1},{konto_id:foreignAccounts[1].id,duguje:'900000',redni_broj:2}]}}});
 const savedWithPrefill=await s.loadCorporateTax();liabilityPrefill=savedWithPrefill.accountPrefill;
 assert.equal(liabilityPrefill.inputs.x16,800000);assert.equal(liabilityPrefill.inputs.x37,1000000);
 assert.equal(liabilityPrefill.liabilities.opening,1100000);assert.equal(liabilityPrefill.liabilities.remainingOld,100000);
 assert.deepEqual(liabilityPrefill.liabilities.issues,[]);
 assert.equal(savedWithPrefill.inputs.x16,0);assert.equal(savedWithPrefill.inputs.x37,0); // Saved return preserved.
 const liabilityHtml=renderToStaticMarkup(await page());assert.match(liabilityHtml,/Pregled obaveza i isplata po kontima/);assert.match(liabilityHtml,/Preostali stari dug/);
 const correctionJournal=await liabilityJournal('CORRECTION',[['4500','100','0'],['5200','0','100']]);
 const ambiguous=await s.loadCorporateTax();assert(ambiguous.accountPrefill.liabilities.issues.length);
 assert(!Object.hasOwn(ambiguous.accountPrefill.inputs,'x16'));assert(!Object.hasOwn(ambiguous.accountPrefill.inputs,'x37'));
 assert.equal(ambiguous.accountPrefill.inputs.x19,50000); // Other prefilled fields remain available.
 assert.match(renderToStaticMarkup(await page()),/nijesu automatski preuzete/);
 await tx.nalog.update({where:{id:correctionJournal.id},data:{status:'DRAFT'}});
 await tx.nalog.update({where:{id:firstPayment.id},data:{status:'DRAFT'}});
 assert.equal((await s.loadCorporateTax()).accountPrefill.inputs.x16,1400000); // Reopening an actual payment changes only live proposal.
 await tx.nalog.update({where:{id:firstPayment.id},data:{status:'POSTED'}});
 await tx.poslovnaGodina.update({where:{id:year.id},data:{porez_dobit_podaci:require('@prisma/client').Prisma.DbNull}});
 const newReturn=await s.loadCorporateTax();assert.equal(newReturn.inputs.x16,800000);assert.equal(newReturn.inputs.x37,1000000);
 const taxDecimal=load('src/lib/corporate-tax.ts').taxDecimal;
 await s.saveCorporateTax({...expected,revision:2,amended:false,fields:Object.fromEntries(Object.entries(newReturn.inputs).map(([key,value])=>[key,taxDecimal(value)]))});
 const liabilityXml=(await s.exportCorporateTax({...expected,revision:3})).xml;
 assert.match(liabilityXml,/<Iznos16>8000.00/);assert.match(liabilityXml,/<Iznos37>10000.00/);
 const purge=load('src/lib/company-purge.ts');await purge.purgeCompanyData(tx,{agencijaId:agency.id,firmaId:company.id,potvrdaNaziva:company.naziv,korisnikId:admin.id});
 assert.equal((await tx.agencija.findUnique({where:{id:agency.id}})).porez_dobit_konta_verzija,2);
 assert.equal(await tx.poslovnaGodina.count({where:{id:year.id}}),0);
 console.log('Corporate tax: scoped save/export, formulas/cents, revisions, locks, rights, CSRF, forged outputs, audit rollback, SSR and actual company purge passed.');
 throw rollback;
},{timeout:60000});}catch(e){if(e!==rollback)throw e;}finally{await db.$disconnect();}})().catch(e=>{console.error(e);process.exitCode=1;});
