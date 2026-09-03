import assert from "node:assert/strict";
import test from "node:test";
import { calculatePriceAdjustment } from "../src/lib/inventory-price-adjustment";

const stock = {
  quantityMilli: BigInt(10000),
  costCents: BigInt(6000),
  retailCents: BigInt(12100),
  marginCents: BigInt(4000),
  includedVatCents: BigInt(2100)
};

test("povećanje cijene mijenja maloprodajnu vrijednost, RUC i PDV bez promjene količine", () => {
  const result = calculatePriceAdjustment({ stock, vatPercentHundred: BigInt(2100), newGrossUnitCents: BigInt(1450) });
  assert.equal(result.oldGrossUnitCents, BigInt(1210));
  assert.equal(result.newRetailCents, BigInt(14500));
  assert.equal(result.retailChangeCents, BigInt(2400));
  assert.equal(result.marginChangeCents + result.includedVatChangeCents, result.retailChangeCents);
});

test("smanjenje cijene daje negativne promjene i ostaje izbalansirano", () => {
  const result = calculatePriceAdjustment({ stock, vatPercentHundred: BigInt(2100), newGrossUnitCents: BigInt(1000) });
  assert.equal(result.newRetailCents, BigInt(10000));
  assert.equal(result.retailChangeCents, BigInt(-2100));
  assert.equal(result.marginChangeCents + result.includedVatChangeCents, result.retailChangeCents);
});

test("ista cijena ne pravi promjenu", () => {
  const result = calculatePriceAdjustment({ stock, vatPercentHundred: BigInt(2100), newGrossUnitCents: BigInt(1210) });
  assert.equal(result.retailChangeCents, BigInt(0));
  assert.equal(result.marginChangeCents, BigInt(0));
  assert.equal(result.includedVatChangeCents, BigInt(0));
});

test("nivelacija odbija prazno stanje i neusklađene vrijednosti lagera", () => {
  assert.throws(() => calculatePriceAdjustment({ stock: { ...stock, quantityMilli: BigInt(0) }, vatPercentHundred: BigInt(2100), newGrossUnitCents: BigInt(1200) }));
  assert.throws(() => calculatePriceAdjustment({ stock: { ...stock, marginCents: BigInt(3999) }, vatPercentHundred: BigInt(2100), newGrossUnitCents: BigInt(1200) }));
});
