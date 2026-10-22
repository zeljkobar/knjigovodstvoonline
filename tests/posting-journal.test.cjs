/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
function fixture(denied=false){
 const queries=[],checks=[];
 const tx={stavkaNaloga:{count:async q=>{queries.push(q);return 201},aggregate:async q=>{queries.push(q);return {_sum:{duguje:'0.30',potrazuje:'0.30'}}},findMany:async q=>{queries.push(q);return [{id:'line',duguje:'0.10',potrazuje:'0.00'}]}}};
 const db={firma:{findFirst:async q=>{assert.equal(q.where.agencija_id,'agency');assert.ok(q.where.korisnici);return {naziv:'Company'}}},poslovnaGodina:{findFirst:async q=>{assert.equal(q.where.firma_id,'company');return {godina:2026}}},$transaction:async(fn,options)=>{assert.equal(options.isolationLevel,'RepeatableRead');return fn(tx)}};
 const load=sourceLoader({'@/lib/prisma':{prisma:db},'@/lib/auth':{requireAnyRole:async()=>({id:'worker',agencija_id:'agency',rola:'korisnik_agencije'})},'@/lib/work-context':{readWorkContext:async()=>({firmaId:'company',poslovnaGodinaId:'year'})},'@/lib/permissions':{requirePermissionForUser:async(_u,q)=>{checks.push(q);if(denied&&q.akcija==='export')throw Error('DENIED')},hasPermission:async()=>!denied}});
 return {report:load('src/lib/posting-journal.ts'),queries,checks};
}
test('journal scopes POSTED lines, dates, stable chronology and pagination; print includes all with exact totals',async()=>{
 const f=fixture(),params={datum_od:'2026-01-01',datum_do:'2026-10-22',strana:'2'};
 const screen=await f.report.loadPostingJournal(params);
 assert.equal(screen.page,2);assert.equal(screen.debit,30);assert.equal(screen.rows[0].debit,10);
 const q=f.queries[2];assert.equal(q.skip,100);assert.equal(q.take,100);
 assert.deepEqual(q.where.nalog,{agencija_id:'agency',firma_id:'company',poslovna_godina_id:'year',status:'POSTED',is_deleted:false,datum:{gte:new Date('2026-01-01'),lte:new Date('2026-10-22')}});
 assert.deepEqual(q.orderBy,[{nalog:{datum:'asc'}},{nalog:{created_at:'asc'}},{nalog_id:'asc'},{redni_broj:'asc'}]);
 const print=await f.report.loadPostingJournal(params,true);assert.equal(print.debit,screen.debit);assert.equal(f.queries[5].take,undefined);assert.ok(f.checks.some(c=>c.akcija==='export'));
 assert.equal(new URLSearchParams(f.report.postingJournalQuery(params)).has('strana'),false);
});
test('invalid periods do not query lines and print permission is enforced',async()=>{
 for(const params of [{datum_od:'2026-02-30'},{datum_od:'bad'},{datum_od:'2026-10-22',datum_do:'2026-01-01'}]){const f=fixture();const data=await f.report.loadPostingJournal(params);assert.ok(data.error);assert.equal(f.queries.length,0)}
 const f=fixture(true);await assert.rejects(f.report.loadPostingJournal({},true),/DENIED/);assert.equal(f.queries.length,0);
});

test('column searches combine on the server and survive print/pagination links',async()=>{
 const f=fixture();
 const params={konto:'241',partner:'NLB',nalog:'IZV-2026-0001',stavka:'2',dokument:'12',datum_dokumenta:'2026-01-01',opis:'priliv',duguje:'1.234,56',potrazuje:'0,00'};
 await f.report.loadPostingJournal(params);
 const and=f.queries[2].where.AND;
 assert.ok(and.some(c=>c.firma_konto?.OR[0].sifra.contains==='241'));
 assert.ok(and.some(c=>c.komitent?.OR[0].naziv.contains==='NLB'));
 assert.ok(and.some(c=>c.duguje?.equals==='1234.56'));
 assert.ok(and.some(c=>c.potrazuje?.equals==='0.00'));
 assert.ok(and.some(c=>c.redni_broj===2));
 assert.ok(and.some(c=>c.datum_dokumenta?.toISOString()==='2026-01-01T00:00:00.000Z'));
 const query=new URLSearchParams(f.report.postingJournalQuery(params,2));
 for(const [k,v] of Object.entries(params)) assert.equal(query.get(k),v);
 for(const p of [{duguje:'abc'},{stavka:'-1'},{rbr:'0'},{datum_dokumenta:'2026-02-30'}]){const g=fixture();assert.ok((await g.report.loadPostingJournal(p)).error);assert.equal(g.queries.length,0)}
});
