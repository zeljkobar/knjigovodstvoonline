import assert from "node:assert/strict";
import test from "node:test";
import { calculateInventoryCountAdjustment } from "../src/lib/inventory-count";

const book = {
  quantityMilli: BigInt(10000),
  averageCostTenThousand: BigInt(25000),
  costCents: BigInt(2500),
  retailCents: BigInt(4000),
  marginCents: BigInt(1200),
  includedVatCents: BigInt(300)
};

test("manjak skida proporcionalne količinske i vrijednosne komponente", () => {
  const result = calculateInventoryCountAdjustment({ book, actualQuantityMilli: BigInt(6000) });
  assert.equal(result.kind, "SHORTAGE");
  assert.equal(result.differenceMilli, BigInt(-4000));
  assert.equal(result.costCents, BigInt(1000));
  assert.equal(result.retailCents, BigInt(1600));
});

test("višak koristi prosječnu cijenu i postojeću strukturu prodajne vrijednosti", () => {
  const result = calculateInventoryCountAdjustment({ book, actualQuantityMilli: BigInt(12000) });
  assert.equal(result.kind, "SURPLUS");
  assert.equal(result.costCents, BigInt(500));
  assert.equal(result.retailCents, BigInt(800));
  assert.equal(result.includedVatCents, BigInt(60));
});

test("višak na nultom stanju zahtijeva ručnu cijenu", () => {
  const empty = { quantityMilli: BigInt(0), averageCostTenThousand: BigInt(0), costCents: BigInt(0), retailCents: BigInt(0), marginCents: BigInt(0), includedVatCents: BigInt(0) };
  assert.throws(() => calculateInventoryCountAdjustment({ book: empty, actualQuantityMilli: BigInt(1000) }));
  const result = calculateInventoryCountAdjustment({ book: empty, actualQuantityMilli: BigInt(1000), surplusUnitCostTenThousand: BigInt(30000) });
  assert.equal(result.costCents, BigInt(300));
  assert.equal(result.retailCents, BigInt(300));
});

test("jednako stanje nema korekciju", () => {
  const result = calculateInventoryCountAdjustment({ book, actualQuantityMilli: BigInt(10000) });
  assert.equal(result.kind, "NONE");
  assert.equal(result.costCents, BigInt(0));
});
