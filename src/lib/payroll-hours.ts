export type PayrollDateValue = Date | string;

type PayrollPeriod = {
  from: string;
  to: string;
};

function parseDateKey(value: PayrollDateValue | null | undefined) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }

    return value.toISOString().slice(0, 10);
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (!match) {
    return null;
  }

  const key = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${key}T00:00:00.000Z`);

  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== key
    ? null
    : key;
}

function laterDate(left: string, right: string) {
  return left > right ? left : right;
}

function earlierDate(left: string, right: string) {
  return left < right ? left : right;
}

export function payrollDateInputValue(value: PayrollDateValue | null | undefined) {
  return parseDateKey(value) ?? "";
}

export function allowedPayrollPeriod({
  calculationFrom,
  calculationTo,
  employmentFrom,
  employmentTo
}: {
  calculationFrom: PayrollDateValue;
  calculationTo: PayrollDateValue;
  employmentFrom?: PayrollDateValue | null;
  employmentTo?: PayrollDateValue | null;
}): PayrollPeriod | null {
  const calculationFromKey = parseDateKey(calculationFrom);
  const calculationToKey = parseDateKey(calculationTo);
  const employmentFromKey = parseDateKey(employmentFrom);
  const employmentToKey = parseDateKey(employmentTo);

  if (!calculationFromKey || !calculationToKey || calculationFromKey > calculationToKey) {
    return null;
  }

  const from = employmentFromKey
    ? laterDate(calculationFromKey, employmentFromKey)
    : calculationFromKey;
  const to = employmentToKey
    ? earlierDate(calculationToKey, employmentToKey)
    : calculationToKey;

  return from <= to ? { from, to } : null;
}

export function normalizePayrollPeriod({
  requestedFrom,
  requestedTo,
  allowed
}: {
  requestedFrom?: PayrollDateValue | null;
  requestedTo?: PayrollDateValue | null;
  allowed: PayrollPeriod;
}): PayrollPeriod {
  const requestedFromKey = parseDateKey(requestedFrom);
  const requestedToKey = parseDateKey(requestedTo);
  const from = requestedFromKey
    ? laterDate(allowed.from, earlierDate(requestedFromKey, allowed.to))
    : allowed.from;
  const to = requestedToKey
    ? earlierDate(allowed.to, laterDate(requestedToKey, allowed.from))
    : allowed.to;

  return from <= to ? { from, to } : allowed;
}

export function isPayrollPeriodAllowed({
  from,
  to,
  allowed
}: {
  from: PayrollDateValue | null | undefined;
  to: PayrollDateValue | null | undefined;
  allowed: PayrollPeriod;
}) {
  const fromKey = parseDateKey(from);
  const toKey = parseDateKey(to);

  return Boolean(
    fromKey &&
      toKey &&
      fromKey <= toKey &&
      fromKey >= allowed.from &&
      toKey <= allowed.to
  );
}

export function employmentOverlapsPayrollPeriod({
  calculationFrom,
  calculationTo,
  employmentFrom,
  employmentTo
}: {
  calculationFrom: PayrollDateValue;
  calculationTo: PayrollDateValue;
  employmentFrom?: PayrollDateValue | null;
  employmentTo?: PayrollDateValue | null;
}) {
  return Boolean(
    allowedPayrollPeriod({
      calculationFrom,
      calculationTo,
      employmentFrom,
      employmentTo
    })
  );
}

export function countWeekdays(
  fromValue: PayrollDateValue,
  toValue: PayrollDateValue
) {
  const from = parseDateKey(fromValue);
  const to = parseDateKey(toValue);

  if (!from || !to || from > to) {
    return 0;
  }

  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  let weekdays = 0;

  while (cursor <= end) {
    const day = cursor.getUTCDay();

    if (day !== 0 && day !== 6) {
      weekdays += 1;
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return weekdays;
}

export function calculateAutomaticPayrollHours({
  calculationFrom,
  calculationTo,
  periodFrom,
  periodTo,
  monthlyScheduledHours
}: {
  calculationFrom: PayrollDateValue;
  calculationTo: PayrollDateValue;
  periodFrom: PayrollDateValue;
  periodTo: PayrollDateValue;
  monthlyScheduledHours: number;
}) {
  const monthWeekdays = countWeekdays(calculationFrom, calculationTo);
  const periodWeekdays = countWeekdays(periodFrom, periodTo);

  if (monthWeekdays === 0 || periodWeekdays === 0 || monthlyScheduledHours <= 0) {
    return 0;
  }

  return Math.round((monthlyScheduledHours * periodWeekdays) / monthWeekdays);
}

export function employeeMonthlyScheduledHours({
  calculationFundHours,
  employeeMonthlyHours,
  employmentPercentage
}: {
  calculationFundHours: number;
  employeeMonthlyHours?: number | null;
  employmentPercentage?: number | null;
}) {
  if (employeeMonthlyHours && employeeMonthlyHours > 0) {
    return employeeMonthlyHours;
  }

  const percentage = Number.isFinite(employmentPercentage)
    ? Math.max(0, employmentPercentage ?? 100)
    : 100;

  return Math.round(calculationFundHours * (percentage / 100));
}
