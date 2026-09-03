import { roundDivision } from "./inventory-calculation";

export const inventoryTransferStatuses = {
  draft: "DRAFT",
  posted: "POSTED",
  deleted: "DELETED"
} as const;

export const inventoryTransferPostingScope = {
  documentType: "WAREHOUSE_TRANSFER",
  subtype: "GENERAL",
  vatRate: "GENERAL"
} as const;

export const inventoryTransferPostingFields = [
  {
    purpose: "TRANSFER_DESTINATION_INVENTORY",
    label: "Zalihe odredišnog magacina",
    defaultDirection: "D",
    description: "Konto zaliha koji se duguje za vrijednost primljene robe."
  },
  {
    purpose: "TRANSFER_SOURCE_INVENTORY",
    label: "Zalihe izvornog magacina",
    defaultDirection: "P",
    description: "Konto zaliha koji se potražuje za vrijednost izdate robe."
  }
] as const;

export function inventoryTransferStatusLabel(status: string) {
  return (
    {
      DRAFT: "Nacrt",
      POSTED: "Proknjižen",
      DELETED: "Obrisan"
    }[status] ?? status
  );
}

export function inventoryTransferNumber(year: number, number: number) {
  return `PRN-${year}-${String(number).padStart(4, "0")}`;
}

export type TransferStockValues = {
  quantityMilli: bigint;
  averageCostTenThousand: bigint;
  costCents: bigint;
  retailCents: bigint;
  marginCents: bigint;
  includedVatCents: bigint;
};

export function calculateTransferSlice(
  source: TransferStockValues,
  transferQuantityMilli: bigint
) {
  if (transferQuantityMilli <= BigInt(0)) {
    throw new Error("Količina prenosa mora biti pozitivna.");
  }

  const fullPositiveStock =
    source.quantityMilli > BigInt(0) &&
    transferQuantityMilli === source.quantityMilli;
  const proportional = (value: bigint) =>
    source.quantityMilli > BigInt(0)
      ? roundDivision(value * transferQuantityMilli, source.quantityMilli)
      : BigInt(0);
  const costCents = fullPositiveStock
    ? source.costCents
    : roundDivision(
        transferQuantityMilli * source.averageCostTenThousand,
        BigInt(100000)
      );
  const unitCostTenThousand =
    costCents > BigInt(0)
      ? roundDivision(costCents * BigInt(100000), transferQuantityMilli)
      : source.averageCostTenThousand;

  return {
    quantityMilli: transferQuantityMilli,
    unitCostTenThousand,
    costCents,
    retailCents: fullPositiveStock ? source.retailCents : proportional(source.retailCents),
    marginCents: fullPositiveStock ? source.marginCents : proportional(source.marginCents),
    includedVatCents: fullPositiveStock
      ? source.includedVatCents
      : proportional(source.includedVatCents)
  };
}
