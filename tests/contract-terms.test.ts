import assert from "node:assert/strict";
import test from "node:test";
import { parseContractTerms } from "../src/lib/contract-terms";
import { accountingContractArticles } from "../src/lib/accounting-contract-template";

const form = (data: Record<string, string>) => { const result = new FormData(); Object.entries(data).forEach(([key,value])=>result.set(key,value)); return result; };

test("contract dates are independent and validated, without today's implicit date", () => {
  const terms = parseContractTerms(form({datum_zakljucenja:"2026-10-02",datum_pocetka:"2026-09-01"}));
  assert.equal(terms?.datum_zakljucenja?.toISOString(),"2026-10-02T00:00:00.000Z");
  assert.equal(terms?.datum_pocetka?.toISOString(),"2026-09-01T00:00:00.000Z");
  assert.equal(parseContractTerms(form({}))?.datum_zakljucenja,null);
  for (const date of ["2026-02-30","2026-13-01","wrong"]) assert.equal(parseContractTerms(form({datum_zakljucenja:date})),null);
  assert.equal(parseContractTerms(form({datum_pocetka:"2026-10-01",datum_prestanka:"2026-09-01"})),null);
});

test("payment deadline distinguishes month day from days after invoice and preserves zero", () => {
  const day = parseContractTerms(form({rok_placanja_tip:"dan_u_mjesecu",dan_placanja:"12",rok_placanja_dana:"20"}));
  assert.equal(day?.dan_placanja,12);assert.equal(day?.rok_placanja_dana,null);
  const days = parseContractTerms(form({rok_placanja_tip:"dani",dan_placanja:"12",rok_placanja_dana:"0"}));
  assert.equal(days?.dan_placanja,null);assert.equal(days?.rok_placanja_dana,0);
  for (const value of ["0","32","1.5","abc"]) assert.equal(parseContractTerms(form({rok_placanja_tip:"dan_u_mjesecu",dan_placanja:value})),null);
  assert.equal(parseContractTerms(form({rok_placanja_tip:"other"})),null);
});

test("contract fee maps decimal cents without hiding invalid or negative input", () => {
  for (const [input, output] of [["0","0.00"],["275,50","275.50"],["275.5","275.50"],["1.234,56","1234.56"]]) {
    assert.equal(parseContractTerms(form({mjesecna_cijena:input}))?.mjesecna_cijena,output);
  }
  assert.equal(parseContractTerms(form({dugovanje:"-20,50"}))?.dugovanje,"-20.50");
  for (const input of ["-1","1.234","NaN","1e3","1000000000000"]) assert.equal(parseContractTerms(form({mjesecna_cijena:input})),null);
});

test("all thirteen source articles remain with variable price, bank, deadline, court and start", () => {
  assert.deepEqual(accountingContractArticles.map(a=>a.number),Array.from({length:13},(_,i)=>i+1));
  const content = JSON.stringify(accountingContractArticles);
  for (const token of ["cijena","racun","rok","sud","pocetak"]) assert.ok(content.includes(`{{${token}}}`));
  assert.doesNotMatch(content,/PROTAX|SWORD|530-363011-96|100,00€|01\.10\.2025/);
});
