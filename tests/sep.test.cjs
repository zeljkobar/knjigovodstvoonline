/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS source-loader regression tests. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const XLSX = require('xlsx');
const { sourceLoader } = require('./helpers/source-loader.cjs');
const load = sourceLoader({ 'server-only': {} });
const { sepPeriod, exportSepExcel } = load('src/lib/sep-client.ts');
const { encryptSepCredentials, decryptSepCredentials } = load('src/lib/sep-secrets.ts');
const { readSepFiscalSnapshot } = load('src/lib/sep-fiscal-setup.ts');
const { SepError } = load('src/lib/sep-transport.ts');

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

function fakeFiscalSetup({ pib = '01234567', recordPib = pib, represented = false, registryOnly = false } = {}) {
  const calls = [];
  const personalId = '0000000000001';
  const row = (origId, fields) => ({ origId, tableRowCells: Object.entries(fields).map(([columnName, value]) => ({
    columnName, ...(typeof value === 'object' ? value : { value }),
  })) });
  const list = (...tableRows) => [{ rowCount: tableRows.length, tableRows }];
  const device = (code, name, other = {}) => ({ 'Kod': code, 'Interna oznaka ENU': code, 'Softver': name, ...other });
  const transport = async (path, data, options) => {
    calls.push({ path, data, options });
    if (path === '/kickstart/login') {
      assert.deepEqual(data, { username: null, password: null });
      return { user: { username: represented ? personalId : pib, ptyId: represented ? null : 101 } };
    }
    if (path.endsWith('/getI18n')) return { locales: { ME: {
      'TAXPAYERS.PTY_NAME': 'Naziv', 'TAXPAYERS.PTY_TIN': 'PIB', 'PROVIDERS_OPERATORS.OPR_CODE': 'Kod',
      'BUSINESS_UNITS.UNIT_CODE': 'Kod', 'CASH_REGISTERS_TAB.TCR_INTERNAL': 'Interna oznaka ENU',
      'CASH_REGISTERS.TCR_INTERNAL': 'Interna oznaka ENU', 'CASH_REGISTERS.VERSION_CODE': 'Kôd softvera',
    } } };
    if (path.endsWith('/moduls')) return [{ code: 'MAIN', modulEntities: [{ code: 'PROVIDERS_OPERATORS' }] }];
    if (path.endsWith('/tableRows')) {
      switch (data.entityEnum) {
        case 'TAXPAYERS':
          assert.equal(data.itemId, '101');
          return row(101, { PTY_NAME: 'Testna firma', PTY_TIN: recordPib, 'PDV obveznik': { valueDisplayLocal: 'Ne' } });
        case 'CASH_REGISTERS':
          switch (data.itemId) {
            case '301': return row(301, device('ab123cd456', 'Summa-fiscal-API', {
              'Verzija softvera': '1.0.1', 'Kôd softvera': 'ef789gh012', 'Certifikovano': true,
              'Proizvođač': { value: 501, linkEntityName: 'SPECIAL_CATALOGUE_PRODUCERS' },
              'Održavaoc': { value: 502, linkEntityName: 'SPECIAL_CATALOGUE_MAINTAINERS' },
            }));
            case '302': return row(302, device('aa111aa222', 'Tuđi softver'));
            case '303': return row(303, device('aa111aa333', 'Summa-fiscal-API', { 'Važi do': '1. 1. 2001.' }));
            case '304': return row(304, device('aa111aa444', 'Summa-fiscal-API', { 'Važi od': '1. 1. 2999.' }));
            case '305': return row(305, { TCR_CODE: 'lb465ki282', TCR_INTERNAL: 'Summa-001', VERSION_CODE: 'lq099vq111',
              'Važi od': '1. 1. 2001.', 'Verzija softvera': '1.0.1',
              TCR_UNIT: { value: 201, valueDisplayLocal: 'Centrala', linkEntityName: 'BUSINESS_UNITS' },
            });
          }
          break;
        case 'SPECIAL_CATALOGUE_PRODUCERS':
          assert.equal(data.itemId, '501');
          return row(501, { 'Kod': 'ij345kl678' });
        case 'SPECIAL_CATALOGUE_MAINTAINERS':
          assert.equal(data.itemId, '502');
          return row(502, { 'Kod': 'mn901op234' });
      }
    }
    if (path.endsWith('/tables')) {
      switch (data.entityEnum) {
        case 'BUSINESS_UNITS': return list(
          row(201, { UNIT_CODE: 'ab123ab123', 'Naziv': 'Centrala', 'Ulica': 'Prva ulica', 'Naselje': 'Bar' }),
          row(202, { UNIT_CODE: 'cd456cd456', 'Naziv': 'Zatvorena jedinica', 'Status': 'Zatvorena' }),
          row(203, { UNIT_CODE: 'de567de567', 'Naziv': 'Druga jedinica' }),
        );
        case 'PROVIDERS_OPERATORS': return list(row(204, { OPR_CODE: 'zz123zz456', 'Ime': 'Test', 'Prezime': 'Operater' }));
        case 'CASH_REGISTERS_TAB':
          assert.equal(data.masterEntityEnum, 'BUSINESS_UNITS');
          if (registryOnly) return list();
          if (data.masterTablePkColumnValue === '203') return list(row(null, { 'Kod': 'aa111aa555', TCR_INTERNAL: 'POS-2', 'Softver': 'Summa-fiscal-API' }));
          assert.equal(data.masterTablePkColumnValue, '201');
          return list(...[301, 302, 303, 304].map(id => row(id, {})));
        case 'CASH_REGISTERS':
          assert.equal(data.masterEntityEnum, null);
          assert.equal(data.masterTablePkColumnValue, null);
          return list(
            row(305, {}), row(305, {}),
            row(null, device('aa111aa666', 'Summa-fiscal-API', { VERSION_CODE: 'zm955pb829', BU_CODE: 'ab123ab123' })),
            row(null, device('aa111aa777', 'Tuđi softver', { BU_CODE: 'ab123ab123' })),
            row(null, device('aa111aa888', '', { VERSION_CODE: 'lq099vq111', 'Poslovna jedinica': { value: 202 } })),
            row(null, device('aa111aa999', '', { VERSION_CODE: 'lq099vq111' })),
          );
      }
    }
    throw new Error('Unexpected SEP request');
  };
  return { calls, transport, personalId };
}

