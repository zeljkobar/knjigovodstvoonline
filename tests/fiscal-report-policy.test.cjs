/* eslint-disable @typescript-eslint/no-require-imports -- Application report regression. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sourceLoader } = require('./helpers/source-loader.cjs');
const context = { user: { agencija_id: 'agency' }, firma: { id: 'firm' }, year: { id: 'year' } };
const year = { datum_od: new Date('2026-01-01Z'), datum_do: new Date('2026-12-31Z') };
const decimal = value => ({ toString: () => String(value) });
function invoice(type, amount, extra = {}) {
  return { id: type, document_type: type, vrsta_racuna: type.includes('STORNO') || type === 'POS_RETURN' ? 'CORRECTIVE' : 'NORMAL',
    original_invoice_id: null, sales_channel: type.startsWith('POS') ? 'POS' : 'OFFICE',
    interni_broj: type, broj_racuna: type, official_invoice_number: type, issued_at: new Date('2026-10-28T12:00Z'),
    datum_racuna: new Date('2026-10-28Z'), ukupno_osnovica: decimal(amount), ukupno_izlazni_pdv: decimal(0), ukupno_sa_pdv: decimal(amount),
    nacin_placanja: 'BANK_TRANSFER', kupac: { naziv: 'Kupac', pib: '00123456' }, pos_register: null,
    placanja: [{ payment_method: 'BANK_TRANSFER', amount: decimal(amount) }], poreske_stavke: [], stavke: [], ...extra };
}
function fixture(rows = []) {
  const queries = [];
  const load = sourceLoader({ '@/lib/prisma': { prisma: { fiskalniIzlazniRacun: { findMany: async query => { queries.push(query); return rows; } } } } });
  return { reports: load('src/lib/direct-portal-reports.ts'), pos: load('src/lib/pos-reports.ts'), queries };
}
test('ordinary sales isolate tenant, year, confirmed environment, currency and supported categories', () => {
  const { confirmedSalesWhere } = sourceLoader()('src/lib/fiscal-report-policy.ts');
  const query = confirmedSalesWhere({ agencijaId: 'a', firmaId: 'f', yearId: 'y' });
  assert.equal(query.agencija_id, 'a'); assert.equal(query.firma_id, 'f'); assert.equal(query.poslovna_godina_id, 'y');
  assert.equal(query.fiscal_environment, 'Production'); assert.equal(query.fiskalizacija_rezim, 'SUMMA'); assert.equal(query.valuta, 'EUR');
  assert.deepEqual(query.fiscal_status.in, ['Fiscalized', 'StornoCreated']);
  assert(query.document_type.in.includes('OFFICE_STORNO'));
  assert(!query.document_type.in.includes('ADVANCE_SETTLEMENT'));
  assert.deepEqual(query.vrsta_racuna.in, ['NORMAL', 'CORRECTIVE']);
  assert.equal(confirmedSalesWhere({ agencijaId:'a',firmaId:'f',yearId:'y',environment:'Test' }).fiscal_environment, 'Test');
});
test('portal filters default production and round-trip test through export/print query', () => {
  const { reports } = fixture();
  const production = reports.parseDirectPortalReportFilters({ od:'2026-01-01',do:'2026-12-31' }, year);
  assert.equal(production.environment, 'Production');
  const filters = reports.parseDirectPortalReportFilters({ od:'2026-01-01',do:'2026-12-31',okruzenje:'Test' }, year);
  assert.equal(new URLSearchParams(reports.directPortalReportQuery(filters)).get('okruzenje'), 'Test');
  assert.equal(reports.parseDirectPortalReportFilters({ okruzenje:'Unknown' }, year).environment, 'Production');
});
test('office and POS corrections reduce original exactly once; cents remain exact', async () => {
  const { reports, queries } = fixture([invoice('INVOICE', '181.50'), invoice('OFFICE_STORNO','-181.50'), invoice('POS_RECEIPT','0.30'), invoice('POS_RETURN','-0.10')]);
  const filters = reports.parseDirectPortalReportFilters({ od:'2026-10-01',do:'2026-10-31' }, year);
  const report = await reports.loadDirectPortalReport(context, filters, 'promet');
  assert.equal(report.totals.gross, 20n); assert.equal(report.totals.salesGross, 18180n);
  assert.equal(report.totals.correctionsGross, -18160n); assert.equal(report.totals.ordinaryCount, 2); assert.equal(report.totals.correctionCount,2);
  assert.equal(report.payments[0].amount,20n);
  const q=queries[0].where; assert.equal(q.firma_id,'firm'); assert.equal(q.agencija_id,'agency'); assert.equal(q.fiscal_environment,'Production');
  assert.equal(q.AND[0].OR[0].issued_at.gte.toISOString(),'2026-09-30T22:00:00.000Z');
  assert.equal(q.AND[0].OR[0].issued_at.lt.toISOString(),'2026-10-31T23:00:00.000Z');
});
test('POS report and pazar reader use same production contract while retaining POS-only scope', async () => {
  const { pos, queries }=fixture();
  await pos.loadPosReport({ agencijaId:'agency',firmaId:'firm',yearId:'year',start:new Date('2026-01-01Z'),end:new Date('2027-01-01Z') });
  assert.deepEqual(queries[0].where.document_type.in,['POS_RECEIPT','POS_RETURN']);
  assert.equal(queries[0].where.fiscal_environment,'Production');
});
test('portal retains tenant/year boundaries and local inclusive dates over DST; POS uses same environment policy', async () => {
  const { reports, pos, queries } = fixture();
  const filters = reports.parseDirectPortalReportFilters({ od:'2026-10-25',do:'2026-10-25',okruzenje:'Test' }, year);
  await reports.loadDirectPortalReport(context, filters, 'promet');
  const where = queries[0].where;
  assert.equal(where.agencija_id, 'agency'); assert.equal(where.firma_id, 'firm'); assert.equal(where.poslovna_godina_id, 'year');
  assert.equal(where.fiscal_environment, 'Test');
  const range = where.AND[0].OR[0].issued_at;
  assert.equal(range.gte.toISOString(), '2026-10-24T22:00:00.000Z');
  assert.equal(range.lt.toISOString(), '2026-10-25T23:00:00.000Z');
  await pos.loadPosReport({ agencijaId:'agency',firmaId:'firm',yearId:'year',start:range.gte,end:new Date(range.lt.getTime()-1),environment:'Test' });
  assert.equal(queries[1].where.fiscal_environment, 'Test');
  assert.deepEqual(queries[1].where.document_type.in, ['POS_RECEIPT','POS_RETURN']);
});
test('journals sort chronologically, select corrections and reveal original only inside company scope', async () => {
  const original={agencija_id:'agency',firma_id:'firm',official_invoice_number:'ORIGINAL',iic:'ORIGINAL-IIC'};
  const {reports,queries}=fixture([invoice('OFFICE_STORNO','-181.50',{original_invoice_id:'original',original_invoice:original,correction_reason:'Povrat'})]);
  const filters=reports.parseDirectPortalReportFilters({od:'2026-10-01',do:'2026-10-31'},year);
  assert.equal(reports.parseDirectPortalReportKind('zurnal'),'zurnal');
  const report=await reports.loadDirectPortalReport(context,filters,'korekcije');
  assert(queries[0].where.AND.some(condition=>condition.OR?.some(item=>item.original_invoice_id)));
  assert.equal(queries[0].orderBy[0].issued_at,'asc');
  assert.equal(report.documents[0].originalNumber,'ORIGINAL');
  assert.equal(report.documents[0].originalIic,'ORIGINAL-IIC');
  assert.equal(report.documents[0].gross,-18150n);
  original.firma_id='other';
  const outside=await reports.loadDirectPortalReport(context,filters,'zurnal');
  assert.equal(outside.documents[0].originalNumber,'');assert.equal(outside.documents[0].originalIic,'');
});
test('journal renders identifiers, correction reference and item amounts without action controls',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const {FiscalJournal}=sourceLoader()('src/components/FiscalJournal.tsx');
 const html=renderToStaticMarkup(React.createElement(FiscalJournal,{documents:[{id:'c',correction:true,officialNumber:'CORRECTION',date:new Date('2026-10-01Z'),channel:'OFFICE',register:'Kancelarija',buyer:'Kupac',buyerTaxNumber:'001',iic:'IKOF-1',jikr:'JIKR-1',originalNumber:'ORIGINAL-1',originalIic:'ORIGINAL-IIC',correctionReason:'Povrat',base:-100n,vat:0n,gross:-100n,lines:[{code:'01',name:'Usluga',quantity:-1000n,unit:'kom',base:-100n,vat:0n,gross:-100n}]}]}));
 for(const expected of ['IKOF-1','JIKR-1','ORIGINAL-1','ORIGINAL-IIC','Povrat','Usluga']) assert(html.includes(expected));
 assert(!html.includes('<button'));assert(!html.includes('<form'));
});
test('buyer report reads issued snapshot and searches historical name alongside scoped address book',async()=>{
 const {reports,queries}=fixture([invoice('INVOICE','1.21',{kupac_id:'buyer-id',buyer_snapshot:{naziv:'Izdat naziv',pib:'0001'}})]);
 const filters=reports.parseDirectPortalReportFilters({od:'2026-10-01',do:'2026-10-31',kupac:'Izdat'},year);
 const report=await reports.loadDirectPortalReport(context,filters,'kupci');
 assert.equal(report.documents[0].buyerId,'buyer-id');assert.equal(report.documents[0].buyer,'Izdat naziv');assert.equal(report.documents[0].buyerTaxNumber,'0001');assert.equal(report.documents[0].buyerHistorical,true);
 assert.equal(queries[0].where.agencija_id,'agency');assert.equal(queries[0].where.firma_id,'firm');
 assert(queries[0].where.AND.some(condition=>condition.OR?.some(item=>item.buyer_snapshot?.path[0]==='naziv'&&item.buyer_snapshot.mode==='insensitive')));
});
