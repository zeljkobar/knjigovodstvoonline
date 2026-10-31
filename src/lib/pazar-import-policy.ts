import { parseScaledInteger } from "./inventory-calculation";

export const fiscalPortalLabels = { VG_EFISKAL: "VG eFiskal", SUMMA_FISKAL: "Summa Fiskal" } as const;
export type FiscalPortalProvider = keyof typeof fiscalPortalLabels;
export type PazarDevice = { id: string; label: string; businessUnitId?: string | null };
export type PazarReport = {
  pib: string; from: string; to: string; device: PazarDevice; total: number;
  taxes: Array<{ rate: string; base: number; vat: number; code?: string }>;
  payments: Array<{ method: string; amount: number }>;
};
export class PazarImportError extends Error {}
export function reportCents(value: unknown) {
  const parsed = parseScaledInteger(String(value ?? "0"), 2);
  if (parsed === null) throw new PazarImportError("Iznos u izvještaju nije ispravan.");
  const result = Number(parsed);
  if (!Number.isSafeInteger(result)) throw new PazarImportError("Iznos u izvještaju nije ispravan.");
  return result;
}
export function pazarDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new PazarImportError("Neispravan datum izvještaja.");
  return date;
}
export function pazarImportPeriod(from: string, to: string, year: number, month: number) {
  const start = pazarDate(from), end = pazarDate(to);
  if (start > end || start.getUTCFullYear() !== year || end.getUTCFullYear() !== year || start.getUTCMonth() + 1 !== month || end.getUTCMonth() + 1 !== month) throw new PazarImportError("Period mora biti unutar mjeseca otvorene KIF knjige.");
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start, end, type: from === to ? "DAILY" : from.endsWith("-01") && to === last ? "MONTHLY" : "RANGE" };
}
export function validatePazarReport(report: PazarReport, expected: { pib: string; from: string; to: string }) {
  if (report.pib !== expected.pib) throw new PazarImportError("PIB na izvještaju ne odgovara aktivnoj firmi. Provjerite nalog fiskalnog portala.");
  if (report.from !== expected.from || report.to !== expected.to) throw new PazarImportError("Period preuzetog izvještaja ne odgovara traženom periodu.");
  const values = [report.total, ...report.taxes.flatMap(t => [t.base, t.vat]), ...report.payments.map(p => p.amount)];
  if (values.some(v => !Number.isSafeInteger(v))) throw new PazarImportError("Izvještaj sadrži neispravne iznose.");
  if (report.total < 0) throw new PazarImportError("Izvještaj ima negativan neto promet. Potrebna je posebna obrada povrata.");
  if (report.taxes.reduce((s, t) => s + t.base + t.vat, 0) !== report.total || report.payments.reduce((s, p) => s + p.amount, 0) !== report.total) throw new PazarImportError("Zbir osnovica, PDV-a ili načina naplate ne odgovara ukupnom prometu izvještaja.");
  if (report.taxes.some(t => !Number.isFinite(Number(t.rate)) || Number(t.rate) < 0 || (Number(t.rate) === 0 && t.vat !== 0))) throw new PazarImportError("Neispravna poreska razrada izvještaja.");
  return report;
}
export function pazarInput(cents: number) { return (cents / 100).toFixed(2).replace(".", ","); }
export function importedCashRegister(provider: string, device: PazarDevice) {
  return `${provider === "VG_EFISKAL" ? "VG" : "SUMMA"} · ${device.label} [${device.id}]`.replace(/\s+/g, " ").toUpperCase();
}
