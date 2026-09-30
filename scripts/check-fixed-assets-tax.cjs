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
        'server-only': {},
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
      const actions = load(path.join(root,'src/app/agencija/osnovna-sredstva/poreska-amortizacija/actions.ts'));
      const page = load(path.join(root,'src/app/agencija/osnovna-sredstva/poreska-amortizacija/page.tsx')).default;
      const detail = load(path.join(root,'src/app/agencija/osnovna-sredstva/poreska-amortizacija/[id]/page.tsx')).default;
      const print = load(path.join(root,'src/app/stampa/osnovna-sredstva/poreska-amortizacija/[id]/page.tsx')).default;
      const form = (values={}) => {const f=new FormData();for(const [k,v] of Object.entries({ocekivana_firma_id:context.firmaId,ocekivana_godina_id:context.poslovnaGodinaId,...values})) f.set(k,String(v));return f;};
      const invoke = async (fn,f) => {try {await fn(f);throw new Error('Expected redirect');}catch(e){if(!e.message.startsWith('REDIRECT:'))throw e;return decodeURIComponent(e.message.slice(9));}};
      const success = async(fn,f) => {const url=await invoke(fn,f);assert.ok(!url.includes('greska='),url);return url;};
      const failure = async(fn,f,pattern) => {const url=await invoke(fn,f);assert.match(url,/greska=/);if(pattern)assert.match(url,pattern);};
      const scope={agencija_id:agency.id,firma_id:company.id,poslovna_godina_id:year.id};
      const asset=await tx.osnovnoSredstvo.create({data:{agencija_id:agency.id,firma_id:company.id,inventarski_broj:'BUILDING',naziv:'Test building',vrsta_imovine:'MATERIAL',status:'ACTIVE',datum_raspolozivosti:new Date('2020-01-01')}});
      const raw={openingSource:'OA 2025',pools:['II','III','IV','V'].map(group=>({group,opening:group==='II'?'10000':'0',soldAll:false})),assets:[{id:asset.id,classification:'I',basis:'100000',previous:'20000',accounting:'0',source:'OA building'}],events:[]};
      await success(actions.saveTaxInputs,form({verzija:0,ulazi:JSON.stringify(raw)}));
      assert.equal((await tx.osPoreskaGodina.findFirstOrThrow({where:scope})).ulazi.pools[0].opening,1000000);
      assert.equal(await tx.osPromjena.count({where:{sredstvo_id:asset.id}}),0);
      await failure(actions.saveTaxInputs,form({verzija:0,ulazi:JSON.stringify(raw)}),/drugom prozoru/);
      const firstUrl=await success(actions.calculateTaxDepreciation,form({verzija:1}));
      const first=firstUrl.split('/').pop();assert.equal(await success(actions.calculateTaxDepreciation,form({verzija:1})),firstUrl);
      let batch=await tx.osPoreskiObracun.findUniqueOrThrow({where:{id:first}});assert.equal(batch.ukupna_amortizacija.toString(),'3500');
      const html=renderToStaticMarkup(await page({searchParams:Promise.resolve({})}));assert.match(html,/Početna poreska stanja/);assert.match(html,/Pregledi obračuna/);
      const detailHtml=renderToStaticMarkup(await detail({params:Promise.resolve({id:first})}));assert.match(detailHtml,/77.500,00/);
      const printHtml=renderToStaticMarkup(await print({params:Promise.resolve({id:first})}));assert.match(printHtml,/NACRT/);fs.writeFileSync('/tmp/os-tax-print.html','<!doctype html><html><meta charset="utf-8"><body>'+printHtml+'</body></html>');
      raw.pools[0].opening='20000';await success(actions.saveTaxInputs,form({verzija:1,ulazi:JSON.stringify(raw)}));
      await failure(actions.confirmTaxDepreciation,form({obracun_id:first}),/izmijenjeni/);
      await success(actions.calculateTaxDepreciation,form({verzija:2}));
      batch=await tx.osPoreskiObracun.findFirstOrThrow({where:scope,orderBy:{revizija:'desc'}});assert.equal(batch.revizija,2);
      failAudit=true;await failure(actions.confirmTaxDepreciation,form({obracun_id:batch.id}));failAudit=false;
      assert.equal((await tx.osPoreskiObracun.findUniqueOrThrow({where:{id:batch.id}})).status,'DRAFT');
      currentUser=worker;await assert.rejects(()=>actions.confirmTaxDepreciation(form({obracun_id:batch.id})));currentUser=admin;
      context={firmaId:foreign.id,poslovnaGodinaId:foreignYear.id};await failure(actions.confirmTaxDepreciation,form({obracun_id:batch.id}),/pronađen|prava/);await assert.rejects(()=>print({params:Promise.resolve({id:batch.id})}),/NOT_FOUND|prava/);
      context={firmaId:company.id,poslovnaGodinaId:year.id};
      await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:true}});await failure(actions.confirmTaxDepreciation,form({obracun_id:batch.id}),/zaključana/);await tx.poslovnaGodina.update({where:{id:year.id},data:{zakljucena:false}});
      const pdv=await tx.pdvPeriod.create({data:{agencija_id:agency.id,firma_id:company.id,poslovna_godina_id:year.id,mjesec:1,datum_od:new Date('2026-01-01'),datum_do:new Date('2026-01-31'),status:'LOCKED'}});
      await failure(actions.confirmTaxDepreciation,form({obracun_id:batch.id}),/PDV/);
      await tx.pdvPeriod.delete({where:{id:pdv.id}});
      await success(actions.confirmTaxDepreciation,form({obracun_id:batch.id}));await success(actions.confirmTaxDepreciation,form({obracun_id:batch.id}));
      const reopenForm=()=>form({obracun_id:batch.id,potvrda_vracanja:'DA',razlog_vracanja:'Ispravka poreskog obračuna'});
      const deleteForm=()=>form({obracun_id:batch.id,potvrda_brisanja:'DA',razlog_brisanja:'Pogrešan poreski obračun'});
      await failure(actions.deleteTaxDepreciationDraft,deleteForm(),/Samo nacrt/);
      failAudit=true;await failure(actions.reopenTaxDepreciation,reopenForm());failAudit=false;
      assert.equal((await tx.osPoreskiObracun.findUniqueOrThrow({where:{id:batch.id}})).status,'CONFIRMED');
      await success(actions.reopenTaxDepreciation,reopenForm());
      let reopened=await tx.osPoreskiObracun.findUniqueOrThrow({where:{id:batch.id}});assert.equal(reopened.status,'DRAFT');assert.equal(reopened.potvrdjen_at,null);assert.equal(reopened.potvrdjen_by,null);
      const reopenedPage=renderToStaticMarkup(await page({searchParams:Promise.resolve({})}));assert.doesNotMatch(reopenedPage,/Podaci su zaključani/);
      const reopenedDetail=renderToStaticMarkup(await detail({params:Promise.resolve({id:batch.id})}));assert.match(reopenedDetail,/Izbriši nacrt/);
      await success(actions.deleteTaxDepreciationDraft,deleteForm());assert.equal(await tx.osPoreskiObracun.count({where:{id:batch.id}}),0);
      assert.ok(await tx.auditLog.findFirst({where:{entitet_id:batch.id,akcija:'delete_tax_depreciation_draft'}}));
      const rebuiltUrl=await success(actions.calculateTaxDepreciation,form({verzija:2}));
      batch=await tx.osPoreskiObracun.findUniqueOrThrow({where:{id:rebuiltUrl.split('/').pop()}});
      await success(actions.confirmTaxDepreciation,form({obracun_id:batch.id}));
      await failure(actions.saveTaxInputs,form({verzija:2,ulazi:JSON.stringify(raw)}),/potvrđen/);assert.equal(await tx.nalog.count({where:{firma_id:company.id}}),0);
      context={firmaId:company.id,poslovnaGodinaId:nextYear.id};await success(actions.carryTaxOpening,form({verzija:0}));
      const next=await tx.osPoreskaGodina.findFirstOrThrow({where:{poslovna_godina_id:nextYear.id}});assert.equal(next.prethodni_obracun_id,batch.id);assert.equal(next.ulazi.pools[0].opening,1800000);assert.equal(next.ulazi.assets[0].previous,2250000);
      await failure(actions.carryTaxOpening,form({verzija:1}),/već postoje/);
      context={firmaId:company.id,poslovnaGodinaId:year.id};await failure(actions.reopenTaxDepreciation,reopenForm(),/prenesen/);
      context={firmaId:company.id,poslovnaGodinaId:nextYear.id};
      await success(actions.calculateTaxDepreciation,form({verzija:1}));
      const undoForm=()=>form({poreska_godina_id:next.id,verzija:next.verzija,potvrda:'DA',razlog:'Korekcija prethodne godine'});
      await failure(actions.undoTaxCarry,undoForm(),/revizije/);
      const nextDraft=await tx.osPoreskiObracun.findFirstOrThrow({where:{poslovna_godina_id:nextYear.id}});
      await success(actions.deleteTaxDepreciationDraft,form({obracun_id:nextDraft.id,potvrda_brisanja:'DA',razlog_brisanja:'Poništavanje prenosa'}));
      await failure(actions.undoTaxCarry,form({poreska_godina_id:next.id,verzija:0,potvrda:'DA',razlog:'Stara verzija'}),/izmijenjeni/);
      currentUser=worker;await failure(actions.undoTaxCarry,undoForm());currentUser=admin;
      await tx.poslovnaGodina.update({where:{id:nextYear.id},data:{zakljucena:true}});
      await failure(actions.undoTaxCarry,undoForm(),/zaključana/);
      await tx.poslovnaGodina.update({where:{id:nextYear.id},data:{zakljucena:false}});
      failAudit=true;await failure(actions.undoTaxCarry,undoForm());failAudit=false;
      assert.ok(await tx.osPoreskaGodina.findUnique({where:{id:next.id}}));
      await success(actions.undoTaxCarry,undoForm());
      assert.equal(await tx.osPoreskaGodina.count({where:{id:next.id}}),0);
      assert.ok(await tx.auditLog.findFirst({where:{entitet_id:next.id,akcija:'undo_tax_carry'}}));
      context={firmaId:company.id,poslovnaGodinaId:year.id};
      await success(actions.reopenTaxDepreciation,reopenForm());
      await success(actions.confirmTaxDepreciation,form({obracun_id:batch.id}));
      context={firmaId:company.id,poslovnaGodinaId:nextYear.id};
      await success(actions.carryTaxOpening,form({verzija:0}));
      checks.push('Tax opening separate from accounting; stale version/hash; revision reopen/delete; idempotency; scoped reads/writes/print; permissions; locked year; audit rollback; carry-forward dependency; no GL journal');
      // Dedicated lifecycle regression on a separate company; everything still rolls back.
      context={firmaId:other.id,poslovnaGodinaId:otherYear.id};
      const life=load(path.join(root,'src/app/agencija/osnovna-sredstva/lifecycle-actions.ts'));
      const assetActions=load(path.join(root,'src/app/agencija/osnovna-sredstva/actions.ts'));
      const kifActions=load(path.join(root,'src/app/agencija/racuni/actions.ts'));
      const batchActions=load(path.join(root,'src/app/agencija/osnovna-sredstva/obracuni/actions.ts'));
      const {initialTaxInput,taxAssets,buildTaxSnapshot}=load(path.join(root,'src/lib/fixed-assets-tax-data.ts'));
      const {automaticTaxEvents}=load(path.join(root,'src/lib/fixed-assets-tax-events.ts'));
      const osScope={agencija_id:agency.id,firma_id:other.id,poslovna_godina_id:otherYear.id};
      const mkAccount=(sifra)=>tx.firmaKonto.create({data:{firma_id:other.id,sifra,naziv:'Test '+sifra,tip_konta:'analiticko'}});
      const cost=await mkAccount('0230'),allowance=await mkAccount('0290'),expense=await mkAccount('5400'),loss=await mkAccount('5700'),income=await mkAccount('6700'),payable=await mkAccount('4330');
      const type=await tx.vrstaNaloga.findFirstOrThrow({where:{sifra:'MANUAL'}});
      const source=await tx.nalog.create({data:{...osScope,vrsta_naloga_id:type.id,broj:1,sifra:'TEST-ACQ',datum:new Date('2026-01-01'),status:'POSTED',kreirao_korisnik_id:admin.id,stavke:{create:[{konto_id:cost.id,duguje:'1200',potrazuje:'0',redni_broj:1},{konto_id:payable.id,duguje:'0',potrazuje:'1200',redni_broj:2}]}}});
      await success(assetActions.createFixedAsset,form({nacin_unosa:'NEW',inventarski_broj:'AUTO',naziv:'Auto tax test',vrsta_imovine:'MATERIAL',poreska_klasifikacija:'III',datum_nabavke:'2026-01-01',datum_raspolozivosti:'2026-01-01',nabavna_vrijednost:'1200',ostatak_vrijednosti:'0',metoda:'LINEAR',godisnja_stopa:'100'}));
      let equipment=await tx.osnovnoSredstvo.findFirstOrThrow({where:{firma_id:other.id,inventarski_broj:'AUTO'}});
      let taxInput=initialTaxInput(await taxAssets(tx,osScope,otherYear.datum_od,otherYear.datum_do));taxInput.openingSource='New company';
      assert.equal((await automaticTaxEvents(tx,osScope,taxInput,otherYear.datum_od,otherYear.datum_do)).events.length,0);
      await success(life.activateFixedAsset,form({sredstvo_id:equipment.id,verzija:equipment.verzija,datum:'2026-01-01',nalog_sifra:'TEST-ACQ',konto_sredstva:'0230'}));
      equipment=await tx.osnovnoSredstvo.findUniqueOrThrow({where:{id:equipment.id}});assert.equal(equipment.status,'ACTIVE');
      taxInput=initialTaxInput(await taxAssets(tx,osScope,otherYear.datum_od,otherYear.datum_do));taxInput.openingSource='New company';
      let automatic=await automaticTaxEvents(tx,osScope,taxInput,otherYear.datum_od,otherYear.datum_do);assert.equal(automatic.events.length,1);assert.equal(automatic.events[0].amount,120000);
      const built=await buildTaxSnapshot(tx,osScope,taxInput,null);assert.equal(built.snapshot.input.events.length,1);
      taxInput.events=built.snapshot.input.events;assert.equal((await buildTaxSnapshot(tx,osScope,taxInput,null)).snapshot.input.events.length,1);
      const taxInputForm={...taxInput,pools:taxInput.pools.map(item=>({...item,opening:String(item.opening)})),assets:taxInput.assets.map(item=>({...item,basis:String(item.basis),previous:String(item.previous),accounting:String(item.accounting)})),events:taxInput.events.map(item=>({...item,amount:String(item.amount) }))};
      await success(actions.saveTaxInputs,form({verzija:0,ulazi:JSON.stringify(taxInputForm)}));
      const lifecycleTaxUrl=await success(actions.calculateTaxDepreciation,form({verzija:1})),lifecycleTaxId=lifecycleTaxUrl.split('/').pop();
      await success(actions.confirmTaxDepreciation,form({obracun_id:lifecycleTaxId}));
      const purchaseChange=await tx.osPromjena.findFirstOrThrow({where:{sredstvo_id:equipment.id,vrsta:'ACQUISITION'}});
      await tx.osPromjena.update({where:{id:purchaseChange.id},data:{status:'DRAFT'}});assert.equal((await automaticTaxEvents(tx,osScope,taxInput,otherYear.datum_od,otherYear.datum_do)).events.length,0);await tx.osPromjena.update({where:{id:purchaseChange.id},data:{status:'CONFIRMED'}});
      const depUrl=await success(batchActions.calculateDepreciation,form({od:'2026-01-01',do:'2026-05-31',konto_troska_sifra:expense.sifra,konto_ispravke_sifra:allowance.sifra}));
      await success(batchActions.postDepreciation,form({obracun_id:depUrl.split('/').pop(),revizija:1}));
      const buyer=await tx.komitent.create({data:{agencija_id:agency.id,firma_id:other.id,scope:'COMPANY',naziv:'Asset buyer'}});
      const rate=await tx.pdvStopa.create({data:{agencija_id:agency.id,sifra:'TEST21',naziv:'PDV21',procenat:'21'}});
      const bookType=await tx.racunVrsta.create({data:{agencija_id:agency.id,firma_id:other.id,dokument_tip:'KIF',sifra:'OS-TEST',naziv:'Test asset sales'}});
      const book=await tx.kifBook.create({data:{...osScope,racun_vrsta_id:bookType.id,redni_broj:1,internal_kif_number:'KIF-TEST',mjesec:6,kif_date:new Date('2026-06-30')}});
      const saleInvoiceForm=()=>form({os_sredstvo_id:equipment.id,kif_book_id:book.id,kupac_id:buyer.id,customer_invoice_number:'OS-1',invoice_date:'2026-06-01',invoice_total:'1089',revenue_account_code:income.sifra,vat_transaction_type:'DOMESTIC',vat_rate_id:rate.id,tax_base:'900',output_vat_amount:'189'});
      const reopenLifecycleTax=()=>form({obracun_id:lifecycleTaxId,potvrda_vracanja:'DA',razlog_vracanja:'Prodaja sredstva'});
      await failure(kifActions.createKifEntry,saleInvoiceForm(),/potvrđen poreski obračun/);
      await success(actions.reopenTaxDepreciation,reopenLifecycleTax());
      await success(kifActions.createKifEntry,saleInvoiceForm());
      const saleEntry=await tx.kifEntry.findFirstOrThrow({where:{firma_id:other.id,source_type:'FIXED_ASSET_SALE'}});assert.equal(saleEntry.source_id,equipment.id);
      assert.equal((await automaticTaxEvents(tx,osScope,taxInput,otherYear.datum_od,otherYear.datum_do)).events.length,1);
      const saleForm=()=>form({sredstvo_id:equipment.id,verzija:equipment.verzija,kif_entry_id:saleEntry.id,datum:'2026-06-01',konto_sredstva:'0230',konto_ispravke:'0290',konto_rashoda:'5700'});
      await success(actions.confirmTaxDepreciation,form({obracun_id:lifecycleTaxId}));
      await failure(life.confirmFixedAssetSale,saleForm(),/potvrđen poreski obračun/);
      await success(actions.reopenTaxDepreciation,reopenLifecycleTax());
      assert.equal((await tx.osPoreskiObracun.findUniqueOrThrow({where:{id:lifecycleTaxId}})).status,'DRAFT');
      assert.equal(await tx.osPoreskiObracun.count({where:{firma_id:other.id,status:'CONFIRMED'}}),0);
      await failure(life.confirmFixedAssetSale,saleForm(),/povezan/);
      assert.equal((await tx.osPoreskiObracun.findUniqueOrThrow({where:{id:lifecycleTaxId}})).status,'DRAFT');
      const saleJournal=await tx.nalog.create({data:{...osScope,vrsta_naloga_id:type.id,broj:2,sifra:'TEST-SALE',datum:new Date('2026-06-01'),status:'POSTED',kreirao_korisnik_id:admin.id}});
      await tx.kifEntry.update({where:{id:saleEntry.id},data:{journal_id:saleJournal.id,posting_status:'POSTED'}});
      await success(life.confirmFixedAssetSale,saleForm());
      equipment=await tx.osnovnoSredstvo.findUniqueOrThrow({where:{id:equipment.id}});assert.equal(equipment.status,'DISPOSED');
      automatic=await automaticTaxEvents(tx,osScope,taxInput,otherYear.datum_od,otherYear.datum_do);assert.equal(automatic.events.length,2);assert.equal(automatic.events.find(e=>e.kind==='SALE').amount,90000);
      const disposal=await tx.nalog.findFirstOrThrow({where:{firma_id:other.id,source_type:'FIXED_ASSET_DISPOSAL'},include:{stavke:true}});assert.equal(disposal.stavke.reduce((n,s)=>n+Number(s.duguje)-Number(s.potrazuje),0),0);
      assert.equal(disposal.stavke.find(s=>s.konto_id===loss.id).duguje.toString(),'700');
      const journalActions=load(path.join(root,'src/app/agencija/nalozi/actions.ts'));
      assert.equal(typeof journalActions.reopenJournal,'function');
      await invoke(journalActions.reopenJournal,form({nalog_id:source.id}));
      assert.equal((await tx.nalog.findUniqueOrThrow({where:{id:source.id}})).status,'POSTED');
      checks.push('Real acquisition activation, scoped posted source/allocation, automatic events without opening/draft duplication, dedicated asset sale creates linked KIF, confirmation writes balanced disposal and tax sale');
      const {purgeCompanyData}=load(path.join(root,'src/lib/company-purge.ts'));
      await purgeCompanyData(tx,{agencijaId:agency.id,firmaId:company.id,potvrdaNaziva:company.naziv,korisnikId:admin.id});
      assert.equal(await tx.osPoreskaGodina.count({where:{firma_id:company.id}}),0);assert.equal(await tx.osPoreskiObracun.count({where:{firma_id:company.id}}),0);
      await purgeCompanyData(tx,{agencijaId:agency.id,firmaId:other.id,potvrdaNaziva:other.naziv,korisnikId:admin.id});
      assert.ok(await tx.firma.findUnique({where:{id:foreign.id}}));
      checks.push('Real company purge removes linked tax years and revisions; foreign company remains');
      throw rollback;
    }, { timeout: 60000 });
  } catch (error) { if (error !== rollback) throw error; }
  console.log(JSON.stringify({ checks, rolledBack: true }, null, 2));
})().catch(error => {
  console.error(error instanceof assert.AssertionError ? error.message : `Fixed-assets regression failed: ${error.message}`);
  process.exitCode = 1;
}).finally(() => db.$disconnect());
