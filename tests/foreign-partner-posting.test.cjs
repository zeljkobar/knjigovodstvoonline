/* eslint-disable @typescript-eslint/no-require-imports -- Render real posting form controls. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createElement}=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const load=sourceLoader(),{InvoicePostingRuleRow}=load('src/components/InvoicePostingRuleRow.tsx');
test('partner total exposes searchable domestic and foreign accounts; tax rows keep one account',()=>{
 const props={accountOptions:[{sifra:'2020',naziv:'Kupci'},{sifra:'2030',naziv:'Ino kupci'}],accountValue:'2020',foreignAccountValue:'2030',code:'UKUPAN_IZNOS',direction:'D',label:'Ukupan iznos',source:'FIXED'};
 const html=renderToStaticMarkup(createElement(InvoicePostingRuleRow,props));
 assert.match(html,/aria-label="Konto domaćeg partnera"/);assert.match(html,/aria-label="Konto ino partnera"/);
 assert.match(html,/name="sifra_konta_UKUPAN_IZNOS_INO"/);assert.match(html,/value="2030" selected/);
 assert.match(html,/Obavezno za knjiženje računa ino partnera/);assert.doesNotMatch(html,/Konto iz unosa računa/);
 const tax=renderToStaticMarkup(createElement(InvoicePostingRuleRow,{...props,code:'PDV_R21',label:'PDV 21%'}));
 assert.doesNotMatch(tax,/Konto ino partnera|UKUPAN_IZNOS_INO/);assert.match(tax,/Konto iz unosa računa/);
});
