/* eslint-disable @typescript-eslint/no-require-imports -- Server page render regression. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { sourceLoader } = require('./helpers/source-loader.cjs');

function fixture(bankAllowed = true) {
  const queries = [], firm = { id: 'firm', naziv: 'Moja firma', aktivan: true, poslovne_godine: [{ id: 'year', godina: 2026 }] };
  const scoped = (kind, rows) => async query => { queries.push({ kind, query }); assert.equal(query.where.agencija_id, 'agency'); return rows; };
  const load = sourceLoader({
    '@/lib/sep-context': { getSepAdmin: async () => ({ user: { id: 'admin', agencija_id: 'agency' }, agencyId: 'agency' }) },
    '@/lib/work-context': { readWorkContext: async () => ({ firmaId: 'firm', poslovnaGodinaId: 'year' }) },
    '@/lib/imap-access-policy': { canAccessAgencyImap: () => bankAllowed },
    '@/lib/permissions': { hasPermission: async () => true },
    '@/app/agencija/podesavanja/sep-automatika/actions': { retrySepAutomation: '/test-retry' },
    'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/lib/prisma': { prisma: {
      firma: { findMany: scoped('firms', [firm]) },
      sepAutomatikaPodesavanje: { findMany: scoped('configs', [{ firma_id: 'firm' }]) },
      sepAutomatikaObrada: { findMany: scoped('sep', [{ id: 'sep', firma_id: 'firm', firma: firm, dan: new Date('2026-10-15'), pocetak: new Date('2026-10-15T02:00Z'), created_at: new Date('2026-10-15'), status: 'REVIEW', pokusaji: 2, rezultat: { preuzeto: 6, uvezeno: 2, duplikati: 4, proknjizeno: 2, greske: ['Zaključan period'], periodi: ['2026-10-01 — 2026-10-14'] } }]) },
      auditLog: { findMany: scoped('bank', [{ id: 'bank', firma_id: 'firm', firma: firm, created_at: new Date('2026-10-16T08:00Z'), nova_vrijednost: { day: '2026-10-16', imported: 3, posted: 3, review: 0, errors: [], status: 'DONE' } }]) }
    } }
  });
  return { queries, render: async query => renderToStaticMarkup(await load('src/app/agencija/automatski-obradjena-dokumenta/page.tsx').default({ searchParams: Promise.resolve(query || {}) })) };
}
test('dashboard combines sources in date order, keeps counters, scope and safe context links', async () => {
  const { render, queries } = fixture();
  const html = await render();
  assert.match(html, /Automatski obrađena dokumenta/);
  assert.match(html, /2 obrada · 1 za provjeru · 5 proknjiženih dokumenata/);
  assert.ok(html.indexOf('Email / izvodi</td>') < html.indexOf('SEP računi</td>'));
  assert.match(html, /Zaključan period/);
  assert.match(html, /Ponovi obradu/);
  assert.match(html, /poslovna_godina_id=year/);
  assert.doesNotMatch(html, /name="sertifikat_id"/);
  for (const { kind, query } of queries.filter(item => item.kind !== 'firms')) {
    assert.equal(query.where.firma_id, 'firm', kind);
  }
});
test('foreign firm filter cannot leave agency; bank data is never loaded without mailbox access', async () => {
  const { render, queries } = fixture(false);
  const html = await render({ firma: 'foreign-firm' });
  assert.equal(queries.some(item => item.kind === 'bank'), false);
  assert.equal(queries.find(item => item.kind === 'sep').query.where.firma_id, 'firm');
  assert.doesNotMatch(html, /Email \/ izvodi<\/td>/);
});
test('review-only filter removes successful runs and reversed dates do not fetch histories', async () => {
  const { render, queries } = fixture();
  const html = await render({ status: 'REVIEW', firma: 'sve' });
  assert.match(html, /1 obrada · 1 za provjeru · 2 proknjiženih dokumenata/);
  assert.equal(queries.find(item => item.kind === 'sep').query.where.status, 'REVIEW');
  const other = fixture();
  assert.match(await other.render({ od: '2026-12-01', do: '2026-01-01' }), /Datum od mora biti prije datuma do/);
  assert.equal(other.queries.some(item => ['sep', 'bank'].includes(item.kind)), false);
});
