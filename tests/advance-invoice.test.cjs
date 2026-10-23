/* eslint-disable @typescript-eslint/no-require-imports -- Application policy regression. */
const {test}=require('node:test');const assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const policy=sourceLoader()('src/lib/advance-invoice.ts');
test('advance uses the ordinary decimal currency contract (242,00 stays 242.00)',()=>{
 assert.equal(policy.advanceAmount('242,00'),'242.00');
 assert.equal(policy.advanceAmount('100.50'),'100.50');
 for(const value of ['24200x','1,234','-1','Infinity',''])assert.throws(()=>policy.advanceAmount(value));
 assert.deepEqual(policy.advancePayments({avansni_racun_id:'source',iznos_avansa:'242.00',ukupno_sa_pdv:'363.00',nacin_placanja:'BANK_TRANSFER'},'remote-source'),[{paymentType:'Advance',amount:242,advanceInvoiceId:'remote-source'},{paymentType:'BankAccount',amount:121}]);
 assert.equal(policy.advancePayments({avansni_racun_id:null,iznos_avansa:'0',ukupno_sa_pdv:'363',nacin_placanja:'CASH'}),null);
 assert.equal(policy.advancePayments({avansni_racun_id:'source',iznos_avansa:'242',ukupno_sa_pdv:'242',nacin_placanja:'BANK_TRANSFER'},'remote').length,1);
 for(const amount of ['0','364'])assert.throws(()=>policy.advancePayments({avansni_racun_id:'source',iznos_avansa:amount,ukupno_sa_pdv:'363',nacin_placanja:'BANK_TRANSFER'},'remote'));
});
test('advance selection is scoped, draft-only, audited and requires an open period',async()=>{
 let invoice={id:'final',vrsta_racuna:'NORMAL',status:'DRAFT',fiscal_status:'DRAFT',fiscal_api_invoice_id:null,datum_racuna:new Date('2026-10-23'),kupac_id:'buyer',valuta:'EUR',ukupno_sa_pdv:'363'};
 let locked=false,updates=[];const sourceId='11111111-1111-4111-8111-111111111111';
 const tx={ $executeRaw:async()=>{},fiskalniIzlazniRacun:{findFirst:async q=>{assert.equal(q.where.firma_id,'firm');assert.equal(q.where.agencija_id,'agency');return q.where.id==='final'?invoice:{id:sourceId,fiscal_api_invoice_id:'remote',ukupno_sa_pdv:'242',datum_racuna:new Date('2026-10-01')};},update:async q=>updates.push(q)},poslovnaGodina:{findFirst:async()=>({id:'year',datum_od:new Date('2026-01-01'),datum_do:new Date('2026-12-31'),zakljucena:locked})},pdvPeriod:{findFirst:async()=>null}};
 const load=sourceLoader({'@/lib/prisma':{prisma:{$transaction:fn=>fn(tx)}},'@/lib/audit':{auditLogInTransaction:async()=>{}}});
 const service=load('src/lib/advance-invoice-service.ts'),ctx={agencijaId:'agency',firmaId:'firm',poslovnaGodinaId:'year',userId:'u',userName:'U'};
 await service.setInvoiceAdvance(ctx,'final',sourceId,'242,00');assert.equal(updates[0].data.iznos_avansa,'242.00');
 await assert.rejects(service.setInvoiceAdvance(ctx,'final',sourceId,'364'),/Izaberite/);
 locked=true;await assert.rejects(service.setInvoiceAdvance(ctx,'final',sourceId,'242'),/zaključana/);locked=false;
 invoice={...invoice,fiscal_api_invoice_id:'remote'};await assert.rejects(service.setInvoiceAdvance(ctx,'final',sourceId,'242'),/neposlatom/);
});

