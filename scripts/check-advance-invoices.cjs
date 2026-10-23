/* eslint-disable @typescript-eslint/no-require-imports -- Rollback-only regression; Fiscal API is mocked. */
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');const {PrismaClient}=require('@prisma/client');
const {sourceLoader,transactionProxy}=require('../tests/helpers/source-loader.cjs');const db=new PrismaClient();const rollback=Error('ROLLBACK');
(async()=>{try{await db.$transaction(async tx=>{
 const agency=await tx.agencija.create({data:{naziv:'QA advance rollback'}}),firm=await tx.firma.create({data:{agencija_id:agency.id,naziv:'QA advance rollback',pib:'12345678',pdv_obveznik:true}});
 const year=await tx.poslovnaGodina.create({data:{firma_id:firm.id,godina:2026,datum_od:new Date('2026-01-01'),datum_do:new Date('2026-12-31')}});
 const user=await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
 const buyer=await tx.komitent.create({data:{agencija_id:agency.id,firma_id:firm.id,scope:'COMPANY',naziv:'QA buyer',pib:'87654321'}});
 const unit=await tx.jedinicaMjere.create({data:{sifra:randomUUID(),naziv:'komad',oznaka:'kom'}}),vat=await tx.pdvStopa.create({data:{agencija_id:agency.id,sifra:'S21',naziv:'21%',procenat:'21'}});
 const item=await tx.artikal.create({data:{agencija_id:agency.id,firma_id:firm.id,sifra:'1',naziv:'Goods',jedinica_mjere_id:unit.id,pdv_stopa_id:vat.id,usluga:false,prati_zalihe:true}});
 const wh=await tx.magacin.create({data:{agencija_id:agency.id,firma_id:firm.id,sifra:'1',naziv:'QA'}});
 const stock=await tx.stanjeZaliha.create({data:{agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id,magacin_id:wh.id,artikal_id:item.id,kolicina:'10',prosjecna_nabavna_cijena:'20',nabavna_vrijednost:'200'}});
 const remoteCompany=randomUUID();await tx.fiscalCompanyLink.create({data:{agencija_id:agency.id,firma_id:firm.id,fiscal_api_company_id:remoteCompany,fiscal_environment:'Test'}});
 let creates=0,sends=0,settlements=0,failResponse=false;const remote=new Map(),keys=new Map();
 class ApiError extends Error{constructor(code,message){super(message);this.code=code}}
 const fiscal={getCompany:async()=>({data:{id:remoteCompany,isActive:true,environment:'Test'}}),getReadiness:async()=>({data:{isReady:true}}),listBusinessUnits:async()=>({data:[{id:'u',isActive:true}]}),listDevices:async()=>({data:[{id:'d',businessUnitId:'u',isActive:true}]}),listOperators:async()=>({data:[{id:'o',isActive:true}]}),
  createInvoice:async(payload,key)=>{if(keys.has(key))return {data:remote.get(keys.get(key))};creates++;const id=randomUUID();const data={...payload,id,status:'ReadyForFiscalization',officialInvoiceNumber:`TEST-${creates}`,totalGrossAmount:payload.items.reduce((s,i)=>s+i.quantity*i.unitPrice-i.discountAmount,0),items:payload.items.map(i=>({...i,id:randomUUID()}))};remote.set(id,data);keys.set(key,id);return {data}},
  getInvoice:async id=>({data:remote.get(id)}),
  fiscalizeInvoice:async id=>{sends++;const data=remote.get(id);data.status='Fiscalized';data.iic=id.replaceAll('-','').toUpperCase();data.jikr=randomUUID();data.qrCodeData='https://example.test/qr';if(failResponse){failResponse=false;throw Error('simulated transport loss after accepted fiscal result')}return {data:{status:'Fiscalized',isSuccess:true,jikr:data.jikr}}},
  createAdvanceSettlement:async(sourceId,payload,key)=>{if(keys.has(key))return {data:remote.get(keys.get(key))};settlements++;const gross=payload.allocations.reduce((s,a)=>s+a.grossAmount,0);const id=randomUUID(),data={id,status:'ReadyForFiscalization',companyId:remoteCompany,issueDateTime:payload.issueDateTime,officialInvoiceNumber:'SETTLEMENT-'+settlements,items:[],totalNetAmount:-Math.round(gross/1.21*100)/100,totalVatAmount:-(gross-Math.round(gross/1.21*100)/100).toFixed(2),totalGrossAmount:-gross};remote.set(id,data);keys.set(key,id);return {data}}
 };
 const proxy=transactionProxy(tx);
 const load=sourceLoader({'@/lib/prisma':{prisma:proxy},'@/lib/fiscal-admin-api':{fiscalAdminApi:fiscal,FiscalAdminApiError:ApiError},'next/headers':{headers:async()=>new Map()}});
 const svc=load('src/lib/outgoing-invoice-service.ts'),advance=load('src/lib/advance-invoice-service.ts'),policy=load('src/lib/advance-invoice.ts');
 const ctx={agencijaId:agency.id,firmaId:firm.id,poslovnaGodinaId:year.id,userId:user.id,userName:'QA'},options={accountingMode:'FISCAL_ONLY',partnerAccess:'DIRECT'};
 const day=new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Podgorica'});
 async function draft(isAdvance,quantity,source,date=day){const f=new FormData();f.set('submission_id',randomUUID());f.set('kupac_id',buyer.id);f.set('datum_racuna',date);f.set('vrsta_racuna',isAdvance?'ADVANCE':'NORMAL');if(!isAdvance)f.set('magacin_id',wh.id);if(source)f.set('avansni_racun_id',source);const result=await svc.createOutgoingInvoiceDraft({context:ctx,formData:f,options});const lines=new FormData();lines.set('faktura_id',result.invoiceId);lines.set('stavke_json',JSON.stringify([{itemId:item.id,quantity:String(quantity),netUnitPrice:'100',discountPercent:'0'}]));await svc.saveOutgoingInvoiceDraft({context:ctx,formData:lines,options});return result.invoiceId}
 async function fiscalize(id){const invoice=await tx.fiskalniIzlazniRacun.findUniqueOrThrow({where:{id}});const f=new FormData();f.set('faktura_id',id);f.set('reviewed','yes');f.set('confirmation','CONFIRM_TEST');f.set('expected_updated_at',invoice.updated_at.toISOString());return svc.fiscalizeOutgoingInvoiceDocument({context:ctx,formData:f,options})}
 const sourceId=await draft(true,2);assert.equal((await fiscalize(sourceId)).status,'fiscalized');
 const source=await tx.fiskalniIzlazniRacun.findUniqueOrThrow({where:{id:sourceId}});assert.equal(source.vrsta_racuna,'ADVANCE');assert.equal(source.ukupno_sa_pdv.toString(),'242');assert.equal(remote.get(source.fiscal_api_invoice_id).invoiceType,'Advance');
 assert.equal((await tx.stanjeZaliha.findUniqueOrThrow({where:{id:stock.id}})).kolicina.toString(),'10');assert.equal(await tx.prometZaliha.count({where:{dokument_id:sourceId}}),0);
 const finalId=await draft(false,3,sourceId);await advance.setInvoiceAdvance(ctx,finalId,sourceId,'242,00');assert.equal((await fiscalize(finalId)).status,'fiscalized');
 let final=await tx.fiskalniIzlazniRacun.findUniqueOrThrow({where:{id:finalId},include:{placanja:true}});assert.equal(final.ukupno_sa_pdv.toString(),'363');const payload=remote.get(final.fiscal_api_invoice_id);assert.deepEqual(payload.payments,[{paymentType:'Advance',amount:242,advanceInvoiceId:source.fiscal_api_invoice_id},{paymentType:'BankAccount',amount:121}]);assert.equal(final.placanja.length,2);assert.equal((await tx.stanjeZaliha.findUniqueOrThrow({where:{id:stock.id}})).kolicina.toString(),'7');assert.equal(policy.settlementState(final.avans_umanjenje).status,'ReadyForFiscalization');
 const confirmation=`SETTLE_ADVANCE:Test:${finalId}`;assert.equal(settlements,1);assert.equal(sends,2,'automatic preparation does not send negative invoice');
 final=await tx.fiskalniIzlazniRacun.findUniqueOrThrow({where:{id:finalId}});failResponse=true;await assert.rejects(advance.sendAdvanceSettlement(ctx,finalId,confirmation,final.updated_at.toISOString()),/simulated transport/);assert.equal(sends,3);final=await tx.fiskalniIzlazniRacun.findUniqueOrThrow({where:{id:finalId}});await advance.sendAdvanceSettlement(ctx,finalId,confirmation,final.updated_at.toISOString());assert.equal(sends,3,'saved success recovered without another fiscal send');final=await tx.fiskalniIzlazniRacun.findUniqueOrThrow({where:{id:finalId}});assert.equal(policy.settlementState(final.avans_umanjenje).status,'Fiscalized');await advance.sendAdvanceSettlement(ctx,finalId,confirmation,final.updated_at.toISOString());assert.equal(sends,3,'confirmed settlement not sent twice');await fiscalize(finalId);assert.equal(creates,2);assert.equal((await tx.stanjeZaliha.findUniqueOrThrow({where:{id:stock.id}})).kolicina.toString(),'7');

 // Agency uses the configured scheme; portal fiscal-only documents above have no journal.
 const accounting=load('src/lib/advance-invoice-accounting.ts');
 const bookType=await tx.racunVrsta.create({data:{agencija_id:agency.id,firma_id:firm.id,dokument_tip:'KIF',sifra:'QA',naziv:'QA'}});
 const book=await tx.kifBook.create({data:{agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id,racun_vrsta_id:bookType.id,redni_broj:1,internal_kif_number:'KIF-QA',mjesec:10,kif_date:new Date('2026-10-31')}});
 if(!await tx.vrstaNaloga.findFirst({where:{sifra:'OUTGOING_INVOICE',sistemska:true}})) await tx.vrstaNaloga.create({data:{sifra:'OUTGOING_INVOICE',naziv:'Izlazni računi',prefiks:'IR',sistemska:true}});
 const accounts={};for(const [code,label,analytic] of [['2020','Buyer',true],['4300','Advance',false],['4301','Changed advance',false],['4700','VAT',false],['6000','Revenue',false],['5000','Cost',false],['1300','Stock',false]]) accounts[code]=await tx.firmaKonto.create({data:{firma_id:firm.id,sifra:code,naziv:label,tip_konta:'analiticko',analitika_obavezna:analytic}});
 const baseVat=await tx.konto.findUnique({where:{sifra:'4700'}})??await tx.konto.create({data:{sifra:'4700',naziv:'VAT',tip_konta:'analiticko'}});await tx.firmaKonto.delete({where:{id:accounts['4700'].id}});
 options.accountingMode='CONFIGURED';
 const configuredSource=await draft(true,2,undefined,'2026-09-20');await fiscalize(configuredSource);
 assert.equal((await tx.fiskalniIzlazniRacun.findUniqueOrThrow({where:{id:configuredSource}})).status,'DRAFT');
 await assert.rejects(accounting.finishAdvanceAccounting(ctx,configuredSource),/šemu/);
 assert.equal(await tx.nalog.count({where:{firma_id:firm.id}}),0,'incomplete scheme rolls back atomically');
 const template=await tx.firma.create({data:{agencija_id:agency.id,naziv:'Advance scheme template',pib:'12345679'}});
 await tx.agencijaKnjizenjeTemplate.create({data:{agencija_id:agency.id,firma_id:template.id}});
 for(const [namjena,code,smjer] of [['ADVANCE_CUSTOMER','2020','D'],['ADVANCE_RECEIVED','4300','P'],['ADVANCE_OUTPUT_VAT','4700','P']])await tx.firmaPodrazumijevanoKonto.create({data:{firma_id:template.id,dokument_tip:'ADVANCE_INVOICE',podvrsta:'GENERAL',namjena,pdv_stopa_sifra:'GENERAL',sifra_konta:code,smjer}});
 class Redirect extends Error {constructor(url){super(url);this.url=url}}
 const actionLoad=sourceLoader({'@/lib/prisma':{prisma:proxy},'@/lib/fiscal-admin-api':{fiscalAdminApi:fiscal,FiscalAdminApiError:ApiError},'next/headers':{headers:async()=>new Map()},'next/navigation':{redirect:url=>{throw new Redirect(url)}},'next/cache':{revalidatePath(){}},'@/lib/auth':{requireAnyRole:async()=>user},'@/lib/permissions':{requirePermissionForUser:async()=>{},hasPermission:async()=>true},'@/lib/work-context':{readWorkContext:async()=>({firmaId:firm.id,poslovnaGodinaId:year.id})},'@/app/agencija/robno/_shared':{getInventoryContext:async()=>({allowed:true,firma:firm,user})}});
 const salesActions=actionLoad('src/app/agencija/robno/izlazne-fakture/actions.ts'),kifActions=actionLoad('src/app/agencija/racuni/actions.ts');
 async function finish(id){const f=new FormData();f.set('faktura_id',id);f.set('firma_id',firm.id);await assert.rejects(salesActions.finalizeOutgoingInvoice(f),e=>e instanceof Redirect&&/avans_knjizen|zavrsena/.test(e.url));return withJournal(id)}
 async function withJournal(id){const invoice=await tx.fiskalniIzlazniRacun.findUniqueOrThrow({where:{id}});return {...invoice,nalog:await tx.nalog.findUniqueOrThrow({where:{id:invoice.nalog_id},include:{stavke:true}})}}
 const a=await finish(configuredSource);accounts['4700']=await tx.firmaKonto.findUniqueOrThrow({where:{firma_id_sifra:{firma_id:firm.id,sifra:'4700'}}});assert.notEqual(accounts['4700'].id,baseVat.id,'global account resolves to a local company account before journal creation');assert.equal(a.status,'WAITING_KIF');assert.equal(a.nalog.status,'DRAFT');assert.equal(a.nalog.stavke.length,3);assert.equal(a.nalog.stavke.find(l=>l.konto_id===accounts['2020'].id).duguje.toString(),'242');
 assert.equal((await accounting.finishAdvanceAccounting(ctx,a.id)).journalId,a.nalog_id,'retry reuses same journal');
 assert.equal(await tx.prometZaliha.count({where:{dokument_id:a.id}}),0);
 const period=await tx.pdvPeriod.create({data:{agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id,mjesec:9,datum_od:new Date('2026-09-01'),datum_do:new Date('2026-09-30'),status:'LOCKED'}});
 await assert.rejects(accounting.finishAdvanceAccounting(ctx,a.id),/PDV period/);
 await tx.pdvPeriod.update({where:{id:period.id},data:{status:'OPEN'}});
 await assert.rejects(accounting.finishAdvanceAccounting({...ctx,agencijaId:randomUUID()},a.id),/dostupan/);
 const worker=await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'korisnik_agencije'}});
 await assert.rejects(accounting.finishAdvanceAccounting({...ctx,userId:worker.id},a.id),/pristup/);
 // Ordinary final keeps its existing full-sales scheme and stock movement.
 for(const [namjena,code,smjer] of [['INVOICE_CUSTOMER','2020','D'],['INVOICE_REVENUE','6000','P'],['INVOICE_OUTPUT_VAT','4700','P'],['INVOICE_COGS','5000','D'],['INVOICE_INVENTORY','1300','P']])await tx.firmaPodrazumijevanoKonto.create({data:{firma_id:firm.id,dokument_tip:'OUTGOING_INVOICE',podvrsta:'GENERAL',namjena,pdv_stopa_sifra:'GENERAL',sifra_konta:code,smjer}});
 const configuredFinal=await draft(false,3,a.id);await advance.setInvoiceAdvance(ctx,configuredFinal,a.id,'242');await fiscalize(configuredFinal);const normal=await finish(configuredFinal);
 // A changed current scheme must not leave the original advance account open.
 await tx.firmaPodrazumijevanoKonto.updateMany({where:{firma_id:template.id,namjena:'ADVANCE_RECEIVED'},data:{sifra_konta:'4301'}});
 await tx.firmaKonto.update({where:{id:accounts['4300'].id},data:{aktivan:false}});
 const beforeSend=sends;let current=await tx.fiskalniIzlazniRacun.findUniqueOrThrow({where:{id:configuredFinal}});
 await assert.rejects(advance.sendAdvanceSettlement(ctx,configuredFinal,`SETTLE_ADVANCE:Test:${configuredFinal}`,current.updated_at.toISOString(),true),/Konto/);
 current=await tx.fiskalniIzlazniRacun.findUniqueOrThrow({where:{id:configuredFinal}});assert.equal(policy.settlementState(current.avans_umanjenje).status,'Fiscalized');assert.ok(policy.settlementState(current.avans_umanjenje).accountingError);
 await tx.firmaKonto.update({where:{id:accounts['4300'].id},data:{aktivan:true}});await advance.reconcileAdvanceSettlement(ctx,configuredFinal,true);
 current=await tx.fiskalniIzlazniRacun.findUniqueOrThrow({where:{id:configuredFinal}});
 const localNegative=policy.settlementState(current.avans_umanjenje).localInvoiceId;
 const neg=await withJournal(localNegative);
 assert.equal(neg.document_type,'ADVANCE_SETTLEMENT');assert.equal(neg.ukupno_sa_pdv.toString(),'-242');assert.equal(neg.nalog.stavke.find(l=>l.konto_id===accounts['4300'].id).potrazuje.toString(),'-200');assert.ok(!neg.nalog.stavke.some(l=>l.konto_id===accounts['4301'].id));
 await advance.reconcileAdvanceSettlement(ctx,configuredFinal,true);assert.equal(sends,beforeSend+1);assert.equal(await tx.nalog.count({where:{izvorni_dokument_id:localNegative}}),1);
 assert.equal((await tx.stanjeZaliha.findUniqueOrThrow({where:{id:stock.id}})).kolicina.toString(),'4');
 const septemberBook=await tx.kifBook.create({data:{agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id,racun_vrsta_id:bookType.id,redni_broj:2,internal_kif_number:'KIF-QA-SEP',mjesec:9,kif_date:new Date('2026-09-30')}});
 async function importKif(ids,expected='kif_fiskalni_preuzeti',bookId=book.id){const f=new FormData();f.set('kif_book_id',bookId);for(const id of ids)f.append('fiscal_invoice_id',id);await assert.rejects(kifActions.importFiscalInvoicesToKif(f),e=>e instanceof Redirect&&e.url.includes(expected));}
 await tx.pdvPeriod.update({where:{id:period.id},data:{status:'LOCKED'}});await importKif([a.id],'kif_fiskalni_period',septemberBook.id);assert.equal(await tx.kifEntry.count({where:{firma_id:firm.id}}),0);await tx.pdvPeriod.update({where:{id:period.id},data:{status:'OPEN'}});
 // Bad selection must not partially import the valid first document.
 await tx.fiskalniIzlazniRacun.update({where:{id:normal.id},data:{datum_racuna:new Date('2026-11-01')}});await importKif([neg.id,normal.id],'kif_fiskalni_mjesec');assert.equal(await tx.kifEntry.count({where:{firma_id:firm.id}}),0);await tx.fiskalniIzlazniRacun.update({where:{id:normal.id},data:{datum_racuna:normal.datum_racuna}});
 await importKif([a.id],'kif_fiskalni_preuzeti',septemberBook.id);await importKif([normal.id,neg.id]);await importKif([a.id],'kif_fiskalni_greska',septemberBook.id);
 const kif=await tx.kifEntry.findMany({where:{firma_id:firm.id},include:{tax_lines:true}});assert.equal(kif.length,3);assert.ok(kif.every(k=>k.posting_mode==='SOURCE_DOCUMENT'&&k.journal_id));
 assert.equal(kif.find(k=>k.source_id===a.id).kif_book_id,septemberBook.id);assert.equal(kif.find(k=>k.source_id===neg.id).kif_book_id,book.id);
 const cents=v=>Math.round(Number(v)*100);
 assert.equal(kif.reduce((s,k)=>s+cents(k.total_base),0),30000);assert.equal(kif.reduce((s,k)=>s+cents(k.total_output_vat),0),6300);assert.equal(kif.reduce((s,k)=>s+cents(k.total_gross),0),36300);
 const journals=await tx.nalog.findMany({where:{id:{in:[a.nalog_id,normal.nalog_id,neg.nalog_id]}},include:{stavke:true}});
 for(const j of journals)assert.equal(j.stavke.reduce((s,l)=>s+cents(l.duguje)-cents(l.potrazuje),0),0);
 const accountNet=code=>journals.flatMap(j=>j.stavke).filter(l=>l.konto_id===accounts[code].id).reduce((s,l)=>s+cents(l.duguje)-cents(l.potrazuje),0);
 assert.equal(accountNet('4300'),0);assert.equal(accountNet('2020'),36300);assert.equal(accountNet('4700'),-6300);assert.equal(accountNet('6000'),-30000);
 assert.equal(await tx.nalog.count({where:{firma_id:firm.id}}),3,'KIF import never creates a second journal');
 const journalActions=actionLoad('src/app/agencija/nalozi/actions.ts');
 const protectedForm=new FormData();protectedForm.set('nalog_id',neg.nalog_id);await assert.rejects(journalActions.deleteJournal(protectedForm),e=>e instanceof Redirect&&e.url.includes('nalog_greska'));
 for(const journal of journals){const f=new FormData();f.set('nalog_id',journal.id);await assert.rejects(journalActions.postJournal(f),e=>e instanceof Redirect&&e.url.includes('nalog_proknjizen'));}
 assert.equal(await tx.nalog.count({where:{firma_id:firm.id,status:'POSTED'}}),3,'positive and negative journals can be posted normally');


 assert.equal(await tx.auditLog.count({where:{firma_id:firm.id,akcija:'advance_accounting_completed'}}),2);
 const auditSource=await draft(true,1);await fiscalize(auditSource);
 const faulty=sourceLoader({'@/lib/prisma':{prisma:proxy},'@/lib/audit':{auditLogInTransaction:async()=>{throw Error('audit failure')}}})('src/lib/advance-invoice-accounting.ts');
 await assert.rejects(faulty.finishAdvanceAccounting(ctx,auditSource),/audit failure/);
 assert.equal((await tx.fiskalniIzlazniRacun.findUniqueOrThrow({where:{id:auditSource}})).nalog_id,null);assert.equal(await tx.nalog.count({where:{firma_id:firm.id}}),3,'failed audit rolls back the entire local journal');

 await assert.rejects(advance.setInvoiceAdvance(ctx,finalId,sourceId,'100'),/neposlatom/);
 await assert.rejects(advance.loadAdvanceSource({...ctx,firmaId:randomUUID()},sourceId),/dostupan/);
 await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:true}});await assert.rejects(draft(true,1),error=>error.redirectCode==='zakljucana');await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:false}});
 await tx.agencijaKnjizenjeTemplate.delete({where:{agencija_id:agency.id}});await tx.firmaPodrazumijevanoKonto.deleteMany({where:{firma_id:template.id}});await tx.firma.delete({where:{id:template.id}});
 // Purge removes the self relation and every descendant inside this isolated transaction.
 const purge=load('src/lib/company-purge.ts');await purge.purgeCompanyData(tx,{agencijaId:agency.id,firmaId:firm.id,potvrdaNaziva:firm.naziv,korisnikId:user.id});assert.equal(await tx.fiskalniIzlazniRacun.count({where:{firma_id:firm.id}}),0);assert.equal(await tx.firma.count({where:{id:firm.id}}),0);
 console.log('PASS: advance/final/negative fiscal flow, template scheme and saved accounts, balanced journals, KIF/PDV totals, replay, locks, permissions, stock and purge');throw rollback;
 },{timeout:60000})}catch(e){if(e!==rollback)throw e}finally{await db.$disconnect()}})().catch(e=>{console.error(e);process.exitCode=1});
