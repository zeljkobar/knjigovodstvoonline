/* eslint-disable @typescript-eslint/no-require-imports -- Test actual parser without Next runtime. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { sourceLoader } = require('./helpers/source-loader.cjs');
const p = sourceLoader()('src/lib/primatech-opening.ts');
const rows = () => [
 ['QA COMPANY'], ['Nalog za knjiženje'],
 ['Vrsta naloga:',null,null,0,null,null,'Pocetno stanje',null,null,null,'Datum naloga:',null,null,'01.01.2026'],
 ['Broj naloga:',null,null,1],
 ['RBR',null,'OJ',null,'Konto/Naziv konta',null,null,'Datum','Opis knjiženja / Subanalitika',null,'Duguje',null,'Potražuje'],
 [1,null,null,'0231',null,null,'Oprema',46023,'Početno stanje',null,'1,234.56',null,'-'],
 [2,null,null,'4330',null,null,'Dobavljači',46023,'Početno stanje\nPARTNER DOO',null,'-',null,'1,234.55'],
 ['Broj stavki:',null,null,null,2]
];
test('Primatech parser preserves leading zero, partner, source cents and imbalance', () => {
 const data = p.parsePrimatechOpening(rows());
 assert.equal(data.date,'2026-01-01'); assert.equal(data.lines[0].account,'0231');
 assert.equal(data.lines[1].partner,'PARTNER DOO');
 assert.deepEqual(p.openingTotals(data.lines),{debit:123456,credit:123455,difference:1});
});
test('binary XLS and XLSX readers both recognize the original layout', () => {
 for (const bookType of ['biff8','xlsx']) {
  const w=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet(rows()),'Sheet');
  assert.equal(p.parsePrimatechOpening(p.primatechRows(XLSX.write(w,{type:'buffer',bookType}))).lines.length,2);
 }
 assert.throws(()=>p.primatechRows(Buffer.from('not an Excel journal')),/Excel|raspored/);
});
test('reject partial, duplicate, malformed, wrong-date or unsupported unit rows', () => {
 for (const mutate of [r=>r[6][0]=1,r=>r[6][7]=46024,r=>r[5][10]='1.234,56',r=>r[5][12]='1.00',r=>r[5][10]='1.001',r=>r[5][2]='OJ1',r=>r[7][4]=3,r=>r.pop()]) {
  const r=rows(); mutate(r); assert.throws(()=>p.parsePrimatechOpening(r));
 }
 assert.throws(()=>p.parsePrimatechOpening([['Pib','Naziv','Grad']]));
});
test('partner summary is identification only, preserving PIB zeroes and missing identifiers', () => {
 const partners=p.parsePrimatechPartners([['Pib','Naziv','Grad'],['02123456','PARTNER DOO','Bar'],[null,'OLD NAME','Bar'],[null,2,null]]);
 assert.deepEqual(partners,[{name:'PARTNER DOO',pib:'02123456',city:'Bar'},{name:'OLD NAME',pib:null,city:'Bar'}]);
 assert.throws(()=>p.parsePrimatechPartners([['Partner:','12345678']]));
});
test('closing list normalizes numeric accounts, aggregates duplicates, rounds only control saldos', () => {
 const closing=p.parsePrimatechClosing([['Oznaka','Naziv','PSDugujeFormated',null,null,null,null,null,'Saldo'],[231,'Oprema',null,null,null,null,null,null,1234.5602],['4690\r\r\n','Doprinos',null,null,null,null,null,null,-1.234]]);
 assert.equal(closing[0].account,'0231'); assert.equal(closing[1].cents,-123);
 assert.deepEqual(p.closingComparison({...p.parsePrimatechOpening(rows()),closing,partners:[],files:[]}),[
  {account:'4330',closing:0,opening:-123455},{account:'4690',closing:-123,opening:0}
 ]);
 assert.equal(p.primatechCents('9,999,999,999.99'),999999999999);
 assert.equal(p.primatechCents('-0.005',true),-1);
 for (const bad of ['NaN','1e3','1,23.00','1 234,56']) assert.throws(()=>p.primatechCents(bad));
});
