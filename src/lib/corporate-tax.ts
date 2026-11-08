import fieldDefinitions from "./corporate-tax-fields.json";

export const corporateTaxRules = "ME_PD_2025_V1";
export const corporateTaxFields = fieldDefinitions;
export const lossKeys = ["pg1_21", "pg1_22", "pg1_23", "pg1_24", "pg1_25", "pg2_21", "pg2_22", "pg2_23", "pg2_24", "pg2_25"];
export const editableTaxKeys = [...corporateTaxFields.filter(f => !f.computed).map(f => f.key), ...lossKeys];
export type CorporateTaxInput = Record<string, number>;
export class CorporateTaxError extends Error {}
export function taxFail(message: string): never { throw new CorporateTaxError(message); }
const maxCents = 99999999999999;
const checked = (value: number) => {
  if (!Number.isSafeInteger(value) || Math.abs(value) > maxCents) taxFail("Iznos ili zbir prelazi dozvoljeni opseg.");
  return value;
};

export function parseTaxMoney(value: unknown): number {
  if (typeof value !== "string") taxFail("Iznose unesite kao decimalni tekst.");
  const raw = value.trim();
  if (!raw) return 0;
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(raw)) taxFail("Unesite nenegativan iznos sa najviše dvije decimale, bez razdvajanja hiljada.");
  const [whole, part = ""] = raw.replace(",", ".").split(".");
  return checked(Number(whole) * 100 + Number(part.padEnd(2, "0")));
}
export function taxDecimal(cents: number) {
  checked(cents);
  const absolute = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}
export function corporateTaxResultFromStatement(rows: ReadonlyArray<{ aop: string | null; tekucaGodina: number }>) {
  // A244 is before tax; A260 includes tax and other comprehensive income.
  const row = rows.find(r => r.aop === "A244");
  if (!row) return null;
  if (!Number.isFinite(row.tekucaGodina)) taxFail("Rezultat bilansa uspjeha nije ispravan.");
  // The existing report service returns EUR numbers. Normalize its result once
  // to two decimal places, then keep all tax calculations in integer cents.
  const amount = parseTaxMoney(Math.abs(row.tekucaGodina).toFixed(2));
  return { x01: row.tekucaGodina > 0 ? amount : 0, x02: row.tekucaGodina < 0 ? amount : 0 };
}
export function corporateTaxAccountingDepreciation(rows: ReadonlyArray<{ aop: string | null; tekucaGodina: number }>) {
  const value = rows.find(row => row.aop === "A210a")?.tekucaGodina;
  return value === undefined || !Number.isFinite(value) || value < 0 ? null : parseTaxMoney(value.toFixed(2));
}
export function corporateTaxDepreciationFromSnapshot(value: unknown, from: string, to: string): number | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as { schema?: number; from?: string; to?: string; result?: { total?: number; extraWriteOff?: number; errors?: unknown[] } };
  const result = snapshot.result;
  if (snapshot.schema !== 1 || snapshot.from !== from || snapshot.to !== to || !result || !Array.isArray(result.errors) || result.errors.length) return null;
  if (![result.total, result.extraWriteOff].every(amount => typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0)) return null;
  const amount = result.total! + result.extraWriteOff!;
  return Number.isSafeInteger(amount) && amount <= maxCents ? amount : null;
}
export function parseCorporateTaxInput(raw: unknown): CorporateTaxInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) taxFail("Podaci prijave nijesu ispravni.");
  for (const key of Object.keys(raw)) if (!editableTaxKeys.includes(key)) taxFail(`Polje ${key} nije dozvoljeno za unos.`);
  return Object.fromEntries(editableTaxKeys.map(key => [key, parseTaxMoney((raw as Record<string, unknown>)[key] ?? "")]));
}

