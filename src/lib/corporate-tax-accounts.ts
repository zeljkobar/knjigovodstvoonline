import { corporateTaxFields, taxFail } from "./corporate-tax";

const keys = ["x03", "x04", "x07", "x08", "x09", "x11", "x12", "x13", "x15a", "x15b", "x19", "x20", "x25", "x31", "x49a", "x49b"];
export const taxAccountFields = corporateTaxFields.filter(field => keys.includes(field.key));
export const taxLiabilityRuleKey = "x16_37";
export const taxAccountSettingsFields = [
  ...taxAccountFields.filter(field => parseInt(field.key.slice(1), 10) < 19),
  { key: taxLiabilityRuleKey, label: "16 i 37 — neisplaćene obaveze i isplate duga iz ranijih godina" },
  ...taxAccountFields.filter(field => parseInt(field.key.slice(1), 10) >= 19)
];
export type TaxAccountRule = { key: string; accounts: string; exclude: string; side: "DEBIT" | "CREDIT" };
export const defaultTaxAccountRules = (): TaxAccountRule[] => taxAccountSettingsFields.map(field => ({ key: field.key, accounts: "", exclude: "", side: ["x03", "x31", "x49a", "x49b", taxLiabilityRuleKey].includes(field.key) ? "CREDIT" : "DEBIT" }));
function prefixes(value: unknown): string[] {
  if (typeof value !== "string" || value.length > 1000) taxFail("Neispravan spisak konta.");
  const values = [...new Set(value.split(/[,;\s]+/).filter(Boolean))];
  if (values.length > 100 || values.some(v => !/^\d[\d./-]{0,31}$/.test(v))) taxFail("Konta i prefikse odvojite zarezom, bez formula ili slova.");
  return values;
}
export function parseTaxAccountRules(value: unknown, allowLegacy = false): TaxAccountRule[] {
  if (!Array.isArray(value) || (value.length !== keys.length + 1 && !(allowLegacy && value.length === keys.length))) taxFail("Podešavanja nemaju sve pozicije. Osvježite stranicu.");
  const seen = new Set<string>();
  const rules = value.map(raw => {
    if (!raw || typeof raw !== "object" || typeof raw.key !== "string" || ![...keys, taxLiabilityRuleKey].includes(raw.key) || seen.has(raw.key) || !["DEBIT", "CREDIT"].includes(raw.side)) taxFail("Neispravna pozicija ili smjer konta.");
    seen.add(raw.key);
    const accounts = prefixes(raw.accounts), exclude = prefixes(raw.exclude);
    if (raw.key === taxLiabilityRuleKey && (raw.side !== "CREDIT" || [...accounts, ...exclude].some(code => !code.startsWith("4")))) taxFail("Za pozicije 16 i 37 unesite zajednička konta obaveza klase 4.");
    return { key: raw.key, accounts: accounts.join(", "), exclude: exclude.join(", "), side: raw.side as TaxAccountRule["side"] };
  });
  if (keys.some(key => !seen.has(key))) taxFail("Podešavanja nemaju sve pozicije.");
  return defaultTaxAccountRules().map(rule => rules.find(r => r.key === rule.key) ?? rule);
}
export function taxAccountMatches(rule: TaxAccountRule, code: string) {
  return prefixes(rule.accounts).some(prefix => code.startsWith(prefix)) && !prefixes(rule.exclude).some(prefix => code.startsWith(prefix));
}
type AccountTotal = { code: string; debit: number; credit: number };
function safe(value: number) {
  if (!Number.isSafeInteger(value) || Math.abs(value) > 99999999999999) taxFail("Iznos konta prelazi dozvoljeni opseg.");
  return value;
}
export type TaxLiabilityJournal = { kind: string; reference: string; lines: AccountTotal[] };
export type TaxLiabilityDetail = { code: string; opening: number; accrued: number; paid: number; paidOld: number; paidCurrent: number; remainingOld: number; remainingCurrent: number };

