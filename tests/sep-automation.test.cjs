/* eslint-disable @typescript-eslint/no-require-imports -- Source-loader regression. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const XLSX=require('xlsx');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const {sepAutomationDay,sepAutomationPeriods,sepAutomationScheduledAt,parseSepAutomationExcel}=sourceLoader()('src/lib/sep-automation-policy.ts');
function excel(rows){const b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,XLSX.utils.json_to_sheet(rows),'SEP');return XLSX.write(b,{type:'buffer',bookType:'xlsx'});}
const row=(overrides={})=>({Status:'CORRECT','IKOF računa':'A'.repeat(32),'Datum fiskalizovanja':'2026-10-15 12:00:00','Redni broj':1,'Kod poslovne jedinice':'bu','ENU kod':'cr','Ukupna cijena (€)':121,'Ime kupca':'Kupac','PIB kupca':'01234567',...overrides});
test('04:00 uses Podgorica time, month-to-yesterday and previous month only on the first',()=>{
 assert.equal(sepAutomationScheduledAt('2026-10-16').toISOString(),'2026-10-16T02:00:00.000Z');
 assert.equal(sepAutomationScheduledAt('2026-12-16').toISOString(),'2026-12-16T03:00:00.000Z');
 assert.equal(sepAutomationDay(new Date('2026-10-16T01:59Z')).due,false);
 assert.equal(sepAutomationDay(new Date('2026-10-16T02:00Z')).due,true);
 assert.equal(sepAutomationDay(new Date('2026-12-16T03:00Z')).due,true);
 assert.deepEqual(sepAutomationPeriods('2026-10-16'),[{from:'2026-10-01',to:'2026-10-15'}]);
 assert.deepEqual(sepAutomationPeriods('2026-11-01'),[{from:'2026-10-01',to:'2026-10-31'}]);
 assert.deepEqual(sepAutomationPeriods('2026-01-01'),[{from:'2025-12-01',to:'2025-12-31'}]);
 assert.deepEqual(sepAutomationPeriods('2024-03-01'),[{from:'2024-02-01',to:'2024-02-29'}]);
 assert.throws(()=>sepAutomationPeriods('2026-02-30'));
});
test('Excel is read in memory; local times are independent of host/browser timezone',()=>{
 const result=parseSepAutomationExcel(excel([row(),row(),row({Status:'REJECTED'}),row({'IKOF računa':'B'.repeat(32),'Datum fiskalizovanja':'2026-10-15 12:00:00','Ukupna cijena (€)':-121})]),'12345678','2026-10-01','2026-10-15');
 assert.equal(result.invoices.length,2);assert.equal(result.skipped,2);assert.deepEqual(result.errors,[]);
 const params=new URL(result.invoices[0].link).hash.split('?')[1];
 assert.equal(new URLSearchParams(params).get('crtd'),'2026-10-15T10:00:00.000Z');
 assert.equal(new URLSearchParams(result.invoices[1].link.split('?')[1]).get('prc'),'-121.00');
});
test('incomplete, wrong-period and ambiguous daylight-saving rows are reported, not silently lost',()=>{
 const result=parseSepAutomationExcel(excel([row({'Datum fiskalizovanja':'2026-10-25 02:30:00'}),row({'IKOF računa':''}),row({'Datum fiskalizovanja':'2026-09-30 12:00:00'})]),'12345678','2026-10-01','2026-10-31');
 assert.equal(result.invoices.length,0);assert.equal(result.errors.length,3);
});