export function calculateCorporateTax(input: CorporateTaxInput) {
  const v: CorporateTaxInput = {};
  for (const key of editableTaxKeys) {
    const value = input[key] ?? 0;
    if (!Number.isSafeInteger(value) || value < 0) taxFail(`Neispravan iznos u polju ${key}.`);
    v[key] = checked(value);
  }
  const sum = (...keys: string[]) => checked(keys.reduce((s, k) => s + (v[k] ?? 0), 0));
  const positive = (value: number) => Math.max(checked(value), 0);
  if (v.x01 && v.x02) taxFail("Dobit i gubitak poslovne godine ne mogu istovremeno biti pozitivni.");
  v.x15 = sum("x15a", "x15b");
  v.x18 = sum("x18a", "x18b", "x18c");
  v.x21 = sum("x21a", "x21b");
  v.x28 = positive(v.x26 - v.x27);
  v.x34 = positive(v.x33 - v.x32);
  const additions = Array.from({ length: 18 }, (_, i) => `x${String(i + 7).padStart(2, "0")}`);
  const result = checked(v.x01 - v.x02 - v.x03 + v.x04 + v.x05 - v.x06 + sum(...additions) - v.x25 + sum("x28", "x29", "x30", "x31", "x34") - sum("x35", "x36", "x37"));
  v.x38 = positive(result); v.x39 = positive(-result);
  v.pg1_1 = v.x38; v.pg1_2 = sum(...lossKeys.slice(0, 5));
  v.pg1_3 = Math.min(v.pg1_1, v.pg1_2); v.x40 = v.pg1_3;
  v.x41 = v.x38 - v.x40;
  // Tax capital gains/losses (42/43) are entered independently of accounting 3/4.
  v.x44 = positive(v.x42 - v.x43); v.x45 = positive(v.x43 - v.x42);
  v.pg2_1 = v.x44; v.pg2_2 = sum(...lossKeys.slice(5));
  v.pg2_3 = Math.min(v.pg2_1, v.pg2_2); v.x46 = v.pg2_3;
  v.x47 = v.x44 - v.x46; v.x48 = sum("x41", "x47");
  v.x49 = sum("x49a", "x49b"); v.x50 = positive(v.x48 - v.x49);
  // Integer rounding to cents at each bracket; no floating currency arithmetic.
  const rate = (cents: number, percent: number) => Number((BigInt(cents) * BigInt(percent) + BigInt(50)) / BigInt(100));
  v.x51 = 0; // Legacy PD XML compatibility field; the three bracket fields carry tax.
  v.x51a = rate(Math.min(v.x50, 10000000), 9);
  v.x51b = rate(Math.min(positive(v.x50 - 10000000), 140000000), 12);
  v.x51c = rate(positive(v.x50 - 150000000), 15);
  v.x52 = sum("x51a", "x51b", "x51c");
  v.x55 = sum("x55a", "x55b", "x55c"); v.x56 = sum("x56a", "x56b");
  v.x57 = checked(v.x52 - sum("x53", "x54", "x55", "x56"));
  if (v.x57 < 0) taxFail("Umanjenja poreza (53–56) prelaze obračunati porez (52). Provjerite odobrene iznose olakšica.");
  v.x59 = positive(v.x57 - v.x58);
  return v;
}

export function assertCorporateTaxYear(year: number) {
  if (!Number.isInteger(year) || year < 2025 || year > 2026) taxFail("Ovaj obrazac je podržan za godine 2025–2026. Za drugu godinu treba provjeriti verziju obrasca i propisa.");
}
export function buildCorporateTaxXml(input: CorporateTaxInput, periodFrom: string, periodTo: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(periodTo) || periodFrom > periodTo) taxFail("Neispravan poreski period.");
  const v = calculateCorporateTax(input);
  const keys = [...corporateTaxFields.map(f => f.key)];
  keys.splice(keys.indexOf("x51a"), 0, "x51");
  const xmlFields = keys.map(key => [`Iznos${key.slice(1).replace(/^0/, "")}`, v[key]] as const);
  for (const group of ["pg1", "pg2"]) for (const suffix of ["1", "2", "21", "22", "23", "24", "25", "3"]) xmlFields.push([`Iznos${group.toUpperCase()}_${suffix}`, v[`${group}_${suffix}`]]);
  return `<?xml version="1.0" encoding="utf-8"?>\n<PD xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n  <PoreskiPeriodOd>${periodFrom}T00:00:00</PoreskiPeriodOd>\n  <PoreskiPeriodDo>${periodTo}T00:00:00</PoreskiPeriodDo>\n${xmlFields.map(([key, amount]) => `  <${key}>${taxDecimal(amount)}</${key}>`).join("\n")}\n</PD>\n`;
}
