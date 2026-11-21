/* eslint-disable @typescript-eslint/no-require-imports -- Server action regression with isolated dependencies. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sourceLoader } = require('./helpers/source-loader.cjs');
const id = '11111111-1111-4111-8111-111111111111';
const scope = { agencija_id: 'agency', firma_id: 'company', poslovna_godina_id: 'year' };
function fixture({ client = false, locked = false, linked = false, supplement = false, auditFails = false } = {}) {
  const events = [];
  let status = 'PRIMLJENO';
  const tx = {
    $queryRaw: async strings => strings.join('').includes('FROM firme') ? [{ id: 'company' }] : [{ zakljucena: locked }],
    primljeniDokument: {
      findFirst: async ({ where }) => {
        assert.deepEqual(Object.fromEntries(Object.keys(scope).map(k => [k, where[k]])), scope);
        assert.equal(where.kuf_entry_id, null);
        assert.equal(where.dopuna_za_id, null);
        assert.equal(where.status, 'PRIMLJENO');
        return linked ? null : { ...scope, id, status, naziv: 'Test.pdf', item_id: 'cloud' };
      },
      count: async () => supplement ? 1 : 0,
      updateMany: async ({ where, data }) => {
        assert.equal(where.kuf_entry_id, null);
        assert.equal(where.status, status);
        events.push('update'); status = data.status; return { count: 1 };
      }
    }
  };
  const load = sourceLoader({
    'next/cache': { revalidatePath: () => {} },
    'next/navigation': { redirect: url => { throw new Error(url); } },
    '@/lib/prisma': { prisma: { $transaction: async fn => {
      events.push('transaction'); const before = status;
      try { return await fn(tx); } catch (e) { status = before; throw e; }
    } } },
    '@/lib/dokumentacija': { dokumentaContext: async action => {
      assert.equal(action, 'update'); return { scope, user: { id: 'user', rola: client ? 'klijent' : 'admin_agencije' } };
    }, uuidPattern: /^[0-9a-f-]{36}$/i },
    '@/lib/dokumentacija-brisanje': {}, '@/lib/dokumentacija-onedrive': {}, '@/lib/dokumentacija-arhiva': {},
    '@/lib/audit': { auditLogInTransaction: async (_tx, entry) => {
      events.push('audit'); assert.equal(entry.korisnikId, 'user');
      assert.equal(entry.staraVrijednost.status, 'PRIMLJENO');
      assert.equal(entry.novaVrijednost.onedrive_obrisan, false);
      if (auditFails) throw new Error('audit failed');
    } }
  });
  const form = new FormData(); form.set('id', id); form.set('firma', 'company'); form.set('godina', 'year');
  return { run: () => load('src/app/agencija/dokumentacija/actions.ts').removeIncomingDocument(form),
    form, events, status: () => status };
}
test('removal keeps a tombstone and audits the actor without any cloud mutation', async () => {
  const f = fixture(); await assert.rejects(f.run(), /onedrive=uklonjeno$/);
  assert.equal(f.status(), 'UKLONJENO'); assert.deepEqual(f.events, ['transaction', 'update', 'audit']);
});
for (const option of ['locked', 'linked', 'supplement']) test(`removal rejects ${option} documents`, async () => {
  const f = fixture({ [option]: true }); await assert.rejects(f.run(), /uklanjanje_blokirano/);
  assert.equal(f.status(), 'PRIMLJENO'); assert.deepEqual(f.events, ['transaction']);
});
test('client and stale work context cannot remove a document', async () => {
  const client = fixture({ client: true }); await client.run(); assert.deepEqual(client.events, []);
  const stale = fixture(); stale.form.set('firma', 'other'); await stale.run(); assert.deepEqual(stale.events, []);
});
test('audit failure rolls back removal', async () => {
  const f = fixture({ auditFails: true }); await assert.rejects(f.run(), /audit failed/);
  assert.equal(f.status(), 'PRIMLJENO');
});
