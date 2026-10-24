/* eslint-disable @typescript-eslint/no-require-imports -- Render the real payroll and journal pages. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {renderToStaticMarkup}=require('react-dom/server');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const id='11111111-1111-4111-8111-111111111111',date=new Date('2026-06-30');

test('payroll list shows Proknjiži beside a linked draft; posted, closed and denied states hide it',async()=>{
 for(const [status,journalStatus,closed,allowed,show]of [['CALCULATED','DRAFT',false,true,true],['POSTED','POSTED',false,true,false],['CALCULATED','DRAFT',true,true,false],['CALCULATED','DRAFT',false,false,false]]){
  const calculation={id,broj:1,godina:2026,mjesec:6,datum_od:date,datum_do:date,fond_sati:176,kategorija:'REDOVAN_RAD',status,nalog_id:id,nalog:{status:journalStatus,is_deleted:false},_count:{radnici:1,stavke:1}};
  const load=sourceLoader({
   '@/app/agencija/plate/_shared':{getPlateContext:async()=>({allowed:true,user:{agencija_id:'agency'},firma:{id:'firm',naziv:'Test'},godina:{id:'year',godina:2026,zakljucena:closed}})},
   '@/lib/permissions':{hasPermission:async()=>allowed,hasAllPermissions:async()=>false},
   '@/lib/prisma':{prisma:{plateObracun:{findMany:async q=>{assert.ok(q.include.nalog);return[calculation]}},plateSifraPrimanja:{findMany:async()=>[]},plateVrstaObracuna:{findMany:async()=>[]},poslovnaJedinica:{findMany:async()=>[]}}}
  });
  const page=load('src/app/agencija/plate/obracun/page.tsx').default;
  const html=renderToStaticMarkup(await page({searchParams:Promise.resolve({})}));
  assert.equal(html.includes('>Proknjiži</button>'),show);assert.match(html,/>Nalog</);assert.doesNotMatch(html,/>Izbriši</);
 }
});
test('payroll journal offers controlled reopen/post, hides line editor and obeys year and payroll permissions',async()=>{
 for(const [status,closed,allowed]of [['POSTED',false,true],['DRAFT',false,true],['POSTED',true,true],['POSTED',false,false],['DRAFT',false,false]]){
  const journal={id,firma_id:id,poslovna_godina_id:id,broj:1,sifra:'PL-2026-1',datum:date,datum_knjizenja:date,created_at:date,proknjizen_at:date,source_type:'PAYROLL',source_module:'PLATE',izvorni_dokument_id:id,status,firma:{naziv:'Test'},poslovna_godina:{godina:2026,zakljucena:closed},vrsta_naloga:{naziv:'Plate',prefiks:'PL'},stavke:[],kreirao_korisnik:null};
  const load=sourceLoader({'@/lib/auth':{requireAnyRole:async()=>({id,agencija_id:id,rola:'admin_agencije'})},'@/lib/permissions':{hasPermission:async(_u,q)=>q.modul!=='plate'||allowed},'@/lib/prisma':{prisma:{nalog:{findFirst:async()=>journal}}}});
  const page=load('src/app/agencija/nalozi/[id]/page.tsx').default;
  const html=renderToStaticMarkup(await page({params:Promise.resolve({id})}));
  assert.equal(html.includes('Vrati u nacrt'),status==='POSTED'&&!closed&&allowed);
  assert.equal(html.includes('Proknjiži nalog (F9)'),status==='DRAFT'&&!closed&&allowed);
  assert.doesNotMatch(html,/Izmijeni stavke/);assert.match(html,/Otvori obračun plata/);
 }
});
