// Real actions and PostgreSQL, fixture transaction always rolls back.
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {PrismaClient}=require('@prisma/client');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {sourceLoader,transactionProxy}=require('../tests/helpers/source-loader.cjs');
const db=new PrismaClient(), rollback=new Error('ROLLBACK_FIXTURES');
const form=data=>{const f=new FormData();for(const [k,v] of Object.entries(data))f.set(k,String(v));return f;};
async function response(fn,data){try{await fn(form(data));throw Error('No redirect');}catch(e){if(!e.message.startsWith('REDIRECT:'))throw e;return e.message;}}
(async()=>{try{await db.$transaction(async tx=>{
 const a=await tx.agencija.create({data:{naziv:'Agency original'}});
 const b=await tx.agencija.create({data:{naziv:'Foreign agency'}});
 const firm=await tx.firma.create({data:{agencija_id:a.id,naziv:'Client original'}});
 const director=await tx.firmaOdgovornoLice.create({data:{agencija_id:a.id,firma_id:firm.id,ime_prezime:'Client director original',uloga:'IZVRSNI_DIREKTOR',primarno:true}});
 const other=await tx.firma.create({data:{agencija_id:b.id,naziv:'Foreign client'}});
 const admin=await tx.korisnik.create({data:{agencija_id:a.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled',rola:'admin_agencije'}});
 let user=admin;
 const load=sourceLoader({'server-only':{},'@/lib/prisma':{prisma:transactionProxy(tx)},
  '@/lib/auth':{requireRole:async role=>{if(user.rola!==role)throw Error('DENIED');return user;}},
  'next/cache':{revalidatePath(){}},'next/headers':{headers:async()=>new Map()},
  'next/navigation':{redirect(url){throw Error('REDIRECT:'+url);},notFound(){throw Error('NOT_FOUND');}},
  'next/link':{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)},
  '@/components/PrintButton':{PrintButton:()=>null}});
 const actions=load('src/app/agencija/podesavanja/agencija/actions.ts');
 const current=()=>tx.agencija.findUniqueOrThrow({where:{id:a.id}});
 const change=async(fn,data)=>response(fn,{verzija:(await current()).updated_at.toISOString(),...data});
 const initial=(await current()).updated_at.toISOString();
 const data={naziv:'Agency original',pib:'12345678',adresa:'Old address',grad:'Bar',zastupnik_ime:'Old representative',zastupnik_funkcija:'Direktor'};
 assert.match(await change(actions.saveAgencyProfile,{...data,agencija_id:b.id}),/sacuvano/);
 assert.equal((await tx.agencija.findUnique({where:{id:b.id}})).naziv,'Foreign agency');
 assert.match(await response(actions.saveAgencyProfile,{...data,verzija:initial}),/zastarjelo/);
 for(const rola of ['klijent','korisnik_agencije']){user={...admin,rola};await assert.rejects(()=>change(actions.saveAgencyProfile,data),/DENIED/);}user=admin;
 assert.match(await change(actions.saveAgencyBankAccount,{naziv_banke:'Bank A',broj_racuna:'510-12345-00'}),/sacuvano/);
 const bank1=await tx.agencijaBankovniRacun.findFirstOrThrow({where:{agencija_id:a.id}});assert.equal(bank1.glavni,true);
 assert.match(await change(actions.saveAgencyBankAccount,{naziv_banke:'Bank B',broj_racuna:'520-12345-00',glavni:'on'}),/sacuvano/);
 const bank2=await tx.agencijaBankovniRacun.findFirstOrThrow({where:{agencija_id:a.id,glavni:true}});assert.notEqual(bank1.id,bank2.id);
 assert.match(await change(actions.saveAgencyBankAccount,{naziv_banke:'Duplicate',broj_racuna:bank1.broj_racuna,glavni:'on'}),/duplikat/);
 assert.equal((await tx.agencijaBankovniRacun.findUnique({where:{id:bank2.id}})).glavni,true);
 const foreign=await tx.agencijaBankovniRacun.create({data:{agencija_id:b.id,naziv_banke:'Foreign bank',broj_racuna:'530-12345-00',glavni:true}});
 assert.match(await change(actions.deleteAgencyBankAccount,{racun_id:foreign.id}),/racun/);
 assert.match(await change(actions.deleteAgencyBankAccount,{racun_id:'------------------------------------'}),/racun/);
 const contractAction=load('src/app/agencija/actions.ts').saveCompanyContract;
 const save=extra=>response(contractAction,{firma_id:firm.id,mjesecna_cijena:'275,50',datum_zakljucenja:'2026-10-02',datum_pocetka:'2026-09-01',rok_placanja_tip:'dan_u_mjesecu',dan_placanja:'12',nadlezni_sud:'Sud u Podgorici',...extra});
 assert.match(await save({}),/ugovor_sacuvan/);
 let contract=await tx.firmaUgovor.findUniqueOrThrow({where:{firma_id:firm.id}});
 assert.equal(contract.agencija_snapshot.racun,bank2.broj_racuna);
 assert.equal(contract.klijent_snapshot.zastupnik_ime,'Client director original');
 assert.equal(contract.datum_zakljucenja.toISOString().slice(0,10),'2026-10-02');
 assert.equal(contract.dan_placanja,12);
 for(const invalid of [{dan_placanja:'32'},{datum_zakljucenja:'2026-02-30'},{mjesecna_cijena:'-2'},{nadlezni_sud:'x'.repeat(201)}]) assert.match(await save(invalid),/ugovor_greska/);
 assert.equal((await tx.firmaUgovor.findUnique({where:{firma_id:firm.id}})).mjesecna_cijena.toString(),'275.5');
 assert.match(await change(actions.saveAgencyProfile,{...data,naziv:'Agency changed',zastupnik_ime:'New representative'}),/sacuvano/);
 await tx.firma.update({where:{id:firm.id},data:{naziv:'Client changed'}});
 await tx.firmaOdgovornoLice.update({where:{id:director.id},data:{ime_prezime:'Client director changed'}});
 await save({});
 contract=await tx.firmaUgovor.findUniqueOrThrow({where:{firma_id:firm.id}});
 assert.equal(contract.agencija_snapshot.naziv,'Agency original');assert.equal(contract.klijent_snapshot.naziv,'Client original');
 const print=load('src/app/stampa/ugovori/[firmaId]/page.tsx').default;
 const html=renderToStaticMarkup(await print({params:Promise.resolve({firmaId:firm.id})}));
 assert.match(html,/Old representative/);assert.match(html,/Client original/);assert.doesNotMatch(html,/Agency changed|New representative|Client changed|Client director changed/);
 assert.match(html,/Client director original/);
 assert.match(html,/275,50 EUR/);assert.match(html,/do 12\. dana u mjesecu/);
 assert.match(html,/02\.10\.2026\./);assert.match(html,/01\.09\.2026\./);
 assert.match(html,/Sud u Podgorici/);assert.match(html,new RegExp(bank2.broj_racuna));
 assert.equal((html.match(/<h2>Član /g)||[]).length,13);
 assert.doesNotMatch(html,/PROTAX|SWORD|NERMINA|TURKMANOVIĆ|Maja Vujović|03620832|03791424|530-363011-96|11\.11\.2025|01\.10\.2025|placeholder/i);
 if(process.env.CONTRACT_QA_HTML){
  const fs=require('node:fs');fs.writeFileSync(process.env.CONTRACT_QA_HTML,'<!doctype html><html lang="sr"><meta charset="UTF-8"><style>'+fs.readFileSync('src/app/globals.css','utf8')+'\n'+fs.readFileSync('src/app/stampa/ugovori/contract.css','utf8')+'</style><body>'+html+'</body></html>');
 }
 await save({rok_placanja_tip:'dani',rok_placanja_dana:'0'});
 const termsHtml=renderToStaticMarkup(await print({params:Promise.resolve({firmaId:firm.id})}));
 assert.match(termsHtml,/u roku od 0 dana/);assert.doesNotMatch(termsHtml,/do 12\. dana/);
 await assert.rejects(()=>print({params:Promise.resolve({firmaId:other.id})}),/NOT_FOUND/);
 assert.match(await response(contractAction,{firma_id:other.id}),/ugovor_greska/);
 await save({obnovi_podatke_strana:'on'});
 contract=await tx.firmaUgovor.findUniqueOrThrow({where:{firma_id:firm.id}});
 assert.equal(contract.klijent_snapshot.zastupnik_ime,'Client director changed');assert.equal(contract.agencija_snapshot.naziv,'Agency changed');assert.equal(contract.klijent_snapshot.naziv,'Client changed');
 assert.match(await change(actions.deleteAgencyBankAccount,{racun_id:bank2.id}),/sacuvano/);
 assert.equal((await tx.agencijaBankovniRacun.findUnique({where:{id:bank1.id}})).glavni,true);
 assert.equal((await tx.agencijaBankovniRacun.findUnique({where:{id:bank2.id}})).is_deleted,true);
 assert.ok(await tx.auditLog.count({where:{agencija_id:a.id,modul:'agencija.podesavanja.agencija'}}));
 await load('src/lib/company-purge.ts').purgeCompanyData(tx,{agencijaId:a.id,firmaId:firm.id,potvrdaNaziva:'Client changed',korisnikId:admin.id});
 assert.equal(await tx.firmaUgovor.count({where:{firma_id:firm.id}}),0);
 assert.equal(await tx.agencijaBankovniRacun.count({where:{agencija_id:a.id}}),2);
 assert.equal(await tx.firma.count({where:{id:other.id}}),1);
 console.log('PASS agency profile: scope, roles, revisions, primary bank, rollback, snapshots, print and company purge');
 throw rollback;
},{timeout:60000});}catch(e){if(e!==rollback)throw e;}finally{await db.$disconnect();}})().catch(e=>{console.error(e);process.exitCode=1;});
