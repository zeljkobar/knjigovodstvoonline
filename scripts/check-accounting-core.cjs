// Actual PostgreSQL + actual actions/report loaders. Fixtures always roll back.
// Only session, Next response handling and UI wrappers are replaced; no external API.
require('@next/env').loadEnvConfig(process.cwd(), false, {info(){},error(){}});
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {PrismaClient} = require('@prisma/client');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const {sourceLoader,transactionProxy} = require('../tests/helpers/source-loader.cjs');
const db = new PrismaClient();
const rollback = new Error('ROLLBACK_ACCOUNTING_FIXTURES');
const date = s=>new Date(s+'T00:00:00Z');
const form = data=>{const f=new FormData();for(const [k,v] of Object.entries(data)) for(const value of [].concat(v)) f.append(k,String(value));return f;};
async function response(action,data) {
  try { await action(form(data)); throw new Error('Expected redirect'); }
  catch(error) { if(!error.message.startsWith('REDIRECT:')) throw error; return decodeURIComponent(error.message); }
}
(async()=>{
 try { await db.$transaction(async tx=>{
  const agency=await tx.agencija.create({data:{naziv:'Accounting regression'}});
  const foreignAgency=await tx.agencija.create({data:{naziv:'Foreign regression'}});
  const firm=await tx.firma.create({data:{agencija_id:agency.id,naziv:'Ledger fixture',pdv_obveznik:true}});
  const other=await tx.firma.create({data:{agencija_id:foreignAgency.id,naziv:'Foreign fixture'}});
  const makeYear=f=>tx.poslovnaGodina.create({data:{firma_id:f,godina:2026,datum_od:date('2026-01-01'),datum_do:date('2026-12-31')}});
  const year=await makeYear(firm.id), foreignYear=await makeYear(other.id);
  const admin=await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
  const worker=await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'korisnik_agencije'}});
  const client=await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'klijent'}});
  for(const u of [worker,client]) await tx.korisnikFirma.create({data:{firma_id:firm.id,korisnik_id:u.id}});
  const partner=await tx.komitent.create({data:{agencija_id:agency.id,firma_id:firm.id,naziv:'Buyer fixture',is_foreign:true}});
  const type=await tx.vrstaNaloga.create({data:{sifra:randomUUID(),naziv:'Fixture journal',prefiks:'TEST',agencija_id:agency.id}});
  const accounts={};
  for(const code of ['201','430','600','500','260','270','241']) accounts[code]=await tx.firmaKonto.create({data:{firma_id:firm.id,sifra:code,naziv:'Fixture '+code,tip_konta:'analiticko',analitika_obavezna:code==='201'||code==='430'}});
  const scope={agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id};
  let user=admin,context={firmaId:firm.id,poslovnaGodinaId:year.id};
  const load=sourceLoader({
   'server-only':{}, '@/lib/prisma':{prisma:transactionProxy(tx)},
   '@/lib/auth':{getCurrentUser:async()=>user,isDirectFiscalTenantUser:()=>false,requireAnyRole:async roles=>{if(!roles.includes(user.rola))throw new Error('DENIED_ROLE');return user;}},
   '@/lib/work-context':{readWorkContext:async()=>context},
   'next/cache':{revalidatePath(){}},'next/headers':{headers:async()=>new Map()},
   'next/navigation':{redirect(url){throw new Error('REDIRECT:'+url);},notFound(){throw new Error('NOT_FOUND');}},
   'next/link':{__esModule:true,default:({children,...p})=>React.createElement('a',p,children)},
   '@/components/AutoSubmitFilterForm':{AutoSubmitFilterForm:({children})=>React.createElement('form',{},children)},
   '@/components/BalanceLevelCheckboxes':{BalanceLevelCheckboxes:()=>null}
  });
  const journals=load('src/app/agencija/nalozi/actions.ts');
  const invoices=load('src/app/agencija/racuni/actions.ts');
  const pdv=load('src/lib/pdv-service.ts');
  const permissions=load('src/lib/permissions.ts');
  let number=0;
  const makeJournal=(overrides={},lines=[['201','121','0',partner.id],['600','0','100'],['260','0','21']])=>tx.nalog.create({data:{...scope,vrsta_naloga_id:type.id,broj:++number,sifra:'TEST-'+number,datum:date('2026-06-15'),status:'DRAFT',kreirao_korisnik_id:admin.id,...overrides,stavke:{create:lines.map(([code,d,p,partnerId],i)=>({konto_id:accounts[code].id,duguje:d,potrazuje:p,komitent_id:partnerId||null,redni_broj:i+1}))}}});
  const balance=async code=>{const sums=await tx.stavkaNaloga.aggregate({where:{konto_id:accounts[code].id,nalog:{...scope,status:'POSTED',is_deleted:false}},_sum:{duguje:true,potrazuje:true}});return Math.round(Number(sums._sum.duguje)*100)-Math.round(Number(sums._sum.potrazuje)*100);};
  const original=await makeJournal();
  assert.equal(await balance('201'),0);
  assert.match(await response(journals.postJournal,{nalog_id:original.id}),/nalog_proknjizen/);
  assert.equal(await balance('201'),12100);
  assert.match(await response(journals.postJournal,{nalog_id:original.id}),/nalog_greska/);
  assert.equal(await tx.auditLog.count({where:{entitet_id:original.id,akcija:'post'}}),1);
  const unbalanced=await makeJournal({},[['201','122','0',partner.id],['600','0','100']]);
  assert.match(await response(journals.postJournal,{nalog_id:unbalanced.id}),/nalog_nije_balansiran/);
  const empty=await makeJournal({},[]);
  assert.match(await response(journals.postJournal,{nalog_id:empty.id}),/nalog_nije_balansiran/);
  const blocked=await makeJournal();
  user=worker;
  assert.match(await response(journals.postJournal,{nalog_id:blocked.id}),/prava/);
  user=client;await assert.rejects(()=>journals.postJournal(form({nalog_id:blocked.id})),/DENIED_ROLE/);
  user=admin;
  const grant=await tx.korisnikPravo.create({data:{agencija_id:agency.id,korisnik_id:worker.id,firma_id:firm.id,modul:'nalozi',akcija:'post',dozvoljeno:true}});
  assert.equal(await permissions.hasPermission(worker,{firmaId:firm.id,modul:'nalozi',akcija:'post'}),true);
  await tx.korisnikPravo.update({where:{id:grant.id},data:{dozvoljeno:false}});
  user=worker;assert.match(await response(journals.postJournal,{nalog_id:blocked.id}),/prava/);
  await tx.korisnikPravo.update({where:{id:grant.id},data:{dozvoljeno:true}});
  await tx.korisnikFirma.updateMany({where:{korisnik_id:worker.id},data:{is_deleted:true}});
  assert.equal(await permissions.hasPermission(worker,{firmaId:firm.id,modul:'nalozi',akcija:'post'}),false);
  assert.match(await response(journals.postJournal,{nalog_id:blocked.id}),/nalog_greska/);
  user=admin;
  assert.equal(await permissions.hasPermission(admin,{firmaId:other.id,modul:'nalozi',akcija:'post'}),false);
  const outsider=await tx.nalog.create({data:{agencija_id:foreignAgency.id,firma_id:other.id,poslovna_godina_id:foreignYear.id,vrsta_naloga_id:type.id,broj:1,sifra:'FOREIGN',datum:date('2026-06-15'),kreirao_korisnik_id:admin.id}});
  assert.match(await response(journals.postJournal,{nalog_id:outsider.id}),/nalog_greska/);
  await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:true}});
  assert.match(await response(journals.postJournal,{nalog_id:blocked.id}),/godina_zakljucena/);
  await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:false}});
  const lockedPeriod=await tx.pdvPeriod.create({data:{...scope,mjesec:6,datum_od:date('2026-06-01'),datum_do:date('2026-06-30'),status:'LOCKED'}});
  assert.match(await response(journals.postJournal,{nalog_id:blocked.id}),/pdv_period_zakljucan/);
  assert.equal((await tx.nalog.findUniqueOrThrow({where:{id:blocked.id}})).status,'DRAFT');
  await tx.pdvPeriod.update({where:{id:lockedPeriod.id},data:{status:'OPEN'}});
  const missingPartner=await makeJournal({},[['201','121','0'],['600','0','121']]);
  assert.match(await response(journals.postJournal,{nalog_id:missingPartner.id}),/partner_obavezan/);
  console.log('PASS journals: draft/posted, balanced/empty, repeat, roles, tenant, year');

  // Actual report renderer excludes draft and soft-deleted journals.
  await makeJournal({status:'POSTED',is_deleted:true},[['201','999','0',partner.id],['600','0','999']]);
  const report=load('src/app/agencija/_components/BrutoBilansPage.tsx');
  const html=renderToStaticMarkup(await report.BrutoBilansPage({searchParams:Promise.resolve({konto:accounts['201'].id})}));
  assert.match(html,/121,00/);assert.doesNotMatch(html,/999,00|122,00/);

  const rate=await tx.pdvStopa.create({data:{agencija_id:agency.id,sifra:'R21',naziv:'21%',procenat:'21'}});
  let entryNumber=0,bookNumber=0;
  const makeBook=async(kind,month=6,deleted=false)=>{
   const isKif=kind==='KIF';
   const rt=await tx.racunVrsta.create({data:{agencija_id:agency.id,firma_id:firm.id,dokument_tip:kind,sifra:randomUUID(),naziv:kind,vrsta_naloga_id:type.id}});
   const rules=[['UKUPAN_IZNOS',isKif?'D':'P',isKif?'201':'430'],['OSNOVICA_R21',isKif?'P':'D',isKif?'600':'500'],['PDV_R21',isKif?'P':'D',isKif?'260':'270']];
   for(const [field,direction,account] of rules) await tx.racunKontiranjePravilo.create({data:{racun_vrsta_id:rt.id,polje_sifra:field,polje_naziv:field,smjer:direction,konto_izvor:'FIXED',sifra_konta:account}});
   const n=++bookNumber;return tx[isKif?'kifBook':'kufBook'].create({data:{...scope,racun_vrsta_id:rt.id,redni_broj:n,mjesec:month,[isKif?'internal_kif_number':'internal_kuf_number']:kind+n,[isKif?'kif_date':'kuf_date']:date(`2026-${String(month).padStart(2,'0')}-15`),is_deleted:deleted}});
  };
  const makeEntry=async(kind,book,base=100,vat=21,extras={})=>{
   const kif=kind==='KIF',n=++entryNumber;
   const tax={vat_rate_id:rate.id,vat_rate_code:'R21',vat_rate_name:'21%',vat_rate_percent:'21',tax_base:String(base),total_with_vat:String(base+vat),...(kif?{output_vat_amount:String(vat)}:{input_vat_amount:String(vat),deductible_vat_amount:String(vat),non_deductible_vat_amount:'0'})};
   return tx[kif?'kifEntry':'kufEntry'].create({data:{...scope,[kif?'kif_book_id':'kuf_book_id']:book.id,[kif?'kupac_id':'dobavljac_id']:partner.id,redni_broj:n,[kif?'internal_kif_number':'internal_kuf_number']:'ENTRY-'+n,[kif?'customer_invoice_number':'supplier_invoice_number']:'INV-'+n,invoice_date:date('2026-05-01'),...(!kif?{receipt_date:date('2026-05-02'),deductible_vat:String(vat)}:{}),total_base:String(base),[kif?'total_output_vat':'total_input_vat']:String(vat),total_gross:String(base+vat),...extras,tax_lines:{create:tax}}});
  };
  const kif=await makeBook('KIF'),kuf=await makeBook('KUF');
  const sale=await makeEntry('KIF',kif),purchase=await makeEntry('KUF',kuf,50,10.5);
  await makeEntry('KIF',kif,1000,210,{is_deleted:true});
  await makeEntry('KIF',await makeBook('KIF',6,true),2000,420);
  await makeEntry('KIF',await makeBook('KIF',7),3000,630);
  const pdvInput={agencijaId:agency.id,firmaId:firm.id,poslovnaGodinaId:year.id,godina:2026,mjesec:6};
  let calc=await pdv.calculatePdvReturn(pdvInput);
  assert.deepEqual(calc.totals,{totalOutput:21,totalInput:10.5,deductible:10.5,nonDeductible:0,payable:10.5,credit:0});
  assert.equal(calc.kifBooks[0].entries[0].vat_transaction_type,'DOMESTIC'); // foreign partner does not override document
  assert.equal((await pdv.calculatePdvReturn({...pdvInput,mjesec:5})).totals.totalOutput,0); // book date wins
  assert.equal((await pdv.calculatePdvReturn({...pdvInput,agencijaId:foreignAgency.id})).kifBooks.length,0);
  for(const [kind,book,entry] of [['KIF',kif,sale],['KUF',kuf,purchase]]) {
   const reply=await response(invoices.postInvoiceBook,{dokument_tip:kind,book_id:book.id});
   assert.match(reply,/knjizenje_(kreiran|dopunjen|uspjeh)/,reply);
   const saved=await tx[kind==='KIF'?'kifEntry':'kufEntry'].findUniqueOrThrow({where:{id:entry.id}});
   const lines=await tx.stavkaNaloga.findMany({where:{nalog_id:saved.journal_id}});
   assert.equal(lines.length,3);assert.equal(lines.reduce((n,l)=>n+Math.round(Number(l.duguje)*100)-Math.round(Number(l.potrazuje)*100),0),0);
   assert.match(await response(invoices.postInvoiceBook,{dokument_tip:kind,book_id:book.id}),/knjizenje_nema/);
   assert.equal(await tx.stavkaNaloga.count({where:{nalog_id:saved.journal_id}}),3);
   const appended=await makeEntry(kind,book,-10,-2.1);
   await response(invoices.postInvoiceBook,{dokument_tip:kind,book_id:book.id});
   assert.equal((await tx[kind==='KIF'?'kifEntry':'kufEntry'].findUniqueOrThrow({where:{id:appended.id}})).journal_id,saved.journal_id);
   assert.equal(await tx.stavkaNaloga.count({where:{nalog_id:saved.journal_id}}),6);
  }
  const invalidBook=await makeBook('KIF');
  await makeEntry('KIF',invalidBook,100,21,{total_gross:'130'});
  const journalCount=await tx.nalog.count({where:scope});
  assert.match(await response(invoices.postInvoiceBook,{dokument_tip:'KIF',book_id:invalidBook.id}),/knjizenje_razlika_racuna/);
  assert.equal(await tx.nalog.count({where:scope}),journalCount,'invalid book must not leave an orphan journal');
  await tx.kifBook.update({where:{id:invalidBook.id},data:{is_deleted:true}});
  const lockedBook=await makeBook('KUF'); await makeEntry('KUF',lockedBook,100,21);
  await tx.pdvPeriod.update({where:{id:lockedPeriod.id},data:{status:'LOCKED'}});
  assert.match(await response(invoices.postInvoiceBook,{dokument_tip:'KUF',book_id:lockedBook.id}),/knjizenje_period/);
  assert.equal(await tx.nalog.count({where:scope}),journalCount);
  await tx.pdvPeriod.update({where:{id:lockedPeriod.id},data:{status:'OPEN'}});
  await tx.kufBook.update({where:{id:lockedBook.id},data:{is_deleted:true}});
  calc=await pdv.calculatePdvReturn(pdvInput);
  assert.equal(Math.round(calc.totals.payable*100),1050);
  console.log('PASS KIF/KUF → journal and PDV: book date, deleted data, foreign partner, negative additions, one journal, no duplicate');

  // Posting real bank statements reduces the same GL customer balance.
  const bankType=await tx.vrstaNaloga.findFirst({where:{sifra:'BANK_STATEMENT',aktivan:true}})||await tx.vrstaNaloga.create({data:{sifra:'BANK_STATEMENT',naziv:'Izvod',prefiks:'IZ',sistemska:true}});
  const bank=await tx.firmaBankovniRacun.create({data:{agencija_id:agency.id,firma_id:firm.id,broj_racuna:'530-999-01',naziv_banke:'Test'}});
  await tx.bankStatementAccountSetting.create({data:{agencija_id:agency.id,firma_id:firm.id,company_bank_account_id:bank.id,bank_account_konto_id:accounts['241'].id,journal_type_id:bankType.id}});
  const statements=load('src/lib/bank-statement-service.ts');
  for(const [i,amount,expected] of [[1,40,8100],[2,81,0],[3,10,-1000]]) {
   const statement=await tx.bankStatement.create({data:{...scope,company_bank_account_id:bank.id,bank_account_konto_id:accounts['241'].id,statement_number:String(i),statement_date:date('2026-06-20'),status:'READY',total_inflow:String(amount),closing_balance:String(amount),lines:{create:{line_number:1,posting_date:date('2026-06-20'),description:'Payment',direction:'INFLOW',inflow_amount:String(amount),credit_account_id:accounts['201'].id,partner_id:partner.id,posting_status:'READY'}}}});
   const paymentLine=await tx.bankStatementLine.findFirstOrThrow({where:{bank_statement_id:statement.id}});
   const allocationForm={statement_id:statement.id,line_id:paymentLine.id,line_direction:'INFLOW',partner_id:partner.id,credit_account_code:'201',allocation_target:'KIF:'+sale.id};
   await response(statements.updateBankStatementLines,allocationForm);
   await response(statements.updateBankStatementLines,allocationForm);
   assert.equal(await tx.bankStatementLineAllocation.count({where:{bank_statement_line_id:paymentLine.id}}),1);
   assert.equal((await tx.kifEntry.findUniqueOrThrow({where:{id:sale.id}})).payment_status,['PARTIALLY_PAID','PAID','OVERPAID'][i-1]);
   await response(statements.postSelectedBankStatements,{statement_id:statement.id});
   assert.equal(await balance('201'),expected);
   const saved=await tx.bankStatement.findUniqueOrThrow({where:{id:statement.id}});assert.ok(saved.journal_id);
   await response(statements.postSelectedBankStatements,{statement_id:statement.id});
   assert.equal(await balance('201'),expected);
   assert.equal(await tx.nalog.count({where:{izvorni_dokument_id:statement.id}}),1);
   assert.match(await response(statements.deleteBankStatement,{statement_id:statement.id}),/izvod_greska/);
   assert.equal((await tx.bankStatement.findUniqueOrThrow({where:{id:statement.id}})).status,'POSTED');
  }
  console.log('PASS bank → GL: partial payment, full settlement, overpayment, repeated posting');
  throw rollback;
 },{timeout:120000}); } catch(error){if(error!==rollback)throw error;}
 console.log('PASS all accounting fixtures rolled back');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());
