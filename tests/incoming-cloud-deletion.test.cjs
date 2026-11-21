/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Graph failure and recovery tests. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sourceLoader } = require('./helpers/source-loader.cjs');
const scope = { agencija_id: 'agency', firma_id: 'company', poslovna_godina_id: 'year' };
function fixture({ moved = false, locked = false, auditFails = false, timeout = false, linked = false } = {}) {
  let status = 'PRIMLJENO', absent = false, failed = false;
  const events = [];
  class GraphError extends Error { constructor(status) { super(); this.status = status; } }
  const tx = {
    $queryRaw: async strings => strings.join('').includes('FROM firme') ? [{ id: 'company' }] : [{ godina: 2026, zakljucena: locked }],
    primljeniDokument: {
      findFirst: async ({ where }) => {
        for (const key of Object.keys(scope)) assert.equal(where[key], scope[key]);
        assert.equal(where.kuf_entry_id, null);
        if (linked) return null;
        const allowed = typeof where.status === 'string' ? [where.status] : where.status.in;
        return allowed.includes(status) ? { ...scope, id: 'doc', status, item_id: 'file', drive_id: 'drive', parent_id: 'incoming' } : null;
      },
      count: async () => 0,
      update: async ({ data }) => { status = data.status; events.push(status); }
    }
  };
  const load = sourceLoader({
    '@/lib/prisma': {},
    './prisma': { prisma: { $transaction: async fn => {
      const before = status;
      try { return await fn(tx); } catch (e) { status = before; throw e; }
    } } },
    './dokumentacija': {
      DokumentaError: Error,
      documentDrive: async () => ({ token: 'private', driveId: 'drive', folder: { folder_id: 'root' } }),
      auditDocument: async (_tx, _doc, action) => {
        events.push(action);
        if (auditFails && action.endsWith('zavrseno') && !failed) { failed = true; throw new Error('audit'); }
      }
    },
    './dokumentacija-onedrive': {
      GraphError, driveItemPath: (drive, item) => `${drive}/${item}`,
      graph: async (_token, path) => {
        if (path.includes('/2026/primljeno')) return { id: 'incoming', folder: {} };
        if (absent) throw new GraphError(404);
        return { id: 'file', file: {}, eTag: 'version1', parentReference: { driveId: 'drive', id: moved ? 'archive' : 'incoming' } };
      },
      graphResponse: async (_token, path, options) => {
        assert.equal(status, 'BRISANJE'); assert.equal(path, 'drive/file');
        assert.equal(options.method, 'DELETE'); assert.equal(options.headers['If-Match'], 'version1');
        events.push('DELETE'); absent = true;
        if (timeout && !failed) { failed = true; throw new Error('timeout'); }
      }
    }
  });
  return { events, status: () => status,
    run: () => load('src/lib/dokumentacija-brisanje.ts').deleteIncomingCloudDocument(scope, 'doc', 'user') };
}
test('cloud deletion persists audited intent before conditional recycle-bin deletion', async () => {
  const f = fixture(); await f.run(); assert.equal(f.status(), 'UKLONJENO');
  assert.deepEqual(f.events, ['BRISANJE', 'onedrive_brisanje_zatrazeno', 'DELETE', 'UKLONJENO', 'onedrive_brisanje_zavrseno']);
});
for (const option of ['moved', 'locked', 'linked']) test(`${option} prevents remote deletion`, async () => {
  const f = fixture({ [option]: true }); await assert.rejects(f.run()); assert.ok(!f.events.includes('DELETE'));
});
for (const option of ['timeout', 'auditFails']) test(`${option} keeps durable intent and explicit retry resolves already absent file`, async () => {
  const f = fixture({ [option]: true }); await assert.rejects(f.run()); assert.equal(f.status(), 'BRISANJE');
  await f.run(); assert.equal(f.status(), 'UKLONJENO'); assert.equal(f.events.filter(x => x === 'DELETE').length, 1);
});