test('fiscal setup imports only matching active devices and keeps tax, software and business unit codes distinct', async () => {
  const { calls, transport } = fakeFiscalSetup();
  const result = await readSepFiscalSnapshot(transport, '01234567', 'production');
  assert.equal(result.identity.name, 'Testna firma');
  assert.equal(result.identity.vat, false);
  assert.deepEqual(result.units.map(x => x.code), ['ab123ab123', 'de567de567']);
  assert.deepEqual(result.operators.map(x => x.code), ['zz123zz456']);
  assert.deepEqual(result.devices.map(x => [x.code, x.unitCode]), [['ab123cd456', 'ab123ab123'], ['aa111aa555', 'de567de567']]);
  assert.deepEqual(result.devices[0].software, {
    name: 'Summa-fiscal-API', version: '1.0.1', code: 'ef789gh012', producer: 'ij345kl678', maintainer: 'mn901op234', certified: true,
  });
  assert.equal(result.devices[1].software.code, undefined);
  assert.equal(result.devices[1].software.certified, undefined);
  assert.match(result.warnings[0], /nije prikazao sve podatke o softveru/);
  assert(!calls.some(call => call.data?.masterTablePkColumnValue === '202'));
  assert(calls.every(call => !/register|insert|delete/i.test(call.path)));
  assert.equal(calls.filter(call => call.path === '/kickstart/login').length, 1);
  assert(!calls.some(call => call.path.includes('checkIf') || JSON.stringify(call.data)?.includes('01234567')));
});

