export const kifEntryKinds = {
  invoice: "INVOICE",
  pazar: "PAZAR"
} as const;

export const pazarPeriodTypes = {
  daily: "DAILY",
  monthly: "MONTHLY"
} as const;

export const pazarPostingSubtype = "PAZAR";

export const pazarPaymentMethods = {
  cash: "CASH",
  card: "CARD",
  transfer: "TRANSFER",
  other: "OTHER"
} as const;

export const pazarPostingSchemeFields = [
  ["PAZAR_CASH_ACCOUNT", "Gotovina", pazarPaymentMethods.cash],
  ["PAZAR_CARD_ACCOUNT", "Kartice", pazarPaymentMethods.card],
  ["PAZAR_TRANSFER_ACCOUNT", "Virman", pazarPaymentMethods.transfer],
  ["PAZAR_OTHER_ACCOUNT", "Ostalo", pazarPaymentMethods.other]
] as const;

export function isPazarPaymentMethod(value: string) {
  return pazarPostingSchemeFields.some(([, , method]) => method === value);
}

export function pazarPaymentLabel(method: string) {
  return (
    pazarPostingSchemeFields.find(([, , candidate]) => candidate === method)?.[1] ??
    method
  );
}
