import { itemPriceTypes } from "@/lib/inventory";

export const warehouseSalesTypes = {
  retail: "RETAIL",
  wholesale: "WHOLESALE"
} as const;

export type WarehouseSalesType = typeof warehouseSalesTypes[keyof typeof warehouseSalesTypes];

export function normalizeWarehouseSalesType(value: string | null | undefined): WarehouseSalesType {
  return value === warehouseSalesTypes.wholesale
    ? warehouseSalesTypes.wholesale
    : warehouseSalesTypes.retail;
}

export function warehouseSalesTypeLabel(value: string | null | undefined) {
  return normalizeWarehouseSalesType(value) === warehouseSalesTypes.wholesale
    ? "Veleprodajni"
    : "Maloprodajni";
}

type PosPriceCandidate = {
  tip: string;
  magacin_id: string | null;
};

export function selectPosPrice<T extends PosPriceCandidate>(
  prices: T[],
  warehouseId: string | null,
  warehouseType: string | null | undefined
) {
  const normalizedType = normalizeWarehouseSalesType(warehouseType);
  const acceptedTypes: Set<string> = normalizedType === warehouseSalesTypes.wholesale
    ? new Set([itemPriceTypes.wholesale, warehouseSalesTypes.wholesale])
    : new Set([itemPriceTypes.retail, warehouseSalesTypes.retail]);
  const matching = prices.filter((price) => acceptedTypes.has(price.tip));

  return matching.find((price) => Boolean(warehouseId) && price.magacin_id === warehouseId)
    ?? matching.find((price) => price.magacin_id === null)
    ?? null;
}