test('fiscal setup finds a production ENU by its software code and links it to its unit when SEP unit tabs are empty', async () => {
  const { calls, transport } = fakeFiscalSetup({ registryOnly: true });
  const result = await readSepFiscalSnapshot(transport, '01234567', 'production');
  assert.deepEqual(result.devices.map(({ code, label, unitCode, software }) => [code, label, unitCode, software.code]), [
    ['lb465ki282', 'Summa-001', 'ab123ab123', 'lq099vq111'],
  ]);
  assert(calls.some(call => call.path.endsWith('/tables') && call.data.entityEnum === 'CASH_REGISTERS'));
  assert(!result.warnings.some(warning => /nijedan|prazan spisak/.test(warning)));
});

test('fiscal setup refuses another PIB or a representative login before reading fiscal resources', async () => {
  for (const options of [{ recordPib: '01234568' }, { represented: true }]) {
    const { calls, transport } = fakeFiscalSetup(options);
    await assert.rejects(readSepFiscalSnapshot(transport, '01234567', 'production'), /COMPANY_CONTEXT_REQUIRED/);
    assert(!calls.some(call => call.path.endsWith('/tables')));
    assert.equal(calls.filter(call => call.path === '/kickstart/login').length, 1);
    assert(!calls.some(call => call.path.endsWith('/checkIfAuthorizedRepresentative')));
    if (options.represented) assert.deepEqual(calls.map(call => call.path), ['/kickstart/login']);
  }
});

test('fiscal setup uses the direct taxpayer record even when the login name differs from the PIB', async () => {
  const { transport } = fakeFiscalSetup({ pib: 'certificate-login-name', recordPib: '01234567' });
  assert.equal((await readSepFiscalSnapshot(transport, '01234567', 'production')).identity.name, 'Testna firma');
});

test('admin SEP lookup keeps a successful environment if the other fails and does not return or audit credentials', async () => {
  const { transport } = fakeFiscalSetup();
  let audit, allowed = false;
  const environments = [];
  const password = 'never-return-this-password';
  const action = sourceLoader({
    '@/lib/auth': { requireRole: async role => {
      assert.equal(role, 'admin');
      if (!allowed) throw new Error('FORBIDDEN');
      return { id: 'admin' };
    } },
    '@/lib/prisma': { prisma: { firma: { findFirst: async input => {
      assert.deepEqual(input.where, { id: 'firm', is_deleted: false });
      return { id: 'firm', agencija_id: 'agency', pib: '01234567' };
    } } } },
    '@/lib/audit': { auditLog: async input => { audit = input; } },
    '@/lib/sep-transport': { SepError, withSepTransport: async (environment, pfx, phrase, work) => {
      environments.push(environment);
      assert.equal(phrase, password);
      assert.equal(pfx.toString(), 'not-a-real-pfx');
      if (environment === 'production') throw new SepError('HTTP_403');
      return work(transport);
    } },
    'node:tls': { createSecureContext: () => ({}) },
  })('src/app/admin/fiskalizacija/[firmaId]/sep-actions.ts');
  const form = new FormData();
  form.append('certificate', new Blob(['not-a-real-pfx']), 'test.pfx');
  form.append('password', password);
  form.append('pib', '99999999');
  await assert.rejects(action.importFiscalSetupFromSep('firm', form), /FORBIDDEN/);
  assert.equal(environments.length, 0);
  allowed = true;
  const result = await action.importFiscalSetupFromSep('firm', form);
  assert.deepEqual(environments, ['test', 'production']);
  assert.equal(result.results.test.data.identity.name, 'Testna firma');
  assert.match(result.results.production.error, /nije prihvatio/);
  assert(!form.has('password') && !form.has('certificate'));
  assert.equal(audit.firmaId, 'firm');
  assert.deepEqual(audit.novaVrijednost, { testProcitan: true, produkcijaProcitana: false });
  for (const secret of [password, 'test.pfx', 'not-a-real-pfx']) assert(!JSON.stringify({ audit, result }).includes(secret));
});

