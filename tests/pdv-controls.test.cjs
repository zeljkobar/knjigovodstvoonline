/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS regression infrastructure. */
const assert = require('node:assert/strict');
const test = require('node:test');
const { renderToStaticMarkup } = require('react-dom/server');
const { sourceLoader } = require('./helpers/source-loader.cjs');

async function renderControls(ledgerAmount) {
  let query;
  const rules = [
    ['OUTPUT_VAT_STANDARD', 'output', '4700'],
    ['VAT_PAYABLE', 'settlement', '4790']
  ].map(([polje_sifra, id, sifra]) => ({polje_sifra, aktivno:true, konto_id:id, konto: {id, sifra, naziv: sifra}}));
  const load = sourceLoader({
    "server-only": {},
    '@/app/agencija/pdv/_components': {PdvMonthForm: () => null},
    '@/lib/pdv-service': {
      normalizePdvMonth: () => 10,
      requirePdvContext: async () => ({agencijaId:'agency', firma:{id:'firm',pdv_obveznik:true}, poslovnaGodina:{id:'year',godina:2026}}),
      calculatePdvReturn: async () => ({kifBooks:[],kufBooks:[],dateFrom:new Date('2026-10-01'),dateTo:new Date('2026-10-31')})
    },
    '@/lib/prisma': {prisma: {
      firma:{findFirst:async()=>null},
      pdvPodesavanja:{findUnique:async()=>({vrsta_naloga_id:'type',pravila:rules})},
      pdvPrijava:{findFirst:async()=>null},
      pdvStopa:{findMany:async()=>[{sifra:'STANDARD',naziv:'Standard',procenat:21}]},
      stavkaNaloga:{findMany:async args=>{query=args;return [{konto_id:'output',duguje:0,potrazuje:ledgerAmount}];}}
    }}
  });
  const html = renderToStaticMarkup(await load('src/app/agencija/pdv/kontrole/page.tsx').default({searchParams:Promise.resolve({mjesec:'10'})}));
  return {html,query};
}

test('PDV controls show ledger VAT when KIF/KUF is empty, excluding settlement and closing journals', async () => {
  const {html,query}=await renderControls(17.21);
  assert.match(html,/4700 - 4700/);
  assert.match(html,/pdv-reconciliation-error[^>]*>\+17,21 €/);
  assert.match(html,/Odstupanja na kontima: 1/);
  assert.deepEqual(query.where.konto_id.in,['output']);
  assert.equal(query.where.nalog.status,'POSTED');
  assert.equal(query.where.nalog.is_deleted,false);
  assert.equal(query.where.nalog.source_type.not,'PDV_RETURN');
  assert.equal(query.where.nalog.firma_id,'firm');
  assert.equal(query.where.nalog.poslovna_godina_id,'year');
});

test('empty evidence and zero ledger do not produce a reconciliation mismatch', async () => {
  const {html}=await renderControls(0);
  assert.match(html,/✓ Slaže se/);
  assert.match(html,/✓ Sva konta su usklađena/);
  assert.doesNotMatch(html,/pdv-reconciliation-error/);
});

test('negative differences retain their sign and error state', async () => {
  const {html} = await renderControls(-12.34);
  assert.match(html,/pdv-reconciliation-error[^>]*>-12,34 €/);
  assert.match(html,/Ostala upozorenja/);
});
