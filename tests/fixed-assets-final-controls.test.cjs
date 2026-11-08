/* eslint-disable @typescript-eslint/no-require-imports -- Actual control service regression. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const scope={agencija_id:'agency',firma_id:'company',poslovna_godina_id:'year'};
const from=new Date('2026-01-01'),to=new Date('2026-12-31');
async function run(options={}) {
 const calls=[];
 const snapshot={lines:[{assetId:'asset',amountCents:100}],coverage:[{assetId:'asset',from:'2026-01-01',to:'2026-12-31'}]};
 const service=sourceLoader({'@/lib/fixed-assets-batches':{buildAssetBatch:async()=>{
  if(options.error)throw options.error;return{snapshot:options.snapshot??snapshot};
 }}})('src/lib/fixed-assets-final-controls.ts');
 const method=(name,result)=>async args=>{calls.push([name,args]);return result;};
 const db={osnovnoSredstvo:{count:method('assets',options.assets??0)},osObracun:{count:async args=>{calls.push(['batches',args]);return args.where.status==='DRAFT'?(options.draftBooks??0):(options.bookCount??0);}},
  stavkaNaloga:{aggregate:method('gl',{_sum:{duguje:String(options.bookAmount??0),potrazuje:'0'}})},
  osPoreskiObracun:{findFirst:method('tax',options.tax?{snapshot:{schema:1,from:'2026-01-01',to:options.badTax?'2025-12-31':'2026-12-31',result:{total:0,extraWriteOff:0,errors:[]}}}:null),count:method('taxDraft',options.draftTaxes??0)},
  osObracunPokrice:{findMany:method('coverage',options.coverage??[])}};
 const controls=await service.fixedAssetFinalControls(db,scope,from,to,options.canView!==false);
 return{controls,calls};
}
const byId=(r,id)=>r.controls.find(c=>c.id===id);
test('neither amortization is applicable without assets; lack of OS rights is never a green check',async()=>{
 assert(!((await run()).controls.some(c=>c.level==='error')));
 const denied=await run({canView:false});assert.equal(denied.calls.length,0);assert.equal(denied.controls[0].level,'warning');
});
test('either completed amortization requires the other, including a legitimate zero OA',async()=>{
 assert.match(byId(await run({bookAmount:120}),'assets-paired-depreciation').title,/poreska/);
 assert.match(byId(await run({bookCount:1}),'assets-paired-depreciation').title,/poreska/);
 assert.match(byId(await run({tax:true}),'assets-paired-depreciation').title,/računovodstvena/);
 assert.equal(byId(await run({tax:true,bookAmount:123}),'assets-paired-depreciation').level,'success');
 assert.equal(byId(await run({tax:true,badTax:true}),'assets-tax-validity').level,'error');
});
test('depreciable assets require both and complete posted coverage; a partial period does not pass',async()=>{
 const missing=await run({assets:1});assert.equal(byId(missing,'assets-required-depreciation').level,'error');
 const partial=await run({assets:1,bookCount:1,tax:true,coverage:[{sredstvo_id:'asset',period_od:from,period_do:new Date('2026-06-30')}]});
 assert.match(byId(partial,'assets-required-depreciation').description,/1 sredstava/);
 const complete=await run({assets:1,bookCount:1,tax:true,coverage:[{sredstvo_id:'asset',period_od:new Date('2026-07-01'),period_do:to},{sredstvo_id:'asset',period_od:from,period_do:new Date('2026-06-30')}]});
 assert.equal(byId(complete,'assets-required-depreciation').level,'success');
 const gap=await run({assets:1,bookCount:1,tax:true,coverage:[{sredstvo_id:'asset',period_od:new Date('2026-01-02'),period_do:to}]});
 assert.equal(byId(gap,'assets-required-depreciation').level,'error');
});
test('zero annual depreciation and excluded assets do not force an expense; missing parameters and drafts are visible',async()=>{
 const zero=await run({assets:1,snapshot:{lines:[],coverage:[]}});assert.equal(byId(zero,'assets-required-depreciation').level,'success');
 assert.equal(byId(await run({assets:1,error:Error('Dopunite parametre')}),'assets-required-depreciation').level,'error');
 await assert.rejects(()=>run({assets:1,error:new TypeError('programming error')}),/programming/);
 const drafts=await run({draftBooks:1,draftTaxes:1});assert.equal(byId(drafts,'assets-draft-depreciation').level,'warning');
});
test('queries isolate agency, company, year and posted statuses and exclude opening/final GL journals',async()=>{
 const {calls}=await run();
 for(const name of ['tax','taxDraft','coverage','batches'])for(const[,args]of calls.filter(([n])=>n===name)){
  for(const[key,value]of Object.entries(scope))assert.equal(args.where[key],value);
 }
 const gl=calls.find(([n])=>n==='gl')[1].where;assert.equal(gl.nalog.status,'POSTED');assert.equal(gl.nalog.is_deleted,false);assert.equal(gl.firma_konto.sifra.startsWith,'540');
 assert.equal(gl.nalog.vrsta_naloga.sifra.notIn.length,2);
 const coverage=calls.find(([n])=>n==='coverage')[1].where;assert.equal(coverage.aktivno,true);assert.equal(coverage.obracun.status,'POSTED');
});
