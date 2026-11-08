/* eslint-disable @typescript-eslint/no-require-imports -- Actual pure tax engine regression. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const t=sourceLoader()('src/lib/corporate-tax.ts');
const calc=values=>t.calculateCorporateTax(t.parseCorporateTaxInput(values));
test('depreciation uses accounting A210a and current OA total plus extra write-off, excluding prior totals',()=>{
 assert.equal(t.corporateTaxAccountingDepreciation([{aop:'A210a',tekucaGodina:123.45}]),12345);
 assert.equal(t.corporateTaxAccountingDepreciation([]),null);
 assert.equal(t.corporateTaxAccountingDepreciation([{aop:'A210a',tekucaGodina:-1}]),null);
 const snapshot={schema:1,from:'2026-01-01',to:'2026-12-31',result:{total:20000,extraWriteOff:3456,errors:[]}};
 const read=s=>t.corporateTaxDepreciationFromSnapshot(s,'2026-01-01','2026-12-31');
 assert.equal(read(snapshot),23456);assert.equal(read({...snapshot,result:{total:0,extraWriteOff:0,errors:[]}}),0);
 assert.equal(read({...snapshot,from:'2025-01-01'}),null);
 assert.equal(read({...snapshot,result:{...snapshot.result,errors:['nepotpun']}}),null);
 for(const total of [-1,0.5,NaN,Number.MAX_SAFE_INTEGER])assert.equal(read({...snapshot,result:{...snapshot.result,total}}),null);
 assert.equal(read(null),null);
});
test('prefill uses corrected current-year A244 before tax, separates profit/loss and preserves cents',()=>{
 const rows=value=>[{aop:'A260',tekucaGodina:99999},{aop:'A244',tekucaGodina:value}];
 assert.deepEqual(t.corporateTaxResultFromStatement(rows(-1053)),{x01:0,x02:105300});
 assert.deepEqual(t.corporateTaxResultFromStatement(rows(1234.56)),{x01:123456,x02:0});
 assert.deepEqual(t.corporateTaxResultFromStatement(rows(0)),{x01:0,x02:0});
 assert.equal(t.corporateTaxResultFromStatement([{aop:'A260',tekucaGodina:500}]),null);
 assert.throws(()=>t.corporateTaxResultFromStatement(rows(NaN)),/ispravan/);
});
test('progressive brackets and cent rounding at both exact boundaries',()=>{
 for(const [profit,tax]of [['0',0],['100000',900000],['100000.01',900000],['1500000',17700000],['1500000.01',17700000],['1600000',19200000],['0.06',1]]){
  assert.equal(calc({x01:profit}).x59,tax,profit);
 }
});
test('all corrections, independently entered tax capital gains, five-year losses and credits reconcile',()=>{
 const v=calc({x01:'200000',x03:'20000',x42:'30000',x43:'5000',pg1_21:'10000',pg2_21:'10000',x49a:'5000',x53:'500',x58:'100'});
 assert.equal(v.x38,18000000);assert.equal(v.x40,1000000);assert.equal(v.x44,2500000);assert.equal(v.x46,1000000);
 assert.equal(v.x47,1500000);assert.equal(v.x50,18000000);assert.equal(v.x52,1860000);assert.equal(v.x57,1810000);assert.equal(v.x59,1800000);
 assert.equal(v.pg1_3,v.x40);assert.equal(v.pg2_3,v.x46);
});
test('zero profit does not select a different broken loss formula; losses capped to eligible profits',()=>{
 const v=calc({x02:'10000',x03:'1000',x04:'200',x42:'2000',x43:'100',pg1_21:'20000',pg2_21:'2500'});
 assert.equal(v.x39,1080000);assert.equal(v.x38,0);assert.equal(v.x40,0);assert.equal(v.x46,190000);assert.equal(v.x59,0);
 const correction=calc({x07:'100',x15a:'20',x15b:'30',x18a:'10',x18b:'20',x18c:'30',x21a:'2',x21b:'3',x26:'50',x27:'10',x32:'20',x33:'30'});
 assert.equal(correction.x38,26500);assert.equal(correction.x15,5000);assert.equal(correction.x18,6000);assert.equal(correction.x21,500);
});
test('strict cents inputs reject exponent, negative, ambiguous locale, excessive precision and computed-field tampering',()=>{
 assert.equal(t.parseTaxMoney('1234,56'),123456);assert.equal(t.taxDecimal(123456),'1234.56');
 for(const bad of ['-1','1e3','1.234,56','1.001','Infinity'])assert.throws(()=>t.parseTaxMoney(bad));
 assert.throws(()=>calc({x59:'1'}),/dozvoljeno/);assert.throws(()=>calc({x01:'1',x02:'2'}),/istovremeno/);
 assert.throws(()=>calc({x53:'1'}),/Umanjenja/);assert.throws(()=>calc({x01:'9999999999999'}),/opseg/);
});
test('legacy XML exports all 59 rows/subrows and PG1/PG2 with actual dates and fixed cents, recalculates outputs',()=>{
 const xml=t.buildCorporateTaxXml(t.parseCorporateTaxInput({x01:'100000',pg1_21:'1000'}),'2026-01-01','2026-12-31');
 assert.match(xml,/<PD xmlns:xsi=/);assert.match(xml,/<PoreskiPeriodOd>2026-01-01T00:00:00</);
 assert.match(xml,/<Iznos59>8910.00<\/Iznos59>/);assert.match(xml,/<IznosPG1_3>1000.00<\/IznosPG1_3>/);
 assert.match(xml,/<IznosPG2_25>0.00<\/IznosPG2_25>/);
 const tags=[...xml.matchAll(/<(Iznos\w+)>/g)].map(m=>m[1]);assert.equal(new Set(tags).size,tags.length);
 assert(!/undefined|NaN|Infinity/.test(xml));
 assert.throws(()=>t.buildCorporateTaxXml({},'2026-12-31','2026-01-01'),/period/);
 assert.throws(()=>t.assertCorporateTaxYear(2027),/2025–2026/);
});
