export type PayrollCopyMonth = { key: string; year: number; month: number; from: Date; to: Date };

export function payrollCopyMonth(value: string): PayrollCopyMonth | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  const [year, month] = value.split("-").map(Number);
  if (year < 2000 || year > 2199) return null;
  return { key: value, year, month, from: new Date(Date.UTC(year, month - 1, 1)), to: new Date(Date.UTC(year, month, 0)) };
}

// Keep month offsets (e.g. payment in the following month) and clamp month ends.
export function shiftPayrollCopyDate(date: Date, source: PayrollCopyMonth, target: PayrollCopyMonth) {
  const offset = (date.getUTCFullYear() - source.year) * 12 + date.getUTCMonth() - (source.month - 1);
  const first = new Date(Date.UTC(target.year, target.month - 1 + offset, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const sourceLast = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), date.getUTCDate() === sourceLast ? last.getUTCDate() : Math.min(date.getUTCDate(), last.getUTCDate())));
}
