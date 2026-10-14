/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS source-loader regression tests. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const XLSX = require('xlsx');
const { sourceLoader } = require('./helpers/source-loader.cjs');
const load = sourceLoader({ 'server-only': {} });
const { sepPeriod, exportSepExcel } = load('src/lib/sep-client.ts');
const { encryptSepCredentials, decryptSepCredentials } = load('src/lib/sep-secrets.ts');

test('encrypted SEP credentials cannot cross agency/user scope or survive tampering', () => {
  const before = process.env.SEP_ENCRYPTION_KEY;
  process.env.SEP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  try {
    const secret = { pfx: 'private-test-key', password: 'secret-password', jmbg: '0000000000000' };
    const value = encryptSepCredentials(secret, 'agency:user');
    assert(!value.includes(secret.password));
    assert.deepEqual(decryptSepCredentials(value, 'agency:user'), secret);
    assert.throws(() => decryptSepCredentials(value, 'other:user'));
    assert.throws(() => decryptSepCredentials(value, 'agency:other'));
    const parts = value.split('.'); const bytes = Buffer.from(parts[3], 'base64'); bytes[0] ^= 1; parts[3] = bytes.toString('base64');
    assert.throws(() => decryptSepCredentials(parts.join('.'), 'agency:user'));
  } finally { if (before === undefined) delete process.env.SEP_ENCRYPTION_KEY; else process.env.SEP_ENCRYPTION_KEY = before; }
});
test('period validation prevents invalid/reversed/excessive ranges', () => {
  assert.equal(sepPeriod('2026-10-01', '2026-10-14').filters[0].value, '01.10.2026-14.10.2026');
  for (const [a,b] of [['2026-02-30','2026-03-01'],['2026-10-14','2026-10-01'],['2024-01-01','2026-10-14']]) assert.throws(() => sepPeriod(a,b));
});
function fake({ denied=false, duplicate=false, outside=false } = {}) {
  const calls = [];
  const row = id => ({ tableRowCells: [
    { columnName:'IVS_FIC', value:`invoice-${id}`, valueDisplay:`invoice-${id}` },
    { columnName:'IVS_FISCAL_DATE', valueDisplay: outside ? '30.09.2026 09:00:00' : '05.10.2026 09:00:00' },
    { columnName:'IVS_TOTAL_PRICE', valueDisplay:12.34 },
  ] });
  const transport = async (path, data, options) => {
    calls.push({ path, data, options });
    if (path.endsWith('checkIfAuthorizedRepresentative')) return !denied;
    if (path.endsWith('checkIfCertificateExists') || path.endsWith('checkIfTaxpayerExists')) return true;
    if (path === '/kickstart/login') return {};
    if (path.endsWith('getI18n')) return { locales:{ ME:{ 'INVOICES_FIS.IVS_FIC':'JIKR','INVOICES_FIS.IVS_FISCAL_DATE':'Datum fiskalizovanja','INVOICES_FIS.IVS_TOTAL_PRICE':'Ukupna cijena (€)' } } };
    if (path.endsWith('/tables')) return [{ rowCount:12, tableColumns:[{columnName:'IVS_FIC'},{columnName:'IVS_FISCAL_DATE'},{columnName:'IVS_TOTAL_PRICE'}],
      tableRows: data.page === 1 ? Array.from({length:10},(_,i)=>row(i)) : [row(duplicate?0:10),row(11)], exportExcelFromBackend:false }];
    throw new Error('Unexpected request');
  };
  return { calls, transport };
}
test('full period export contains all pages and preserves numeric amounts', async () => {
  const { calls, transport } = fake();
  const result = await exportSepExcel(transport,'00000000','0000000000000','2026-10-01','2026-10-14');
  assert.equal(result.count,12);
  const book = XLSX.read(result.excel,{type:'buffer'}), rows = XLSX.utils.sheet_to_json(book.Sheets.data,{header:1});
  assert.equal(rows.length,13); assert.equal(rows[1][2],12.34);
  for (const call of calls.filter(c=>c.path.endsWith('/tables'))) assert.equal(call.data.filterColumnDataList[0].value,'01.10.2026-14.10.2026');
  assert(calls.every(c=>!c.path.includes('register')&&!c.path.includes('Fiscal')));
});
test('denied SEP authorization never logs into company or reads invoices', async () => {
  const { calls, transport } = fake({denied:true});
  await assert.rejects(exportSepExcel(transport,'00000000','0000000000000','2026-10-01','2026-10-14'), /NOT_AUTHORIZED/);
  assert(!calls.some(c=>c.path.endsWith('/tables')||c.path==='/kickstart/login'));
});
test('repeated pages and ignored date filters fail instead of returning an incomplete Excel', async () => {
  await assert.rejects(exportSepExcel(fake({duplicate:true}).transport,'00000000','0000000000000','2026-10-01','2026-10-14'), /PAGINATION_INCONSISTENT/);
  await assert.rejects(exportSepExcel(fake({outside:true}).transport,'00000000','0000000000000','2026-10-01','2026-10-14'), /SEP_FILTER_NOT_APPLIED/);
});
test('only agency administrators can obtain SEP context, with current company scoped on backend', async () => {
  let user = { id:'admin-1', rola:'korisnik_agencije', agencija_id:'agency-1', agencija:{ is_fiscal_direct_container:false } };
  let query;
  const context = sourceLoader({
    'server-only':{}, './auth':{getCurrentUser:async()=>user},
    './work-context':{readWorkContext:async()=>({firmaId:'firm-1'})},
    './permissions':{hasPermission:async()=>true},
    './prisma':{prisma:{firma:{findFirst:async input=>{query=input;return {id:'firm-1',naziv:'Test',pib:'00000000'};}}}},
  })('src/lib/sep-context.ts');
  await assert.rejects(context.getSepAdmin(), /ACCESS_DENIED/);
  user.rola='admin_agencije';
  await assert.rejects(context.getSepCompany('other-firm'), /CONTEXT_CHANGED/);
  const result=await context.getSepCompany('firm-1');
  assert.equal(result.scope,'agency-1:admin-1');
  assert.deepEqual(query.where,{id:'firm-1',agencija_id:'agency-1',aktivan:true,is_deleted:false});
});

