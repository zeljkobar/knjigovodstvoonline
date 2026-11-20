/* eslint-disable @typescript-eslint/no-require-imports -- Report access regression. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sourceLoader } = require('./helpers/source-loader.cjs');
function fixture(channels, assigned = true) {
  const queries = [];
  const load = sourceLoader({
    './auth': { requireAnyRole: async () => ({ id:'worker',rola:'korisnik_agencije',agencija_id:'a' }) },
    './work-context': { readWorkContext: async () => ({ firmaId:'f',poslovnaGodinaId:'y' }) },
    './permissions': { hasAllPermissions: async (_, requirements) => { assert.equal(requirements[0].firmaId,'f'); return channels.includes(requirements[0].modul); } },
    './prisma': { prisma: {
      firma: { findFirst: async q => { queries.push(q); return assigned ? {id:'f'} : null; } },
      poslovnaGodina: { findFirst: async q => { assert.equal(q.where.firma_id,'f'); return {id:'y'}; } }
    } }
  });
  return { get:load('src/lib/agency-fiscal-report.ts').getAgencyFiscalReportContext,queries };
}
test('report grants only individually authorized channels and assigned tenant',async () => {
  const {get,queries} = fixture(['robno']);
  assert.deepEqual((await get()).channels,['OFFICE']);
  assert.equal(queries[0].where.agencija_id,'a');
  assert.equal(queries[0].where.korisnici.some.korisnik_id,'worker');
  assert.deepEqual((await fixture(['pos']).get()).channels,['POS']);
  assert.deepEqual((await fixture(['robno','pos']).get()).channels,['OFFICE','POS']);
  assert.equal(await fixture([]).get(),null);
  assert.equal(await fixture(['robno','pos'],false).get(),null);
});
test('crafted query cannot widen POS-only report to OFFICE, and empty state is explicit',async () => {
  const React = require('react');
  const {renderToStaticMarkup} = require('react-dom/server');
  let selected;
  const load=sourceLoader({
    'next/link':{__esModule:true,default:({children,...props})=>{delete props.prefetch;delete props.scroll;return React.createElement('a',props,children);}},
    '@/lib/agency-fiscal-report':{getAgencyFiscalReportContext:async()=>({user:{agencija_id:'a'},firma:{id:'f',naziv:'Firma'},year:{id:'y',datum_od:new Date('2026-01-01Z'),datum_do:new Date('2026-12-31Z')},channels:['POS']})},
    '@/lib/fiscal-report-detail':{loadFiscalReportDetail:async()=>null,loadReportRegisters:async()=>[]},
    '@/lib/fiscal-report-page': { fiscalReportPage:()=>1, loadFiscalReportPage:async(_,filters)=>{selected=filters;return{page:1,pages:1,documents:[],taxes:[],totals:{count:0,ordinaryCount:0,correctionCount:0,salesGross:0n,correctionsGross:0n,base:0n,vat:0n,gross:0n}};} },
    '@/lib/direct-portal-reports':{
      directPortalReportQuery:()=>'',
      parseDirectPortalReportFilters:()=>({periodFrom:'2026-01-01',periodTo:'2026-12-31',salesChannel:'OFFICE',environment:'Production'}),
      directPortalReportChannelLabels:{POS:'POS',OFFICE:'Fakture'},directPortalReportDocumentLabels:{},
      loadDirectPortalReport:async(_,filters)=>{selected=filters;return{documents:[],taxes:[],totals:{ordinaryCount:0,correctionCount:0,salesGross:0n,correctionsGross:0n,base:0n,vat:0n,gross:0n}};}
    }
  });
  const Page=load('src/app/agencija/pos/promet/page.tsx').default;
  const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({kanal:'OFFICE'})}));
  assert.equal(selected.salesChannel,'POS');
  assert.match(html,/Nema potvrđenih računa/);
  assert.match(html,/automatsko poređenje sa Fiscal API-jem još nije dostupno/);
});
