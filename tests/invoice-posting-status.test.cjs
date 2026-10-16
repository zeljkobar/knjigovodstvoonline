/* eslint-disable @typescript-eslint/no-require-imports -- Source-loader regression tests. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sourceLoader } = require('./helpers/source-loader.cjs');

test('KIF/KUF display follows journal posting and reversal without resetting transfer state', async () => {
  let state = 'POSTED';
  const load = sourceLoader({ '@/lib/prisma': { prisma: { nalog: { findMany: async query => {
    assert.equal(query.where.agencija_id, 'agency');
    assert.equal(query.where.is_deleted, false);
    assert.deepEqual(query.where.id.in, ['journal']);
    return [{ id: 'journal', status: state }];
  } } } } });
  const { loadInvoiceJournalStatuses, invoiceEntryPostingLabel, invoiceBookPostingLabel } = load('src/lib/invoice-posting-status.ts');
  const transferred = { journal_id: 'journal', posting_status: 'POSTED' };
  const fresh = { journal_id: null, posting_status: 'UNPOSTED' };
  for (const [journalState, expected] of [['POSTED', 'Knjiženo'], ['DRAFT', 'U nacrtu naloga'], ['POSTED', 'Knjiženo']]) {
    state = journalState;
    const statuses = await loadInvoiceJournalStatuses([transferred, transferred], 'agency');
    assert.equal(invoiceEntryPostingLabel(transferred, statuses), expected);
    assert.equal(invoiceBookPostingLabel([transferred], statuses), expected);
    assert.equal(transferred.posting_status, 'POSTED');
    assert.equal(transferred.journal_id, 'journal');
    assert.equal(invoiceBookPostingLabel([transferred, fresh], statuses), journalState === 'POSTED' ? 'Djelimično knjižena' : 'U nacrtu naloga');
  }
  const mixed = new Map([['journal', 'POSTED'], ['draft', 'DRAFT']]);
  assert.equal(invoiceBookPostingLabel([transferred, { journal_id: 'draft' }], mixed), 'Djelimično knjižena');
  assert.equal(invoiceEntryPostingLabel(transferred, new Map([['journal', 'DELETED']])), 'Otvorena');
  assert.equal(invoiceEntryPostingLabel(transferred, new Map()), 'Otvorena');
  assert.equal(invoiceBookPostingLabel([], new Map()), 'Otvorena');
});

test('KIF and KUF locked period reviews hide add link and explain unlocking', async () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  for (const kind of ['kif', 'kuf']) {
    let locked = false;
    const book = { id: 'book', entries: [], mjesec: 6, status: 'OPEN', racun_vrsta: { naziv: kind }, [`internal_${kind}_number`]: 'BOOK', [`${kind}_date`]: new Date('2026-06-30') };
    const prisma = {
      firma: { findFirst: async () => ({ id: 'firm' }) },
      poslovnaGodina: { findFirst: async () => ({ id: 'year', godina: 2026 }) },
      [`${kind}Book`]: { findFirst: async () => book },
      pdvPeriod: { findFirst: async query => {
        assert.equal(query.where.agencija_id, 'agency');
        assert.equal(query.where.firma_id, 'firm');
        assert.equal(query.where.status, 'LOCKED');
        assert.deepEqual(query.where.datum_od.lte, book[`${kind}_date`]);
        assert.deepEqual(query.where.datum_do.gte, book[`${kind}_date`]);
        return locked ? { id: 'period' } : null;
      } }
    };
    const load = sourceLoader({
      '@/lib/prisma': { prisma },
      '@/lib/auth': { requireAnyRole: async () => ({ id: 'user', agencija_id: 'agency', rola: 'admin_agencije' }) },
      '@/lib/permissions': { requirePermissionForUser: async () => {} },
      '@/lib/work-context': { readWorkContext: async () => ({ firmaId: 'firm', poslovnaGodinaId: 'year' }) },
      'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) }
    });
    const Page = load(`src/app/agencija/racuni/pregled-${kind}/[id]/page.tsx`).default;
    const render = async () => renderToStaticMarkup(await Page({ params: Promise.resolve({ id: 'book' }), searchParams: Promise.resolve({}) }));
    assert.match(await render(), /Dodaj račun\/e/);
    locked = true;
    const html = await render();
    assert.doesNotMatch(html, /Dodaj račun\/e/);
    assert.match(html, /PDV period je zaključan. Za dodavanje računa prvo ga otključajte./);
    locked = false;
    assert.match(await render(), /Dodaj račun\/e/);
  }
});
