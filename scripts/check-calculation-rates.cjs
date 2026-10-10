require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{PrismaClient}=require('@prisma/client');
const {sourceLoader,transactionProxy}=require('../tests/helpers/source-loader.cjs');const p=new PrismaClient(),rollback=Error('ROLLBACK_RATES');
const form=o=>{const f=new FormData();for(const [k,v]of Object.entries(o))f.set(k,String(v));return f;};
(async()=>{try{await p.$transaction(async tx=>{
 const agency=await tx.agencija.create({data:{naziv:'Rate regression'}});
 const firm=await tx.firma.create({data:{agencija_id:agency.id,naziv:'Rate regression',pdv_obveznik:true}});
 const year=await tx.poslovnaGodina.create({data:{firma_id:firm.id,godina:2026,datum_od:new Date('2026-01-01'),datum_do:new Date('2026-12-31')}});
 const user=await tx.korisnik.create({data:{agencija_id:agency.id,rola:'admin_agencije',korisnicko_ime:randomUUID(),lozinka_hash:'disabled'}});
 const partner=await tx.komitent.create({data:{agencija_id:agency.id,firma_id:firm.id,naziv:'Supplier'}});
 const unit=await tx.jedinicaMjere.create({data:{sifra:randomUUID(),naziv:'Komad',oznaka:'kom'}});
 const warehouse=await tx.magacin.create({data:{agencija_id:agency.id,firma_id:firm.id,sifra:'1',naziv:'Retail'}});
 const load=sourceLoader({'@/lib/prisma':{prisma:transactionProxy(tx)},'next/headers':{headers:async()=>new Map()},'next/cache':{revalidatePath(){}},'next/navigation':{redirect:u=>{throw Error('REDIRECT:'+u);}},'@/lib/auth':{requireAnyRole:async()=>user,requireRole:async()=>user},'@/lib/work-context':{readWorkContext:async()=>({firmaId:firm.id,poslovnaGodinaId:year.id})},'@/lib/permissions':{hasPermission:async()=>true,hasAllPermissions:async()=>true}});
 const fields=load('src/lib/inventory-calculation.ts').calculationPostingFields;
 const typeCode=load('src/lib/journals.ts').standardJournalTypes[3][0];
 if(!await tx.vrstaNaloga.findFirst({where:{sifra:typeCode,aktivan:true}})) await tx.vrstaNaloga.create({data:{sifra:typeCode,naziv:'Kalkulacija',prefiks:'KAL',sistemska:true}});
 for(const [code,percent]of [['A','21'],['B','7']])await tx.pdvStopa.create({data:{agencija_id:agency.id,sifra:code,naziv:code,procenat:percent}});
 const rules=fields.map((f,i)=>({namjena:f.purpose,pdv_stopa_sifra:'GENERAL',sifra_konta:String(1300+i),smjer:f.defaultDirection}));
 rules.push({namjena:'CALCULATION_INCLUDED_VAT',pdv_stopa_sifra:'B',sifra_konta:'1345',smjer:'P'},{namjena:'CALCULATION_INPUT_VAT',pdv_stopa_sifra:'B',sifra_konta:'2710',smjer:'D'});
 for(const code of rules.map(r=>r.sifra_konta))await tx.firmaKonto.create({data:{firma_id:firm.id,sifra:code,naziv:code,tip_konta:'analiticko'}});
 const save=load('src/app/agencija/robno/podesavanja/actions.ts').saveCalculationPostingSettings;
 await assert.rejects(()=>save(form({firma_id:firm.id,calculation_rules:JSON.stringify([...rules,rules[0]])})),/neispravna_konta/);
 await assert.rejects(()=>save(form({firma_id:firm.id,calculation_rules:JSON.stringify(rules)})),/poruka=sacuvano/);
 assert.equal(await tx.firmaPodrazumijevanoKonto.count({where:{firma_id:firm.id,dokument_tip:'CALCULATION'}}),8);
 const c=await tx.kalkulacija.create({data:{agencija_id:agency.id,firma_id:firm.id,poslovna_godina_id:year.id,magacin_id:warehouse.id,dobavljac_id:partner.id,broj:1,interni_broj:'TEST',broj_racuna_dobavljaca:'TEST',datum_racuna_dobavljaca:new Date('2026-06-01'),datum_kalkulacije:new Date('2026-06-01'),tip_prodaje:'RETAIL',ukupno_nabavna_vrijednost:'200',ukupno_prodajna_vrijednost_sa_pdv:'342',ukupno_razlika_u_cijeni:'100',ukupno_ukalkulisani_pdv:'42'}});
 for(const [n,percent,vat,retail,included]of [[1,'21','21','181.50','31.50'],[2,'7','7','160.50','10.50']]){
 const item=await tx.artikal.create({data:{agencija_id:agency.id,firma_id:firm.id,sifra:String(n),naziv:'Item',jedinica_mjere_id:unit.id}});
 await tx.stavkaKalkulacije.create({data:{kalkulacija_id:c.id,artikal_id:item.id,redni_broj:n,kolicina:'1',fakturna_cijena:'100',fakturna_vrijednost:'100',neto_fakturna_cijena:'100',neto_fakturna_vrijednost:'100',nabavna_vrijednost:'100',jedinicna_nabavna_cijena:'100',ulazni_pdv_stopa:percent,ulazni_pdv_iznos:vat,prodajna_cijena_bez_pdv:'150',prodajna_cijena_sa_pdv:retail,prodajna_vrijednost_bez_pdv:'150',prodajna_vrijednost_sa_pdv:retail,razlika_u_cijeni:'50',ukalkulisani_pdv_iznos:included}});
 }
 await assert.rejects(()=>load('src/app/agencija/robno/kalkulacije/actions.ts').postCalculation(form({firma_id:firm.id,kalkulacija_id:c.id})),/REDIRECT/);
 const saved=await tx.kalkulacija.findUniqueOrThrow({where:{id:c.id}});assert.ok(saved.nalog_id);
 const rows=await tx.stavkaNaloga.findMany({where:{nalog_id:saved.nalog_id},include:{firma_konto:true}});
 assert.equal(rows.find(r=>r.firma_konto.sifra==='1345').potrazuje.toString(),'10.5');
 assert.equal(rows.find(r=>r.firma_konto.sifra==='1304').potrazuje.toString(),'31.5');
 assert.equal(rows.find(r=>r.firma_konto.sifra==='2710').duguje.toString(),'7');
 assert.equal(rows.reduce((n,r)=>n+Math.round(Number(r.duguje)*100)-Math.round(Number(r.potrazuje)*100),0),0);
 console.log('PASS dynamic calculation rules: save, duplicate guard, real retail posting with split input/included VAT and balanced journal');throw rollback;
 },{timeout:60000});}catch(e){if(e!==rollback)throw e;}finally{await p.$disconnect();}})().catch(e=>{console.error(e);process.exitCode=1;});
