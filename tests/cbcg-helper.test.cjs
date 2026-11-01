/* eslint-disable @typescript-eslint/no-require-imports -- Test actual extension scripts in isolated browser API fixtures. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const root='browser-extensions/irms-helper/';
const company={account:'530-19109-13',name:'SUMMA SUMMARUM - BAR',pib:'02825767',address:'POPA DUKLJANINA 4',city:'BAR'};
function shared(){const ctx=vm.createContext({URL});vm.runInContext(fs.readFileSync(root+'cbcg-common.js','utf8'),ctx);return ctx.SummaCbcg;}
const common=shared(),bridge=sourceLoader()('src/lib/cbcg-browser-bridge.ts');
test('CBCG parses BBAN variants without mixing accounts; app and extension enforce the same result identity',()=>{
 for(const account of ['530-19109-13','530-0000000019109-13','530000000001910913','5301910913']){
  assert.equal(common.accountParts(account).account,company.account);
  assert.equal(bridge.cbcgAccountParts(account).account,company.account);
  assert.ok(common.validCompany(company,account));assert.ok(bridge.validateCbcgCompany(company,account));
 }
 for(const account of ['','abc530-19109-13','ME255301910913','530-0-13','530-19109-1']){
  assert.equal(common.accountParts(account),null);assert.equal(bridge.cbcgAccountParts(account),null);
 }
 for(const data of [{...company,account:'510-19109-13'},{...company,pib:'2825767'},{...company,name:''},{...company,address:2}]){
  assert.equal(common.validCompany(data,company.account),false);assert.equal(bridge.validateCbcgCompany(data,company.account),null);
 }
 assert.ok(common.isCbcgUrl('https://eportal.cbcg.me/cbcgPregledi/faces/pages/pregledracuni.jspx;jsessionid=abc?_afr=1'));
 assert.equal(common.isCbcgUrl('https://eportal.cbcg.me.evil.test/cbcgPregledi/faces/pages/pregledracuni.jspx'),false);
 assert.equal(common.isAppUrl('https://summasummarum.me.evil.test'),false);
});
function resultDocument({account=company.account,items=1,body='',pib=company.pib}={}){
 const item={innerText:`Naziv\t${company.name}\nMatični broj\t${pib}\nAdresa\t${company.address}\nSjedište\t${company.city}\nPrikaži detalje`};
 return {body:{innerText:`${body}\nRezultat pretrage za transakcioni račun ${account}`},getElementById:()=>({querySelectorAll:()=>Array(items).fill(item)})};
}
test('only an unambiguous CBCG result under the matching account heading is returned, even after the popup',()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(common.readResult(resultDocument({body:'reCAPTCHA response nije validan. OK'}),company.account))),company);
 for(const options of [{items:0},{items:2},{account:'510-19109-13'},{pib:'bad'}])assert.equal(common.readResult(resultDocument(options),company.account),null);
 assert.equal(common.readResult({body:{innerText:'Nema podataka.'}},company.account),null);
});
function workerFixture(){
 const listeners={},store={},tabs=new Map([[10,{id:10,url:'http://localhost:3000/agencija/izvodi'}]]),removed=[],sent=[],alarms=new Map();let nextId=100;
 const event=name=>({addListener:fn=>{(listeners[name]??=[]).push(fn);}});
 const chrome={storage:{session:{get:async k=>k==null?{...store}:{[k]:store[k]},set:async data=>Object.assign(store,data),remove:async k=>{delete store[k];}}},
  tabs:{create:async data=>{const tab={...data,id:nextId++};tabs.set(tab.id,tab);return tab;},get:async id=>tabs.get(id),update:async(id,data)=>Object.assign(tabs.get(id),data),
   remove:async id=>{removed.push(id);tabs.delete(id);},sendMessage:async(id,message,options)=>{sent.push({id,message,options});},onUpdated:event('updated'),onRemoved:event('removed')},
  alarms:{create:async(k,data)=>alarms.set(k,data),clear:async k=>alarms.delete(k),onAlarm:event('alarm')},runtime:{onMessage:event('message')}};
 function restart(){for(const k of Object.keys(listeners))delete listeners[k];const ctx=vm.createContext({chrome,URL,Date});ctx.importScripts=(...names)=>names.forEach(n=>vm.runInContext(fs.readFileSync(root+n,'utf8'),ctx));vm.runInContext(fs.readFileSync(root+'service-worker.js','utf8'),ctx);}
 restart();
 const app={tab:{id:10},frameId:0,documentId:'app-document',url:tabs.get(10).url};
 const requestId='cbcg-11111111-1111-4111-8111-111111111111';
 const message=(data,sender=app)=>new Promise(resolve=>{let handled=false;for(const fn of listeners.message){if(fn(data,sender,resolve)===true)handled=true;}if(!handled)resolve();});
 const reader=id=>({tab:{id},frameId:0,documentId:'reader-doc',url:tabs.get(id)?.url});
 return {store,tabs,removed,sent,alarms,restart,app,requestId,message,reader,listeners};
}
test('helper survives service-worker restart; only validated delivery ACK closes its own tab',async()=>{
 const f=workerFixture();assert.ok((await f.message({type:'SUMMA_CBCG_LOOKUP',requestId:f.requestId,account:company.account})).ok);
 assert.deepEqual(f.removed,[]);f.restart();
 assert.ok((await f.message({type:'SUMMA_CBCG_SUBMITTED',requestId:f.requestId},f.reader(100))).ok);
 const data={type:'SUMMA_CBCG_RESULT',requestId:f.requestId,data:company};
 assert.equal((await f.message(data,{...f.reader(100),url:'https://evil.test'})).ok,false);
 assert.equal((await f.message({...data,data:{...company,account:'510-19109-13'}},f.reader(100))).ok,false);
 assert.ok((await f.message(data,f.reader(100))).ok);assert.deepEqual(f.removed,[]);
 assert.equal(f.sent.at(-1).id,10);assert.equal(f.sent.at(-1).options.documentId,'app-document');
 await f.message({type:'SUMMA_CBCG_ACK',requestId:f.requestId},{...f.app,documentId:'another-document'});assert.deepEqual(f.removed,[]);
 await f.message({type:'SUMMA_CBCG_ACK',requestId:f.requestId});assert.deepEqual(f.removed,[100]);assert.equal(Object.keys(f.store).length,0);
 assert.equal(f.tabs.get(10).active,true);assert.equal(f.alarms.size,0);
});
test('two rows stay separate; cancel, manual close, requester close and timeout clean only owned helpers',async()=>{
 const f=workerFixture(),second=f.requestId.replace(/1/g,'2');
 for(const requestId of[f.requestId,second])await f.message({type:'SUMMA_CBCG_LOOKUP',requestId,account:company.account});
 await f.message({type:'SUMMA_CBCG_ACK',requestId:f.requestId});assert.deepEqual(f.removed,[]); // no result yet
 await f.message({type:'SUMMA_CBCG_CANCEL',requestId:f.requestId});assert.deepEqual(f.removed,[100]);assert.ok(f.store['cbcg-pending-101']);
 f.tabs.delete(101);f.listeners.removed.forEach(fn=>fn(101));await new Promise(setImmediate);
 assert.equal(Object.keys(f.store).length,0);assert.equal(f.sent.at(-1).message.requestId,second);assert.match(f.sent.at(-1).message.message,/zatvoren/);
 await f.message({type:'SUMMA_CBCG_LOOKUP',requestId:f.requestId,account:company.account});
 f.listeners.alarm.forEach(fn=>fn({name:'cbcg-pending-102'}));await new Promise(setImmediate);assert.ok(f.removed.includes(102));
 await f.message({type:'SUMMA_CBCG_LOOKUP',requestId:f.requestId,account:company.account});
 f.tabs.delete(10);f.listeners.removed.forEach(fn=>fn(10));await new Promise(setImmediate);assert.ok(f.removed.includes(103));
 assert.ok(!f.removed.includes(10));assert.equal(Object.keys(f.store).length,0);
});
test('a cancelled lookup during tab creation cannot orphan a tab; untrusted origins/frames cannot create one',async()=>{
 const f=workerFixture();
 const lookup=f.message({type:'SUMMA_CBCG_LOOKUP',requestId:f.requestId,account:company.account});
 const cancel=f.message({type:'SUMMA_CBCG_CANCEL',requestId:f.requestId});await Promise.all([lookup,cancel]);assert.deepEqual(f.removed,[100]);
 for(const sender of[{...f.app,url:'https://evil.test'},{...f.app,frameId:1}])assert.equal((await f.message({type:'SUMMA_CBCG_LOOKUP',requestId:f.requestId,account:company.account},sender)).ok,false);
 assert.equal(f.tabs.size,1);
});
test('IRMS lookup still uses its own protocol and closes only its IRMS helper',async()=>{
 const f=workerFixture();await f.message({type:'SUMMA_IRMS_LOOKUP',requestId:'irms-test',pib:company.pib});
 assert.match(f.tabs.get(100).url,/irms.tax.gov.me/);
 await f.message({type:'SUMMA_IRMS_RESULT',data:{pib:company.pib}},{tab:{id:100}});await new Promise(setImmediate);
 assert.deepEqual(f.removed,[100]);assert.equal(f.sent.at(-1).message.requestId,'irms-test');
});
test('reader uses normal visible search, waits through error/OK and submits only once across reloads',async()=>{
 const sent=[],fields={},timers=[];let click=0,handler,doc=resultDocument({items:0});
 class Input {set value(v){this.text=v;}dispatchEvent(){}}
 for(const id of['pt1:it3::content','pt1:it4::content','pt1:it5::content'])fields[id]=new Input();
 const button={click:()=>{click++;}};
 const document={get body(){return doc.body;},getElementById:id=>fields[id]??doc.getElementById(id),querySelector:()=>button};
 const ctx=vm.createContext({document,location:{href:'https://eportal.cbcg.me/cbcgPregledi/faces/pages/pregledracuni.jspx'},HTMLInputElement:Input,Event:class{},Date,
  SummaCbcg:common,clearInterval(){},setInterval:fn=>{timers.push(fn);return timers.length;},chrome:{runtime:{sendMessage:async data=>{sent.push(data);return{ok:true};},onMessage:{addListener:fn=>{handler=fn;}}}}});
 vm.runInContext(fs.readFileSync(root+'cbcg-reader.js','utf8'),ctx);
 const start={type:'SUMMA_CBCG_START',requestId:'row-1',account:company.account,expiresAt:Date.now()+10000,submitted:false};
 handler(start);await new Promise(setImmediate);assert.equal(click,1);assert.equal(fields['pt1:it4::content'].text,'19109');
 doc=resultDocument({items:0,body:'reCAPTCHA response nije validan. OK'});timers[0]();handler(start);assert.equal(click,1);assert.equal(sent.some(m=>m.type==='SUMMA_CBCG_RESULT'),false);
 doc=resultDocument();timers[0]();assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1).data)),company);
 // A new document resumes a submitted request without another click.
 handler({...start,requestId:'row-2',submitted:true});await new Promise(setImmediate);assert.equal(click,1);
});
test('browser bridge rejects wrong source/request/account, ACKs good data, and cleans abort/timeout listeners',async()=>{
 const old=global.window;const listeners=new Set(),timers=new Map(),posted=[];let n=0;
 const window={location:{origin:'http://localhost:3000'},setTimeout:fn=>{timers.set(++n,fn);return n;},clearTimeout:id=>timers.delete(id),addEventListener:(_n,fn)=>listeners.add(fn),removeEventListener:(_n,fn)=>listeners.delete(fn),postMessage:data=>posted.push(data)};
 const emit=(data,source=window,origin=window.location.origin)=>[...listeners].forEach(fn=>fn({data,source,origin}));
 global.window=window;
 try{
  const promise=bridge.lookupCbcgThroughBrowser(company.account);emit({type:'SUMMA_CBCG_EXTENSION_READY'});
  const requestId=posted.at(-1).requestId;
  emit({type:'SUMMA_CBCG_RESULT',requestId,data:company},{},'http://localhost:3000');
  emit({type:'SUMMA_CBCG_RESULT',requestId:'other-row',data:company});assert.equal(listeners.size,1);
  emit({type:'SUMMA_CBCG_RESULT',requestId,data:company});assert.deepEqual(await promise,company);assert.equal(posted.at(-1).type,'SUMMA_CBCG_ACK');assert.equal(listeners.size,0);assert.equal(timers.size,0);
  const invalid=bridge.lookupCbcgThroughBrowser(company.account);emit({type:'SUMMA_CBCG_EXTENSION_READY'});emit({type:'SUMMA_CBCG_RESULT',requestId:posted.at(-1).requestId,data:{...company,account:'510-19109-13'}});await assert.rejects(invalid,/ne odgovara/);assert.equal(posted.at(-1).type,'SUMMA_CBCG_CANCEL');
  const controller=new AbortController(),aborted=bridge.lookupCbcgThroughBrowser(company.account,controller.signal);emit({type:'SUMMA_CBCG_EXTENSION_READY'});controller.abort();await assert.rejects(aborted,{name:'AbortError'});assert.equal(listeners.size,0);
  const missing=bridge.lookupCbcgThroughBrowser(company.account);[...timers.values()][0]();await assert.rejects(missing,/ekstenziju/);assert.equal(timers.size,0);
 }finally{global.window=old;}
});
test('CBCG is offered only on an editable unresolved domestic account; existing form name remains partner_id',()=>{
 const Component=sourceLoader()('src/components/BankStatementPartnerInput.tsx').BankStatementPartnerInput;
 for(const [disabled,account,initialPartner,visible]of[[false,company.account,null,true],[true,company.account,null,false],[false,'',null,false],[false,'foreign',null,false],[false,company.account,{id:'p',label:'Partner',naziv:'Partner',pib:company.pib,scope:'GLOBAL'},false]]){
  const html=renderToStaticMarkup(React.createElement(Component,{disabled,account,initialPartner}));assert.equal(html.includes('>CBCG</button>'),visible);assert.match(html,/name="partner_id"/);
 }
 const Modal=sourceLoader()('src/components/QuickPartnerCreateModal.tsx').QuickPartnerCreateModal;
 const html=renderToStaticMarkup(React.createElement(Modal,{initialName:company.name,initialPib:company.pib,initialAddress:company.address,initialCity:company.city,initialAccountNumber:company.account,onClose(){},onCreated(){}}));
 for(const value of Object.values(company))assert.ok(html.includes(value));
});

// Exercise client transitions without introducing a DOM/testing dependency.
// Child components remain real React elements; the row's actual handlers run.
function interactiveRow(lookup=async()=>company){
 const slots=[],cleanups=[];let cursor=0;
 const hooks={...React,useState:initial=>{const i=cursor++;if(!Object.hasOwn(slots,i))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
  useRef:initial=>{const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect:fn=>{const i=cursor++;if(!slots[i]){slots[i]=true;cleanups.push(fn());}}};
 const Component=sourceLoader({'react':hooks,'@/lib/cbcg-browser-bridge':{...bridge,lookupCbcgThroughBrowser:lookup}})('src/components/BankStatementPartnerInput.tsx').BankStatementPartnerInput;
 function render(){cursor=0;const nodes=[];function walk(node){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(walk);return;}nodes.push(node);walk(node.props?.children);}walk(Component({account:company.account,disabled:false,initialPartner:null}));return nodes;}
 const button=text=>render().find(n=>n.type==='button'&&n.props.children===text);
 return{render,button,child:name=>render().find(n=>n.type?.name===name),close:()=>cleanups.forEach(fn=>fn?.())};
}
test('CBCG matches only the exact PIB; ambiguous partners require choice, missing partners get a prefilled modal, lookup failure does not create',async()=>{
 const original=global.fetch;const partner={id:'partner-a',pib:company.pib,naziv:'Available',label:'Available (02825767)',scope:'AGENCY'};
 try{
  for(const [found,ok]of[[[partner],true],[[partner,{...partner,id:'partner-b',scope:'GLOBAL'}],true],[[],true],[[],false]]){
   global.fetch=async url=>{assert.match(url,/\/api\/partners\/search\?q=02825767&exactPib=1$/);return{ok,json:async()=>({results:found})};};
   const row=interactiveRow();row.button('CBCG').props.onClick();await new Promise(setImmediate);
   const input=row.child('PartnerSearchInput');
   if(ok&&found.length===1)assert.equal(input.props.initialPartner.id,partner.id);
   else assert.equal(input.props.initialPartner,null);
   if(ok&&found.length===2){
    assert.equal(row.child('QuickPartnerCreateModal'),undefined);
    const choices=row.render().filter(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children.includes('GLOBAL'));
    assert.equal(choices.length,1);choices[0].props.onClick();assert.equal(row.child('PartnerSearchInput').props.initialPartner.id,'partner-b');
   }
   if(ok&&found.length===0){const modal=row.child('QuickPartnerCreateModal');assert.equal(modal.props.initialPib,company.pib);assert.equal(modal.props.initialAccountNumber,company.account);assert.equal(modal.props.initialAddress,company.address);}
   if(!ok){assert.equal(row.child('QuickPartnerCreateModal'),undefined);assert.equal(row.button('Novi partner iz CBCG podataka'),undefined);}
   row.close();
  }
 }finally{global.fetch=original;}
});
test('manual partner choice and unmount cancel the row; a late CBCG reply cannot replace the user choice',async()=>{
 const original=global.fetch;let finish,signal,requests=0;
 global.fetch=async()=>{requests++;throw Error('Should not search after cancel');};
 try{
  const row=interactiveRow((_account,s)=>{signal=s;return new Promise(resolve=>{finish=resolve;});});
  row.button('CBCG').props.onClick();const manual={id:'manual',label:'Manual',naziv:'Manual',pib:null,scope:'AGENCY'};
  row.child('PartnerSearchInput').props.onPartnerChange(manual);assert.equal(signal.aborted,true);finish(company);await new Promise(setImmediate);
  assert.equal(requests,0);assert.equal(row.child('QuickPartnerCreateModal'),undefined);assert.equal(row.button('CBCG'),undefined);
  row.close();
  const abandoned=interactiveRow((_a,s)=>{signal=s;return new Promise(()=>{});});abandoned.button('CBCG').props.onClick();abandoned.close();assert.equal(signal.aborted,true);
 }finally{global.fetch=original;}
});