test('advance posting settings save only their own company scope, sanitize fields and reject unavailable accounts/rates',async()=>{
 const writes=[],audits=[];let inactive=false;
 class Redirect extends Error{constructor(url){super(url);this.url=url}}
 const db={pdvStopa:{findMany:async()=>[{sifra:'S21'}]},konto:{findMany:async()=>[{sifra:'2020'},{sifra:'4300'},{sifra:'4700'}]},firmaKonto:{findMany:async()=>inactive?[{sifra:'4300',aktivan:false,tip_konta:'analiticko',override_type:'DEACTIVATED'}]:[]},firmaPodrazumijevanoKonto:{findMany:async()=>[],deleteMany:async q=>writes.push(q),createMany:async q=>writes.push(q)},$queryRaw:async()=>[], $transaction:async fn=>fn(db)};
 const load=sourceLoader({'next/navigation':{redirect:url=>{throw new Redirect(url)}},'next/cache':{revalidatePath:()=>{}},'@/lib/auth':{requireRole:async role=>assert.equal(role,'admin_agencije')},'@/app/agencija/robno/_shared':{getInventoryContext:async()=>({allowed:true,firma:{id:'firm'},user:{id:'user',agencija_id:'agency'}})},'@/lib/prisma':{prisma:db},'@/lib/audit':{auditLogInTransaction:async(_tx,q)=>audits.push(q)}});
 const action=load('src/app/agencija/robno/podesavanja/actions.ts').saveAdvanceInvoicePostingSettings;
 const rules=[{namjena:'ADVANCE_CUSTOMER',pdv_stopa_sifra:'GENERAL',sifra_konta:'2020',smjer:'D',firma_id:'foreign',dokument_tip:'OUTGOING_INVOICE'},{namjena:'ADVANCE_RECEIVED',pdv_stopa_sifra:'S21',sifra_konta:'4300',smjer:'P'},{namjena:'ADVANCE_OUTPUT_VAT',pdv_stopa_sifra:'S21',sifra_konta:'4700',smjer:'P'}];
 const form=(rows,company='firm')=>{const f=new FormData();f.set('firma_id',company);f.set('advance_rules',JSON.stringify(rows));return f};
 await assert.rejects(action(form(rules)),e=>e.url.includes('avans_sacuvano'));
 assert.equal(writes[0].where.dokument_tip,'ADVANCE_INVOICE');assert.equal(writes[0].where.firma_id,'firm');
 assert.ok(writes[1].data.every(r=>r.firma_id==='firm'&&r.dokument_tip==='ADVANCE_INVOICE'));assert.equal(audits[0].akcija,'save_advance_invoice_posting_settings');
 const count=writes.length;
 await assert.rejects(action(form(rules,'foreign')),e=>e.url.includes('prava'));
 for(const rows of [[rules[0],rules[0]],[{...rules[0],pdv_stopa_sifra:'S21'}],[{...rules[1],pdv_stopa_sifra:'FOREIGN'}],[{...rules[0],namjena:'INVOICE_REVENUE'}]]) await assert.rejects(action(form(rows)),e=>e.url.includes('neispravna_konta'));
 inactive=true;await assert.rejects(action(form(rules)),e=>e.url.includes('neispravna_konta'));assert.equal(writes.length,count);
});

test('advance scheme balances per VAT rate, reverses the original amounts and rejects incomplete rules',()=>{
 const posting=sourceLoader()('src/lib/advance-invoice-posting.ts');
 const rules=[['ADVANCE_CUSTOMER','GENERAL','2020','D'],['ADVANCE_RECEIVED','GENERAL','4300','P'],['ADVANCE_OUTPUT_VAT','S21','4700','P'],['ADVANCE_OUTPUT_VAT','S7','4707','P']].map(([namjena,pdv_stopa_sifra,sifra_konta,smjer])=>({namjena,pdv_stopa_sifra,sifra_konta,smjer}));
 const taxes=[{code:'S21',base:'200',vat:'42'},{code:'S7',base:'100',vat:'7'}];
 const lines=posting.buildAdvancePostingLines(rules,taxes,'349');
 assert.deepEqual(lines.map(l=>[l.code,l.direction,String(l.amount)]),[['2020','D','34900'],['4300','P','30000'],['4700','P','4200'],['4707','P','700']]);
 const negative=posting.buildAdvancePostingLines(rules,taxes.map(t=>({...t,base:'-'+t.base,vat:'-'+t.vat})),'-349');
 assert.deepEqual(negative.map(l=>l.amount),lines.map(l=>-l.amount));
 assert.equal(posting.buildAdvancePostingLines(rules.filter(r=>r.sifra_konta!=='4707'),taxes,'349'),null);
 assert.equal(posting.buildAdvancePostingLines(rules,taxes,'350'),null);
});
test('settlement consumes exact confirmed fiscal taxes, including mixed VAT and rounding cents',()=>{
 const {readAdvanceSettlementTaxes:read}=sourceLoader()('src/lib/advance-invoice-posting.ts');
 const remote={totalNetAmount:'-82.64',totalVatAmount:'-17.36',totalGrossAmount:'-100'};
 assert.equal(read(remote,['21.00'],'2026-10-23').taxes[0].vat,'-17.36');
 assert.throws(()=>read({...remote,totalVatAmount:undefined},['21.00'],'2026-10-23'));
 assert.throws(()=>read(remote,['21.00','7.00'],'2026-10-23'),/razradu/);
 const mixed={totalNetAmount:'-300',totalVatAmount:'-49',totalGrossAmount:'-349',items:[{vatRate:21,netAmount:-200,vatAmount:-42,grossAmount:-242},{vatRate:7,netAmount:-100,vatAmount:-7,grossAmount:-107}]};
 assert.equal(read(mixed,['21.00','7.00'],'2026-10-23').taxes.length,2);
 assert.throws(()=>read({...mixed,totalGrossAmount:'-350'},['21.00','7.00'],'2026-10-23'),/usklađeni/);
});
