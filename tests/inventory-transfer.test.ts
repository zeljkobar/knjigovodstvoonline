import assert from "node:assert/strict";
import test from "node:test";
import { calculateTransferSlice } from "../src/lib/inventory-transfer";

test("djelimični prenos koristi prosječnu cijenu i proporcionalne robne vrijednosti", () => {
  const result = calculateTransferSlice(
    {
      quantityMilli: BigInt(10000),
      averageCostTenThousand: BigInt(25000),
      costCents: BigInt(2500),
      retailCents: BigInt(4000),
      marginCents: BigInt(1200),
      includedVatCents: BigInt(300)
    },
    BigInt(4000)
  );

  assert.equal(result.costCents, BigInt(1000));
  assert.equal(result.unitCostTenThousand, BigInt(25000));
  assert.equal(result.retailCents, BigInt(1600));
  assert.equal(result.marginCents, BigInt(480));
  assert.equal(result.includedVatCents, BigInt(120));
});

test("prenos cijelog stanja prenosi tačne vrijednosti bez ostatka od zaokruživanja", () => {
  const result = calculateTransferSlice(
    {
      quantityMilli: BigInt(3000),
      averageCostTenThousand: BigInt(33300),
      costCents: BigInt(999),
      retailCents: BigInt(1500),
      marginCents: BigInt(400),
      includedVatCents: BigInt(101)
    },
    BigInt(3000)
  );

  assert.equal(result.costCents, BigInt(999));
  assert.equal(result.retailCents, BigInt(1500));
  assert.equal(result.marginCents, BigInt(400));
  assert.equal(result.includedVatCents, BigInt(101));
});

test("nulta količina nije dozvoljena", () => {
  assert.throws(() =>
    calculateTransferSlice(
      {
        quantityMilli: BigInt(1000),
        averageCostTenThousand: BigInt(10000),
        costCents: BigInt(100),
        retailCents: BigInt(0),
        marginCents: BigInt(0),
        includedVatCents: BigInt(0)
      },
      BigInt(0)
    )
  );
});
