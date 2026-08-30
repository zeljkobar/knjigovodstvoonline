import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedPayrollPeriod,
  calculateAutomaticPayrollHours,
  employeeMonthlyScheduledHours,
  employmentOverlapsPayrollPeriod,
  isPayrollPeriodAllowed
} from "../src/lib/payroll-hours";

const calculationPeriod = {
  calculationFrom: "2026-07-01",
  calculationTo: "2026-07-31"
};

test("period radnika se presijeca datumom početka i prestanka", () => {
  assert.deepEqual(
    allowedPayrollPeriod({
      ...calculationPeriod,
      employmentFrom: "2026-07-17"
    }),
    { from: "2026-07-17", to: "2026-07-31" }
  );
  assert.deepEqual(
    allowedPayrollPeriod({
      ...calculationPeriod,
      employmentFrom: "2026-07-20",
      employmentTo: "2026-07-24"
    }),
    { from: "2026-07-20", to: "2026-07-24" }
  );
});

test("radnik van mjeseca ne ulazi u obračun", () => {
  assert.equal(
    employmentOverlapsPayrollPeriod({
      ...calculationPeriod,
      employmentFrom: "2026-08-01"
    }),
    false
  );
  assert.equal(
    employmentOverlapsPayrollPeriod({
      ...calculationPeriod,
      employmentTo: "2026-06-30"
    }),
    false
  );
});

test("automatski sati se proporcionalno računaju iz mjesečnog fonda", () => {
  assert.equal(
    calculateAutomaticPayrollHours({
      ...calculationPeriod,
      periodFrom: "2026-07-17",
      periodTo: "2026-07-31",
      monthlyScheduledHours: 176
    }),
    84
  );
  assert.equal(
    calculateAutomaticPayrollHours({
      ...calculationPeriod,
      periodFrom: "2026-07-20",
      periodTo: "2026-07-24",
      monthlyScheduledHours: 176
    }),
    38
  );
});

test("mjesečni sati radnika imaju prednost nad procentom radnog vremena", () => {
  assert.equal(
    employeeMonthlyScheduledHours({
      calculationFundHours: 176,
      employeeMonthlyHours: 120,
      employmentPercentage: 50
    }),
    120
  );
  assert.equal(
    employeeMonthlyScheduledHours({
      calculationFundHours: 176,
      employmentPercentage: 50
    }),
    88
  );
});

test("server odbija period prije zaposlenja ili van mjeseca", () => {
  const allowed = { from: "2026-07-17", to: "2026-07-31" };

  assert.equal(
    isPayrollPeriodAllowed({ from: "2026-07-17", to: "2026-07-31", allowed }),
    true
  );
  assert.equal(
    isPayrollPeriodAllowed({ from: "2026-07-01", to: "2026-07-31", allowed }),
    false
  );
  assert.equal(
    isPayrollPeriodAllowed({ from: "2026-07-25", to: "2026-07-20", allowed }),
    false
  );
});