test('download route rejects CSRF/stale context and only audits sanitized metadata on success', async () => {
  const { NextRequest } = require('next/server');
  const context = { user:{id:'admin-1'}, agencyId:'agency-1', scope:'agency-1:admin-1', firm:{id:'firm-1',naziv:'Test',pib:'00000000'} };
  let exports=0, audit=null, changed=false;
  const route=sourceLoader({
    'server-only':{}, '@/lib/app-url':{getPublicAppUrl:()=> 'http://localhost:3000'},
    '@/lib/sep-context':{getSepCompany:async expected=>{if(expected&&changed)throw new Error('CHANGED');return context;}},
    '@/lib/prisma':{prisma:{agencijaSepSertifikat:{findFirst:async()=>({id:'cert-1',updated_at:new Date(),sifrovani_podaci:'encrypted'}),count:async()=>1}}},
    '@/lib/sep-secrets':{decryptSepCredentials:()=>({pfx:'hidden',password:'hidden',jmbg:'0000000000000'})},
    '@/lib/audit':{auditLog:async input=>{audit=input;}},
    '@/lib/sep-client':{...load('src/lib/sep-client.ts'),downloadSepExcel:async()=>{exports++;return {excel:Buffer.from('test-excel'),count:12};}},
  })('src/app/agencija/sep/preuzmi/route.ts');
  function request(origin='http://localhost:3000',firm='firm-1') {
    return new NextRequest('http://localhost:3000/agencija/sep/preuzmi',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({firma_id:firm,od:'2026-10-01',do:'2026-10-14'})});
  }
  assert.equal((await route.POST(request('https://evil.example'))).status,403);
  assert.equal((await route.POST(request('http://localhost:3000','other'))).status,409);
  assert.equal(exports,0);
  const response=await route.POST(request());
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('x-sep-count'),'12');
  assert.deepEqual(audit.novaVrijednost,{od:'2026-10-01',do:'2026-10-14',broj_racuna:12});
  assert(!JSON.stringify(audit).includes('hidden'));
  audit=null;changed=true;
  assert.equal((await route.POST(request())).status,500);
  assert.equal(audit,null);
});
