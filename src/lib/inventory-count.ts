import { roundDivision } from "./inventory-calculation";
import { calculateTransferSlice, type TransferStockValues } from "./inventory-transfer";

export const inventoryCountStatuses = {
  draft: "DRAFT",
  posted: "POSTED",
  completed: "COMPLETED",
  deleted: "DELETED"
} as const;

export const inventoryCountPostingScope = {
  documentType: "STOCK_COUNT",
  subtype: "GENERAL",
  vatRate: "GENERAL"
} as const;

export const inventoryCountPostingFields = [
  {
    purpose: "STOCK_COUNT_SURPLUS_INVENTORY",
    label: "Zalihe po višku",
    defaultDirection: "D",
    description: "Konto zaliha koje se zadužuje za nabavnu vrijednost viška."
  },
  {
    purpose: "STOCK_COUNT_SURPLUS_INCOME",
    label: "Prihod od viška",
    defaultDirection: "P",
    description: "Konto prihoda koje se odobrava za vrijednost viška."
  },
  {
    purpose: "STOCK_COUNT_SHORTAGE_EXPENSE",
    label: "Trošak manjka",
    defaultDirection: "D",
    description: "Konto troška koje se zadužuje za nabavnu vrijednost manjka."
  },
  {
    purpose: "STOCK_COUNT_SHORTAGE_INVENTORY",
    label: "Zalihe po manjku",
    defaultDirection: "P",
    description: "Konto zaliha koje se odobrava za nabavnu vrijednost manjka."
  }
] as const;

export function inventoryCountStatusLabel(status: string) {
  return (
    {
      DRAFT: "Nacrt",
      POSTED: "Proknjižen",
      COMPLETED: "Zaključen bez razlike",
      DELETED: "Obrisan"
    }[status] ?? status
  );
}

export function inventoryCountNumber(year: number, number: number) {
  return `POP-${year}-${String(number).padStart(4, "0")}`;
}

export type InventoryCountAdjustment = {
  kind: "NONE" | "SURPLUS" | "SHORTAGE";
  differenceMilli: bigint;
  absoluteQuantityMilli: bigint;
  unitCostTenThousand: bigint;
  costCents: bigint;
  retailCents: bigint;
  marginCents: bigint;
  includedVatCents: bigint;
};

export function calculateInventoryCountAdjustment(input: {
  book: TransferStockValues;
  actualQuantityMilli: bigint;
  surplusUnitCostTenThousand?: bigint;
}): InventoryCountAdjustment {
  if (input.actualQuantityMilli < BigInt(0)) {
    throw new Error("Stvarna količina ne može biti negativna.");
  }
  const difference = input.actualQuantityMilli - input.book.quantityMilli;
  if (difference === BigInt(0)) {
    return {
      kind: "NONE",
      differenceMilli: BigInt(0),
      absoluteQuantityMilli: BigInt(0),
      unitCostTenThousand: input.book.averageCostTenThousand,
      costCents: BigInt(0),
      retailCents: BigInt(0),
      marginCents: BigInt(0),
      includedVatCents: BigInt(0)
    };
  }
  if (difference < BigInt(0)) {
    const slice = calculateTransferSlice(input.book, -difference);
    return {
      kind: "SHORTAGE",
      differenceMilli: difference,
      absoluteQuantityMilli: -difference,
      ...slice
    };
  }

  const unitCost = input.surplusUnitCostTenThousand ?? input.book.averageCostTenThousand;
  if (unitCost <= BigInt(0)) {
    throw new Error("Višak mora imati nabavnu cijenu.");
  }
  const proportional = (value: bigint) =>
    input.book.quantityMilli > BigInt(0)
      ? roundDivision(value * difference, input.book.quantityMilli)
      : BigInt(0);
  const costCents = roundDivision(difference * unitCost, BigInt(100000));
  const proportionalRetail = proportional(input.book.retailCents);

  return {
    kind: "SURPLUS",
    differenceMilli: difference,
    absoluteQuantityMilli: difference,
    unitCostTenThousand: unitCost,
    costCents,
    retailCents: proportionalRetail > BigInt(0) ? proportionalRetail : costCents,
    marginCents: proportionalRetail > BigInt(0) ? proportional(input.book.marginCents) : BigInt(0),
    includedVatCents:
      proportionalRetail > BigInt(0) ? proportional(input.book.includedVatCents) : BigInt(0)
  };
}
