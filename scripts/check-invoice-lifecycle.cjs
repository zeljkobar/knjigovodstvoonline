// Full local lifecycle with real database/actions; ONLY external Fiscal API is simulated.
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {PrismaClient}=require('@prisma/client');
const {sourceLoader,transactionProxy}=require('../tests/helpers/source-loader.cjs');
const db=new PrismaClient(),rollback=new Error('ROLLBACK_LIFECYCLE');
const form=data=>{const f=new FormData();for(const [k,v] of Object.entries(data))for(const x of [].concat(v))f.append(k,String(x));return f;};
async function response(fn,data){try{await fn(form(data));throw new Error('Missing redirect');}catch(e){if(!e.message.startsWith('REDIRECT:'))throw e;return e.message;}}
(async()=>{
 try{await db.$transaction(async tx=>{
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Podgorica',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const y=Number(today.slice(0,4)),month=Number(today.slice(5,7));
  const agency=await tx.agencija.create({data:{naziv:'Lifecycle fixture'}});
  const firm=await tx.firma.create({data:{agencija_id:agency.id,naziv:'Lifecycle fixture',pib:'12345678',pdv_obveznik:true}});
  const year=await tx.poslovnaGodina.create({data:{firma_id:firm.id,godina:y,datum_od:new Date(`${y}-01-01`),datum_do:new Date(`${y}-12-31`)}});
  const user=await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
  const partner=await tx.komitent.create({data:{agencija_id:agency.id,firma_id:firm.id,naziv:'Buyer',pib:'87654321'}});
  const rate=await tx.pdvStopa.create({data:{agencija_id:agency.id,sifra:'R21',naziv:'21%',procenat:'21'}});
  const unit=await tx.jedinicaMjere.create({data:{sifra:randomUUID(),naziv:'Komad',oznaka:'kom'}});
  const item=await tx.artikal.create({data:{agencija_id:agency.id,firma_id:firm.id,sifra:'1',naziv:'Goods',jedinica_mjere_id:unit.id,pdv_stopa_id:rate.id,usluga:false,prati_zalihe:true}});
  const warehouse=await tx.magacin.create({data:{agencija_id:agency.id,firma_id:firm.id,sifra:'1',naziv:'Warehouse'}});
  const scope={agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id};
  await tx.stanjeZaliha.create({data:{...scope,magacin_id:warehouse.id,artikal_id:item.id,kolicina:'10',nabavna_vrijednost:'300',prosjecna_nabavna_cijena:'30',maloprodajna_vrijednost:'605',razlika_u_cijeni:'200',ukalkulisani_pdv:'105'}});
  const journalType=await tx.vrstaNaloga.findFirst({where:{sifra:'OUTGOING_INVOICE',sistemska:true}})||await tx.vrstaNaloga.create({data:{sifra:'OUTGOING_INVOICE',naziv:'Invoice',prefiks:'IR',sistemska:true}});
  const accounts={};
  for(const [purpose,code,direction] of [['CUSTOMER','201','D'],['REVENUE','600','P'],['OUTPUT_VAT','260','P'],['COGS','500','D'],['INVENTORY','130','P']]){
   accounts[code]=await tx.firmaKonto.create({data:{firma_id:firm.id,sifra:code,naziv:code,tip_konta:'analiticko',analitika_obavezna:code==='201'}});
   await tx.firmaPodrazumijevanoKonto.create({data:{firma_id:firm.id,dokument_tip:'OUTGOING_INVOICE',podvrsta:'GENERAL',pdv_stopa_sifra:'GENERAL',namjena:'INVOICE_'+purpose,sifra_konta:code,smjer:direction}});
  }
  const remoteCompany=randomUUID(),unitId=randomUUID(),remotes=new Map();let submits=0,creates=0;
  await tx.fiscalCompanyLink.create({data:{agencija_id:agency.id,firma_id:firm.id,fiscal_api_company_id:remoteCompany,fiscal_environment:'Test'}});
  const api={
   getCompany:async()=>({data:{id:remoteCompany,tin:firm.pib,environment:'Test',isActive:true}}),
   getReadiness:async()=>({data:{isReady:true}}),
   listBusinessUnits:async()=>({data:[{id:unitId,isActive:true,environment:'Test'}]}),
   listDevices:async()=>({data:[{id:randomUUID(),isActive:true,businessUnitId:unitId}]}),
   listOperators:async()=>({data:[{id:randomUUID(),isActive:true,environment:'Test'}]}),
   createInvoice:async(payload,key)=>{
    creates++;assert.equal(payload.companyId,remoteCompany);assert.equal(payload.items[0].quantity,2);assert.equal(payload.items[0].unitPrice,60.5);assert.equal(payload.payments[0].amount,121);assert.ok(key);
    const invoice={id:randomUUID(),companyId:remoteCompany,status:'Draft',invoiceNumber:'TEST-1',totalGrossAmount:121};remotes.set(invoice.id,invoice);return {data:{...invoice}};
   },
   getInvoice:async id=>{assert.ok(remotes.has(id));return {data:{...remotes.get(id)}};},
   fiscalizeInvoice:async(id,confirmation)=>{
    assert.equal(confirmation,`FISCALIZE_TEST:${id}`);submits++;
    const invoice=remotes.get(id);Object.assign(invoice,{status:'Fiscalized',iic:randomUUID(),jikr:randomUUID(),qrCodeData:'https://example.test/qr',officialInvoiceNumber:'TEST-'+submits});
    return {data:{isSuccess:true,status:'Fiscalized',jikr:invoice.jikr}};
   },
   createInvoiceStorno:async(id,payload,key)=>{
    assert.equal(payload.confirmation,'CREATE_STORNO:'+id);assert.ok(key);
    const original=remotes.get(id);assert.equal(original.status,'Fiscalized');
    const invoice={id:randomUUID(),companyId:remoteCompany,originalInvoiceId:id,status:'Draft',invoiceNumber:'ST-1',totalGrossAmount:-121};remotes.set(invoice.id,invoice);return {data:{...invoice}};
   }
  };
  const load=sourceLoader({'server-only':{},'@/lib/prisma':{prisma:transactionProxy(tx)},'@/lib/fiscal-admin-api':{fiscalAdminApi:api,FiscalAdminApiError:class extends Error{constructor(code,message){super(message);this.code=code;}}},'@/lib/auth':{requireAnyRole:async roles=>{assert.ok(roles.includes(user.rola));return user;},getCurrentUser:async()=>user,isDirectFiscalTenantUser:()=>false},'@/lib/work-context':{readWorkContext:async()=>({firmaId:firm.id,poslovnaGodinaId:year.id})},'next/headers':{headers:async()=>new Map()},'next/cache':{revalidatePath(){}},'next/navigation':{redirect(url){throw new Error('REDIRECT:'+url);}}});
  const service=load('src/lib/outgoing-invoice-service.ts'),actions=load('src/app/agencija/robno/izlazne-fakture/actions.ts');
  const journals=load('src/app/agencija/nalozi/actions.ts'),books=load('src/app/agencija/racuni/actions.ts'),pdv=load('src/lib/pdv-service.ts');
  const context={agencijaId:agency.id,firmaId:firm.id,poslovnaGodinaId:year.id,userId:user.id,userName:user.korisnicko_ime},options={accountingMode:'CONFIGURED',partnerAccess:'AGENCY'};
  const draftInput={context,options,formData:form({submission_id:randomUUID(),kupac_id:partner.id,magacin_id:warehouse.id,datum_racuna:today,datum_prometa:today,nacin_placanja:'BANK_TRANSFER'})};
  const draft=await service.createOutgoingInvoiceDraft(draftInput);
  assert.equal((await service.createOutgoingInvoiceDraft(draftInput)).invoiceId,draft.invoiceId);
  await service.saveOutgoingInvoiceDraft({context,options,formData:form({faktura_id:draft.invoiceId,stavke_json:JSON.stringify([{itemId:item.id,quantity:'2',netUnitPrice:'50',discountPercent:'0'}])})});
  const fiscalInput={context,options,formData:form({faktura_id:draft.invoiceId})};
  assert.equal((await service.fiscalizeOutgoingInvoiceDocument(fiscalInput)).status,'fiscalized');
  await service.fiscalizeOutgoingInvoiceDocument(fiscalInput);assert.equal(submits,1);assert.equal(creates,1);
  const finalReply=await response(actions.finalizeOutgoingInvoice,{faktura_id:draft.invoiceId,firma_id:firm.id});
  assert.match(finalReply,/zavrsena/,finalReply);
  const original=await tx.fiskalniIzlazniRacun.findUniqueOrThrow({where:{id:draft.invoiceId}});assert.ok(original.nalog_id);
  const stock=()=>tx.stanjeZaliha.findFirstOrThrow({where:{firma_id:firm.id,artikal_id:item.id}});
  assert.equal((await stock()).kolicina.toString(),'8');
  assert.match(await response(journals.postJournal,{nalog_id:original.nalog_id}),/nalog_proknjizen/);
  const type=await tx.racunVrsta.create({data:{agencija_id:agency.id,firma_id:firm.id,dokument_tip:'KIF',sifra:'FISCAL',naziv:'Fiscal',vrsta_naloga_id:journalType.id}});
  const book=await tx.kifBook.create({data:{...scope,racun_vrsta_id:type.id,redni_broj:1,internal_kif_number:'LIFE-KIF',mjesec:month,kif_date:new Date(today)}});
  const importDoc=async id=>assert.match(await response(books.importFiscalInvoicesToKif,{kif_book_id:book.id,fiscal_invoice_id:id}),/kif_fiskalni_preuzeti/);
  const pdvInput={agencijaId:agency.id,firmaId:firm.id,poslovnaGodinaId:year.id,godina:y,mjesec:month};
  assert.equal((await pdv.calculatePdvReturn(pdvInput)).totals.totalOutput,0); // fiscal invoice alone is not KIF
  await importDoc(original.id);
  assert.equal((await pdv.calculatePdvReturn(pdvInput)).totals.totalOutput,21);
  const storno=load('src/lib/outgoing-invoice-storno.ts');
  const correction=await storno.createAndFiscalizeOfficeStorno({context:{...context,yearId:year.id},originalId:original.id,reason:'Lifecycle test',confirmed:true});assert.equal(correction.state,'complete');
  const saved=await tx.fiskalniIzlazniRacun.findUniqueOrThrow({where:{id:correction.id}});
  assert.match(await response(journals.postJournal,{nalog_id:saved.nalog_id}),/nalog_proknjizen/);
  await importDoc(saved.id);
  assert.equal((await pdv.calculatePdvReturn(pdvInput)).totals.totalOutput,0);
  assert.equal(await tx.kifEntry.count({where:{...scope}}),2);
  for(const account of Object.values(accounts)){
   const lines=await tx.stavkaNaloga.findMany({where:{konto_id:account.id,nalog:{...scope,status:'POSTED',is_deleted:false}}});
   assert.equal(lines.reduce((sum,line)=>sum+Math.round(Number(line.duguje)*100)-Math.round(Number(line.potrazuje)*100),0),0,account.sifra+' must reverse to zero');
  }
  assert.equal((await stock()).kolicina.toString(),'10');assert.equal((await stock()).nabavna_vrijednost.toString(),'300');
  assert.equal(submits,2);assert.equal(await tx.nalog.count({where:scope}),2);
  console.log('PASS lifecycle: create → save → simulated fiscalization → stock/journal → POSTED → KIF → PDV → storno → all balances zero; stock restored');
  throw rollback;
 },{timeout:120000});}catch(e){if(e!==rollback)throw e;}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());
