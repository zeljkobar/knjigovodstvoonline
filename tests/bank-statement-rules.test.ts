import assert from "node:assert/strict";
import test from "node:test";
import {
  bankStatementLineBlockers,
  bankStatementAmountBlockers,
  bankStatementAmountsReady,
  bestBankStatementRuleForLine,
  type BankStatementRuleMatchInput
} from "../src/lib/bank-statement-rules";

type TestRule = BankStatementRuleMatchInput & {
  id: string;
};

test("spremnost izvoda provjerava oba zbira i smjer, a ne samo oznake READY", () => {
  const statement = { opening_balance: "10.00", total_inflow: "0.30", total_outflow: "0.20", closing_balance: "10.10", lines: [
    { line_number: 1, direction: "INFLOW", inflow_amount: "0.10", outflow_amount: "0", posting_status: "READY" },
    { line_number: 2, direction: "INFLOW", inflow_amount: "0.20", outflow_amount: "0", posting_status: "READY" },
    { line_number: 3, direction: "OUTFLOW", inflow_amount: "0", outflow_amount: "0.20", posting_status: "READY" }
  ] };
  assert.equal(bankStatementAmountsReady(statement), true);
  assert.deepEqual(bankStatementAmountBlockers(statement), []);
  const commission = { ...statement, lines: statement.lines.map((line, index) => index === 2 ? { ...line, inflow_amount: "0.36" } : line) };
  assert.equal(bankStatementAmountsReady(commission), false);
  assert.match(bankStatementAmountBlockers(commission).join(" "), /smjer.*Zbir priliva.*0,66.*0,30/);
  const wrongDirection = { ...statement, lines: statement.lines.map((line, index) => index === 0 ? { ...line, direction: "OUTFLOW" } : line) };
  assert.equal(bankStatementAmountsReady(wrongDirection), false);
  assert.equal(bankStatementAmountsReady({ ...statement, lines: statement.lines.map(line => ({ ...line, posting_status: "IGNORED" })) }), false);
  assert.equal(bankStatementAmountsReady({ ...statement, total_inflow: "1.00" }), false);
  assert.equal(bankStatementAmountsReady({ ...statement, opening_balance: null }), false);
  assert.equal(bankStatementAmountsReady({ ...statement, lines: [] }), false);
  assert.equal(bankStatementAmountsReady({ ...statement, lines: statement.lines.map(line => ({ ...line, posting_status: "NEEDS_REVIEW" })) }), false);
});

function rule(overrides: Partial<TestRule> & Pick<TestRule, "id">): TestRule {
  return {
    firma_id: "firma-1",
    direction: "OUTFLOW",
    auto_apply: true,
    counterparty_account_number_normalized: null,
    description_contains: null,
    reference_contains: null,
    payment_code: null,
    priority: 10,
    times_used: 0,
    ...overrides
  };
}

test("M02 pravilo važi za karticu bez obzira na trgovca i nedostatak žiro računa", () => {
  const matched = bestBankStatementRuleForLine(
    [rule({ id: "m02", payment_code: "M02" })],
    "OUTFLOW",
    {
      description: "POS kupovina kod proizvoljnog trgovca",
      normalizedAccountNumber: null,
      paymentCode: "02"
    },
    "firma-1"
  );

  assert.equal(matched?.id, "m02");
});

test("pravilo po žiro računu ne zavisi od rednog broja, opisa ili šifre plaćanja", () => {
  const matched = bestBankStatementRuleForLine(
    [
      rule({
        id: "bank-account",
        direction: "INFLOW",
        counterparty_account_number_normalized: "53000000001922456"
      })
    ],
    "INFLOW",
    {
      description: "36 - Uplata robe · potpuno novi opis",
      normalizedAccountNumber: "53000000001922456",
      paymentCode: "120"
    },
    "firma-1"
  );

  assert.equal(matched?.id, "bank-account");
});

test("pravilo firme ima prednost nad agencijskim pravilom", () => {
  const matched = bestBankStatementRuleForLine(
    [
      rule({
        id: "agency",
        firma_id: null,
        payment_code: "121",
        priority: 100,
        times_used: 50
      }),
      rule({
        id: "firm",
        firma_id: "firma-1",
        payment_code: "121",
        priority: 1
      })
    ],
    "OUTFLOW",
    {
      description: "Plaćanje dobavljaču",
      normalizedAccountNumber: null,
      paymentCode: "121"
    },
    "firma-1"
  );

  assert.equal(matched?.id, "firm");
});

test("analitičko konto bez partnera jasno blokira knjiženje", () => {
  assert.deepEqual(
    bankStatementLineBlockers({
      lineNumber: 4,
      ignored: false,
      postingStatus: "NEEDS_REVIEW",
      accountCode: "4290",
      accountRequiresPartner: true,
      partnerId: null
    }),
    ["Stavka 4: partner je obavezan za analitički konto 4290."]
  );

  assert.deepEqual(
    bankStatementLineBlockers({
      lineNumber: 4,
      ignored: false,
      postingStatus: "READY",
      accountCode: "4290",
      accountRequiresPartner: true,
      partnerId: "partner-1"
    }),
    []
  );
});

test("neanalitičko konto može biti spremno bez partnera", () => {
  assert.deepEqual(
    bankStatementLineBlockers({
      lineNumber: 1,
      ignored: false,
      postingStatus: "READY",
      accountCode: "2422",
      accountRequiresPartner: false,
      partnerId: null
    }),
    []
  );
});
