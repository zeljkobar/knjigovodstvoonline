import assert from "node:assert/strict";
import test from "node:test";
import {
  fixedAssetCentsToDecimal,
  fixedAssetDecimalToCents,
  fixedAssetContextMatches,
  fixedAssetDepreciationEligibility,
  fixedAssetOpeningDates,
  fixedAssetPage,
  parseFixedAssetDate,
  parseFixedAssetMoney
} from "../src/lib/fixed-assets";

test("novac osnovnih sredstava prihvata lokalni i decimalni zapis", () => {
  assert.equal(parseFixedAssetMoney("1.200,50"), 120050);
  assert.equal(parseFixedAssetMoney("1200.50"), 120050);
  assert.equal(parseFixedAssetMoney("0,01"), 1);
  assert.equal(parseFixedAssetMoney("12,345"), null);
  assert.equal(parseFixedAssetMoney("-1"), null);
});

test("početni presjek pripada prethodnom danu, događaj i amortizacija novoj godini", () => {
  const dates = fixedAssetOpeningDates(new Date("2025-12-31"), new Date("2026-01-01"));
  assert.equal(dates.effectiveFrom.toISOString().slice(0, 10), "2026-01-01");
  assert.equal(dates.eventDate.toISOString().slice(0, 10), "2026-01-01");
  assert.throws(() => fixedAssetOpeningDates(new Date("2026-01-01"), new Date("2026-01-01")));
  assert.throws(() => fixedAssetOpeningDates(new Date("2026-06-30"), new Date("2026-01-01")));
});

test("stara forma se odbija nakon promjene firme ili godine, kao i forma bez konteksta", () => {
  const form = new FormData();
  const context = { firmaId: "A", poslovnaGodinaId: "2026" };
  assert.equal(fixedAssetContextMatches(form, context), false);
  form.set("ocekivana_firma_id", "A");
  form.set("ocekivana_godina_id", "2026");
  assert.equal(fixedAssetContextMatches(form, context), true);
  assert.equal(fixedAssetContextMatches(form, { ...context, firmaId: "B" }), false);
  assert.equal(fixedAssetContextMatches(form, { ...context, poslovnaGodinaId: "2027" }), false);
});

test("zemljište i nepodržane vrste ne ulaze u linearni obračun", () => {
  assert.equal(fixedAssetDepreciationEligibility("LAND"), "EXCLUDED");
  assert.equal(fixedAssetDepreciationEligibility("RIGHT_OF_USE"), "UNSUPPORTED");
  assert.equal(fixedAssetDepreciationEligibility("OTHER"), "UNSUPPORTED");
  assert.equal(fixedAssetDepreciationEligibility("MATERIAL"), "SUPPORTED");
  assert.equal(fixedAssetDepreciationEligibility("INTANGIBLE"), "SUPPORTED");
});

test("paginacija pokriva više od 200 sredstava i ograničava neispravnu stranu", () => {
  assert.deepEqual(fixedAssetPage("5", 205), { page: 5, pages: 5, skip: 200, take: 50 });
  assert.equal(fixedAssetPage("999", 205).page, 5);
  assert.equal(fixedAssetPage("-1", 205).page, 1);
  assert.equal(fixedAssetPage("abc", 0).page, 1);
});

test("unos novca poštuje Decimal(14,2) granicu bez gubitka centa", () => {
  assert.equal(parseFixedAssetMoney("999999999999,99"), 99999999999999);
  assert.equal(parseFixedAssetMoney("1000000000000,00"), null);
});

test("centi se zapisuju kao Decimal string bez float aritmetike", () => {
  assert.equal(fixedAssetCentsToDecimal(120050), "1200.50");
  assert.equal(fixedAssetCentsToDecimal(-1), "-0.01");
});

test("Decimal vrijednost iz baze se pretvara u cente bez float aritmetike", () => {
  assert.equal(fixedAssetDecimalToCents({ toString: () => "1200.50" }), 120050);
  assert.equal(fixedAssetDecimalToCents({ toString: () => "-0.01" }), -1);
  assert.equal(fixedAssetDecimalToCents({ toString: () => "12.345" }), null);
});

