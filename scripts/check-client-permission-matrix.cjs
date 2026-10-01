// Exercise the real save action with an isolated permission store (no database writes).
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
let role = 'klijent';
let rights = [];
const prisma = {
  korisnik: { findFirst: async () => ({ id: 'user', rola: role }) },
  firma: { findFirst: async () => ({ id: 'firm' }) },
  korisnikPravo: {
    deleteMany: async ({ where }) => {
      assert.equal(where.agencija_id, 'agency');
      assert.equal(where.korisnik_id, 'user');
      assert.equal(where.firma_id, 'firm');
      rights = where.modul ? rights.filter((right) => right.modul === where.modul.not) : [];
    },
    createMany: async ({ data }) => { rights.push(...data); }
  },
  $transaction: async (fn) => fn(prisma)
};
const mocks = {
  '@/lib/prisma': { prisma },
  '@/lib/auth': { requireRole: async (required) => {
    assert.equal(required, 'admin_agencije'); return { id: 'admin', agencija_id: 'agency' };
  } },
  '@/lib/audit': { auditLog: async () => {} },
  '../actions': {},
  'react/jsx-runtime': require('react/jsx-runtime'),
  'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
  'next/cache': { revalidatePath() {} },
  'next/navigation': { redirect(url) { throw new Error('REDIRECT:' + url); } }
};
function load(file) {
  const filename = path.resolve(file);
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = module.paths;
  mod.require = (id) => {
    if (id in mocks) return mocks[id];
    if (['@/lib/permission-policy', '@/lib/client-permission-policy'].includes(id)) return load('src/' + id.slice(2) + '.ts');
    return {};
  };
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, filename);
  return mod.exports;
}
const { saveUserPermissionMatrix } = load('src/app/agencija/actions.ts');
async function save(groups, kind = 'klijent', extra = []) {
  const form = new FormData();
  form.set('korisnik_id', 'user'); form.set('firma_id', 'firm'); form.set('matrica', kind);
  groups.forEach((group) => form.append('pregledi', group));
  extra.forEach((right) => form.append('prava', right));
  await assert.rejects(saveUserPermissionMatrix(form), /REDIRECT:.*prava_sacuvana/);
}
const keys = () => rights.map((r) => `${r.modul}:${r.akcija}`).sort();
(async () => {
  rights = [{ modul: 'pos', akcija: 'create' }, { modul: 'plate', akcija: 'view' }];
  await save(['partneri', 'pdv'], 'klijent', ['nalozi:post']);
  assert.deepEqual(keys(), ['izvjestaji:view', 'nalozi:view', 'pdv:view', 'pos:create']);
  await save(['pdv']); // Shared reports permission survives disabling partner reports.
  assert.deepEqual(keys(), ['izvjestaji:view', 'pdv:view', 'pos:create']);
  await save(['robno', 'unknown']);
  assert.deepEqual(keys(), ['pos:create', 'robno:view']);
  await save([]);
  assert.deepEqual(keys(), ['pos:create']);
  const form = new FormData();
  form.set('korisnik_id', 'user'); form.set('firma_id', 'firm'); form.set('matrica', 'radnik');
  form.append('prava', 'nalozi:post');
  await assert.rejects(saveUserPermissionMatrix(form), /REDIRECT:.*prava_greska/);
  assert.deepEqual(keys(), ['pos:create']);
  role = 'korisnik_agencije';
  await save([], 'radnik', ['nalozi:view', 'nalozi:post', 'robno:create']);
  assert.deepEqual(keys(), ['nalozi:post', 'nalozi:view', 'robno:create']);
  const company = { id: 'firm', naziv: 'Test company', pib: null };
  prisma.firma.findMany = async () => [company];
  prisma.korisnik.findMany = async () => [{ id: 'user', korisnicko_ime: 'Test user', rola: role,
    email: null, aktivan: true, zadnja_prijava_at: null,
    firme: [{ id: 'assignment', firma: company, glavni_radnik: false }],
    prava: rights.map((right) => ({ ...right, firma_id: 'firm', dozvoljeno: true })) }];
  const page = load('src/app/agencija/korisnici/page.tsx').default;
  const render = async () => renderToStaticMarkup(await page({ searchParams: Promise.resolve({ korisnik: 'user', firma: 'firm', tip: role === 'klijent' ? 'klijenti' : undefined }) }));
  let html = await render();
  assert.match(html, /name="prava"/); assert.match(html, /Knjiženje/);
  role = 'klijent';
  html = await render();
  assert.match(html, /Kupci i dobavljači/); assert.match(html, /PDV pregled/);
  assert.equal((html.match(/name="pregledi"/g) || []).length, 3);
  assert.doesNotMatch(html, /name="prava"|Knjiženje|Storniranje/);
  // Real activity page: tenant scope on every lookup, bounded pagination and DST dates.
  let captured;
  prisma.korisnik.findMany = async ({ where }) => { assert.equal(where.agencija_id, 'agency'); return []; };
  prisma.firma.findMany = async ({ where }) => { assert.equal(where.agencija_id, 'agency'); return []; };
  prisma.auditLog = {
    groupBy: async ({ where }) => { assert.equal(where.agencija_id, 'agency'); return [{ akcija: 'create' }]; },
    count: async ({ where }) => { assert.equal(where.agencija_id, 'agency'); captured = where; return 51; },
    findMany: async (args) => {
      assert.equal(args.where.agencija_id, 'agency');
      assert.equal(args.take, 50); assert.ok(args.skip <= 50);
      return [{ id: 'log', created_at: new Date('2026-03-29T10:00:00Z'), korisnik_id: null, firma_id: null,
        modul: 'nalozi', akcija: 'create', tip_entiteta: 'Nalog', entitet_id: null }];
    }
  };
  const activity = load('src/app/agencija/korisnici/audit-log/page.tsx').default;
  html = renderToStaticMarkup(await activity({ searchParams: Promise.resolve({ od: '2026-03-29', do: '2026-03-29', stranica: '99999999' }) }));
  assert.equal(captured.created_at.gte.toISOString(), '2026-03-28T23:00:00.000Z');
  assert.equal(captured.created_at.lt.toISOString(), '2026-03-29T22:00:00.000Z');
  assert.match(html, /Stranica 2 od 2/);
  assert.match(html, /Sistem/);
  html = renderToStaticMarkup(await activity({ searchParams: Promise.resolve({ od: '2026-02-31' }) }));
  assert.match(html, /Provjerite filtere/);
  html = renderToStaticMarkup(await activity({ searchParams: Promise.resolve({ firma: 'not-a-uuid' }) }));
  assert.match(html, /Provjerite filtere/);
  mocks['@/lib/auth'].requireRole = async () => { throw new Error('DENIED'); };
  await assert.rejects(activity({}), /DENIED/);
  console.log('PASS: client groups, shared permissions, revocation, POS preservation, role spoofing and worker permissions');
})().catch((error) => { console.error(error); process.exitCode = 1; });
