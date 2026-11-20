/* eslint-disable @typescript-eslint/no-require-imports -- Server-rendered help and scope checks. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {sourceLoader}=require('./helpers/source-loader.cjs');
async function render(permissionKeys,readiness={code:'NEEDS_SUPPORT',label:'Potrebna intervencija podrške'},locked=false) {
 let guarded=false;
 const page=sourceLoader({'@/lib/direct-portal':{requireDirectPortalContext:async(_permission,path)=>{assert.equal(path,'/portal/pomoc');guarded=true;return{permissionKeys,readiness,year:{godina:2026,zakljucena:locked},user:{korisnicko_ime:'client'},firma:{naziv:'Own firm',pib:'01234567',posPodesavanje:{aktivan:false},fiscalCompanyLink:{last_correlation_id:'setup-check'}}};}},'next/link':{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)}})('src/app/portal/pomoc/page.tsx');
 const html=renderToStaticMarkup(await page.default());assert.equal(guarded,true);return html;
}
test('help explains blocked setup and only links authorized sections; support belongs to active company',async()=>{
 const html=await render(new Set(['fiskalizacija:view']));assert.match(html,/fiskalna konfiguracija firme nije spremna/);assert.match(html,/01234567/);assert.match(html,/setup-check/);assert.match(html,/href="\/portal\/racuni"/);assert.doesNotMatch(html,/href="\/portal\/(fakture|izvjestaji|pos)"/);assert.doesNotMatch(html,/permission guarda|implementacionoj fazi/);
});
test('report guidance and locked-year notice appear without hiding help',async()=>{
 const html=await render(new Set(['fiskalizacija:view','izvjestaji:view']),{code:'TEST',label:'Testno okruženje'},true);assert.match(html,/href="\/portal\/izvjestaji"/);assert.match(html,/Poslovna godina 2026 je zaključana/);assert.match(html,/Radite u testnom okruženju/);assert.match(html,/Kopiraj podatke za podršku/);
});
