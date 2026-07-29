export const inventoryModule = "robno";

export const itemPriceTypes = {
  purchase: "NABAVNA",
  wholesale: "VELEPRODAJNA",
  retail: "MALOPRODAJNA",
  promotional: "AKCIJSKA",
  customer: "PO_KUPCU",
  warehouse: "PO_MAGACINU"
} as const;

export const initialItemPriceTypes = [
  {
    value: itemPriceTypes.wholesale,
    label: "Veleprodajna"
  },
  {
    value: itemPriceTypes.retail,
    label: "Maloprodajna"
  }
] as const;

export function itemPriceTypeLabel(value: string) {
  const labels: Record<string, string> = {
    [itemPriceTypes.purchase]: "Nabavna",
    [itemPriceTypes.wholesale]: "Veleprodajna",
    [itemPriceTypes.retail]: "Maloprodajna",
    [itemPriceTypes.promotional]: "Akcijska",
    [itemPriceTypes.customer]: "Po kupcu",
    [itemPriceTypes.warehouse]: "Po magacinu"
  };

  return labels[value] ?? value;
}

export function normalizeInventoryCode(value: string) {
  return value.trim().toUpperCase();
}

export function parseInventoryMoneyToCents(value: FormDataEntryValue | string | null) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:[.,]|$))/g, "")
    .replace(",", ".");

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.round(parsed * 100);
}

export function inventoryCentsToDecimal(cents: number) {
  return (cents / 100).toFixed(2);
}

export function calculateItemPriceAmounts(
  inputType: "BEZ_PDV" | "SA_PDV",
  inputCents: number,
  vatPercent: number
) {
  const safePercent = Number.isFinite(vatPercent) && vatPercent >= 0 ? vatPercent : 0;

  if (inputType === "SA_PDV") {
    const netCents = Math.round(inputCents / (1 + safePercent / 100));

    return {
      netCents,
      grossCents: inputCents
    };
  }

  const vatCents = Math.round((inputCents * safePercent) / 100);

  return {
    netCents: inputCents,
    grossCents: inputCents + vatCents
  };
}

