/* eslint-disable @typescript-eslint/no-require-imports -- Actual form and navigation render. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const filter={from:'4140',to:'4147',journalTypeId:'11111111-1111-4111-8111-111111111111',dateFrom:'',dateTo:''};
test('replacement form requires preview, displays all journals and full counts; blockers and pending state prevent confirmation',()=>{
 for(const mode of['initial','preview','blocked','pending','changed-filter']){
  const preview={filter,token:mode==='blocked'?'':'signed-preview',from:'4140 — Krediti',to:'4147 — Krediti',journalType:'Izvodi',companyId:'firm',yearId:'year',count:300,journalCount:2,debit:12000,credit:1000,bankCount:1,blocked:mode==='blocked'?[{journalId:'journal',message:'PDV period je zaključan.'}]:[],journals:[{id:'journal',code:'IZV-2026-1',date:'2026-06-20',count:299},{id:'journal2',code:'IZV-2026-2',date:'2026-06-21',count:1}],rows:[{id:'line',journalId:'journal',journal:'IZV-2026-1',date:'2026-06-20',number:1,partner:'Partner',description:'Kredit',document:'DOC',debit:12000,credit:0}]};
  const load=sourceLoader({'react':{...React,useActionState:()=>[mode==='initial'?{}:{preview},()=>{},mode==='pending'],useState:()=>[mode==='changed-filter'?{...filter,to:'4148'}:filter,()=>{}]},'next/link':{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)},'@/components/AccountSearchSelect':{AccountSearchSelect:({children,...props})=>React.createElement('select',props,children)},'@/app/agencija/nalozi/zamjena-konta/actions':{replaceJournalAccount(){}}});
  const Form=load('src/app/agencija/nalozi/zamjena-konta/ReplacementForm.tsx').ReplacementForm;
  const html=renderToStaticMarkup(React.createElement(Form,{companyId:'firm',yearId:'year',accounts:[{code:'4140',name:'Krediti',active:true},{code:'4147',name:'Krediti',active:true}],journalTypes:[{id:filter.journalTypeId,naziv:'Izvodi',prefiks:'IZV'}]}));
  assert.match(html,/Trenutni konto|Novi konto|Vrsta naloga/);
  const confirms=html.includes('Potvrdi zamjenu (300)');assert.equal(confirms,mode==='preview');
  if(mode==='preview'){assert.match(html,/IZV-2026-2/);assert.match(html,/Potvrda obuhvata svih 300 stavki/);assert.match(html,/name="token"/);}
  if(mode==='blocked'){assert.match(html,/Nijedna stavka neće biti promijenjena/);assert.doesNotMatch(html,/name="token"/);}
  if(mode==='pending')assert.match(html,/disabled=""/);
  if(mode==='changed-filter')assert.doesNotMatch(html,/Pregled zamjene/);
 }
});
test('replacement navigation requires view/update/post; invalid filters are rejected before database work',()=>{
 const load=sourceLoader(),nav=load('src/lib/navigation.ts');
 assert.ok(nav.getSubNavigation('nalozi','admin_agencije').some(i=>i.label==='Zamjena konta'));
 assert.ok(!nav.getSubNavigation('nalozi','korisnik_agencije',new Set(['nalozi:view','nalozi:update'])).some(i=>i.label==='Zamjena konta'));
 assert.ok(nav.getSubNavigation('nalozi','korisnik_agencije',new Set(['nalozi:view','nalozi:update','nalozi:post'])).some(i=>i.label==='Zamjena konta'));
 const {replacementFilter:parse}=load('src/lib/journal-account-replacement.ts');
 const form=data=>{const f=new FormData();for(const[k,v]of Object.entries(data))f.set(k,v);return f;};
 assert.deepEqual(parse(form(filter)),filter);
 assert.throws(()=>parse(form({...filter,from:'4147'})),/različiti/);
 assert.throws(()=>parse(form({...filter,dateFrom:'2026-02-31'})),/ispravan datum/);
 assert.throws(()=>parse(form({...filter,dateFrom:'2026-06-20',dateTo:'2026-06-01'})),/Datum od/);
 assert.throws(()=>parse(form({...filter,journalTypeId:'other'})),/vrstu naloga/);
});
