import assert from "node:assert/strict";
import test from "node:test";
import { calculateSupplierReturn, returnDecimal } from "../src/lib/supplier-return";

const source = { quantityMilli: BigInt(10000), averageCostTenThousand: BigInt(100000), costCents: BigInt(10000), retailCents: BigInt(18150), marginCents: BigInt(5000), includedVatCents: BigInt(3150) };
test("Supplier credit differs from stock cost; retail and wholesale remain balanced", () => {
  for (const retail of [true, false]) for (const deductible of [true, false]) for (const unit of [80000, 100000, 120000]) {
    const a = calculateSupplierReturn({ source, quantity: BigInt(2000), creditPrice: BigInt(unit), vatPercent: BigInt(2100), retail, deductible });
    assert.equal(a.stock.costCents, BigInt(2000));
    assert.equal(a.signed.reduce((s, [, n]) => s + n, BigInt(0)), BigInt(0));
    assert.equal(a.deductible, deductible ? a.vat : BigInt(0));
    assert.equal(a.gross, a.base + a.vat);
  }
});
test("Full stock drains all cents, partial fractions and multiple VAT rates reconcile", () => {
  const small = { ...source, quantityMilli: BigInt(3000), averageCostTenThousand: BigInt(33333), costCents: BigInt(1000), retailCents: BigInt(1999), marginCents: BigInt(652), includedVatCents: BigInt(347) };
  for (const rate of [0, 700, 1500, 2100]) {
    const a = calculateSupplierReturn({ source: small, quantity: BigInt(3000), creditPrice: BigInt(33333), vatPercent: BigInt(rate), retail: true, deductible: true });
    assert.equal(a.stock.costCents, small.costCents);
    assert.equal(a.stock.retailCents, small.retailCents);
    assert.equal(a.signed.reduce((s, [, n]) => s + n, BigInt(0)), BigInt(0));
  }
});
test("Input parser rejects overprecision, negative, exponential and zero amounts", () => {
  assert.equal(returnDecimal("1,235", 3), BigInt(1235));
  for (const raw of ["1.2345", "-1", "1e3", "0", "NaN", "", "100000000000"]) assert.throws(() => returnDecimal(raw, 3));
  assert.throws(() => calculateSupplierReturn({ source, quantity: BigInt(0), creditPrice: BigInt(100), vatPercent: BigInt(2100), retail: true, deductible: true }));
});
test("Retail rounding uses RUC residual and zero-stock fallback stays balanced", () => {
  for (const quantity of [1, 333, 1000, 9999]) {
    const a = calculateSupplierReturn({ source, quantity: BigInt(quantity), creditPrice: BigInt(98765), vatPercent: BigInt(2100), retail: true, deductible: true });
    assert.equal(a.stock.retailCents, a.stock.costCents + a.stock.marginCents + a.stock.includedVatCents);
  }
  const empty = Object.fromEntries(Object.keys(source).map(k => [k, BigInt(0)])) as typeof source;
  const a = calculateSupplierReturn({ source: empty, quantity: BigInt(1000), creditPrice: BigInt(100000), vatPercent: BigInt(0), retail: true, deductible: false });
  assert.equal(a.stock.costCents, BigInt(1000));
  assert.equal(a.stock.retailCents, a.stock.costCents + a.stock.marginCents + a.stock.includedVatCents);
});
