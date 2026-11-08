import { corporateTaxFields, taxFail } from "./corporate-tax";

const keys = ["x03", "x04", "x07", "x08", "x09", "x11", "x12", "x13", "x15a", "x15b", "x19", "x20", "x25", "x31", "x49a", "x49b"];
export const taxAccountFields = corporateTaxFields.filter(field => keys.includes(field.key));
export type TaxAccountRule = { key: string; accounts: string; exclude: string; side: "DEBIT" | "CREDIT" };
export const defaultTaxAccountRules = (): TaxAccountRule[] => taxAccountFields.map(field => ({ key: field.key, accounts: "", exclude: "", side: ["x03", "x31", "x49a", "x49b"].includes(field.key) ? "CREDIT" : "DEBIT" }));
function prefixes(value: unknown): string[] {
  if (typeof value !== "string" || value.length > 1000) taxFail("Neispravan spisak konta.");
  const values = [...new Set(value.split(/[,;\s]+/).filter(Boolean))];
  if (values.length > 100 || values.some(v => !/^\d[\d./-]{0,31}$/.test(v))) taxFail("Konta i prefikse odvojite zarezom, bez formula ili slova.");
  return values;
}
export function parseTaxAccountRules(value: unknown): TaxAccountRule[] {
  if (!Array.isArray(value) || value.length !== keys.length) taxFail("Podešavanja nemaju sve pozicije.");
  const seen = new Set<string>();
  const rules = value.map(raw => {
    if (!raw || typeof raw !== "object" || typeof raw.key !== "string" || !keys.includes(raw.key) || seen.has(raw.key) || !["DEBIT", "CREDIT"].includes(raw.side)) taxFail("Neispravna pozicija ili smjer konta.");
    seen.add(raw.key);
    return { key: raw.key, accounts: prefixes(raw.accounts).join(", "), exclude: prefixes(raw.exclude).join(", "), side: raw.side as TaxAccountRule["side"] };
  });
  return defaultTaxAccountRules().map(rule => rules.find(r => r.key === rule.key)!);
}
type AccountTotal = { code: string; debit: number; credit: number };
function safe(value: number) {
  if (!Number.isSafeInteger(value) || Math.abs(value) > 99999999999999) taxFail("Iznos konta prelazi dozvoljeni opseg.");
  return value;
}
export function calculateTaxAccountInputs(rules: TaxAccountRule[], totals: AccountTotal[]) {
  for (const row of totals) { safe(row.debit); safe(row.credit); }
  const revenueCents = Math.max(0, safe(totals.filter(row => row.code.startsWith("6")).reduce((sum, row) => safe(sum + row.credit - row.debit), 0)));
  const inputs: Record<string, number> = {}, details: { key: string; amount: number; expense: number; limit: number | null }[] = [];
  for (const rule of parseTaxAccountRules(rules)) {
    const include = prefixes(rule.accounts), exclude = prefixes(rule.exclude);
    if (!include.length) continue;
    const expense = Math.max(0, safe(totals.filter(row => include.some(p => row.code.startsWith(p)) && !exclude.some(p => row.code.startsWith(p)))
      .reduce((sum, row) => safe(sum + (rule.side === "DEBIT" ? row.debit - row.credit : row.credit - row.debit)), 0)));
    // Whole-cent thresholds, rounded half up: 1% representation, 0.1% memberships.
    const divisor = rule.key === "x19" ? 100 : rule.key === "x20" ? 1000 : null;
    const limit = divisor ? Number((BigInt(revenueCents) + BigInt(divisor / 2)) / BigInt(divisor)) : null;
    const amount = limit === null ? expense : Math.max(0, expense - limit);
    inputs[rule.key] = amount; details.push({ key: rule.key, amount, expense, limit });
  }
  return { inputs, details, revenueCents };
}
