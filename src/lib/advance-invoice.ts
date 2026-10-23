import { decimalToScaled, scaledToDecimal } from "./inventory-calculation";

export class AdvanceWorkflowError extends Error {}
export const advanceType = "ADVANCE";
// Same decimal currency contract as ordinary fiscal invoices; no change of units.
export function advanceAmount(value: string) {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(normalized)) throw new AdvanceWorkflowError("Unesite ispravan iznos avansa, npr. 242,00.");
  return scaledToDecimal(decimalToScaled(normalized, 2), 2);
}
export function advancePayments(invoice: { avansni_racun_id: string | null; iznos_avansa: {toString(): string}; ukupno_sa_pdv: {toString(): string}; nacin_placanja: string }, sourceRemoteId?: string) {
  if (!invoice.avansni_racun_id) return null;
  const applied = decimalToScaled(invoice.iznos_avansa, 2);
  const total = decimalToScaled(invoice.ukupno_sa_pdv, 2);
  if (!sourceRemoteId || applied <= BigInt(0) || applied > total || invoice.nacin_placanja !== "BANK_TRANSFER") throw new AdvanceWorkflowError("Provjerite iznos avansa i bankovni ostatak konačnog računa.");
  return [{ paymentType: "Advance", amount: Number(scaledToDecimal(applied, 2)), advanceInvoiceId: sourceRemoteId },
    ...(total > applied ? [{ paymentType: "BankAccount", amount: Number(scaledToDecimal(total - applied, 2)) }] : [])];
}
export type AdvanceSettlement = {
  key: string; issueDateTime: string; allocations: Array<{advanceItemId: string; grossAmount: number}>;
  remoteId?: string; status?: string; officialInvoiceNumber?: string | null; iic?: string | null; jikr?: string | null;
  qrCodeData?: string | null; error?: string; claimedAt?: string;
  localInvoiceId?: string; accountingError?: string; accountingSnapshot?: AdvanceAccountingSnapshot;
};
export function settlementState(value: unknown): AdvanceSettlement | null {
  if (!value || typeof value !== "object" || !("key" in value) || !("allocations" in value)) return null;
  return value as AdvanceSettlement;
}

export type AdvanceTaxSnapshot = { rate: string; base: string; vat: string; gross: string };
export type AdvanceAccountingSnapshot = { issueDateTime: string; net: string; vat: string; gross: string; taxes: AdvanceTaxSnapshot[] };
