/* eslint-disable @typescript-eslint/no-require-imports -- Parse actual editor payloads and render the shared editor. */
const{test}=require('node:test'),assert=require('node:assert/strict'),React=require('react');
const{renderToStaticMarkup}=require('react-dom/server');const{sourceLoader}=require('./helpers/source-loader.cjs');
const load=sourceLoader(),{parseManualBankLines,manualLedgerBalanced}=load('src/lib/bank-manual-journal-input.ts');
function form(overrides={}){const data={konto_sifra:['2410','5530'],komitent_id:['',''],stavka_opis:['Bank','Expense'],broj_dokumenta:['1','1'],datum_dokumenta:['2026-06-01',''],datum_valute:['',''],duguje:['','242,00'],potrazuje:['242.00',''],...overrides};const f=new FormData();for(const[k,v]of Object.entries(data))for(const x of[].concat(v))f.append(k,x);return f;}
test('manual bank editor accepts exact cents and unbalanced draft rows, but rejects ambiguous dates/amounts/array tampering',()=>{
 const rows=parseManualBankLines(form());assert.equal(rows[0].credit,24200n);assert.equal(rows[1].debit,24200n);
 assert.equal(parseManualBankLines(form({duguje:['','241.99']}))[1].debit,24199n);
 for(const data of[{duguje:['','0.001']},{duguje:['','-1']},{duguje:['','1e2']},{duguje:['','10'],potrazuje:['242','1']},{komitent_id:['']},{datum_dokumenta:['2026-02-30','']}])assert.throws(()=>parseManualBankLines(form(data)),/stavk/);
 assert.equal(manualLedgerBalanced([{duguje:'0.10',potrazuje:'0'},{duguje:'0.20',potrazuje:'0'},{duguje:'0',potrazuje:'0.30'}]),true);
});
test('an unused trailing row with an automatically filled description does not block saving completed lines',()=>{
 const f=form();
 for(const name of ['konto_sifra','komitent_id','stavka_opis','broj_dokumenta','datum_dokumenta','datum_valute','duguje','potrazuje'])f.append(name,name==='stavka_opis'?'Izvod 3':'');
 assert.equal(parseManualBankLines(f).length,2);
 for(const name of ['konto_sifra','komitent_id','broj_dokumenta','datum_dokumenta','datum_valute','duguje','potrazuje']){
  const invalid=new FormData();for(const[k,v]of f)invalid.append(k,v);
  const values=invalid.getAll(name);values[values.length-1]=name==='duguje'||name==='potrazuje'?'1.00':name.startsWith('datum_')?'2026-06-01':'entered';invalid.delete(name);values.forEach(v=>invalid.append(name,v));
  assert.throws(()=>parseManualBankLines(invalid),/stavk/);
 }
});
test('full shared editor includes all accounting fields and explicit add/delete controls only when requested',()=>{
 const{JournalLinesEditor}=load('src/components/JournalLinesEditor.tsx');
 const props={accounts:[{sifra:'2410',naziv:'Bank',analitika_obavezna:false}],datalistId:'manual-test',initialLines:[{accountCode:'2410',debit:'0.10'},{accountCode:'5530',debit:'0.20'},{accountCode:'2410',credit:'0.30'}]};
 const html=renderToStaticMarkup(React.createElement(JournalLinesEditor,{...props,allowRemoveRows:true}));
 for(const name of['konto_sifra','komitent_id','stavka_opis','broj_dokumenta','datum_dokumenta','datum_valute','duguje','potrazuje'])assert.ok(html.includes('name="'+name+'"'));
 assert.match(html,/Obriši stavku/);assert.match(html,/Dodaj stavku/);assert.match(html,/class="balanced"/);
 assert.doesNotMatch(renderToStaticMarkup(React.createElement(JournalLinesEditor,props)),/Obriši stavku/);
});
