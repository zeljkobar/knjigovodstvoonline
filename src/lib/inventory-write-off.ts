import { roundDivision } from "./inventory-calculation";
import type { TransferStockValues } from "./inventory-transfer";

export const inventoryWriteOffStatuses = {
  draft: "DRAFT",
  posted: "POSTED",
  deleted: "DELETED"
} as const;

export const inventoryWriteOffReasons = [
  { value: "DAMAGED", label: "Oštećena roba" },
  { value: "EXPIRED", label: "Istekao rok" },
  { value: "BREAKAGE", label: "Kalo, rastur ili lom" },
  { value: "INVENTORY_SHORTAGE", label: "Manjak van redovnog popisa" },
  { value: "OTHER", label: "Drugi razlog" }
] as const;

export const inventoryWriteOffPostingScope = {
  documentType: "WRITE_OFF",
  subtype: "GENERAL",
  vatRate: "GENERAL"
} as const;

export const inventoryWriteOffPostingFields = [
  {
    purpose: "WRITE_OFF_EXPENSE",
    label: "Trošak otpisa",
    defaultDirection: "D",
    description: "Konto troška koje se zadužuje za nabavnu vrijednost otpisa."
  },
  {
    purpose: "WRITE_OFF_INVENTORY",
    label: "Zalihe robe",
    defaultDirection: "P",
    description: "Konto zaliha koje se odobrava za nabavnu vrijednost otpisane robe."
  }
] as const;

export function inventoryWriteOffStatusLabel(status: string) {
  return ({ DRAFT: "Nacrt", POSTED: "Proknjižen", DELETED: "Obrisan" }[status] ?? status);
}

export function inventoryWriteOffReasonLabel(reason: string) {
  return inventoryWriteOffReasons.find((item) => item.value === reason)?.label ?? reason;
}

export function inventoryWriteOffNumber(year: number, number: number) {
  return `OTP-${year}-${String(number).padStart(4, "0")}`;
}

export function calculateWriteOffSlice(input: {
  source: TransferStockValues;
  quantityMilli: bigint;
  fallbackUnitCostTenThousand?: bigint;
}) {
  if (input.quantityMilli <= BigInt(0)) throw new Error("Količina otpisa mora biti pozitivna.");
  const unitCost = input.source.averageCostTenThousand > BigInt(0)
    ? input.source.averageCostTenThousand
    : input.fallbackUnitCostTenThousand ?? BigInt(0);
  if (unitCost <= BigInt(0)) throw new Error("Otpis mora imati nabavnu cijenu.");

  const absoluteSourceQuantity = input.source.quantityMilli < BigInt(0)
    ? -input.source.quantityMilli
    : input.source.quantityMilli;
  const proportional = (value: bigint) => {
    if (absoluteSourceQuantity === BigInt(0)) return BigInt(0);
    const absoluteValue = value < BigInt(0) ? -value : value;
    return roundDivision(absoluteValue * input.quantityMilli, absoluteSourceQuantity);
  };
  const exactFullPositive = input.source.quantityMilli > BigInt(0) && input.quantityMilli === input.source.quantityMilli;
  const costCents = exactFullPositive
    ? input.source.costCents
    : roundDivision(input.quantityMilli * unitCost, BigInt(100000));
  const retailCents = exactFullPositive ? input.source.retailCents : proportional(input.source.retailCents);
  const marginCents = exactFullPositive ? input.source.marginCents : proportional(input.source.marginCents);
  const includedVatCents = exactFullPositive ? input.source.includedVatCents : proportional(input.source.includedVatCents);

  return { unitCostTenThousand: unitCost, costCents, retailCents, marginCents, includedVatCents };
}
