import { roundDivision } from "./inventory-calculation";

export const inventoryPriceAdjustmentStatuses = {
  draft: "DRAFT",
  posted: "POSTED",
  deleted: "DELETED"
} as const;

export const inventoryPriceAdjustmentPostingScope = {
  documentType: "PRICE_ADJUSTMENT",
  subtype: "RETAIL",
  vatRate: "GENERAL"
} as const;

export const inventoryPriceAdjustmentPostingFields = [
  {
    purpose: "PRICE_ADJUSTMENT_INVENTORY",
    label: "Roba u maloprodaji",
    defaultDirection: "D",
    description: "Kod povećanja cijene zadužuje se za rast maloprodajne vrijednosti; kod smanjenja smjer se automatski obrće."
  },
  {
    purpose: "PRICE_ADJUSTMENT_MARGIN",
    label: "Razlika u cijeni",
    defaultDirection: "P",
    description: "Kod povećanja cijene odobrava se za rast razlike u cijeni; kod smanjenja smjer se automatski obrće."
  },
  {
    purpose: "PRICE_ADJUSTMENT_INCLUDED_VAT",
    label: "Ukalkulisani PDV",
    defaultDirection: "P",
    description: "Kod povećanja cijene odobrava se za rast ukalkulisanog PDV-a; kod smanjenja smjer se automatski obrće."
  }
] as const;

export function inventoryPriceAdjustmentStatusLabel(status: string) {
  return ({ DRAFT: "Nacrt", POSTED: "Proknjižena", DELETED: "Obrisana" }[status] ?? status);
}

export function inventoryPriceAdjustmentNumber(year: number, number: number) {
  return `NIV-${year}-${String(number).padStart(4, "0")}`;
}

export type PriceAdjustmentStockValues = {
  quantityMilli: bigint;
  costCents: bigint;
  retailCents: bigint;
  marginCents: bigint;
  includedVatCents: bigint;
};

export function calculatePriceAdjustment(input: {
  stock: PriceAdjustmentStockValues;
  vatPercentHundred: bigint;
  newGrossUnitCents: bigint;
}) {
  if (input.stock.quantityMilli <= BigInt(0)) throw new Error("Nivelacija zahtijeva pozitivno stanje.");
  if (input.stock.retailCents <= BigInt(0)) throw new Error("Stara maloprodajna cijena mora postojati.");
  if (input.newGrossUnitCents <= BigInt(0)) throw new Error("Nova maloprodajna cijena mora biti pozitivna.");
  if (input.vatPercentHundred < BigInt(0)) throw new Error("PDV stopa ne može biti negativna.");
  if (input.stock.retailCents !== input.stock.costCents + input.stock.marginCents + input.stock.includedVatCents) {
    throw new Error("Vrijednosti lagera nijesu usklađene.");
  }

  const oldGrossUnitCents = roundDivision(input.stock.retailCents * BigInt(1000), input.stock.quantityMilli);
  const newRetailCents = roundDivision(input.stock.quantityMilli * input.newGrossUnitCents, BigInt(1000));
  const newNetCents = roundDivision(newRetailCents * BigInt(10000), BigInt(10000) + input.vatPercentHundred);
  const newIncludedVatCents = newRetailCents - newNetCents;
  const newMarginCents = newNetCents - input.stock.costCents;

  return {
    oldGrossUnitCents,
    newGrossUnitCents: input.newGrossUnitCents,
    oldRetailCents: input.stock.retailCents,
    newRetailCents,
    retailChangeCents: newRetailCents - input.stock.retailCents,
    oldMarginCents: input.stock.marginCents,
    newMarginCents,
    marginChangeCents: newMarginCents - input.stock.marginCents,
    oldIncludedVatCents: input.stock.includedVatCents,
    newIncludedVatCents,
    includedVatChangeCents: newIncludedVatCents - input.stock.includedVatCents
  };
}
