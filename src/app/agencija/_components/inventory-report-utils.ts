import { decimalToScaled } from "@/lib/inventory-calculation";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { getInventoryContext } from "../robno/_shared";

export async function loadInventoryReportContext() {
  const [inventoryContext, workContext] = await Promise.all([
    getInventoryContext("view"),
    readWorkContext()
  ]);

  const year =
    inventoryContext.firma && workContext.poslovnaGodinaId
      ? await prisma.poslovnaGodina.findFirst({
          where: {
            id: workContext.poslovnaGodinaId,
            firma_id: inventoryContext.firma.id
          },
          select: {
            id: true,
            godina: true,
            datum_od: true,
            datum_do: true
          }
        })
      : null;

  return {
    ...inventoryContext,
    year
  };
}

export function decimalToInventoryScaled(
  value: { toString(): string },
  decimals: number
) {
  return decimalToScaled(value, decimals);
}

export function formatInventoryMoney(value: bigint) {
  return formatScaledInventoryValue(value, 2, 2);
}

export function formatInventoryQuantity(value: bigint) {
  return formatScaledInventoryValue(value, 3, 0);
}

export function formatInventoryUnitPrice(value: bigint) {
  return formatScaledInventoryValue(value, 4, 2);
}

function formatScaledInventoryValue(
  value: bigint,
  decimals: number,
  minimumDecimals: number
) {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = absolute / scale;
  let fraction = (absolute % scale).toString().padStart(decimals, "0");

  while (fraction.length > minimumDecimals && fraction.endsWith("0")) {
    fraction = fraction.slice(0, -1);
  }

  return `${negative ? "-" : ""}${whole.toLocaleString("sr-Latn-ME")}${
    fraction ? `,${fraction}` : ""
  }`;
}

export function parseInventoryReportDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatInventoryDate(value: Date) {
  return value.toLocaleDateString("sr-Latn-ME");
}

export function inventoryMovementSign(direction: string) {
  return direction === "OUT" ? BigInt(-1) : BigInt(1);
}

export function inventoryDocumentLabel(type: string) {
  const labels: Record<string, string> = {
    CALCULATION: "Kalkulacija",
    OUTGOING_INVOICE: "Izlazna faktura",
    WAREHOUSE_TRANSFER_OUT: "Prenos robe — izlaz",
    WAREHOUSE_TRANSFER_IN: "Prenos robe — ulaz",
    STOCK_COUNT_SURPLUS: "Popis robe — višak",
    STOCK_COUNT_SHORTAGE: "Popis robe — manjak",
    WRITE_OFF: "Otpis robe",
    PRICE_ADJUSTMENT_UP: "Nivelacija — povećanje",
    PRICE_ADJUSTMENT_DOWN: "Nivelacija — smanjenje",
    POS_SALE: "POS prodaja",
    POS_RETURN: "POS storno"
  };

  return labels[type] ?? type;
}
