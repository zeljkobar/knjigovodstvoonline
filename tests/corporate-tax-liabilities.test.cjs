/* eslint-disable @typescript-eslint/no-require-imports -- Pure liability allocation regression. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sourceLoader } = require('./helpers/source-loader.cjs');
const t = sourceLoader()('src/lib/corporate-tax-accounts.ts');
const rules = (accounts = '450, 451', exclude = '') => t.defaultTaxAccountRules().map(rule => rule.key === t.taxLiabilityRuleKey ? { ...rule, accounts, exclude } : rule);
const line = (code, debit = 0, credit = 0) => ({ code, debit, credit });
const journal = (kind, ...lines) => ({ kind, reference: `${kind}-1`, lines });
const opening = (amount, code = '4500') => journal('OPENING_BALANCE', line(code, 0, amount), line('1000', amount));
const accrual = (amount, code = '4500') => journal('PAYROLL', line(code, 0, amount), line('5200', amount));
const payment = (amount, code = '4500', kind = 'BANK_STATEMENT') => journal(kind, line(code, amount), line('2410', 0, amount));
const calc = (journals, accounts, exclude) => t.calculateTaxAccountInputs(rules(accounts, exclude), [], journals);

test('one shared rule; legacy settings load without changing old mappings, writes require new shape', () => {
  const current = rules();
  assert.equal(current.filter(rule => rule.key === t.taxLiabilityRuleKey).length, 1);
  assert(!current.some(rule => ['x16', 'x37'].includes(rule.key)));
  const legacy = current.filter(rule => rule.key !== t.taxLiabilityRuleKey);
  assert.equal(t.parseTaxAccountRules(legacy, true).find(rule => rule.key === t.taxLiabilityRuleKey).accounts, '');
  assert.throws(() => t.parseTaxAccountRules(legacy));
  for (const key of ['x16', 'x37']) assert.throws(() => t.parseTaxAccountRules(current.map(rule => rule.key === t.taxLiabilityRuleKey ? { ...rule, key } : rule)));
  assert.throws(() => t.parseTaxAccountRules(rules('520')));
  assert.throws(() => t.parseTaxAccountRules(current.map(rule => rule.key === t.taxLiabilityRuleKey ? { ...rule, side: 'DEBIT' } : rule)));
  const result = t.calculateTaxAccountInputs(t.defaultTaxAccountRules(), []);
  assert.equal(result.liabilities, null);
  assert(!Object.hasOwn(result.inputs, 'x16')); assert(!Object.hasOwn(result.inputs, 'x37'));
  assert.equal(calc([], ' , ; ').liabilities, null);
});

test('paid opening debt goes to 37; only unpaid current accrual goes to 16, in cents', () => {
  const result = calc([opening(1000000), accrual(6000000), payment(6400000)]);
  assert.deepEqual(result.inputs, { x16: 600000, x37: 1000000 });
  assert.deepEqual(result.liabilities.issues, []);
  assert.equal(result.liabilities.paidCurrent, 5400000);
  assert.equal(result.liabilities.remainingOld, 0);
  assert.equal(result.liabilities.rows[0].opening, 1000000);
  const cents = calc([opening(101), accrual(203), payment(152)]);
  assert.deepEqual(cents.inputs, { x16: 152, x37: 101 });
});

test('partial/no old-debt payment never counts the remaining old debt again in 16', () => {
  const partial = calc([opening(1000000), accrual(6000000), payment(600000)]);
  assert.deepEqual(partial.inputs, { x16: 6000000, x37: 600000 });
  assert.equal(partial.liabilities.remainingOld, 400000);
  assert.deepEqual(calc([opening(1000000), accrual(6000000)]).inputs, { x16: 6000000, x37: 0 });
  assert.deepEqual(calc([opening(1000000), payment(1000000)]).inputs, { x16: 0, x37: 1000000 });
});

test('no opening debt, zero activity and full settlement are valid zeroes', () => {
  assert.deepEqual(calc([accrual(10000), payment(4000)]).inputs, { x16: 6000, x37: 0 });
  assert.deepEqual(calc([accrual(10000), payment(10000)]).inputs, { x16: 0, x37: 0 });
  assert.deepEqual(calc([]).inputs, { x16: 0, x37: 0 });
});

test('opening debit and credit are netted as opening balance, never classified as a payment', () => {
  const result = calc([journal('OPENING_BALANCE', line('4500', 1000), line('4500', 0, 3000), line('2410', 2000)), payment(1000)]);
  assert.deepEqual(result.liabilities.issues, []);
  assert.deepEqual(result.inputs, { x16: 0, x37: 1000 });
  assert.equal(result.liabilities.remainingOld, 1000);
});

test('payments cannot settle old debt on a different account, even under the same prefix', () => {
  const result = calc([opening(10000, '4500'), accrual(10000, '4501'), payment(10000, '4501')]);
  assert.deepEqual(result.inputs, { x16: 0, x37: 0 });
  assert.equal(result.liabilities.remainingOld, 10000);
  assert.equal(result.liabilities.paidCurrent, 10000);
});

test('overlapping prefixes count once, exclusions work and final journals are excluded', () => {
  const result = calc([opening(10000), accrual(20000), payment(15000), opening(99999, '4510'), payment(99999, '4510'),
    journal('FINAL_ACCOUNT', line('4500', 999999), line('1000', 0, 999999))], '45, 450, 4500', '451');
  assert.deepEqual(result.inputs, { x16: 15000, x37: 10000 });
  assert.equal(result.liabilities.rows.length, 1);
});

test('manual bank/cash payments and bank refunds/reversals are recognised, negative credit corrects accrual', () => {
  const result = calc([opening(10000), accrual(20000), accrual(-2000), payment(18000, '4500', 'MANUAL'),
    journal('BANK_STATEMENT', line('4500', 0, 1000), line('2410', 1000)), payment(-2000)]);
  assert.deepEqual(result.liabilities.issues, []);
  assert.deepEqual(result.inputs, { x16: 13000, x37: 10000 });
  assert.equal(result.liabilities.paid, 15000);
  assert.deepEqual(calc([accrual(1000), payment(600, '4500', 'CASH_REGISTER')]).inputs, { x16: 400, x37: 0 });
});

test('non-cash debit adjustments and transfers do not create a tax deduction', () => {
  for (const adjustment of [journal('CORRECTION', line('4500', 1000), line('5200', 0, 1000)),
    journal('MANUAL', line('4500', 0, 1000), line('4600', 1000)),
    journal('BANK_STATEMENT', line('4500', 1000), line('4600', 0, 1000))]) {
    const result = calc([opening(5000), accrual(10000), adjustment]);
    assert(result.liabilities.issues.length);
    assert(!Object.hasOwn(result.inputs, 'x16')); assert(!Object.hasOwn(result.inputs, 'x37'));
  }
});

test('advance/debit opening, overpayments and invalid amounts require review', () => {
  for (const journals of [[opening(-100)], [accrual(100), payment(200)], [accrual(-100)], [payment(-100)]]) {
    const result = calc(journals);
    assert(result.liabilities.issues.length); assert.deepEqual(result.inputs, {});
  }
  assert.throws(() => calc([accrual(1.5)]));
  assert.throws(() => calc([opening(Number.MAX_SAFE_INTEGER)]));
});
