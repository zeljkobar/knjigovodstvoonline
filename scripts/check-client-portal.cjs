// Real database regression for client isolation and read-only report rendering. Fixtures roll back.
const root = process.cwd();
require('@next/env').loadEnvConfig(root, false, { info() {}, error() {} });
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const db = new PrismaClient();
const rollback = new Error('ROLLBACK_CLIENT_PORTAL');
(async () => {
 try { await db.$transaction(async (tx) => {
 const agency = await tx.agencija.create({data:{naziv:'Client portal regression'}});
 const otherAgency = await tx.agencija.create({data:{naziv:'Foreign client regression'}});
 const company = await tx.firma.create({data:{agencija_id:agency.id,naziv:'Client fixture A',pdv_obveznik:true}});
 const other = await tx.firma.create({data:{agencija_id:agency.id,naziv:'Client fixture B'}});
 const foreign = await tx.firma.create({data:{agencija_id:otherAgency.id,naziv:'Foreign client fixture'}});
 const makeYear = (firma_id,godina=2026) => tx.poslovnaGodina.create({data:{firma_id,godina,datum_od:new Date(`${godina}-01-01`),datum_do:new Date(`${godina}-12-31`)}});
 const year = await makeYear(company.id), otherYear = await makeYear(other.id), foreignYear = await makeYear(foreign.id), oldYear = await makeYear(company.id,2025);
 const user = await tx.korisnik.create({data:{agencija_id:agency.id,korisnicko_ime:randomUUID(),lozinka_hash:'disabled-test-fixture',rola:'klijent'}});
 await tx.korisnikFirma.create({data:{korisnik_id:user.id,firma_id:company.id}});
 for (const modul of ['nalozi','izvjestaji','robno','pdv']) await tx.korisnikPravo.create({data:{agencija_id:agency.id,korisnik_id:user.id,firma_id:company.id,modul,akcija:'view'}});
 let context = {firmaId:company.id,poslovnaGodinaId:year.id};
 const mocks = {
  'server-only': {},
  '@/lib/direct-portal': {getDirectPortalContext:async()=>({state:'NOT_DIRECT'})},
  '@/app/actions': {logout:async()=>{}},
  react: {...React,cache:(fn)=>fn},
  'next/navigation': {redirect(url){throw new Error('REDIRECT:'+url)},notFound(){throw new Error('NOT_FOUND')}},
  'next/link': {__esModule:true,default:({children,...props})=>React.createElement('a',props,children)},
  '@/components/AutoSubmitFilterForm': {AutoSubmitFilterForm:({children,...props})=>React.createElement('form',props,children)},
  '@/lib/prisma': {prisma:tx},
  '@/lib/auth': {requireRole:async(role)=>{assert.equal(role,'klijent');return user},getCurrentUser:async()=>user,isDirectFiscalTenantUser:()=>false},
  '@/lib/work-context': {readWorkContext:async()=>context}
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

 const loadSource = (file) => load(path.join(root,'src',file));
 const portal = loadSource('lib/client-portal.ts');
 const cards = loadSource('lib/client-partner-card.ts');
 const inventory = loadSource('lib/client-inventory.ts');
 const permissions = loadSource('lib/permissions.ts');
 const policy = loadSource('lib/client-partner-policy.ts');
 const accountPolicy = loadSource('lib/account-plan.ts');
 const report = loadSource('app/agencija/_components/PartnerBalanceReportPage.tsx').PartnerBalanceReportPage;
 const scope = {agencija_id:agency.id,firma_id:company.id,poslovna_godina_id:year.id};
 assert.equal((await portal.getClientContext()).firma.id,company.id);
 context={firmaId:foreign.id,poslovnaGodinaId:foreignYear.id};
 assert.equal((await portal.getClientContext()).firma.id,company.id);
 assert.equal((await portal.getClientContext()).year.id,year.id);
 context={firmaId:other.id,poslovnaGodinaId:otherYear.id};
 assert.equal((await portal.getClientContext()).firma.id,company.id);
 context={firmaId:company.id,poslovnaGodinaId:year.id};
 const partner = await tx.komitent.create({data:{naziv:'Allowed partner',agencija_id:agency.id,firma_id:company.id}});
 const hiddenPartner = await tx.komitent.create({data:{naziv:'Hidden partner',agencija_id:agency.id,firma_id:other.id}});
 const type = await tx.vrstaNaloga.create({data:{sifra:randomUUID(),naziv:'Client regression'}});
 const balancing = await tx.firmaKonto.create({data:{firma_id:company.id,sifra:'9999',naziv:'Balance',tip_konta:'analiticko'}});
 let number=0;
 for (const [tip, config] of Object.entries(policy.clientPartnerTypes)) {
  const account = await tx.firmaKonto.create({data:{firma_id:company.id,sifra:String(8000+number),naziv:'Secret account '+tip,tip_konta:'analiticko'}});
  await tx.firmaPodrazumijevanoKonto.create({data:{firma_id:company.id,namjena:config.purpose,sifra_konta:account.sifra,dokument_tip:accountPolicy.invoicePostingDocumentTypes.general,podvrsta:accountPolicy.invoicePostingDefaultScope.subtype,pdv_stopa_sifra:accountPolicy.invoicePostingDefaultScope.vatRate}});
  for (const [status,deleted,amount,date] of [['POSTED',false,'10.01','2026-01-10'],['POSTED',false,'20.02','2026-02-10'],['DRAFT',false,'1000','2026-02-10'],['POSTED',true,'2000','2026-02-10']]) {
   await tx.nalog.create({data:{...scope,vrsta_naloga_id:type.id,broj:++number,datum:new Date(date),status,is_deleted:deleted,stavke:{create:[{konto_id:account.id,komitent_id:partner.id,duguje:amount,potrazuje:'0',redni_broj:1},{konto_id:balancing.id,duguje:'0',potrazuje:amount,redni_broj:2}]}}});
  }
  const card = await cards.loadClientPartnerCard(tip,partner.id);
  assert.equal(card.lines.length,2);
  const html=renderToStaticMarkup(await report({kind:config.kind,clientType:tip,searchParams:Promise.resolve({prikaz:'svi',konto:balancing.id})}));
  assert.match(html,/30,03/);assert.doesNotMatch(html,/Secret account|Aktivna konta|<th>Konto/);
  assert.match(html,new RegExp('/klijent/izvjestaji/'+tip+'/kartica'));
  assert.doesNotMatch(html,/Hidden partner|1\.000,00|2\.000,00/);
 }
 const dashboard = loadSource('lib/client-dashboard.ts');
 for (const [tip, names] of [['kupci',['Adriatic Logistics','Montenegro Trade','Primorje Market','Atlas Transport']],['dobavljaci',['Petrol Partner','Auto Centar','Euro Parts','Telekom Servisi']]]) {
  const settings=await tx.firmaPodrazumijevanoKonto.findFirstOrThrow({where:{firma_id:company.id,namjena:policy.clientPartnerTypes[tip].purpose}});
  const account=await tx.firmaKonto.findFirstOrThrow({where:{firma_id:company.id,sifra:settings.sifra_konta}});
  for(const [index,amount] of ['1250.25','8450.50','3200.00','-9000.00'].entries()) {
   const customer=tip==='kupci';
   const party=await tx.komitent.create({data:{naziv:names[index],agencija_id:agency.id,firma_id:company.id}});
   await tx.nalog.create({data:{...scope,vrsta_naloga_id:type.id,broj:++number,datum:new Date('2026-03-01'),status:'POSTED',stavke:{create:[
    {konto_id:account.id,komitent_id:party.id,duguje:customer?amount:'0',potrazuje:customer?'0':amount,redni_broj:1},
    {konto_id:balancing.id,duguje:customer?'0':amount,potrazuje:customer?amount:'0',redni_broj:2}
   ]}}});
  }
 }
 const dashboards=await dashboard.loadClientDashboard();
 assert.equal(dashboards[0].rows[0].name,'Montenegro Trade');
 assert.equal(dashboards[1].rows[0].name,'Auto Centar');
 assert.equal(dashboards[1].total,BigInt(1290075));
 assert.equal(dashboards[0].total,BigInt(1293078));
 assert.equal(dashboards[0].rows[0].width,100);
 assert.ok(dashboards.every(panel=>panel.rows.every((row,index)=>!index||panel.rows[index-1].cents>=row.cents)));
 assert.equal(dashboards[0].rows.some(row=>row.name==='Atlas Transport'),false);
 assert.equal(dashboards[1].rows.some(row=>row.name==='Telekom Servisi'),false);
 const international=await dashboard.loadClientDashboard(true);
 assert.equal(international[0].total,BigInt(3003));
 assert.equal(international[1].total,BigInt(0));
 const home=renderToStaticMarkup(await loadSource('app/klijent/page.tsx').default({}));
 assert.doesNotMatch(home,/client-shortcut|Secret account/);
 assert.match(home,/Montenegro Trade/);assert.match(home,/Auto Centar/);
 if (process.env.CLIENT_PREVIEW_DIR) {
  const content = await loadSource('app/klijent/page.tsx').default({});
  const layout = loadSource('app/klijent/layout.tsx').default;
  const body = renderToStaticMarkup(await layout({children:content}));
  fs.mkdirSync(process.env.CLIENT_PREVIEW_DIR,{recursive:true});
  fs.writeFileSync(path.join(process.env.CLIENT_PREVIEW_DIR,'index.html'),'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body>'+body+'</body></html>');
  fs.copyFileSync(path.join(root,'src/app/globals.css'),path.join(process.env.CLIENT_PREVIEW_DIR,'style.css'));
 }
 const cardPage = loadSource('app/klijent/izvjestaji/[tip]/kartica/page.tsx').default;
 const html=renderToStaticMarkup(await cardPage({params:Promise.resolve({tip:'kupci'}),searchParams:Promise.resolve({partner:partner.id,datum_od:'2026-02-01'})}));
 assert.match(html,/10,01/);assert.match(html,/20,02/);assert.match(html,/30,03/);
 await assert.rejects(()=>cards.loadClientPartnerCard('kupci',hiddenPartner.id),/NOT_FOUND/);
 await assert.rejects(()=>cards.loadClientPartnerCard('unknown',partner.id),/NOT_FOUND/);
 await tx.firmaPodrazumijevanoKonto.updateMany({where:{firma_id:company.id,namjena:policy.clientPartnerTypes.kupci.purpose},data:{sifra_konta:'9999'}});
 await assert.rejects(()=>cards.loadClientPartnerCard('kupci',partner.id),/NOT_FOUND/);
 await tx.firmaPodrazumijevanoKonto.deleteMany({where:{firma_id:company.id,namjena:policy.clientPartnerTypes.kupci.purpose}});
 assert.equal((await cards.loadClientPartnerCard('kupci',partner.id)).configured,false);
 const warehouse = await tx.magacin.create({data:{agencija_id:agency.id,firma_id:company.id,sifra:'M1',naziv:'Test warehouse'}});
 const doc=await tx.nivelacijaCijena.create({data:{...scope,magacin_id:warehouse.id,broj:1,interni_broj:'NIV-TEST',datum:new Date('2026-01-01')}});
 assert.equal((await inventory.loadClientInventory('nivelacija',{id:doc.id})).documents[0].number,'NIV-TEST');
 const wrongWarehouse = await tx.magacin.create({data:{agencija_id:agency.id,firma_id:other.id,sifra:'M1',naziv:'Wrong warehouse'}});
 const wrongDoc = await tx.nivelacijaCijena.create({data:{agencija_id:agency.id,firma_id:other.id,poslovna_godina_id:otherYear.id,magacin_id:wrongWarehouse.id,broj:1,interni_broj:'HIDDEN',datum:new Date('2026-01-01')}});
 await assert.rejects(()=>inventory.loadClientInventory('nivelacija',{id:wrongDoc.id}),/NOT_FOUND/);
 context.poslovnaGodinaId=oldYear.id;
 await assert.rejects(()=>inventory.loadClientInventory('nivelacija',{id:doc.id}),/NOT_FOUND/);
 context.poslovnaGodinaId=year.id;
 await tx.nivelacijaCijena.update({where:{id:doc.id},data:{is_deleted:true}});
 await assert.rejects(()=>inventory.loadClientInventory('nivelacija',{id:doc.id}),/NOT_FOUND/);
 for(const tip of Object.keys(inventory.clientInventoryTypes)) await inventory.loadClientInventory(tip);
 const catalog = loadSource('app/klijent/robno/sifarnici/page.tsx').default;
 assert.match(renderToStaticMarkup(await catalog({searchParams:Promise.resolve({})})),/Artikli i cjenovnik/);
 const period=await tx.pdvPeriod.create({data:{...scope,mjesec:1,datum_od:new Date('2026-01-01'),datum_do:new Date('2026-01-31')}});
 await tx.pdvPrijava.create({data:{...scope,pdv_period_id:period.id,status:'POSTED',total_output_vat:'210',payable_vat:'210'}});
 const vatPage = loadSource('app/klijent/pdv/page.tsx').default;
 const vatHtml=renderToStaticMarkup(await vatPage());assert.match(vatHtml,/PDV pregled/);assert.doesNotMatch(vatHtml,/<form|Kreiraj periode/);assert.match(vatHtml,/210,00/);assert.match(vatHtml,/Nacrt/);
 for(const action of ['create','update','delete','post','cancel']) {
  await tx.korisnikPravo.create({data:{agencija_id:agency.id,korisnik_id:user.id,firma_id:company.id,modul:'robno',akcija:action}});
  assert.equal(await permissions.hasPermission(user,{firmaId:company.id,modul:'robno',akcija:action}),false);
 }
 await tx.korisnikPravo.updateMany({where:{korisnik_id:user.id,modul:'robno',akcija:'view'},data:{dozvoljeno:false}});
 await assert.rejects(()=>inventory.loadClientInventory('nivelacija'),/NOT_FOUND/);
 await tx.korisnikFirma.create({data:{korisnik_id:user.id,firma_id:other.id}});
 assert.equal((await portal.getClientContext()).firma,null);
 await tx.korisnikFirma.updateMany({where:{korisnik_id:user.id},data:{is_deleted:true}});
 await assert.rejects(()=>portal.requireClientContext(['izvjestaji']),/NOT_FOUND/);
 console.log('PASS: four configurable partner reports, posted-only amounts, opening balance, hidden accounts, tenant/company/year isolation, changed defaults, missing setup, inventory IDOR/deletion, all inventory queries, read-only PDV, denied writes and revoked permissions/assignment.');
 throw rollback;
 },{timeout:60000}); } catch(error) { if(error!==rollback) throw error; }
 finally {await db.$disconnect();}
})().catch(error=>{console.error(error);process.exitCode=1});
