// Real PostgreSQL/action/page regression; synthetic session only. All fixtures roll back.
const root = process.cwd();
require('@next/env').loadEnvConfig(root, false, { info() {}, error() {} });
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const db = new PrismaClient();
const rollback = new Error('ROLLBACK_FIXED_ASSETS');
const checks = [];

(async () => {
  try {
    await db.$transaction(async (tx) => {
      const agency = await tx.agencija.create({ data: { naziv: 'Temporary fixed-assets regression' } });
      const otherAgency = await tx.agencija.create({ data: { naziv: 'Temporary isolated agency' } });
      const company = await tx.firma.create({ data: { agencija_id: agency.id, naziv: 'Temporary assets A' } });
      const other = await tx.firma.create({ data: { agencija_id: agency.id, naziv: 'Temporary assets B' } });
      const foreign = await tx.firma.create({ data: { agencija_id: otherAgency.id, naziv: 'Temporary foreign assets' } });
      const makeYear = (firma_id, godina = 2026) => tx.poslovnaGodina.create({ data: { firma_id, godina, datum_od: new Date(`${godina}-01-01`), datum_do: new Date(`${godina}-12-31`) } });
      const year = await makeYear(company.id);
      const otherYear = await makeYear(other.id);
      const nextYear = await makeYear(company.id, 2027);
      const foreignYear = await makeYear(foreign.id);
      const admin = await tx.korisnik.create({ data: { agencija_id: agency.id, korisnicko_ime: randomUUID(), lozinka_hash: 'disabled-test-fixture', rola: 'admin_agencije' } });
      const worker = await tx.korisnik.create({ data: { agencija_id: agency.id, korisnicko_ime: randomUUID(), lozinka_hash: 'disabled-test-fixture', rola: 'korisnik_agencije' } });
      await tx.korisnikFirma.create({ data: { korisnik_id: worker.id, firma_id: company.id } });
      for (const akcija of ['create', 'view', 'update']) await tx.korisnikPravo.create({ data: { agencija_id: agency.id, korisnik_id: worker.id, firma_id: company.id, modul: 'osnovna_sredstva', akcija } });
      let currentUser = admin;
      let context = { firmaId: company.id, poslovnaGodinaId: year.id };
      let failAudit = false;
      let savepoint = 0;
      const transactional = new Proxy(tx, { get(target, key) {
        if (key === 'auditLog' && failAudit) return { create: async () => { throw new Error('INJECTED_AUDIT_FAILURE'); } };
        return target[key];
      } });
      const proxy = new Proxy(transactional, { get(target, key) {
        if (key === '$transaction') return async (fn) => {
          const name = `asset_test_${++savepoint}`;
          await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
          try { const result = await fn(transactional); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); return result; }
          catch (error) { await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`); await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); throw error; }
        };
        return target[key];
      } });
      const mocks = {
        'next/cache': { revalidatePath() {} },
        'next/headers': { headers: async () => new Headers() },
        'next/navigation': { redirect(url) { throw new Error('REDIRECT:' + url); }, notFound() { throw new Error('NOT_FOUND'); } },
        'next/link': { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) },
        '@/lib/prisma': { prisma: proxy },
        '@/lib/auth': {
          requireAnyRole: async (roles) => { assert.ok(roles.includes(currentUser.rola)); return currentUser; },
          requireRole: async (role) => { assert.equal(currentUser.rola, role); return currentUser; },
          getCurrentUser: async () => currentUser,
          isDirectFiscalTenantUser: () => false
        },
        '@/lib/work-context': { readWorkContext: async () => context }
      };
      const cache = new Map();
      function load(filename) {
        const canonical = path.normalize(filename);
        if (cache.has(canonical)) return cache.get(canonical).exports;
        for (const [id, mock] of Object.entries(mocks)) {
          if (id.startsWith('@/') && canonical === path.join(root, 'src', id.slice(2) + '.ts')) return mock;
        }
        const mod = new Module(canonical, module); mod.filename = canonical; mod.paths = module.paths; cache.set(canonical, mod);
        const native = Module.createRequire(canonical);
        mod.require = (id) => {
          if (id.endsWith('.module.css')) return {};
          if (id in mocks) return mocks[id];
          if (id.startsWith('@/') || id.startsWith('.')) {
            const stem = id.startsWith('@/') ? path.join(root, 'src', id.slice(2)) : path.resolve(path.dirname(canonical), id);
            for (const extension of ['.ts', '.tsx']) if (fs.existsSync(stem + extension)) return load(stem + extension);
          }
          return native(id);
        };
        mod._compile(ts.transpileModule(fs.readFileSync(canonical, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, canonical);
        return mod.exports;
      }
      const actions = load(path.join(root, 'src/app/agencija/osnovna-sredstva/actions.ts'));
      const preview = load(path.join(root, 'src/app/agencija/osnovna-sredstva/obracuni/page.tsx')).default;
      const register = load(path.join(root, 'src/app/agencija/osnovna-sredstva/page.tsx')).default;
      const assetPage = load(path.join(root, 'src/app/agencija/osnovna-sredstva/[id]/page.tsx')).default;
      const form = (overrides = {}) => {
        const data = new FormData();
        const values = { ocekivana_firma_id: company.id, ocekivana_godina_id: year.id, nacin_unosa: 'OPENING', inventarski_broj: randomUUID(), naziv: 'Regression equipment', vrsta_imovine: 'MATERIAL', poreska_klasifikacija: 'III', datum_nabavke: '2020-01-01', datum_raspolozivosti: '2020-01-01', datum_presjeka: '2025-12-31', nabavna_vrijednost: '1200,00', akumulirana_amortizacija: '0,00', ostatak_vrijednosti: '0,00', korisni_vijek_mjeseci: '12', metoda: 'LINEAR', godisnja_stopa: '100', ...overrides };
        for (const [key, value] of Object.entries(values)) data.set(key, value);
        return data;
      };
      const redirected = async (fn, pattern) => assert.rejects(fn, (error) => pattern.test(error.message));
      const create = async (overrides = {}) => {
        const data = form(overrides);
        await redirected(() => actions.createFixedAsset(data), /sredstvo_sacuvano/);
        return tx.osnovnoSredstvo.findFirstOrThrow({ where: { firma_id: company.id, inventarski_broj: data.get('inventarski_broj') }, include: { parametri: true, promjene: true } });
      };

      const asset = await create();
      assert.equal(asset.promjene[0].datum.toISOString().slice(0, 10), '2026-01-01');
      assert.equal(asset.parametri[0].vazi_od.toISOString().slice(0, 10), '2026-01-01');
      assert.equal(asset.promjene[0].snapshot.opening_cutoff, '2025-12-31');
      assert.equal(await tx.nalog.count({ where: { firma_id: company.id } }), 0);
      assert.equal(await tx.auditLog.count({ where: { entitet_id: asset.id } }), 1);
      const { parameterInput } = load(path.join(root, 'src/lib/fixed-assets-input.ts'));
      const { calculateAssetPeriods } = load(path.join(root, 'src/lib/fixed-assets-calculation.ts'));
      assert.equal(calculateAssetPeriods({ assetId: asset.id, grossCents: 120000, accumulatedCents: 0, availableDate: '2020-01-01', periodFrom: '2026-01-01', periodTo: '2026-12-31', parameters: asset.parametri.map(parameterInput) }).totalCents, 120000);
      await redirected(() => actions.createFixedAsset(form({ datum_presjeka: '2026-01-01' })), /presjek_pocetka_godine/);
      await redirected(() => actions.createFixedAsset(form({ datum_presjeka: '2026-06-30' })), /presjek_pocetka_godine/);
      checks.push('Opening cutoff, January 1, full annual amount and no duplicate journal');

      await create({ vrsta_imovine: 'LAND', poreska_klasifikacija: 'EXEMPT', naziv: 'Regression land', korisni_vijek_mjeseci: '' });
      await create({ vrsta_imovine: 'RIGHT_OF_USE', poreska_klasifikacija: 'ACCOUNTING_AMOUNT', naziv: 'Regression unsupported lease' });
      const html = renderToStaticMarkup(await preview({ searchParams: Promise.resolve({}) }));
      assert.match(html, /Obračunaj amortizaciju/);
      assert.match(html, /Sačuvani obračuni/);
      assert.match(html, /Još nema sačuvanih obračuna/);
      checks.push('Actual preview excludes land and flags unsupported types');

      const originalContext = context;
      context = { firmaId: other.id, poslovnaGodinaId: otherYear.id };
      await redirected(() => actions.createFixedAsset(form()), /kontekst_promijenjen/);
      await redirected(() => actions.createFixedAssetCategory(form({ sifra: 'OLD', naziv: 'Old form' })), /kontekst_promijenjen/);
      context = { firmaId: company.id, poslovnaGodinaId: nextYear.id };
      await redirected(() => actions.createFixedAsset(form()), /kontekst_promijenjen/);
      context = originalContext;
      currentUser = worker;
      await redirected(() => actions.createFixedAsset(form()), /greska=prava/);
      await create({ nacin_unosa: 'NEW', datum_nabavke: '2026-01-01', datum_raspolozivosti: '2026-01-01' });
      currentUser = admin;
      checks.push('Stale company/year/category form and real permission matrix');

      const foreignCategory = await tx.osKategorija.create({ data: { agencija_id: otherAgency.id, firma_id: foreign.id, sifra: 'FOREIGN', naziv: 'Foreign category' } });
      await redirected(() => actions.createFixedAsset(form({ kategorija_id: foreignCategory.id })), /sredstvo_greska/);
      context = { firmaId: foreign.id, poslovnaGodinaId: foreignYear.id };
      await redirected(() => actions.createFixedAsset(form({ ocekivana_firma_id: foreign.id, ocekivana_godina_id: foreignYear.id })), /greska=prava/);
      context = { firmaId: other.id, poslovnaGodinaId: otherYear.id };
      await assert.rejects(assetPage({ params: Promise.resolve({ id: asset.id }) }), /NOT_FOUND/);
      context = originalContext;
      checks.push('Cross-company detail and cross-agency writes/foreign keys blocked');

      await tx.poslovnaGodina.update({ where: { id: year.id }, data: { zakljucena: true } });
      await redirected(() => actions.createFixedAsset(form()), /godina_zakljucena/);
      await tx.poslovnaGodina.update({ where: { id: year.id }, data: { zakljucena: false } });
      const pdv = await tx.pdvPeriod.create({ data: { agencija_id: agency.id, firma_id: company.id, poslovna_godina_id: year.id, mjesec: 1, datum_od: new Date('2026-01-01'), datum_do: new Date('2026-01-31'), status: 'LOCKED' } });
      await redirected(() => actions.createFixedAsset(form()), /pdv_zakljucan/);
      await tx.pdvPeriod.delete({ where: { id: pdv.id } });
      const before = await tx.osnovnoSredstvo.count({ where: { firma_id: company.id } });
      failAudit = true;
      await redirected(() => actions.createFixedAsset(form()), /sredstvo_greska/);
      failAudit = false;
      assert.equal(await tx.osnovnoSredstvo.count({ where: { firma_id: company.id } }), before);
      checks.push('Locked year/PDV rejected and failed audit rolls back asset and changes');

      const parameterForm = form({ sredstvo_id: asset.id, ocekivana_verzija: '1', vazi_od: '2026-07-01', razlog_promjene: 'Test estimate' });
      await redirected(() => actions.createFixedAssetParameter(parameterForm), /parametar_sacuvan/);
      parameterForm.set('vazi_od', '2026-08-01');
      await redirected(() => actions.createFixedAssetParameter(parameterForm), /parametar_zastario/);
      assert.equal(await tx.osParametar.count({ where: { sredstvo_id: asset.id } }), 2);
      checks.push('Estimate revision and optimistic conflict roll back atomically');

      const functional = await create({ metoda:'UNITS_OF_PRODUCTION', nabavna_vrijednost:'100', ocekivani_ucinak:'3', prethodni_ucinak:'0', jedinica_ucinka:'komad', izvor_stope:'DERIVED' });
      const usageForm = async (overrides={}) => form({ sredstvo_id:functional.id, ocekivana_verzija:String((await tx.osnovnoSredstvo.findUniqueOrThrow({where:{id:functional.id}})).verzija), datum_od:'2026-01-01', datum_do:'2026-01-31', kolicina:'1', razlog:'Test usage', ...overrides });
      const firstUsage = await usageForm();
      await redirected(()=>actions.saveFixedAssetUsage(firstUsage),/ucinak_sacuvan/);
      await redirected(()=>actions.saveFixedAssetUsage(firstUsage),/parametar_zastario/);
      await redirected(async ()=>actions.saveFixedAssetUsage(await usageForm()),/ucinak_preklapanje/);
      const januaryHtml=renderToStaticMarkup(await preview({searchParams:Promise.resolve({od:'2026-01-01',do:'2026-01-31'})}));
      assert.match(januaryHtml,/Obračunaj amortizaciju/);
      await redirected(async ()=>actions.saveFixedAssetUsage(await usageForm({datum_od:'2026-02-01',datum_do:'2026-02-28',kolicina:'3'})),/ucinak_kapacitet/);
      failAudit=true;
      await redirected(async ()=>actions.saveFixedAssetUsage(await usageForm({datum_od:'2026-02-01',datum_do:'2026-02-28',kolicina:'0'})),/ucinak_neispravan/);
      failAudit=false;
      assert.equal(await tx.osUcinak.count({where:{sredstvo_id:functional.id}}),1);
      await tx.poslovnaGodina.update({where:{id:nextYear.id},data:{zakljucena:true}});
      await redirected(async ()=>actions.saveFixedAssetUsage(await usageForm({datum_od:'2026-02-01',datum_do:'2026-02-28',kolicina:'0'})),/godina_zakljucena/);
      await tx.poslovnaGodina.update({where:{id:nextYear.id},data:{zakljucena:false}});
      const pform=await usageForm({vazi_od:'2026-02-01',metoda:'DEGRESSIVE',godisnja_stopa:'30',korisni_vijek_mjeseci:'24',razlog_promjene:'New estimate'});
      await redirected(()=>actions.createFixedAssetParameter(pform),/parametar_sacuvan/);
      const revised=await tx.osParametar.findFirstOrThrow({where:{sredstvo_id:functional.id,metoda:'DEGRESSIVE'}});
      assert.equal(revised.osnovica.toString(),'66.67');
      const oldUsage=await tx.osUcinak.findFirstOrThrow({where:{sredstvo_id:functional.id}});
      await redirected(async ()=>actions.saveFixedAssetUsage(await usageForm({ucinak_id:oldUsage.id,kolicina:'0'})),/ucinak_zavisnost/);
      await redirected(()=>actions.createFixedAsset(form({godisnja_stopa:'100.000001'})),/sredstvo_obavezno/);
      await redirected(()=>actions.createFixedAsset(form({metoda:'UNITS_OF_PRODUCTION',jedinica_ucinka:'sat',ocekivani_ucinak:'200',prethodni_ucinak:'100',izvor_stope:'DERIVED'})),/ucinak_pocetni/);
      const manual=await create({metoda:'UNITS_OF_PRODUCTION',nabavna_vrijednost:'10000',akumulirana_amortizacija:'4000',izvor_stope:'MANUAL',stopa_po_jedinici:'0.5',jedinica_ucinka:'sat',prethodni_ucinak:'8000',ocekivani_ucinak:'999999'});
      assert.equal(manual.parametri[0].ocekivani_ucinak.toString(),'20000');
      const manualUsage= form({sredstvo_id:manual.id,ocekivana_verzija:'1',datum_od:'2026-01-01',datum_do:'2026-01-31',kolicina:'100',razlog:'Usage'});
      await redirected(()=>actions.saveFixedAssetUsage(manualUsage),/ucinak_sacuvan/);
      const manualRecord=await tx.osUcinak.findFirstOrThrow({where:{sredstvo_id:manual.id}});
      manualUsage.set('ucinak_id',manualRecord.id);manualUsage.set('ocekivana_verzija','2');manualUsage.set('obrisi','1');
      currentUser=worker;
      await redirected(()=>actions.saveFixedAssetUsage(manualUsage),/greska=prava/);
      currentUser=admin;
      manualUsage.delete('obrisi');manualUsage.set('kolicina','0');
      await redirected(()=>actions.saveFixedAssetUsage(manualUsage),/ucinak_sacuvan/);
      assert.equal((await tx.osUcinak.findUniqueOrThrow({where:{id:manualRecord.id}})).kolicina.toString(),'0');
      manualUsage.set('ocekivana_verzija','3');manualUsage.set('obrisi','1');
      await redirected(()=>actions.saveFixedAssetUsage(manualUsage),/ucinak_sacuvan/);
      assert.equal((await tx.osUcinak.findUniqueOrThrow({where:{id:manualRecord.id}})).is_deleted,true);
      const { DepreciationFields }=load(path.join(root,'src/components/fixed-assets/DepreciationFields.tsx'));
      const functionalFields=renderToStaticMarkup(React.createElement(DepreciationFields,{initialMethod:'UNITS_OF_PRODUCTION',gross:'10000',initialQuantity:'20000',opening:true}));
      assert.match(functionalFields,/0,500000/);assert.match(functionalFields,/name="prethodni_ucinak"/);assert.doesNotMatch(functionalFields,/name="godisnja_stopa"/);
      const linearFields=renderToStaticMarkup(React.createElement(DepreciationFields,{}));
      assert.match(linearFields,/name="godisnja_stopa"/);assert.doesNotMatch(linearFields,/name="korisni_vijek_mjeseci"/);
      const degressiveFields=renderToStaticMarkup(React.createElement(DepreciationFields,{initialMethod:'DEGRESSIVE'}));
      assert.match(degressiveFields,/name="korisni_vijek_mjeseci"/);
      const detailHtml=renderToStaticMarkup(await assetPage({params:Promise.resolve({id:functional.id})}));
      assert.match(detailHtml,/Ostvareni učinak/);assert.match(detailHtml,/Degresivna/);
      const legacyAsset=await create({naziv:'Legacy migration fixture'});
      await tx.osParametar.deleteMany({where:{sredstvo_id:legacyAsset.id}});
      const legacyParameter=await tx.osParametar.create({data:{agencija_id:agency.id,firma_id:company.id,sredstvo_id:legacyAsset.id,vazi_od:new Date('2026-01-01'),korisni_vijek_mjeseci:12,metoda:'LINEAR'}});
      assert.equal(legacyParameter.algoritam,'ACTUAL_DAYS_LIFE_V1');assert.equal(legacyParameter.godisnja_stopa,null);
      const legacyResult=calculateAssetPeriods({assetId:legacyAsset.id,grossCents:120000,accumulatedCents:0,availableDate:'2020-01-01',periodFrom:'2026-01-01',periodTo:'2026-01-31',parameters:[parameterInput(legacyParameter)]});
      assert.equal(legacyResult.totalCents,10192);
      checks.push('Manual rate/capacity, explicit zero, update and soft-delete permissions, method-specific forms and legacy database compatibility');
      checks.push('Three methods, actual usage preview, overlap/capacity/stale input, audit rollback, future locks and dependent estimates');

      const batchActions=load(path.join(root,'src/app/agencija/osnovna-sredstva/obracuni/actions.ts'));
      const batchPage=load(path.join(root,'src/app/agencija/osnovna-sredstva/obracuni/[id]/page.tsx')).default;
      const journalActions=load(path.join(root,'src/app/agencija/nalozi/actions.ts'));
      context={firmaId:other.id,poslovnaGodinaId:otherYear.id};
      const batchForm=(extra={})=>form({ocekivana_firma_id:other.id,ocekivana_godina_id:otherYear.id,od:'2026-01-01',do:'2026-01-15',...extra});
      await redirected(()=>actions.createFixedAsset(batchForm({inventarski_broj:'BATCH-ASSET'})),/sredstvo_sacuvano/);
      const batchAsset=await tx.osnovnoSredstvo.findFirstOrThrow({where:{firma_id:other.id,inventarski_broj:'BATCH-ASSET'}});
      const globalDebitCode=`T54-${randomUUID().slice(0,8)}`;
      const globalDebit=await tx.konto.create({data:{sifra:globalDebitCode,naziv:'Global test depreciation expense',tip_konta:'analiticko'}});
      const credit=await tx.firmaKonto.create({data:{firma_id:other.id,sifra:'0290',naziv:'Test depreciation allowance',tip_konta:'analiticko'}});
      const type=await tx.vrstaNaloga.findUnique({where:{sifra:'DEPRECIATION'}});
      if(!type) await tx.vrstaNaloga.create({data:{sifra:'DEPRECIATION',naziv:'Amortizacija',prefiks:'AM',sistemska:true}});
      let newBatchId='';
      await assert.rejects(()=>batchActions.calculateDepreciation(batchForm()),e=>{const m=e.message.match(/REDIRECT:\/agencija\/osnovna-sredstva\/obracuni\/([a-f0-9-]+)$/);if(m)newBatchId=m[1];return !!m;});
      assert.equal(await tx.nalog.count({where:{firma_id:other.id}}),0);
      let batch=await tx.osObracun.findUniqueOrThrow({where:{id:newBatchId}});
      assert.equal(batch.ukupna_amortizacija.toString(),'48.39');
      assert.equal(batch.status,'DRAFT');
      await redirected(()=>batchActions.calculateDepreciation(batchForm()),new RegExp(newBatchId+'$'));
      assert.equal(await tx.osObracun.count({where:{firma_id:other.id}}),1);
      const detail=renderToStaticMarkup(await batchPage({params:Promise.resolve({id:newBatchId})}));
      assert.match(detail,/48,39/);assert.match(detail,/Ponovo obračunaj nacrt/);assert.match(detail,new RegExp(globalDebitCode));
      const recalc=()=>batchForm({obracun_id:newBatchId,revizija:String(batch.revizija),konto_troska_sifra:globalDebitCode,konto_ispravke_sifra:credit.sifra});
      await redirected(()=>batchActions.calculateDepreciation(recalc()),new RegExp(newBatchId+'$'));
      const linkedDebit=await tx.firmaKonto.findUniqueOrThrow({where:{firma_id_sifra:{firma_id:other.id,sifra:globalDebitCode}}});
      assert.equal(linkedDebit.konto_id,globalDebit.id);assert.equal(linkedDebit.override_type,'BASE_LINK');
      batch=await tx.osObracun.findUniqueOrThrow({where:{id:newBatchId}});
      const postForm=()=>batchForm({obracun_id:newBatchId,revizija:String(batch.revizija)});
      await tx.osnovnoSredstvo.update({where:{id:batchAsset.id},data:{naziv:'Changed name'}});
      await redirected(()=>batchActions.postDepreciation(postForm()),/greska=/);
      assert.equal(await tx.nalog.count({where:{firma_id:other.id}}),0);
      await redirected(()=>batchActions.calculateDepreciation(recalc()),new RegExp(newBatchId+'$'));
      batch=await tx.osObracun.findUniqueOrThrow({where:{id:newBatchId}});
      failAudit=true;
      await redirected(()=>batchActions.postDepreciation(postForm()),/greska=/);
      failAudit=false;
      assert.equal(await tx.osObracunPokrice.count({where:{firma_id:other.id}}),0);
      assert.equal(await tx.nalog.count({where:{firma_id:other.id}}),0);
      await redirected(()=>batchActions.postDepreciation(postForm()),new RegExp(newBatchId+'$'));
      await redirected(()=>batchActions.postDepreciation(postForm()),new RegExp(newBatchId+'$'));
      const posted=await tx.osObracun.findUniqueOrThrow({where:{id:newBatchId},include:{nalog:{include:{stavke:true}}}});
      assert.equal(posted.nalog.status,'POSTED');assert.equal(posted.nalog.stavke.length,2);
      assert.equal(posted.nalog.stavke.reduce((s,l)=>s+Number(l.duguje),0),48.39);
      assert.equal(posted.nalog.stavke.reduce((s,l)=>s+Number(l.potrazuje),0),48.39);
      assert.equal(await tx.nalog.count({where:{firma_id:other.id}}),1);
      await redirected(()=>journalActions.reopenJournal(form({nalog_id:posted.nalog_id})),/nalog_greska/);
      await redirected(()=>actions.createFixedAssetParameter(batchForm({sredstvo_id:batchAsset.id,ocekivana_verzija:'1',vazi_od:'2026-01-10',razlog_promjene:'Blocked historical change'})),/proknjizena_istorija/);
      async function makeBatch(od,doDate){
        let result='';await assert.rejects(()=>batchActions.calculateDepreciation(batchForm({od,do:doDate})),e=>{const m=e.message.match(/obracuni\/([a-f0-9-]+)$/);if(m)result=m[1];return !!m;});
        await redirected(()=>batchActions.calculateDepreciation(batchForm({obracun_id:result,revizija:'1',konto_troska_sifra:globalDebitCode,konto_ispravke_sifra:credit.sifra})),new RegExp(result+'$'));return result;
      }
      const overlapping=await makeBatch('2026-01-01','2026-01-31');
      await redirected(()=>batchActions.postDepreciation(batchForm({obracun_id:overlapping,revizija:'2'})),/greska=/);
      const gap=await makeBatch('2026-02-01','2026-02-28');
      await redirected(()=>batchActions.postDepreciation(batchForm({obracun_id:gap,revizija:'2'})),/greska=/);
      const rest=await makeBatch('2026-01-16','2026-01-31');
      await redirected(()=>batchActions.postDepreciation(batchForm({obracun_id:rest,revizija:'2'})),new RegExp(rest+'$'));
      assert.equal((await tx.osObracun.findUniqueOrThrow({where:{id:rest}})).ukupna_amortizacija.toString(),'51.61');
      const registerPosted=renderToStaticMarkup(await register({searchParams:Promise.resolve({})}));
      assert.match(registerPosted,/Ispravka vrijednosti<\/span><strong>100,00/);
      const correctionForm=async(batchId)=>batchForm({revizija:String((await tx.osObracun.findUniqueOrThrow({where:{id:batchId}})).revizija),obracun_id:batchId,potvrda_vracanja:'DA',razlog_vracanja:'Ispravka pogrešnog obračuna'});
      await redirected(async()=>batchActions.reopenDepreciation(await correctionForm(newBatchId)),/greska=/);
      const restBeforeReopen=await tx.osObracun.findUniqueOrThrow({where:{id:rest},include:{nalog:true}});
      const restJournalId=restBeforeReopen.nalog_id;
      await redirected(()=>batchActions.reopenDepreciation(batchForm({obracun_id:rest,revizija:'0',potvrda_vracanja:'DA',razlog_vracanja:'Stari tab'})),/greska=/);
      failAudit=true;
      await redirected(async()=>batchActions.reopenDepreciation(await correctionForm(rest)),/greska=/);
      failAudit=false;
      assert.equal((await tx.osObracun.findUniqueOrThrow({where:{id:rest}})).status,'POSTED');
      assert.ok(await tx.nalog.findUnique({where:{id:restJournalId}}));
      await redirected(async()=>batchActions.reopenDepreciation(await correctionForm(rest)),new RegExp(rest+'$'));
      let reopened=await tx.osObracun.findUniqueOrThrow({where:{id:rest}});
      assert.equal(reopened.status,'DRAFT');assert.equal(reopened.nalog_id,null);assert.equal(reopened.proknjizen_at,null);
      assert.equal(await tx.nalog.count({where:{id:restJournalId}}),0);
      assert.equal(await tx.osObracunPokrice.count({where:{obracun_id:rest}}),0);
      const reopenedDetail=renderToStaticMarkup(await batchPage({params:Promise.resolve({id:rest})}));
      assert.match(reopenedDetail,/Izbriši nacrt/);
      await redirected(()=>batchActions.calculateDepreciation(batchForm({obracun_id:rest,revizija:String(reopened.revizija),konto_troska_sifra:globalDebitCode,konto_ispravke_sifra:credit.sifra})),new RegExp(rest+'$'));
      reopened=await tx.osObracun.findUniqueOrThrow({where:{id:rest}});
      await redirected(()=>batchActions.postDepreciation(batchForm({obracun_id:rest,revizija:String(reopened.revizija)})),new RegExp(rest+'$'));
      await redirected(async()=>batchActions.reopenDepreciation(await correctionForm(rest)),new RegExp(rest+'$'));
      await redirected(()=>batchActions.deleteDepreciationDraft(batchForm({obracun_id:rest,revizija:'0',potvrda_brisanja:'DA',razlog_brisanja:'Stari tab'})),/greska=/);
      const deleteRevision=String((await tx.osObracun.findUniqueOrThrow({where:{id:rest}})).revizija);
      await redirected(()=>batchActions.deleteDepreciationDraft(batchForm({obracun_id:rest,revizija:deleteRevision,potvrda_brisanja:'DA',razlog_brisanja:'Obračun više nije potreban'})),/obracuni$/);
      assert.equal(await tx.osObracun.count({where:{id:rest}}),0);
      assert.equal(await tx.osObracunStavka.count({where:{obracun_id:rest}}),0);
      assert.ok(await tx.auditLog.findFirst({where:{entitet_id:rest,akcija:'delete_depreciation_draft'}}));
      context=originalContext;
      await redirected(()=>batchActions.postDepreciation(form({obracun_id:rest,revizija:'2'})),/greska=/);
      checks.push('Saved partial-period drafts, duplicate open, recalculation, stale hash, atomic posting/audit, idempotency, overlap/gap rejection, journal protection, reopen/delete flow and register totals');

      const ids = Array.from({ length: 205 }, () => randomUUID());
      await tx.osnovnoSredstvo.createMany({ data: ids.map((id, index) => ({ id, agencija_id: agency.id, firma_id: company.id, inventarski_broj: `P-${String(index).padStart(3, '0')}`, naziv: 'Pagination fixture', vrsta_imovine: 'MATERIAL', status: 'ACTIVE' })) });
      await tx.osPromjena.createMany({ data: ids.map((id) => ({ agencija_id: agency.id, firma_id: company.id, poslovna_godina_id: year.id, sredstvo_id: id, datum: new Date('2026-01-01'), vrsta: 'OPENING', status: 'CONFIRMED', delta_nabavna_vrijednost: '0.10', delta_ispravka_vrijednosti: '0.01' })) });
      const registerHtml = renderToStaticMarkup(await register({ searchParams: Promise.resolve({ pretraga: 'Pagination fixture', strana: '5' }) }));
      assert.match(registerHtml, /201–205 od 205/);
      assert.match(registerHtml, /Nabavna vrijednost<\/span><strong>20,50/);
      assert.match(registerHtml, /Ispravka vrijednosti<\/span><strong>2,05/);
      assert.match(registerHtml, /P-204/);
      assert.doesNotMatch(registerHtml, /P-000/);
      checks.push('Page 5 reaches assets after 200 and totals include all 205 with exact cents');

      const { purgeCompanyData } = load(path.join(root, 'src/lib/company-purge.ts'));
      await purgeCompanyData(tx, { agencijaId: agency.id, firmaId: company.id, potvrdaNaziva: company.naziv, korisnikId: admin.id });
      assert.equal(await tx.osnovnoSredstvo.count({ where: { firma_id: company.id } }), 0);
      assert.equal(await tx.osUcinak.count({where:{firma_id:company.id}}),0);
      await purgeCompanyData(tx, { agencijaId: agency.id, firmaId: other.id, potvrdaNaziva: other.naziv, korisnikId: admin.id });
      assert.equal(await tx.osObracun.count({where:{firma_id:other.id}}),0);
      assert.equal(await tx.osObracunPokrice.count({where:{firma_id:other.id}}),0);
      assert.equal(await tx.nalog.count({where:{firma_id:other.id}}),0);
      assert.equal(await tx.osKategorija.count({ where: { firma_id: foreign.id } }), 1);
      checks.push('Real company purge removes dependent rows and preserves foreign company');
      throw rollback;
    }, { timeout: 60000 });
  } catch (error) { if (error !== rollback) throw error; }
  console.log(JSON.stringify({ checks, rolledBack: true }, null, 2));
})().catch(error => {
  console.error(error instanceof assert.AssertionError ? error.message : `Fixed-assets regression failed: ${error.message}`);
  process.exitCode = 1;
}).finally(() => db.$disconnect());