test("poslovni datum prihvata samo ISO date-only zapis", () => {
  assert.equal(parseFixedAssetDate("2026-09-27")?.toISOString(), "2026-09-27T00:00:00.000Z");
  assert.equal(parseFixedAssetDate("27.09.2026"), null);
  assert.equal(parseFixedAssetDate("2026-02-31"), null);
});

import { parseDepreciationFields, completeDepreciationFields } from "../src/lib/fixed-assets-rates";
test("izbor metode validira stopu i ignoriše neprimjenjiva polja",()=>{
  const f=new FormData();f.set("metoda","LINEAR");f.set("godisnja_stopa","20,123456");f.set("ocekivani_ucinak","pogresno");f.set("korisni_vijek_mjeseci","pogresno");
  assert.equal(parseDepreciationFields(f)?.godisnja_stopa,"20.123456");assert.equal(parseDepreciationFields(f)?.ocekivani_ucinak,null);
  f.set("godisnja_stopa","100.000001");assert.equal(parseDepreciationFields(f),null);
  assert.equal(parseDepreciationFields(f,true)?.metoda,"NONE");
  f.set("metoda","DEGRESSIVE");f.set("godisnja_stopa","30");assert.equal(parseDepreciationFields(f),null);
});
test("ručno izabrana stopa po jedinici određuje kapacitet bez protivrječnih unosa",()=>{
  const f=new FormData();f.set("metoda","UNITS_OF_PRODUCTION");f.set("izvor_stope","MANUAL");f.set("stopa_po_jedinici","0.5");f.set("jedinica_ucinka","sat");f.set("prethodni_ucinak","8000");f.set("ocekivani_ucinak","999999");
  const parsed=parseDepreciationFields(f);assert.ok(parsed);
  assert.equal(completeDepreciationFields(parsed,1000000)?.ocekivani_ucinak,"20000.000000");
});

import { fixedAssetTaxGroups, parseTaxClassification, taxClassificationLabel } from "../src/lib/fixed-assets-tax-groups";

test("poreske grupe mapiraju pojedinačni i grupni tretman", () => {
  for (const group of fixedAssetTaxGroups) {
    assert.deepEqual(parseTaxClassification(group.id, "MATERIAL"), {
      poreski_tretman: group.id === "I" ? "GROUP_I" : "GROUP_POOL", poreska_grupa: group.id
    });
    assert.equal(taxClassificationLabel(group.id === "I" ? "GROUP_I" : "GROUP_POOL", group.id), `Grupa ${group.id} – ${group.rate}%`);
  }
});
test("poreska klasifikacija odbija prazan, nepoznat i nekompatibilan izbor", () => {
  for (const value of [null, "", "VI", "ACCOUNTING_AMOUNT"]) assert.equal(parseTaxClassification(value, "MATERIAL"), null);
  assert.equal(parseTaxClassification("III", "LAND"), null);
  assert.equal(parseTaxClassification("V", "INTANGIBLE"), null);
  assert.equal(parseTaxClassification("II", "RIGHT_OF_USE"), null);
  assert.equal(parseTaxClassification("II", "UNKNOWN"), null);
});
test("poreski posebni tretmani ne dobijaju grupu niti proizvoljnu stopu", () => {
  assert.deepEqual(parseTaxClassification("EXEMPT", "LAND"), { poreski_tretman: "EXEMPT", poreska_grupa: null });
  for (const type of ["INTANGIBLE", "RIGHT_OF_USE"]) assert.deepEqual(parseTaxClassification("ACCOUNTING_AMOUNT", type), { poreski_tretman: "ACCOUNTING_AMOUNT", poreska_grupa: null });
  assert.deepEqual(parseTaxClassification("UNSUPPORTED", "OTHER"), { poreski_tretman: "UNSUPPORTED", poreska_grupa: null });
  assert.equal(taxClassificationLabel("UNSUPPORTED", null), "Nije klasifikovano / poseban tretman");
});
