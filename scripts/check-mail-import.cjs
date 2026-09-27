// Integration regression: real parsers/import persistence, synthetic mailbox/session,
// temporary company and all DB mutations rolled back. No real mail is downloaded.
const root = process.cwd();
require('@next/env').loadEnvConfig(root, false, { info() {}, error() {} });
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const rollback = new Error('ROLLBACK_TEST');
let verified = false;
(async () => {
  const user = await db.korisnik.findFirst({ where: { agencija_id: process.env.IMAP_AGENCY_ID, rola: 'admin_agencije', aktivan: true, is_deleted: false } });
  if (!user) throw new Error('Missing test agency administrator');
  try {
    await db.$transaction(async (tx) => {
      const firma = await tx.firma.create({ data: { agencija_id: user.agencija_id, naziv: 'Temporary mail import regression' } });
      const year = await tx.poslovnaGodina.create({ data: { firma_id: firma.id, godina: 2026, datum_od: new Date('2026-01-01'), datum_do: new Date('2026-12-31') } });
      const account = await tx.firmaBankovniRacun.create({ data: { agencija_id: user.agencija_id, firma_id: firma.id, broj_racuna: '530-123456-78', naziv_banke: 'NLB' } });
      const konto = await tx.firmaKonto.create({ data: { firma_id: firma.id, sifra: '241099', naziv: 'Test bank account', tip_konta: 'analiticko' } });
      await tx.bankStatementAccountSetting.create({ data: { agencija_id: user.agencija_id, firma_id: firma.id, company_bank_account_id: account.id, bank_account_konto_id: konto.id } });
      const context = { firmaId: firma.id, poslovnaGodinaId: year.id };
      let allowed = true;
      let xml = '<stmtrs><acctid>530000000012345678</acctid><stmtnumber>186</stmtnumber><ledgerbal><balamt>10.00</balamt><dtasof>2026-09-25</dtasof></ledgerbal><availbal><balamt>15.00</balamt><dtasof>2026-09-25</dtasof></availbal><stmttrn><benefit>credit</benefit><trnamt>5.00</trnamt><dtposted>2026-09-25</dtposted><purpose>Test</purpose></stmttrn></stmtrs>';
      const fixture = () => [{ index: 0, filename: 'statement.xml', content: Buffer.from(xml), contentType: 'application/xml' }];
      const proxy = new Proxy(tx, { get(target, key) { if (key === '$transaction') return (fn) => fn(tx); return target[key]; } });
      const mocks = {
        'next/cache': { revalidatePath() {} },
        'next/navigation': { redirect(url) { throw new Error('REDIRECT:' + url); } },
        '@/lib/prisma': { prisma: proxy },
        'pdfjs-dist/legacy/build/pdf.worker.mjs': {},
        'pdfjs-dist/legacy/build/pdf.mjs': { getDocument({data}) {
          structuredClone(data.buffer, {transfer: [data.buffer]});
          return {promise: Promise.resolve({numPages: 0})};
        } },
        '@/lib/audit': { auditLog: async () => {} },
        '@/lib/auth': { requireAnyRole: async () => user, requireRole: async () => user },
        '@/lib/permissions': { hasPermission: async () => allowed, requirePermissionForUser: async () => { if (!allowed) throw new Error('DENIED'); } },
        '@/lib/work-context': { readWorkContext: async () => context },
        './imap/access': { requireImapCompany: async (id) => { if (id !== firma.id) throw new Error('DENIED'); return { user, firma }; } },
        '@/lib/company-mail-settings': { getCompanyMailConfigs: async () => [{ firmaId: firma.id }] },
        '@/lib/imap-mail': { getMailImportAttachments: async () => fixture(), MailError: class extends Error {} }
      };
      const cache = new Map();
      function load(filename) {
        if (cache.has(filename)) return cache.get(filename).exports;
        const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; cache.set(filename, mod);
        const native = Module.createRequire(filename);
        mod.require = (id) => {
          if (id in mocks) return mocks[id];
          if (id.startsWith('@/')) return load(path.join(root, 'src', id.slice(2) + '.ts'));
          if (id.startsWith('.') && fs.existsSync(path.resolve(path.dirname(filename), id + '.ts'))) return load(path.resolve(path.dirname(filename), id + '.ts'));
          return native(id);
        };
        mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText + (filename.endsWith('/izvodi/actions.ts') ? '\nexports.testReadUploadedFile = readUploadedFile;' : ''), filename);
        return mod.exports;
      }
      const actions = load(path.join(root, 'src/app/agencija/izvodi/actions.ts'));
      // PDF.js detaches the input buffer. Different PDFs must keep different original hashes.
      const policy = load(path.join(root, 'src/lib/mail-import-policy.ts'));
      const firstPdf = Buffer.from('%PDF-first');
      const secondPdf = Buffer.from('%PDF-second');
      const firstRead = await actions.testReadUploadedFile(new File([firstPdf], 'first.pdf'));
      const secondRead = await actions.testReadUploadedFile(new File([secondPdf], 'second.pdf'));
      assert.equal(firstRead.contentHash, policy.attachmentHash(firstPdf));
      assert.equal(secondRead.contentHash, policy.attachmentHash(secondPdf));
      assert.notEqual(firstRead.contentHash, secondRead.contentHash);
      const ref = { firmaId: firma.id, yearId: year.id, folder: 'INBOX', validity: '1', uid: 1 };
      let result = await actions.importBankStatementMailMessage(ref);
      assert.equal(result[0].status, 'IMPORTED');
      const statementId = result[0].statementId;
      let statement = await tx.bankStatement.findUnique({ where: { id: statementId }, include: { lines: true } });
      assert.equal(statement.lines.length, 1); assert.equal(statement.journal_id, null); assert.notEqual(statement.status, 'POSTED');
      result = await actions.importBankStatementMailMessage(ref); assert.equal(result[0].statementId, statementId);
      result = await actions.importBankStatementMailMessage({ ...ref, folder: 'Izvodi/test', uid: 20 }); assert.equal(result[0].status, 'DUPLICATE');
      assert.equal(await tx.bankStatement.count({ where: { firma_id: firma.id } }), 1);
      // Legacy manual imports have no content hash. Identity must still prevent duplication.
      await tx.bankStatement.update({ where: { id: statementId }, data: { sadrzaj_hash: null } });
      result = await actions.importBankStatementMailMessage({ ...ref, uid: 2 }); assert.equal(result[0].status, 'DUPLICATE');
      const original = xml;
      xml = original.replace('15.00', '16.00');
      result = await actions.importBankStatementMailMessage({ ...ref, uid: 3 }); assert.equal(result[0].status, 'REVIEW');
      xml = original.replace('530000000012345678', '530-999999-00');
      result = await actions.importBankStatementMailMessage({ ...ref, uid: 4 }); assert.equal(result[0].status, 'REVIEW');
      xml = original.replaceAll('2026-09-25', '2025-09-25');
      result = await actions.importBankStatementMailMessage({ ...ref, uid: 5 }); assert.equal(result[0].status, 'REVIEW');
      xml = original;
      await assert.rejects(actions.importBankStatementMailMessage({ ...ref, firmaId: 'wrong' }));
      await assert.rejects(actions.importBankStatementMailMessage({ ...ref, yearId: 'wrong' }));
      allowed = false; await assert.rejects(actions.importBankStatementMailMessage(ref)); allowed = true;
      await tx.poslovnaGodina.update({ where: { id: year.id }, data: { zakljucena: true } });
      await assert.rejects(actions.importBankStatementMailMessage(ref));
      await tx.poslovnaGodina.update({ where: { id: year.id }, data: { zakljucena: false } });
      // Technical receipt follows physical deletion, then permits a deliberate re-import.
      await tx.bankStatement.delete({ where: { id: statementId } });
      assert.equal(await tx.mailIzvodObrada.count({ where: { firma_id: firma.id, izvod_id: { not: null } } }), 0);
      result = await actions.importBankStatementMailMessage(ref); assert.equal(result[0].status, 'IMPORTED');
      const { purgeCompanyData } = load(path.join(root, 'src/lib/company-purge.ts'));
      const purged = await purgeCompanyData(tx, { agencijaId: user.agencija_id, firmaId: firma.id, potvrdaNaziva: firma.naziv, korisnikId: user.id });
      assert.ok(purged.obrisano.mail_izvod_obrade > 0);
      assert.equal(await tx.mailIzvodObrada.count({ where: { firma_id: firma.id } }), 0);
      verified = true;
      throw rollback;
    }, { timeout: 60000 });
  } catch (error) { if (error !== rollback) throw error; }
  console.log(JSON.stringify({ importAndLines: verified, repeatAndMoveDeduplication: verified, legacyManualDuplicate: verified, wrongAccountYearAndScopeRejected: verified, lockedYearAndPermissionsRejected: verified, deleteAndReimport: verified, purge: verified, rolledBack: true }));
})().catch(error => { console.error(error instanceof assert.AssertionError ? error.message : 'Mail import database regression failed'); process.exitCode = 1; }).finally(() => db.$disconnect());