test('one SEP submission can save the same certificate for signing only after confirming the selected taxpayer', async t => {
  for (const [scenario, options] of Object.entries({
    'lookup only': { optOut: true },
    'new test profile and certificate': {},
    'linked test profile and certificate': { linked: true },
    'wrong taxpayer in production SEP': { wrongPib: true },
    'unlinked profile already exists in the Fiscal API': { unlinked: true },
    'existing active certificate': { linked: true, active: true },
  })) await t.test(scenario, async () => {
    const password = 'vault-only-password';
    const contents = 'fake-pfx-bytes';
    const audit = [], events = [];
    const originalFile = new File([contents], 'reference.pfx');
    const company = { id: 'fiscal-profile', tin: '01234567', isActive: true, environment: 'Test' };
    const link = { agencija_id: 'agency', is_suspended: false, fiscal_api_company_id: options.linked ? company.id : null };
    const tx = {
      firma: { findFirst: async ({ where }) => {
        if ('pib' in where) assert.deepEqual(where, { id: 'firm', agencija_id: 'agency', pib: company.tin, is_deleted: false });
        return { id: 'firm', agencija_id: 'agency', pib: company.tin, naziv: 'Lokalna firma', pdv_obveznik: true, fiscalCompanyLink: link };
      } },
      $queryRaw: async () => [{ acquired: true }],
      fiscalCompanyLink: { upsert: async ({ create, where }) => {
        assert.deepEqual(where, { firma_id: 'firm' });
        assert.equal(create.agencija_id, 'agency');
        assert.equal(create.fiscal_api_company_id, company.id);
        events.push('link');
      } },
    };
    const { FiscalAdminApiError } = load('src/lib/fiscal-admin-api.ts');
    const { importFiscalSetupFromSep } = sourceLoader({
      '@/lib/auth': { requireRole: async () => ({ id: 'admin', korisnicko_ime: 'Admin' }) },
      '@/lib/prisma': { prisma: { ...tx, $transaction: async fn => fn(tx) } },
      '@/lib/audit': { auditLog: async input => audit.push(input) },
      '@/lib/sep-transport': { SepError, withSepTransport: async (environment, pfx, phrase, work) => {
        assert.equal(pfx.toString(), contents);
        assert.equal(phrase, password);
        return work(fakeFiscalSetup({ recordPib: options.wrongPib && environment === 'production' ? '01234568' : company.tin }).transport);
      } },
      'node:tls': { createSecureContext: () => ({}) },
      '@/lib/fiscal-admin-api': { FiscalAdminApiError, fiscalAdminApi: {
        listCompanies: async () => { events.push('find'); return { data: options.unlinked ? [company] : [] }; },
        upsertCompany: async input => {
          events.push('create');
          assert.equal(input.environment, 'Test');
          assert.equal(input.tin, company.tin);
          assert.ok(input.softwareCode);
          return { data: company, correlationId: 'correlation' };
        },
        getCompany: async id => { events.push('get'); assert.equal(id, company.id); return { data: company }; },
        listCertificates: async id => { events.push('list'); assert.equal(id, company.id); return { data: options.active ? [{ isActive: true }] : [] }; },
        uploadCertificate: async (id, form, actor) => {
          events.push('upload');
          assert.equal(id, company.id);
          assert.equal(actor.id, 'admin');
          assert.equal(await form.get('file').text(), contents);
          assert.equal(form.get('password'), password);
          return { data: { isActive: false } };
        },
      } },
    })('src/app/admin/fiskalizacija/[firmaId]/sep-actions.ts');
    const form = new FormData();
    form.set('certificate', originalFile);
    form.set('password', password);
    if (!options.optOut) form.set('save_for_signing', 'on');
    const result = await importFiscalSetupFromSep('firm', form);
    assert.equal(result.signing?.ok, options.optOut ? undefined : !(options.wrongPib || options.unlinked));
    assert.deepEqual(events, options.optOut || options.wrongPib ? [] : options.unlinked ? ['find']
      : options.active ? ['get', 'list'] : options.linked ? ['get', 'list', 'upload'] : ['find', 'create', 'link', 'list', 'upload']);
    assert.ok('data' in result.results.test);
    assert.equal('error' in result.results.production, Boolean(options.wrongPib));
    for (const secret of [password, contents, originalFile.name]) assert(!JSON.stringify({ audit, result }).includes(secret));
  });
});
