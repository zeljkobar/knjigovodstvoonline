/* eslint-disable @typescript-eslint/no-require-imports -- Bounded report queries. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
test('SQL totals cover all documents while bounded last page shares snapshot and tenant scope',async()=>{
  const calls=[];let pageOptions;
  const db={
    fiskalniIzlazniRacun:{aggregate:async q=>{calls.push(q);return{_count:calls.length===1?120:2,_sum:{ukupno_osnovica:calls.length===1?'100.10':'-0.10',ukupno_izlazni_pdv:'0',ukupno_sa_pdv:calls.length===1?'100.10':'-0.10'}};}},
    fiskalniIzlazniRacunPorez:{groupBy:async q=>{assert.equal(q.where.fiskalni_izlazni_racun.firma_id,'f');return[];}}
  };
  const load=sourceLoader({
    './prisma':{prisma:{$transaction:async(fn,options)=>{assert.equal(options.isolationLevel,'RepeatableRead');return fn(db);}}},
    './direct-portal-reports':{
      reportWhere:()=>({firma_id:'f',agencija_id:'a',fiscal_environment:'Production'}),
      loadDirectPortalReport:async(_c,_f,_kind,options,tx)=>{assert.equal(tx,db);pageOptions=options;return{documents:[{id:'last'}]};}
    }
  });
  const {loadFiscalReportPage,fiscalReportPage}=load('src/lib/fiscal-report-page.ts');
  const result=await loadFiscalReportPage({}, {},999999);
  assert.equal(result.totals.count,122);assert.equal(result.totals.gross,10000n);
  assert.equal(result.page,3);assert.equal(result.pages,3);
  assert.deepEqual(pageOptions,{skip:100,take:50});
  assert.equal(result.documents.length,1);
  assert.equal(calls[0].where.AND[0].agencija_id,'a');
  assert(calls[0].where.AND[1].NOT);assert(calls[1].where.AND[1].OR);
  assert.equal(fiscalReportPage('-1'),1);assert.equal(fiscalReportPage('2'),2);assert.equal(fiscalReportPage('Infinity'),1);
});
