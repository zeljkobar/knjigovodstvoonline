export const vatTransactionTypes = {
  domestic: "DOMESTIC",
  import: "IMPORT",
  export: "EXPORT",
  exempt: "EXEMPT",
  nonTaxable: "NON_TAXABLE"
} as const;

export type VatTransactionType =
  (typeof vatTransactionTypes)[keyof typeof vatTransactionTypes];

export const vatTransactionLabels: Record<VatTransactionType, string> = {
  DOMESTIC: "Domaći promet",
  IMPORT: "Uvoz",
  EXPORT: "Izvoz",
  EXEMPT: "Oslobođeno",
  NON_TAXABLE: "Van PDV-a"
};

const kufTypes = [
  vatTransactionTypes.domestic,
  vatTransactionTypes.import,
  vatTransactionTypes.exempt,
  vatTransactionTypes.nonTaxable
] as const;

const kifTypes = [
  vatTransactionTypes.domestic,
  vatTransactionTypes.export,
  vatTransactionTypes.exempt,
  vatTransactionTypes.nonTaxable
] as const;

export function vatTransactionOptions(documentType: "KUF" | "KIF") {
  return documentType === "KUF" ? kufTypes : kifTypes;
}

export function isVatTransactionType(value: string): value is VatTransactionType {
  return Object.values(vatTransactionTypes).includes(value as VatTransactionType);
}

export function normalizeVatTransactionType(
  value: string,
  documentType: "KUF" | "KIF",
  partnerIsForeign = false
) {
  const upperValue = value.trim().toUpperCase();
  const allowed: readonly VatTransactionType[] = vatTransactionOptions(documentType);

  if (isVatTransactionType(upperValue) && allowed.includes(upperValue)) {
    return upperValue;
  }

  if (partnerIsForeign) {
    return documentType === "KUF" ? vatTransactionTypes.import : vatTransactionTypes.export;
  }

  return vatTransactionTypes.domestic;
}
