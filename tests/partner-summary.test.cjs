/* eslint-disable @typescript-eslint/no-require-imports -- Shared report regression. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const accountId='11111111-1111-4111-8111-111111111111';
function fixture({denyExport=false}={}) {
 const checks=[],queries=[];
 const account={id:accountId,sifra:'4330',naziv:'Dobavljači'};
 const line=(partner,debit,credit)=>({duguje:{toString:()=>debit},potrazuje:{toString:()=>credit},firma_konto:account,komitent:{id:partner,naziv:partner,pib:'12345678'}});
 const db={firma:{findFirst:async q=>{assert.equal(q.where.agencija_id,'agency');assert.equal(q.where.id,'company');assert.ok(q.where.korisnici);return {id:'company',naziv:'Firma',pib:'12345678'}}},poslovnaGodina:{findFirst:async q=>{assert.equal(q.where.firma_id,'company');return {godina:2026}}},firmaKonto:{findMany:async()=>[account]},stavkaNaloga:{findMany:async q=>{queries.push(q);assert.equal(q.where.nalog.agencija_id,'agency');assert.equal(q.where.nalog.firma_id,'company');assert.equal(q.where.nalog.poslovna_godina_id,'year');assert.equal(q.where.nalog.status,'POSTED');assert.equal(q.where.nalog.is_deleted,false);return [line('A','0.10','0'),line('A','0.20','0'),line('B','0','1.23'),line('Closed','0.30','0.30')];}}};
 const load=sourceLoader({'@/lib/prisma':{prisma:db},'@/lib/auth':{requireAnyRole:async()=>({id:'worker',agencija_id:'agency',rola:'korisnik_agencije'})},'@/lib/work-context':{readWorkContext:async()=>({firmaId:'company',poslovnaGodinaId:'year'})},'@/lib/permissions':{requirePermissionForUser:async(_u,q)=>{checks.push(q);if(denyExport&&q.akcija==='export')throw Error('DENIED')},hasPermission:async()=>!denyExport}});
 return {report:load('src/lib/partner-summary.ts'),checks,queries};
}
test('screen and print share exact cent totals, date/account filters and POSTED tenant scope',async()=>{
 const {report,checks,queries}=fixture();const params={konto:accountId,datum_od:'2026-01-01',datum_do:'2026-10-31'};
 const screen=await report.loadPartnerSummary(params),print=await report.loadPartnerSummary(params,true);
 assert.deepEqual(print.rows,screen.rows);assert.equal(print.rows.length,2);
 assert.equal(print.totalDebitBalance,30);assert.equal(print.totalCreditBalance,123);
 assert.equal(print.totalDebit,30);assert.equal(print.totalCredit,123);
 assert.equal(report.partnerSummaryMoney(30),'0,30');
 assert.equal(queries[0].where.konto_id,accountId);assert.equal(queries[0].where.nalog.datum.lte.toISOString().slice(0,10),'2026-10-31');
 assert.ok(checks.some(q=>q.modul==='nalozi'&&q.akcija==='export'));
 assert.equal(new URLSearchParams(report.partnerSummaryQuery(params)).get('konto'),accountId);
});
test('direct print requires export; invalid or reversed dates do not broaden report',async()=>{
 const denied=fixture({denyExport:true});await assert.rejects(denied.report.loadPartnerSummary({},true),/DENIED/);assert.equal(denied.queries.length,0);
 for(const params of [{datum_od:'2026-02-30'},{datum_od:'2026-10-31',datum_do:'2026-01-01'},{konto:'------------------------------------'}]){
  const f=fixture();const data=await f.report.loadPartnerSummary(params,true);assert.ok(data.filterError);assert.equal(data.rows.length,0);assert.equal(f.queries.length,0);
 }
});
