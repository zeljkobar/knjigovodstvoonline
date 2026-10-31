/* eslint-disable @typescript-eslint/no-require-imports -- Fiscal report source-loader regressions. */
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomBytes}=require('node:crypto');
const XLSX=require('xlsx'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const load=sourceLoader(),policy=load('src/lib/pazar-import-policy.ts'),vg=load('src/lib/vg-fiscal-client.ts');
const device={id:'KASA1',label:'1-1 | KASA'};
function workbook(overrides={}) {
 const rows=[['PIB 12345678'],['PERIODIČNI FISKALNI IZVJEŠTAJ'],['Za period','01.09.2026 - 30.09.2026'],['Poreska stopa','Osnovica','Porez','Promet'],['Poreska stopa 21%',100,21,121],['Poreska stopa 7%',100,7,107],['Poreska stopa 0%',0,0,0],['Ukupno (21%, 7%, 0%)',200,28,228],['Oslobođeni promet','','',0],['Vrijednost prometa iskazana po načinu plaćanja'],['BANKNOTE (Gotovina)',121],['CARD (Platna kartica)',100],['BUSINESSCARD (Poslovna kartica)',7],['ORDER (Nalog)',0],['ORDER (Nalog)',0],['Kalkulacija gotovine']];
 for(const[label,value]of Object.entries(overrides)){const row=rows.find(r=>r[0]===label);if(row)row[1]=value;}
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Report');return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
}
test('VG workbook maps mixed VAT/payment rates and validates company, period and cents',()=>{
 const report=vg.parseVgReport(workbook(),device);assert.equal(report.total,22800);
 assert.deepEqual(report.payments.filter(p=>p.amount),[{method:'CASH',amount:12100},{method:'CARD',amount:10700}]);
 policy.validatePazarReport(report,{pib:'12345678',from:'2026-09-01',to:'2026-09-30'});
 assert.throws(()=>policy.validatePazarReport(report,{pib:'87654321',from:report.from,to:report.to}),/PIB/);
 assert.throws(()=>policy.validatePazarReport(report,{pib:report.pib,from:'2026-08-01',to:report.to}),/Period/);
 assert.throws(()=>policy.validatePazarReport(vg.parseVgReport(workbook({'CARD (Platna kartica)':99}),device),{pib:report.pib,from:report.from,to:report.to}),/Zbir/);
 assert.throws(()=>policy.reportCents('not money'));assert.equal(policy.reportCents('0.29'),29);
 assert.equal(policy.pazarImportPeriod('2026-09-01','2026-09-30',2026,9).type,'MONTHLY');
 assert.equal(policy.pazarImportPeriod('2026-09-01','2026-09-01',2026,9).type,'DAILY');
 assert.equal(policy.pazarImportPeriod('2026-09-02','2026-09-14',2026,9).type,'RANGE');
 assert.throws(()=>policy.pazarImportPeriod('2026-09-01','2026-10-01',2026,9));
 assert.throws(()=>policy.pazarImportPeriod('2026-02-30','2026-02-30',2026,2));
});
test('VG login uses cookie+CSRF, allowed HTTPS origin and exact report filters; stale login is rejected',async()=>{
 const requests=[];let expired=false,evil=false;
 const fake=async(url,options)=>{
  requests.push({url,options});assert.equal(options.redirect,'manual');assert.equal(new URL(url).origin,'https://fis.fiskalizacija.me');
  if(url.endsWith('/user/login')&&options.method!=='POST')return new Response('<input value="csrf-test" name="csrft">',{headers:{'set-cookie':'session=test; Secure; HttpOnly'}});
  assert.equal(options.headers.get('cookie'),'session=test');
  if(options.method==='POST'){const body=new URLSearchParams(options.body);assert.equal(body.get('csrft'),'csrf-test');assert.equal(body.get('password'),'secret fixture');return new Response('',{status:302,headers:{location:expired?'/me/user/login':'/me/device/list'}});}
  if(new URL(url).pathname==='/me/receipt/export')return new Response(workbook());
  const query=new URL(url).searchParams;
  return new Response('<select name="serial"><option value="KASA1">1-1 | KASA</option></select><a href="'+(evil?'https://evil.invalid':'')+'/me/receipt/export?serial=KASA1&amp;type=summaryPeriodical&amp;issued_at_from='+query.get('issued_at_from')+'&amp;issued_at_to='+query.get('issued_at_to')+'">Report</a>');
 };
 const client=new vg.VgFiscalClient(fake);await client.login('fixture@example.com','secret fixture');assert.deepEqual(await client.devices(),[device]);
 const data=await client.report(device,'2026-09-01','2026-09-30');assert.equal(data.report.total,22800);assert.equal(data.bytes.subarray(0,2).toString(),'PK');
 evil=true;await assert.rejects(client.report(device,'2026-09-01','2026-09-30'),/ne odgovara/);assert(!requests.some(r=>r.url.includes('evil.invalid')));client.close();
 expired=true;await assert.rejects(new vg.VgFiscalClient(fake).login('fixture@example.com','secret fixture'),/prijava/);
});
test('portal encryption and signed import bind tenant, form, source and expiry without plaintext',()=>{
 const before=process.env.FISCAL_PORTAL_ENCRYPTION_KEY;process.env.FISCAL_PORTAL_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 try{const crypto=load('src/lib/fiscal-portal-secrets.ts'),password=' fixture $ pass ',value=crypto.encryptPortalPassword(password,'agency:firm:config');
  assert(!value.includes(password));assert.equal(crypto.decryptPortalPassword(value,'agency:firm:config'),password);assert.throws(()=>crypto.decryptPortalPassword(value,'other:firm:config'));
  const proof={agencyId:'agency',companyId:'firm',yearId:'year',bookId:'book',userId:'user',configId:'config',configVersion:'v',provider:'VG_EFISKAL',deviceId:'device',cashRegister:'cash',from:'2026-09-01',to:'2026-09-30',digest:'digest',expires:Date.now()+10000};
  const token=crypto.signPazarImport(proof);assert.deepEqual(crypto.verifyPazarImport(token),proof);assert.throws(()=>crypto.verifyPazarImport('x'+token));
  assert.throws(()=>crypto.verifyPazarImport(crypto.signPazarImport({...proof,expires:Date.now()-1})));
 }finally{if(before===undefined)delete process.env.FISCAL_PORTAL_ENCRYPTION_KEY;else process.env.FISCAL_PORTAL_ENCRYPTION_KEY=before;}
});
test('Summa business-day boundaries follow Podgorica DST; form retains summed VAT instead of recomputing',()=>{
 const svc=load('src/lib/pazar-import.ts');assert.equal(svc.pazarBusinessInstant('2026-09-01').toISOString(),'2026-08-31T22:00:00.000Z');assert.equal(svc.pazarBusinessInstant('2026-11-01').toISOString(),'2026-10-31T23:00:00.000Z');
 const Form=sourceLoader({'next/link':{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)},'@/components/AccountSearchSelect':{AccountSearchSelect:()=>null}})('src/components/KifPazarForm.tsx').KifPazarForm;
 const html=renderToStaticMarkup(React.createElement(Form,{action:()=>{},bookId:'book',companyId:'firm',defaultDailyDate:'2026-09-01',defaultMonth:'2026-09',rates:[{id:'r',naziv:'21%',procenat:'21'}],revenueAccountRequired:false,revenueAccounts:[],defaultRevenueAccount:'6000',businessUnits:[],initial:{id:'entry',sourceImported:true,periodType:'MONTHLY',periodFrom:'2026-09-01',periodTo:'2026-09-30',reportNumber:'report',cashRegister:'cash',total:'0,11',revenueAccountCode:'6000',note:'',businessUnitId:'',taxLines:[{vatRateId:'r',taxBase:'0,08',vatAmount:'0,03'}],payments:[{method:'CASH',amount:'0,11'}]}}));
 const fresh=renderToStaticMarkup(React.createElement(Form,{action:()=>{},bookId:'book',companyId:'firm',defaultDailyDate:'2026-09-01',defaultMonth:'2026-09',rates:[{id:'r',naziv:'21%',procenat:'21'}],revenueAccountRequired:false,revenueAccounts:[],defaultRevenueAccount:'6000',businessUnits:[]}));assert.match(fresh,/Uvezi izvještaj/);assert.match(fresh,/fiskalni-portali/);
 assert.match(html,/name="output_vat_amount"[^>]*value="0,03"/);assert.match(html,/name="pazar_period_type"[^>]*value="MONTHLY"/);
});
