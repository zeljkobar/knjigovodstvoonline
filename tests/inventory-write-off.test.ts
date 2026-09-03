import assert from "node:assert/strict";
import test from "node:test";
import { calculateWriteOffSlice } from "../src/lib/inventory-write-off";

const source = {
  quantityMilli: BigInt(10000),
  averageCostTenThousand: BigInt(25000),
  costCents: BigInt(2500),
  retailCents: BigInt(4000),
  marginCents: BigInt(1200),
  includedVatCents: BigInt(300)
};

test("djelimični otpis koristi prosječnu cijenu i proporcionalne maloprodajne vrijednosti", () => {
  const result = calculateWriteOffSlice({ source, quantityMilli: BigInt(4000) });
  assert.equal(result.costCents, BigInt(1000));
  assert.equal(result.retailCents, BigInt(1600));
  assert.equal(result.marginCents, BigInt(480));
  assert.equal(result.includedVatCents, BigInt(120));
});

test("otpis cijelog stanja uklanja tačne vrijednosti bez ostatka", () => {
  const result = calculateWriteOffSlice({ source: { ...source, quantityMilli: BigInt(3000), costCents: BigInt(749), retailCents: BigInt(1199) }, quantityMilli: BigInt(3000) });
  assert.equal(result.costCents, BigInt(749));
  assert.equal(result.retailCents, BigInt(1199));
});

test("procijenjena cijena se koristi samo kada prosječna ne postoji", () => {
  const result = calculateWriteOffSlice({ source: { ...source, quantityMilli: BigInt(0), averageCostTenThousand: BigInt(0), costCents: BigInt(0), retailCents: BigInt(0), marginCents: BigInt(0), includedVatCents: BigInt(0) }, quantityMilli: BigInt(2000), fallbackUnitCostTenThousand: BigInt(30000) });
  assert.equal(result.costCents, BigInt(600));
  assert.throws(() => calculateWriteOffSlice({ source: { ...source, averageCostTenThousand: BigInt(0) }, quantityMilli: BigInt(1000) }));
});

test("nulta količina nije dozvoljena", () => {
  assert.throws(() => calculateWriteOffSlice({ source, quantityMilli: BigInt(0) }));
});
