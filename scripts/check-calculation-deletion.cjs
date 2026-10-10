require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');const {PrismaClient}=require('@prisma/client');
const {sourceLoader,transactionProxy}=require('../tests/helpers/source-loader.cjs');const db=new PrismaClient();const rollback=new Error('ROLLBACK');
(async()=>{try{await db.$transaction(async tx=>{
 const agency=await tx.agencija.create({data:{naziv:'Calculation delete fixture'}});
 const firm=await tx.firma.create({data:{agencija_id:agency.id,naziv:'Fixture'}});
 const year=await tx.poslovnaGodina.create({data:{firma_id:firm.id,godina:2026,datum_od:new Date('2026-01-01'),datum_do:new Date('2026-12-31')}});
 const user=await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
 await tx.korisnikFirma.create({data:{firma_id:firm.id,korisnik_id:user.id}});
 const partner=await tx.komitent.create({data:{agencija_id:agency.id,firma_id:firm.id,naziv:'Supplier'}});
 const unit=await tx.jedinicaMjere.create({data:{sifra:randomUUID(),naziv:'Komad',oznaka:'kom'}});
 const warehouse=await tx.magacin.create({data:{agencija_id:agency.id,firma_id:firm.id,sifra:'1',naziv:'Fixture'}});
 const type=await tx.vrstaNaloga.create({data:{agencija_id:agency.id,sifra:randomUUID(),naziv:'Fixture',prefiks:'KAL'}});
 const bookType=await tx.racunVrsta.create({data:{agencija_id:agency.id,firma_id:firm.id,dokument_tip:'KUF',sifra:'T',naziv:'T'}});
 const scope={agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id};
 const book=await tx.kufBook.create({data:{...scope,racun_vrsta_id:bookType.id,redni_broj:1,internal_kuf_number:'KUF1',mjesec:6,kuf_date:new Date('2026-06-30')}});
 const account=await tx.firmaKonto.create({data:{firma_id:firm.id,sifra:'1300',naziv:'Roba',tip_konta:'analiticko'}});
 const load=sourceLoader({'@/lib/prisma':{prisma:transactionProxy(tx)},'next/headers':{headers:async()=>new Map()},'next/cache':{revalidatePath(){}},'next/navigation':{redirect:url=>{throw new Error('REDIRECT:'+url)}},'@/lib/auth':{requireAnyRole:async()=>user},'@/lib/work-context':{readWorkContext:async()=>({firmaId:firm.id,poslovnaGodinaId:year.id})},'@/lib/permissions':{hasPermission:async()=>user.rola==='admin_agencije'}});
 const {deleteCalculationInTransaction:remove}=load('src/lib/calculation-deletion.ts');let num=0;
 async function fixture(status='POSTED',retail=true){
  const n=++num;const item=await tx.artikal.create({data:{agencija_id:agency.id,firma_id:firm.id,sifra:String(n),naziv:'Item',jedinica_mjere_id:unit.id,posljednja_nabavna_cijena:'10'}});
  const c=await tx.kalkulacija.create({data:{...scope,magacin_id:warehouse.id,dobavljac_id:partner.id,broj:n,interni_broj:'KAL'+n,broj_racuna_dobavljaca:'R'+n,datum_racuna_dobavljaca:new Date('2026-06-01'),datum_kalkulacije:new Date('2026-06-01'),status,tip_prodaje:retail?'RETAIL':'WHOLESALE'}});
  const input={id:c.id,firmaId:firm.id,agencijaId:agency.id,godinaId:year.id,userId:user.id,reason:'Pogrešna firma'};
  if(status==='DRAFT')return {c,input,item};
  const line=await tx.stavkaKalkulacije.create({data:{kalkulacija_id:c.id,redni_broj:1,artikal_id:item.id,kolicina:'2',fakturna_cijena:'10',fakturna_vrijednost:'20',neto_fakturna_cijena:'10',neto_fakturna_vrijednost:'20',nabavna_vrijednost:'20',jedinicna_nabavna_cijena:'10',prodajna_cijena_bez_pdv:'15',prodajna_cijena_sa_pdv:'18.15',prodajna_vrijednost_bez_pdv:'30',prodajna_vrijednost_sa_pdv:'36.30'}});
  const journal=await tx.nalog.create({data:{...scope,vrsta_naloga_id:type.id,broj:n,datum:c.datum_kalkulacije,status:'POSTED',source_type:'CALCULATION',izvorni_dokument_id:c.id,stavke:{create:[{konto_id:account.id,redni_broj:1,duguje:'20'},{konto_id:account.id,redni_broj:2,potrazuje:'20'}]}}});
  const entry=status==='POSTED'?await tx.kufEntry.create({data:{...scope,kuf_book_id:book.id,dobavljac_id:partner.id,redni_broj:n,internal_kuf_number:'R'+n,supplier_invoice_number:'R'+n,invoice_date:c.datum_kalkulacije,receipt_date:c.datum_kalkulacije,source_type:'CALCULATION',source_id:c.id,journal_id:journal.id,posting_mode:'SOURCE_DOCUMENT',posting_status:'POSTED',total_gross:'24.20'}}):null;
  await tx.kalkulacija.update({where:{id:c.id},data:{nalog_id:journal.id,kuf_book_id:entry?book.id:null,kuf_entry_id:entry?.id}});
  const stock=await tx.stanjeZaliha.create({data:{...scope,magacin_id:warehouse.id,artikal_id:item.id,kolicina:'2',nabavna_vrijednost:'20',prosjecna_nabavna_cijena:'10',maloprodajna_vrijednost:retail?'36.30':'0',razlika_u_cijeni:retail?'10':'0',ukalkulisani_pdv:retail?'6.30':'0'}});
  const movement=await tx.prometZaliha.create({data:{...scope,magacin_id:warehouse.id,artikal_id:item.id,kalkulacija_id:c.id,stavka_kalkulacije_id:line.id,tip_dokumenta:'CALCULATION',dokument_id:c.id,datum_prometa:c.datum_kalkulacije,smjer:'IN',kolicina:'2',jedinicna_nabavna_cijena:'10',nabavna_vrijednost:'20',prodajna_vrijednost:'36.30',razlika_u_cijeni:'10',ukalkulisani_pdv:'6.30',prosjecna_cijena_nakon:'10',kolicina_nakon:'2',created_at:new Date('2026-06-01')}});
  const previousPrice=await tx.cijenaArtikla.create({data:{agencija_id:agency.id,firma_id:firm.id,artikal_id:item.id,magacin_id:warehouse.id,tip:'MALOPRODAJNA',cijena_bez_pdv:'9',cijena_sa_pdv:'10.89',created_at:new Date('2026-05-01'),aktivna:false}});
  const price=await tx.cijenaArtikla.create({data:{agencija_id:agency.id,firma_id:firm.id,artikal_id:item.id,magacin_id:warehouse.id,tip:'MALOPRODAJNA',cijena_bez_pdv:'15',cijena_sa_pdv:'18.15',created_at:new Date('2026-06-01'),napomena:'Kreirano iz '+c.interni_broj}});
  return {c,input,item,stock,journal,entry,movement,previousPrice,price};
 }
 const other=await fixture();
 for(const [status,retail] of [['DRAFT',true],['WAITING_KUF',false],['POSTED',true]]){
  const f=await fixture(status,retail);await remove(tx,f.input);await remove(tx,f.input);
  assert.equal((await tx.kalkulacija.findUnique({where:{id:f.c.id}})).is_deleted,true);
  if(f.journal){assert.equal((await tx.nalog.findUnique({where:{id:f.journal.id}})).status,'DELETED');const stock=await tx.stanjeZaliha.findUnique({where:{id:f.stock.id}});for(const field of ['kolicina','nabavna_vrijednost','maloprodajna_vrijednost','razlika_u_cijeni','ukalkulisani_pdv'])assert.equal(Number(stock[field]),0);assert.equal(await tx.prometZaliha.count({where:{kalkulacija_id:f.c.id,tip_dokumenta:'CALCULATION_REVERSAL'}}),1);}
  if(f.price){assert.equal((await tx.cijenaArtikla.findUnique({where:{id:f.price.id}})).is_deleted,true);assert.equal((await tx.cijenaArtikla.findUnique({where:{id:f.previousPrice.id}})).aktivna,true);}
  if(f.entry)assert.equal((await tx.kufEntry.findUnique({where:{id:f.entry.id}})).is_deleted,true);
 }
 assert.equal((await tx.kufEntry.findUnique({where:{id:other.entry.id}})).is_deleted,false);
 const locked=await fixture();await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:true}});await assert.rejects(remove(tx,locked.input),/godina je zaključana/);await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:false}});
 await assert.rejects(remove(tx,{...locked.input,agencijaId:randomUUID()}),/nije pronađena/);
 const later=await tx.prometZaliha.create({data:{...scope,magacin_id:warehouse.id,artikal_id:locked.item.id,tip_dokumenta:'OUTGOING_INVOICE',dokument_id:randomUUID(),datum_prometa:new Date('2026-06-02'),smjer:'OUT',kolicina:'1',jedinicna_nabavna_cijena:'10',nabavna_vrijednost:'10',prosjecna_cijena_nakon:'10',kolicina_nakon:'1'}});
 await assert.rejects(remove(tx,locked.input),/naknadni promet/);await tx.prometZaliha.delete({where:{id:later.id}});
 const period=await tx.pdvPeriod.create({data:{...scope,mjesec:6,datum_od:new Date('2026-06-01'),datum_do:new Date('2026-06-30'),status:'LOCKED'}});
 await assert.rejects(remove(tx,locked.input),/PDV period/);await tx.pdvPeriod.update({where:{id:period.id},data:{status:'OPEN'}});await tx.pdvPeriod.delete({where:{id:period.id}});
 // Failure after stock/journal/KUF writes must roll all of them back.
 await tx.$executeRawUnsafe('SAVEPOINT audit_failure');
 const failingTx=new Proxy(tx,{get(target,key){if(key==='auditLog')return new Proxy(target.auditLog,{get(model,method){if(method==='create')return async()=>{throw new Error('AUDIT_FAILURE')};return model[method];}});return target[key];}});
 await assert.rejects(remove(failingTx,locked.input),/AUDIT_FAILURE/);
 await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT audit_failure');
 assert.equal((await tx.kalkulacija.findUnique({where:{id:locked.c.id}})).is_deleted,false);
 assert.equal(Number((await tx.stanjeZaliha.findUnique({where:{id:locked.stock.id}})).kolicina),2);
 assert.equal((await tx.kufEntry.findUnique({where:{id:locked.entry.id}})).is_deleted,false);
 const allocatedTx=new Proxy(tx,{get(target,key){if(key==='bankStatementLineAllocation')return {count:async()=>1};return target[key];}});
 await assert.rejects(remove(allocatedTx,locked.input),/plaćanjem na izvodu/);
 const form=new FormData();for(const [k,v] of Object.entries({firma_id:firm.id,kalkulacija_id:locked.c.id,delete_reason:'Test',potvrda_brisanja:'on'}))form.set(k,v);
 user.rola='korisnik_agencije';await assert.rejects(load('src/app/agencija/robno/kalkulacije/actions.ts').deleteCalculation(form),/REDIRECT:.*prava/);user.rola='admin_agencije';
 // Real action, not only service: confirmation, scoped permissions, transaction and redirect.
 await assert.rejects(load('src/app/agencija/robno/kalkulacije/actions.ts').deleteCalculation(form),/REDIRECT:.*obrisana/);
 assert.equal((await tx.nalog.findUnique({where:{id:locked.journal.id}})).is_deleted,true);
 assert.equal(await tx.auditLog.count({where:{agencija_id:agency.id,akcija:'delete_calculation'}}),4);
 throw rollback;
},{timeout:30000});}catch(e){if(e!==rollback)throw e;}console.log('PASS calculation deletion: draft/waiting/imported, stock and GL/KUF reversal, unrelated KUF preserved, duplicate click, year/PDV/scope/dependency guards, actual action; rollback.');})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());
