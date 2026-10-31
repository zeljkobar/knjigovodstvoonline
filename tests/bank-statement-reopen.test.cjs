/* eslint-disable @typescript-eslint/no-require-imports -- Render the actual journal page. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {renderToStaticMarkup}=require('react-dom/server');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const id='11111111-1111-4111-8111-111111111111',date=new Date('2026-06-20');
test('bank journal has controlled reopen and source link, without generic editing/posting; permissions and closed year hide actions',async()=>{
 for(const [status,closed,allowed]of[['POSTED',false,true],['DRAFT',false,true],['POSTED',true,true],['POSTED',false,false]]){
  const journal={id,firma_id:id,poslovna_godina_id:id,broj:1,sifra:'IZV-2026-1',datum:date,datum_knjizenja:date,created_at:date,proknjizen_at:date,source_type:'BANK_STATEMENT',source_module:'IZVODI',izvorni_dokument_id:id,status,firma:{naziv:'Test'},poslovna_godina:{godina:2026,zakljucena:closed},vrsta_naloga:{naziv:'Izvodi',prefiks:'IZV'},stavke:[],kreirao_korisnik:null,bankStatements:[{id}]};
  const load=sourceLoader({'@/lib/auth':{requireAnyRole:async()=>({id,agencija_id:id,rola:'admin_agencije'})},'@/lib/permissions':{hasPermission:async(_u,q)=>q.modul!=='izvodi'||allowed},'@/lib/prisma':{prisma:{nalog:{findFirst:async()=>journal}}}});
  const html=renderToStaticMarkup(await load('src/app/agencija/nalozi/[id]/page.tsx').default({params:Promise.resolve({id})}));
  assert.equal(html.includes('Vrati u nacrt'),status==='POSTED'&&!closed&&allowed);
  assert.doesNotMatch(html,/Proknjiži nalog \(F9\)|Izmijeni stavke/);assert.match(html,/Otvori izvod/);
 }
});
