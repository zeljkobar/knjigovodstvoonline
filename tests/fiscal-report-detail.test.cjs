/* eslint-disable @typescript-eslint/no-require-imports -- Scoped read-only detail regression. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const id='11111111-1111-4111-8111-111111111111';
test('detail binds selected ID to same list filters and register options bind tenant',async()=>{
 let query,registerQuery,calls=0;
 const scope={agencija_id:'a',firma_id:'f',poslovna_godina_id:'y',fiscal_environment:'Test',AND:[{sales_channel:'POS'}]};
 const load=sourceLoader({
  './direct-portal-reports':{reportWhere:(context,filters,kind)=>{assert.equal(kind,'promet');assert.equal(filters.salesChannel,'POS');return scope;}},
  './prisma':{prisma:{fiskalniIzlazniRacun:{findFirst:async q=>{calls++;query=q;return null;}},posRegister:{findMany:async q=>{registerQuery=q;return[];}}}}
 });
 const svc=load('src/lib/fiscal-report-detail.ts');
 const context={user:{agencija_id:'a'},firma:{id:'f'},year:{id:'y'}};
 assert.equal(await svc.loadFiscalReportDetail(context,{salesChannel:'POS'},'invalid'),null);assert.equal(calls,0);
 assert.equal(await svc.loadFiscalReportDetail(context,{salesChannel:'POS'},id),null);
 assert.deepEqual(query.where.AND,[scope,{id}]);
 assert.equal(query.select.buyer_snapshot,true);assert.equal(query.select.issuer_snapshot,true);
 assert.equal(query.select.stavke.orderBy.redni_broj,'asc');
 await svc.loadReportRegisters(context);assert.equal(registerQuery.where.agencija_id,'a');assert.equal(registerQuery.where.firma_id,'f');assert.equal(registerQuery.where.is_deleted,false);
});
test('side preview renders historical snapshots and monetary totals without editing or fiscalization',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const load=sourceLoader({'next/link':{__esModule:true,default:({children,...props})=>{delete props.scroll;return React.createElement('a',props,children);}}});
 const Preview=load('src/app/agencija/pos/promet/ReportDetail.tsx').ReportDetail;
 const d=value=>({toString:()=>value});
 const html=renderToStaticMarkup(React.createElement(Preview,{closeHref:'/agencija/pos/promet?strana=2',invoice:{
 id,interni_broj:'IF-1',official_invoice_number:'OFFICIAL-1',issued_at:new Date('2026-10-28T10:00Z'),
 fiscal_environment:'Test',fiscal_status:'Fiscalized',buyer_snapshot:{naziv:'Stari naziv <kupac>',pib:'00123456'},issuer_snapshot:{naziv:'Izdavalac',pib:'00112233'},
 iic:'IKOF',jikr:'JIKR',pos_register:null,ukupno_osnovica:d('150'),ukupno_izlazni_pdv:d('31.50'),ukupno_sa_pdv:d('181.50'),
 stavke:[{id:'line',sifra_artikla:'1',naziv_artikla:'Usluga',kolicina:d('1'),jedinica_mjere:'kom',pdv_stopa_procenat:d('21'),ukupno_sa_pdv:d('181.50')}],placanja:[]
 }}));
 assert.match(html,/Stari naziv &lt;kupac&gt;/);assert.match(html,/181,50/);assert.match(html,/TEST/);assert.match(html,/strana=2/);
 assert(!html.includes('<form'));assert(!html.includes('<button'));assert.match(html,/Ne pokreće fiskalizaciju/);
});
