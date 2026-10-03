// Real PostgreSQL transactions with rollback; Fiscal API is entirely simulated.
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const rollback = new Error('ROLLBACK_OFFICE_STORNO');
(async () => {
 try { await db.$transaction(async (tx) => {
  const now = new Date();
  const yearNumber = Number(new Intl.DateTimeFormat('en-GB', { year: 'numeric', timeZone: 'Europe/Podgorica' }).format(now));
  const agency = await tx.agencija.create({ data: { naziv: 'Storno test' } });
  const firm = await tx.firma.create({ data: { agencija_id: agency.id, naziv: 'Storno fixture', pib: '12345678' } });
  const year = await tx.poslovnaGodina.create({ data: { firma_id: firm.id, godina: yearNumber, datum_od: new Date(`${yearNumber}-01-01`), datum_do: new Date(`${yearNumber}-12-31`) } });
  const user = await tx.korisnik.create({ data: { agencija_id: agency.id, korisnicko_ime: randomUUID(), lozinka_hash: 'disabled', rola: 'admin_agencije' } });
  const partner = await tx.komitent.create({ data: { naziv: 'Buyer', agencija_id: agency.id, firma_id: firm.id } });
  const unit = await tx.jedinicaMjere.create({ data: { sifra: randomUUID(), naziv: 'Komad', oznaka: 'kom' } });
  const item = await tx.artikal.create({ data: { agencija_id: agency.id, firma_id: firm.id, sifra: '1', naziv: 'Test item', jedinica_mjere_id: unit.id, usluga: false } });
  const wh = await tx.magacin.create({ data: { agencija_id: agency.id, firma_id: firm.id, sifra: '1', naziv: 'Warehouse' } });
  const type = await tx.vrstaNaloga.create({ data: { sifra: randomUUID(), naziv: 'Storno journal', prefiks: 'IR' } });
  const debit = await tx.firmaKonto.create({ data: { firma_id: firm.id, sifra: '2010', naziv: 'Buyer', tip_konta: 'analiticko', analitika_obavezna: true } });
  const credit = await tx.firmaKonto.create({ data: { firma_id: firm.id, sifra: '6000', naziv: 'Revenue', tip_konta: 'analiticko' } });
  const remoteCompany = randomUUID();
  await tx.fiscalCompanyLink.create({ data: { agencija_id: agency.id, firma_id: firm.id, fiscal_api_company_id: remoteCompany, fiscal_environment: 'Test' } });
  const ctx = { agencijaId: agency.id, firmaId: firm.id, yearId: year.id, userId: user.id, userName: user.korisnicko_ime };
  const scope = { agencija_id: agency.id, firma_id: firm.id, poslovna_godina_id: year.id };
  const remote = new Map(), byKey = new Map();
  let creates = 0, submits = 0, loseCreate = false, loseSubmit = false, environment = 'Test', remotePending = false;
  let createHook = null;
  const api = {
    getCompany: async () => ({ data: { id: remoteCompany, tin: '12345678', environment } }),
    getInvoice: async (id) => { assert.ok(remote.has(id)); return { data: { ...remote.get(id) } }; },
    createInvoiceStorno: async (id, payload, key) => {
      creates++;
      assert.equal(payload.confirmation, `CREATE_STORNO:${id}`);
      if (createHook) { const hook = createHook; createHook = null; await hook(); }
      let created = byKey.get(key);
      if (!created) {
        const original = remote.get(id); assert.ok(original);
        created = { id: randomUUID(), companyId: remoteCompany, originalInvoiceId: id, invoiceType: 'Corrective', status: remotePending ? 'FiscalizationPending' : 'Draft', totalGrossAmount: -original.totalGrossAmount, invoiceNumber: 'ST-'+creates };
        byKey.set(key, created); remote.set(created.id, created);
      }
      if (loseCreate) { loseCreate = false; throw new Error('create response lost'); }
      return { data: { ...created } };
    },
    fiscalizeInvoice: async (id, confirmation) => {
      submits++; assert.equal(confirmation, `FISCALIZE_TEST:${id}`);
      const invoice = remote.get(id); invoice.status = 'Fiscalized'; invoice.iic = 'storno-iic'; invoice.jikr = randomUUID(); invoice.qrCodeData = 'https://example.test/qr'; invoice.officialInvoiceNumber = 'ST-'+submits;
      if (loseSubmit) { loseSubmit = false; throw new Error('submit response lost'); }
      return { data: { isSuccess: true, status: 'Fiscalized', jikr: invoice.jikr } };
    }
  };
  let savepoint = 0;
  const proxy = new Proxy(tx, { get(target, key) {
    if (key === '$transaction') return async (fn) => {
      const name = `storno_test_${++savepoint}`;
      await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
      try { const result = await fn(tx); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); return result; }
      catch (error) { await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`); throw error; }
    };
    return target[key];
  } });
  const mocks = { 'server-only': {}, './prisma': { prisma: proxy }, './fiscal-admin-api': { fiscalAdminApi: api, FiscalAdminApiError: class extends Error { constructor(code, message) { super(message); this.code = code; } } }, 'next/headers': { headers: async () => new Map() } };
  let failAccountingAudit = false;
  const cache = new Map();
  function load(file) {
    const canonical = path.resolve(file); if (cache.has(canonical)) return cache.get(canonical).exports;
    const mod = new Module(canonical, module); mod.paths = module.paths; cache.set(canonical, mod);
    const native = Module.createRequire(canonical);
    mod.require = (id) => {
      if (id === './audit') {
        const actual = load('src/lib/audit.ts');
        return { ...actual, auditLogInTransaction: async (...args) => {
          if (failAccountingAudit && args[1].akcija === 'office_storno_accounting_completed') { failAccountingAudit = false; throw new Error('simulate failed local commit'); }
          return actual.auditLogInTransaction(...args);
        } };
      }
      if (id in mocks) return mocks[id];
      if (id.startsWith('.') || id.startsWith('@/')) {
        const stem = id.startsWith('@/') ? path.resolve('src', id.slice(2)) : path.resolve(path.dirname(canonical), id);
        for (const extension of ['.ts','.tsx']) if (fs.existsSync(stem+extension)) return load(stem+extension);
      }
      return native(id);
    };
    mod._compile(ts.transpileModule(fs.readFileSync(canonical, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, canonical);
    return mod.exports;
  }
  const service = load('src/lib/outgoing-invoice-storno.ts');
  let number = 1000;
  async function makeInvoice({ goods = false, journal = true } = {}) {
    const n = number += 100, remoteId = randomUUID();
    const invoice = await tx.fiskalniIzlazniRacun.create({ data: { ...scope, kupac_id: partner.id, magacin_id: goods ? wh.id : null, broj: n, interni_broj: `IF-${n}`, broj_racuna: `IF-${n}`, datum_racuna: now, datum_prometa: now, fiscal_api_invoice_id: remoteId, fiscal_status: 'Fiscalized', fiscal_environment: 'Test', fiskalizacija_rezim: 'SUMMA', iic: 'original-iic', jikr: randomUUID(), ukupno_osnovica: '100', ukupno_izlazni_pdv: '21', ukupno_sa_pdv: '121', status: journal ? 'WAITING_KIF' : 'DRAFT', stavke: { create: { redni_broj: 1, artikal_id: item.id, sifra_artikla: '1', naziv_artikla: 'Test item', jedinica_mjere: 'kom', usluga: !goods, kolicina: '2', jedinicna_cijena_bez_pdv: '50', jedinicna_cijena_sa_pdv: '60.5', osnovica: '100', pdv_iznos: '21', ukupno_sa_pdv: '121', pdv_stopa_sifra: '21', pdv_stopa_naziv: '21%', pdv_stopa_procenat: '21' } } }, include: { stavke: true } });
    remote.set(remoteId, { id: remoteId, companyId: remoteCompany, status: 'Fiscalized', iic: invoice.iic, jikr: invoice.jikr, totalGrossAmount: 121 });
    if (journal) await attachJournal(invoice);
    if (goods) {
      await tx.prometZaliha.create({ data: { ...scope, magacin_id: wh.id, artikal_id: item.id, tip_dokumenta: 'OUTGOING_INVOICE', dokument_id: invoice.id, stavka_dokumenta_id: invoice.stavke[0].id, datum_prometa: now, smjer: 'OUT', kolicina: '2', jedinicna_nabavna_cijena: '30', nabavna_vrijednost: '60', prosjecna_cijena_nakon: '30', kolicina_nakon: '8' } });
      await tx.stanjeZaliha.upsert({ where: { firma_id_poslovna_godina_id_magacin_id_artikal_id: { firma_id: firm.id, poslovna_godina_id: year.id, magacin_id: wh.id, artikal_id: item.id } }, create: { ...scope, magacin_id: wh.id, artikal_id: item.id, kolicina: '8', prosjecna_nabavna_cijena: '30', nabavna_vrijednost: '240' }, update: {} });
    }
    return invoice;
  }
  async function attachJournal(invoice) {
    const journal = await tx.nalog.create({ data: { ...scope, vrsta_naloga_id: type.id, broj: invoice.broj, datum: now, izvorni_dokument_id: invoice.id, source_type: 'OUTGOING_INVOICE', stavke: { create: [{ konto_id: debit.id, komitent_id: partner.id, duguje: '121', potrazuje: '0', redni_broj: 1 }, { konto_id: credit.id, duguje: '0', potrazuje: '121', redni_broj: 2 }] } } });
    await tx.fiskalniIzlazniRacun.update({ where: { id: invoice.id }, data: { nalog_id: journal.id } });
  }
  const run = (invoice, context = ctx) => service.createAndFiscalizeOfficeStorno({ context, originalId: invoice.id, reason: 'Test complete reversal', confirmed: true });
  const first = await makeInvoice({ goods: true });
  createHook = async () => { assert.equal((await run(first)).state, 'pending'); };
  let result = await run(first);
  assert.equal(result.state, 'complete');
  const correction = await tx.fiskalniIzlazniRacun.findUniqueOrThrow({ where: { id: result.id }, include: { poreske_stavke: true, stavke: true } });
  assert.equal(correction.ukupno_sa_pdv.toString(), '-121'); assert.equal(correction.stavke[0].kolicina.toString(), '-2'); assert.equal(correction.poreske_stavke[0].output_vat_amount.toString(), '-21');
  const reverseLines = await tx.stavkaNaloga.findMany({ where: { nalog_id: correction.nalog_id }, orderBy: { redni_broj: 'asc' } });
  assert.equal(reverseLines[0].duguje.toString(), '-121'); assert.equal(reverseLines[1].potrazuje.toString(), '-121');
  const state = await tx.stanjeZaliha.findFirstOrThrow({ where: { firma_id: firm.id, artikal_id: item.id } });
  assert.equal(state.kolicina.toString(), '10'); assert.equal(state.nabavna_vrijednost.toString(), '300');
  const beforeSubmit = submits;
  assert.equal((await run(first)).id, correction.id); assert.equal(submits, beforeSubmit);
  assert.equal(await tx.prometZaliha.count({ where: { dokument_id: correction.id } }), 1);
  assert.equal(await tx.fiskalniIzlazniRacun.count({ where: { original_invoice_id: first.id } }), 1);
  for (const mode of ['create', 'submit']) {
    const invoice = await makeInvoice();
    if (mode === 'create') loseCreate = true; else loseSubmit = true;
    result = await run(invoice); assert.equal(result.state, 'pending');
    const afterLoss = submits;
    const retry = await run(invoice); assert.equal(retry.state, 'complete'); assert.equal(retry.id, result.id);
    if (mode === 'submit') assert.equal(submits, afterLoss);
    assert.equal(await tx.fiskalniIzlazniRacun.count({ where: { original_invoice_id: invoice.id } }), 1);
  }
  const unfinished = await makeInvoice({ journal: false });
  result = await run(unfinished); assert.equal(result.state, 'accounting'); assert.equal(result.issue, 'storno_original_knjizenje');
  const beforeFinish = submits; await attachJournal(unfinished); assert.equal((await run(unfinished)).state, 'complete'); assert.equal(submits, beforeFinish);
  const rollbackInvoice = await makeInvoice({ goods: true });
  const stockBefore = await tx.stanjeZaliha.findFirstOrThrow({ where: { firma_id: firm.id, artikal_id: item.id } });
  failAccountingAudit = true;
  result = await run(rollbackInvoice); assert.equal(result.state, 'accounting');
  assert.equal(await tx.prometZaliha.count({ where: { dokument_id: result.id } }), 0);
  assert.equal((await tx.stanjeZaliha.findUniqueOrThrow({ where: { id: stockBefore.id } })).kolicina.toString(), stockBefore.kolicina.toString());
  assert.equal((await tx.fiskalniIzlazniRacun.findUniqueOrThrow({ where: { id: result.id } })).fiscal_status, 'Fiscalized');
  const beforeLocalRetry = submits;
  assert.equal((await run(rollbackInvoice)).state, 'complete'); assert.equal(submits, beforeLocalRetry);
  const previous = await tx.poslovnaGodina.create({ data: { firma_id: firm.id, godina: yearNumber - 1, datum_od: new Date(`${yearNumber-1}-01-01`), datum_do: new Date(`${yearNumber-1}-12-31`), zakljucena: true } });
  const oldInvoice = await makeInvoice();
  await tx.fiskalniIzlazniRacun.update({ where: { id: oldInvoice.id }, data: { poslovna_godina_id: previous.id, datum_racuna: new Date(`${yearNumber-1}-12-01`) } });
  result = await run(oldInvoice); assert.equal(result.state, 'complete');
  assert.equal((await tx.fiskalniIzlazniRacun.findUniqueOrThrow({ where: { id: result.id } })).poslovna_godina_id, year.id);
  const bookType = await tx.racunVrsta.create({ data: { agencija_id: agency.id, firma_id: firm.id, dokument_tip: 'KIF', sifra: 'storno', naziv: 'Test KIF' } });
  await tx.pdvStopa.create({ data: { agencija_id: agency.id, sifra: '21', naziv: '21%', procenat: '21' } });
  const book = await tx.kifBook.create({ data: { ...scope, racun_vrsta_id: bookType.id, redni_broj: 1, internal_kif_number: 'KIF-TEST', mjesec: correction.datum_racuna.getUTCMonth()+1, kif_date: correction.datum_racuna } });
  const actionsFile = path.resolve('src/app/agencija/racuni/actions.ts');
  const actionsModule = new Module(actionsFile, module);
  actionsModule.require = (id) => {
    if (id === '@/lib/prisma') return { prisma: proxy };
    if (id === '@/lib/auth') return { requireAnyRole: async () => user };
    if (id === '@/lib/work-context') return { readWorkContext: async () => ({ firmaId: firm.id, poslovnaGodinaId: year.id }) };
    if (id === '@/lib/permissions') return { hasPermission: async () => true };
    if (id === '@/lib/audit') return { auditLog: async () => {} };
    if (id === 'next/cache') return { revalidatePath() {} };
    if (id === 'next/navigation') return { redirect(url) { throw new Error('REDIRECT:'+url); } };
    if (id === '@/lib/account-plan') return load('src/lib/account-plan.ts');
    return {};
  };
  actionsModule._compile(ts.transpileModule(fs.readFileSync(actionsFile,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, actionsFile);
  const importForm = new FormData(); importForm.set('kif_book_id',book.id); importForm.append('fiscal_invoice_id',correction.id);
  await assert.rejects(actionsModule.exports.importFiscalInvoicesToKif(importForm), /kif_fiskalni_preuzeti/);
  const kif = await tx.kifEntry.findFirstOrThrow({ where: { source_id: correction.id }, include: { tax_lines: true } });
  assert.equal(kif.total_gross.toString(), '-121'); assert.equal(kif.tax_lines[0].output_vat_amount.toString(), '-21'); assert.equal(kif.journal_id, correction.nalog_id);
  const submitBeforeImportRetry = submits; assert.equal((await run(first)).state,'complete'); assert.equal(submits,submitBeforeImportRetry);
  assert.equal((await tx.fiskalniIzlazniRacun.findUniqueOrThrow({ where: { id: correction.id } })).status,'POSTED');
  mocks['@/lib/prisma'] = { prisma: proxy };
  mocks['./actions'] = {};
  mocks['../../../_shared'] = { getInventoryContext: async () => ({ allowed: true, user, firma: firm }) };
  mocks['next/navigation'] = { notFound() { throw new Error('NOT_FOUND'); } };
  mocks['next/link'] = { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) };
  const stornoPage = load('src/app/agencija/robno/izlazne-fakture/[id]/storno/page.tsx').default;
  const previewOriginal = await makeInvoice();
  const preview = renderToStaticMarkup(await stornoPage({ params: Promise.resolve({ id: previewOriginal.id }), searchParams: Promise.resolve({}) }));
  assert.match(preview, /Fiskalizuj potpuni storno/); assert.match(preview, /-121/); assert.match(preview, /Test/);
  const completedHtml = renderToStaticMarkup(await stornoPage({ params: Promise.resolve({ id: first.id }), searchParams: Promise.resolve({}) }));
  assert.doesNotMatch(completedHtml, /type="submit"/); assert.match(completedHtml, /Štampaj storno/);
  if (process.env.STORNO_PREVIEW_DIR) {
    fs.mkdirSync(process.env.STORNO_PREVIEW_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.STORNO_PREVIEW_DIR, 'index.html'), '<!doctype html><html lang="sr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><main style="padding:32px;max-width:1200px;margin:auto">'+preview+'</main></body></html>');
    fs.copyFileSync('src/app/globals.css', path.join(process.env.STORNO_PREVIEW_DIR, 'style.css'));
  }
  const mismatch = await makeInvoice(); environment = 'Production'; const prior = creates;
  result = await run(mismatch); assert.equal(result.issue, 'storno_okruzenje'); assert.equal(creates, prior); environment = 'Test';
  const blocked = await makeInvoice();
  await assert.rejects(run(blocked, { ...ctx, firmaId: randomUUID() }), /storno_original/);
  await tx.poslovnaGodina.update({ where: { id: year.id }, data: { zakljucena: true } });
  await assert.rejects(run(blocked), /storno_godina/);
  await tx.poslovnaGodina.update({ where: { id: year.id }, data: { zakljucena: false } });
  const uncertain = await makeInvoice(); loseSubmit = true; const uncertainResult = await run(uncertain); assert.equal(uncertainResult.state, 'pending');
  const month = Number(new Intl.DateTimeFormat('en-GB', { month: 'numeric', timeZone: 'Europe/Podgorica' }).format(now));
  await tx.pdvPeriod.create({ data: { ...scope, mjesec: month, datum_od: new Date(Date.UTC(yearNumber, month-1, 1)), datum_do: new Date(Date.UTC(yearNumber, month, 0)), status: 'LOCKED' } });
  await assert.rejects(run(blocked), /storno_period/);
  const beforeReconcile = submits;
  result = await run(uncertain); assert.equal(result.state, 'accounting'); assert.equal(result.issue, 'storno_period');
  assert.equal(submits, beforeReconcile);
  assert.equal((await tx.fiskalniIzlazniRacun.findUniqueOrThrow({ where: { id: uncertainResult.id } })).fiscal_status, 'Fiscalized');
  console.log('PASS: OFFICE storno, fiscal replay, duplicate click, negative taxes/journal, exact stock return, pending accounting, scope, environment and period guards');
  throw rollback;
 }, { timeout: 90000 }); } catch (error) { if (error !== rollback) throw error; }
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