// The opening liability is the user-designated previously disallowed debt. Allocate
// payments oldest-first independently per account; never net one liability against another.
export function calculateTaxLiabilities(rule: TaxAccountRule, journals: TaxLiabilityJournal[]) {
  const balances = new Map<string, { opening: number; accrued: number; paid: number }>();
  const issues = new Set<string>();
  for (const journal of journals) {
    if (journal.kind === "FINAL_ACCOUNT") continue;
    for (const line of journal.lines) { safe(line.debit); safe(line.credit); }
    const selected = journal.lines.filter(line => taxAccountMatches(rule, line.code));
    if (!selected.length) continue;
    const other = journal.lines.filter(line => !taxAccountMatches(rule, line.code) && (line.debit || line.credit));
    // Standard bank/cash journals can contain other payments. A manual payment is
    // also recognised when all counterpart lines are cash/bank accounts (group 24).
    const cash = other.filter(line => line.code.startsWith("24"));
    const payment = journal.kind !== "OPENING_BALANCE" && (["BANK_STATEMENT", "CASH_REGISTER"].includes(journal.kind) || (other.length > 0 && cash.length === other.length));
    if (payment) {
      const debit = selected.reduce((sum, line) => safe(sum + line.debit), 0);
      const credit = selected.reduce((sum, line) => safe(sum + line.credit), 0);
      const cashDebit = cash.reduce((sum, line) => safe(sum + line.debit), 0);
      const cashCredit = cash.reduce((sum, line) => safe(sum + line.credit), 0);
      if ((debit >= 0 ? debit > cashCredit : debit < cashCredit) || (credit >= 0 ? credit > cashDebit : credit < cashDebit)) {
        issues.add(`${journal.reference}: provjerite isplatu ili storno; iznos nije pokriven knjiženjem banke/blagajne.`);
      }
    }
    for (const line of selected) {
      const row = balances.get(line.code) ?? { opening: 0, accrued: 0, paid: 0 };
      if (journal.kind === "OPENING_BALANCE") row.opening = safe(row.opening + line.credit - line.debit);
      else if (payment) row.paid = safe(row.paid + line.debit - line.credit);
      else {
        row.accrued = safe(row.accrued + line.credit - line.debit);
        // A debit adjustment is not evidence of payment, and its original year is
        // unknown. Leave both tax fields manual instead of inventing a deduction.
        if (line.debit) issues.add(`${journal.reference}, konto ${line.code}: dugovno knjiženje nije prepoznato kao isplata. Provjerite storno ili preknjiženje.`);
        if (other.some(counterpart => counterpart.code.startsWith("4") && counterpart.debit)) issues.add(`${journal.reference}, konto ${line.code}: moguće preknjiženje obaveza. Provjerite kojoj godini dug pripada.`);
      }
      balances.set(line.code, row);
    }
  }
  const rows: TaxLiabilityDetail[] = [];
  for (const [code, row] of [...balances].sort(([a], [b]) => a.localeCompare(b))) {
    if (row.opening < 0 || row.accrued < 0 || row.paid < 0 || row.paid > safe(row.opening + row.accrued)) {
      issues.add(`Konto ${code}: provjerite dugovni saldo, avans, povraćaj ili korekciju obaveza.`);
    }
    const paidOld = Math.max(0, Math.min(row.opening, row.paid));
    const paidCurrent = Math.max(0, row.paid - paidOld);
    rows.push({ code, ...row, paidOld, paidCurrent, remainingOld: Math.max(0, row.opening - paidOld), remainingCurrent: Math.max(0, row.accrued - paidCurrent) });
  }
  const total = (key: keyof Omit<TaxLiabilityDetail, "code">) => rows.reduce((sum, row) => safe(sum + row[key]), 0);
  return { rows, issues: [...issues], opening: total("opening"), accrued: total("accrued"), paid: total("paid"),
    paidOld: total("paidOld"), paidCurrent: total("paidCurrent"), remainingOld: total("remainingOld"), remainingCurrent: total("remainingCurrent") };
}

export function calculateTaxAccountInputs(rules: TaxAccountRule[], totals: AccountTotal[], liabilityJournals: TaxLiabilityJournal[] = []) {
  for (const row of totals) { safe(row.debit); safe(row.credit); }
  const revenueCents = Math.max(0, safe(totals.filter(row => row.code.startsWith("6")).reduce((sum, row) => safe(sum + row.credit - row.debit), 0)));
  const inputs: Record<string, number> = {}, details: { key: string; amount: number; expense: number; limit: number | null }[] = [];
  const parsedRules = parseTaxAccountRules(rules);
  for (const rule of parsedRules) {
    if (rule.key === taxLiabilityRuleKey) continue;
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
  const liabilityRule = parsedRules.find(rule => rule.key === taxLiabilityRuleKey)!;
  const liabilities = liabilityRule.accounts ? calculateTaxLiabilities(liabilityRule, liabilityJournals) : null;
  if (liabilities && !liabilities.issues.length) {
    inputs.x16 = liabilities.remainingCurrent; inputs.x37 = liabilities.paidOld;
    details.push({ key: "x16", amount: inputs.x16, expense: liabilities.accrued, limit: null }, { key: "x37", amount: inputs.x37, expense: liabilities.opening, limit: null });
  }
  return { inputs, details, revenueCents, liabilities };
}
