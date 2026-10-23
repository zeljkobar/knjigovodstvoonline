export const advanceInvoicePostingScope = {
  documentType: "ADVANCE_INVOICE",
  subtype: "GENERAL"
} as const;
export const advanceInvoicePostingFields = [
  { purpose: "ADVANCE_CUSTOMER", label: "Kupac — ukupan avans", defaultDirection: "D" },
  { purpose: "ADVANCE_RECEIVED", label: "Primljeni avansi — osnovica", defaultDirection: "P" },
  { purpose: "ADVANCE_OUTPUT_VAT", label: "Izlazni PDV po avansu", defaultDirection: "P" }
] as const;
export const advanceInvoiceRatePurposes = ["ADVANCE_RECEIVED", "ADVANCE_OUTPUT_VAT"];
import { decimalToScaled, scaledToDecimal } from "./inventory-calculation";
import type { InvoicePostingRule } from "./outgoing-invoice";
import type { AdvanceAccountingSnapshot, AdvanceTaxSnapshot } from "./advance-invoice";
export function buildAdvancePostingLines(rules: InvoicePostingRule[], taxes: Array<{
  code: string;
  base: string;
  vat: string;
}>, gross: string) {
  const sums = new Map<InvoicePostingRule, bigint>();
  const add = (purpose: string, rate: string, amount: bigint) => {
    if (!amount)
      return true;
    const rule = rules.find(r => r.namjena === purpose && r.pdv_stopa_sifra === rate) ?? rules.find(r => r.namjena === purpose && r.pdv_stopa_sifra === "GENERAL");
    if (!rule?.sifra_konta || !["D", "P"].includes(rule.smjer))
      return false;
    sums.set(rule, (sums.get(rule) ?? BigInt(0)) + amount);
    return true;
  };
  if (!add("ADVANCE_CUSTOMER", "GENERAL", decimalToScaled(gross, 2)))
    return null;
  for (const tax of taxes)
    if (!add("ADVANCE_RECEIVED", tax.code, decimalToScaled(tax.base, 2)) || !add("ADVANCE_OUTPUT_VAT", tax.code, decimalToScaled(tax.vat, 2)))
      return null;
  const rows = [...sums].map(([rule, amount]) => ({ code: rule.sifra_konta, direction: rule.smjer, amount }));
  return rows.length && rows.reduce((s, r) => s + (r.direction === "D" ? r.amount : -r.amount), BigInt(0)) === BigInt(0) ? rows : null;
}
// Consume fiscal monetary snapshots, never manufacture a rounding remainder.
// A single source VAT rate is unambiguous even when an older API omits line totals.
export function readAdvanceSettlementTaxes(remote: Record<string, unknown>, sourceRates: string[], fallbackDate: string): AdvanceAccountingSnapshot {
  const value = (v: unknown) => {
    if (v === null || v === undefined || !/^-?\d+(\.\d+)?$/.test(String(v)))
      throw new Error("Fiscal API nije vratio potpunu poresku razradu umanjenja.");
    return scaledToDecimal(decimalToScaled(String(v), 2), 2);
  };
  const net = value(remote.totalNetAmount), vat = value(remote.totalVatAmount), gross = value(remote.totalGrossAmount);
  if (decimalToScaled(net, 2) + decimalToScaled(vat, 2) !== decimalToScaled(gross, 2) || decimalToScaled(gross, 2) >= BigInt(0))
    throw new Error("Poreski iznosi umanjenja nijesu usklađeni.");
  const distinct = [...new Set(sourceRates)];
  let taxes: AdvanceTaxSnapshot[] = [];
  if (distinct.length === 1)
    taxes = [{ rate: distinct[0], base: net, vat, gross }];
  else {
    const items = Array.isArray(remote.items) ? remote.items : [];
    const groups = new Map<string, AdvanceTaxSnapshot>();
    for (const item of items) {
      if (!item || typeof item !== "object")
        throw new Error("Nedostaje razrada po stopama.");
      const row = item as Record<string, unknown>;
      const rate = scaledToDecimal(decimalToScaled(String(row.vatRate), 2), 2);
      const base = value(row.totalNetAmount ?? row.netAmount ?? row.lineNetAmount);
      const tax = value(row.totalVatAmount ?? row.vatAmount ?? row.lineVatAmount);
      const total = value(row.totalGrossAmount ?? row.grossAmount ?? row.lineGrossAmount);
      if (!distinct.includes(rate) || decimalToScaled(base, 2) + decimalToScaled(tax, 2) !== decimalToScaled(total, 2) || decimalToScaled(total, 2) >= BigInt(0))
        throw new Error("Neispravna fiskalna razrada po stopama.");
      const old = groups.get(rate);
      groups.set(rate, { rate, base: scaledToDecimal(decimalToScaled(old?.base ?? 0, 2) + decimalToScaled(base, 2), 2), vat: scaledToDecimal(decimalToScaled(old?.vat ?? 0, 2) + decimalToScaled(tax, 2), 2), gross: scaledToDecimal(decimalToScaled(old?.gross ?? 0, 2) + decimalToScaled(total, 2), 2) });
    }
    taxes = [...groups.values()];
  }
  for (const [key, total] of [["base", net], ["vat", vat], ["gross", gross]] as const)
    if (taxes.reduce((s, t) => s + decimalToScaled(t[key], 2), BigInt(0)) !== decimalToScaled(total, 2))
      throw new Error("Fiscal API mora vratiti tačnu poresku razradu svih stopa.");
  return { issueDateTime: typeof remote.issueDateTime === "string" ? remote.issueDateTime : fallbackDate, net, vat, gross, taxes };
}
