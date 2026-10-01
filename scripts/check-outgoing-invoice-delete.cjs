const fs = require('node:fs'), Module = require('node:module'), assert = require('node:assert/strict'), ts = require('typescript');
let changes = 0, audits = 0, period = null, movement = null;
const base = { id: 'invoice', status: 'DRAFT', fiscal_status: 'DRAFT', datum_racuna: new Date('2026-10-02'), poslovna_godina: { zakljucena: false }, _count: { fiskalni_pokusaji: 0, placanja: 0, corrective_invoices: 0 } };
let invoice = base;
const tx = {
  $executeRaw: async () => {},
  fiskalniIzlazniRacun: {
    findFirst: async ({ where }) => { assert.equal(where.agencija_id, 'agency'); assert.equal(where.firma_id, 'firm'); assert.equal(where.poslovna_godina_id, 'year'); assert.equal(where.is_deleted, false); assert.equal(where.sales_channel, 'OFFICE'); return invoice; },
    update: async ({ data }) => { assert.equal(data.is_deleted, true); assert.equal(data.deleted_by, 'user'); changes++; }
  },
  pdvPeriod: { findFirst: async () => period },
  prometZaliha: { findFirst: async () => movement }
};
const mod = new Module('delete-test', module);
mod.require = (name) => name === '@prisma/client' ? require(name) : name === './prisma' ? { prisma: { $transaction: (fn) => fn(tx) } } : name === './audit' ? { auditLogInTransaction: async (client) => { assert.equal(client, tx); audits++; } } : {};
mod._compile(ts.transpileModule(fs.readFileSync('src/lib/outgoing-invoice-delete.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, 'delete-test');
const run = () => mod.exports.deleteOutgoingInvoiceDraftDocument({ agencijaId: 'agency', firmaId: 'firm', yearId: 'year', userId: 'user' }, 'invoice');
(async () => {
  assert.equal(await run(), 'obrisana'); assert.equal(changes, 1); assert.equal(audits, 1);
  for (const patch of [{ status: 'POSTED' }, { fiscal_status: 'Fiscalized' }, { fiscal_status: 'FiscalizationPending' }, { fiscal_status: 'FiscalizationFailed' }, { nalog_id: 'journal' }, { kif_entry_id: 'kif' }, { last_fiscal_attempt_at: new Date() }, { fiscal_api_invoice_id: 'external' }, { _count: { fiskalni_pokusaji: 1 } }, { _count: { placanja: 1 } }, { original_invoice_id: 'original' }]) {
    invoice = { ...base, ...patch }; assert.equal(await run(), 'brisanje_nedozvoljeno');
  }
  invoice = { ...base, poslovna_godina: { zakljucena: true } }; assert.equal(await run(), 'zakljucana');
  invoice = base; period = { status: 'LOCKED' }; assert.equal(await run(), 'pdv_period');
  period = null; movement = { id: 'stock' }; assert.equal(await run(), 'brisanje_nedozvoljeno');
  invoice = null; assert.equal(await run(), 'nije_nacrt');
  assert.equal(changes, 1); assert.equal(audits, 1);
  console.log('PASS: scoped draft deletion, fiscal/dependency/period guards and transactional audit');
})().catch((error) => { console.error(error); process.exitCode = 1; });
