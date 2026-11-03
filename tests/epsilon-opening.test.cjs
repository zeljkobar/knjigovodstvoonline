/* eslint-disable @typescript-eslint/no-require-imports -- Pure vendor import regression. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const {buildEpsilonOpening,parseEpsilonBalances}=sourceLoader()('src/lib/epsilon-opening.ts');
const headings=partners=>[[null,null,'POČETNO STANJE',null,'TEKUĆI PROMET',null,'UKUPAN PROMET',null,'S A L D O'],
 [partners?'I.D.':'KONTO',partners?'NAZIV-GRAD':'NAZIV KONTA','-duguje-','-potražuje-','-duguje-','-potražuje-','-duguje-','-potražuje-','-duguje-','-potražuje-','SALDO','D/P']];
const row=(code,name,od,oc,td=0,tc=0)=>{
 const d=od+td,c=oc+tc,s=d-c;return [code,name,od,oc,td,tc,d,c,Math.max(s,0),Math.max(-s,0),Math.abs(s),s>0?'D':s<0?'P':''];
};
const ledger=()=>[...headings(false),row('0231','Oprema',200,0),row('4330','Dobavljači',0,100,50,0),row('3010','Kapital',0,100),row('2410','Banka',0,0,0,50)];
const suppliers=()=>[...headings(true),row('0010','Partner A - BAR',0,120,50,0),row('0011','Partner B - BAR',20,0)];
const build=(extra={})=>buildEpsilonOpening({ledger:ledger(),suppliers:suppliers(),supplierAccount:'4330',customerAccount:'2020',basis:'CLOSING',reportDate:'2025-12-31',company:'QA',year:2026,...extra});
test('Epsilon closing saldos replace aggregate payable exactly once, never import turnover',()=>{
 const data=build();assert.equal(data.format,'EPSILON_V1');
 assert.equal(data.lines.filter(l=>l.account==='4330').length,2);
 assert.equal(data.lines.filter(l=>l.account==='4330').reduce((s,l)=>s+l.debit-l.credit,0),-5000);
 assert.equal(data.lines.find(l=>l.partner.startsWith('0010')).credit,7000);
 assert.equal(data.partners[0].pib,null);assert.equal(data.partners[0].name,'0010 · Partner A - BAR');
 assert.deepEqual(data.epsilon.controls,[{account:'4330',expected:-5000,actual:-5000}]);
 assert.deepEqual(data.epsilon.blocked,[]);
 assert.equal(data.lines.reduce((n,l)=>n+l.debit-l.credit,0),0);
});
test('opening columns use C/D even when final balance and turnover differ',()=>{
 const data=build({basis:'OPENING',reportDate:'2026-01-01'});
 assert.equal(data.lines.find(l=>l.partner.startsWith('0010')).credit,12000);
 assert.equal(data.lines.some(l=>l.account==='2410'),false);
 assert.deepEqual(data.epsilon.controls,[{account:'4330',expected:-10000,actual:-10000}]);
});
test('missing buyer breakdown, detail mismatch, unclosed income and expenses block saving',()=>{
 const l=ledger();l.push(row('2020','Kupci',10,0));
 assert.match(build({ledger:l}).epsilon.blocked.join(' '),/2020.*nedostaje/);
 const s=[...headings(true),row('0010','Partner A - BAR',0,99)];
 assert.match(build({suppliers:s}).epsilon.blocked.join(' '),/Razrada konta/);
 assert.match(build({ledger:[...ledger(),row('5120','Trošak',1,0)]}).epsilon.blocked.join(' '),/nezatvoren saldo/);
 assert.throws(()=>build({reportDate:'2026-01-01'}),/datum/);
});
test('reject reordered columns, duplicate IDs/accounts, invalid signs and overwritten totals',()=>{
 for(const mutate of [r=>r[0][2]='SALDO',r=>r[2][11]='P',r=>r[2][10]=999,r=>r[2][6]=201,r=>r.push([...r[2]])]){
  const r=ledger();mutate(r);assert.throws(()=>parseEpsilonBalances(r,false,'CLOSING'));
 }
 const s=suppliers();s.push([...s[2]]);assert.throws(()=>parseEpsilonBalances(s,true,'OPENING'),/ponovljena/);
 assert.throws(()=>parseEpsilonBalances(suppliers(),false,'CLOSING'),/zaključni list/);
});
