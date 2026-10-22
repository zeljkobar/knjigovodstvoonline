import { decimalToScaled, roundDivision } from "./inventory-calculation";
import { calculateWriteOffSlice } from "./inventory-write-off";
import type { TransferStockValues } from "./inventory-transfer";

export const supplierReturnScope = { documentType: "SUPPLIER_RETURN", subtype: "GENERAL", vatRate: "GENERAL" } as const;
export const supplierReturnFields = [
  { purpose: "RETURN_SUPPLIER", label: "Dobavljač", direction: "D" },
  { purpose: "RETURN_INVENTORY", label: "Roba (MP ili nabavna vrijednost)", direction: "P" },
  { purpose: "RETURN_INPUT_VAT", label: "Ispravka ulaznog PDV-a", direction: "P" },
  { purpose: "RETURN_MARGIN", label: "Razlika u cijeni", direction: "D" },
  { purpose: "RETURN_INCLUDED_VAT", label: "Ukalkulisani PDV", direction: "D" },
  { purpose: "RETURN_LOSS", label: "Trošak razlike odobrenja i lagera (klasa 5)", direction: "D" },
  { purpose: "RETURN_GAIN", label: "Prihod razlike odobrenja i lagera (klasa 6)", direction: "P" }
] as const;
export function supplierReturnNumber(year: number, number: number) { return `POV-${year}-${String(number).padStart(4, "0")}`; }
export function supplierReturnStatus(status: string) { return ({ DRAFT: "Nacrt", POSTED: "Proknjižen", DELETED: "Obrisan" }[status] ?? status); }
export function supplierReturnPreview(lines: Array<{ kolicina: { toString(): string }; cijena_odobrenja: { toString(): string }; pdv_procenat: { toString(): string } }>) {
  return lines.reduce((sum, line) => {
    const base = roundDivision(decimalToScaled(line.kolicina, 3) * decimalToScaled(line.cijena_odobrenja, 4), BigInt(100000));
    const vat = roundDivision(base * decimalToScaled(line.pdv_procenat, 2), BigInt(10000));
    return { base: sum.base + base, vat: sum.vat + vat, gross: sum.gross + base + vat };
  }, { base: BigInt(0), vat: BigInt(0), gross: BigInt(0) });
}
export class SupplierReturnError extends Error {}
export function returnFail(message: string): never { throw new SupplierReturnError(message); }

// Decimal precision is validated before parsing, rather than silently truncating money/quantity.
export function returnDecimal(raw: string, precision: number, allowZero = false) {
  const normalized = raw.trim().replace(",", ".");
  if (!new RegExp(`^\\d{1,10}(?:\\.\\d{1,${precision}})?$`).test(normalized)) returnFail("Neispravan iznos ili količina.");
  const [whole, fraction = ""] = normalized.split(".");
  const result = BigInt(whole) * BigInt(10) ** BigInt(precision) + BigInt(fraction.padEnd(precision, "0"));
  if (result < BigInt(0) || (!allowZero && result === BigInt(0))) returnFail("Iznos i količina moraju biti pozitivni.");
  return result;
}

export function calculateSupplierReturn(input: {
  source: TransferStockValues; quantity: bigint; creditPrice: bigint; vatPercent: bigint;
  deductible: boolean; retail: boolean;
}) {
  if (input.quantity <= BigInt(0) || input.creditPrice <= BigInt(0) || input.vatPercent < BigInt(0) || input.vatPercent > BigInt(10000)) returnFail("Neispravna stavka povrata.");
  const stock = calculateWriteOffSlice({ source: input.source, quantityMilli: input.quantity, fallbackUnitCostTenThousand: input.creditPrice });
  const base = roundDivision(input.quantity * input.creditPrice, BigInt(100000));
  const vat = roundDivision(base * input.vatPercent, BigInt(10000));
  const gross = base + vat;
  const deductible = input.deductible ? vat : BigInt(0);
  const creditCost = gross - deductible;
  const inventory = input.retail ? stock.retailCents : stock.costCents;
  const included = input.retail ? stock.includedVatCents : BigInt(0);
  // Derive RUC as the residual to preserve cent-level retail reconciliation.
  const margin = input.retail ? inventory - stock.costCents - included : BigInt(0);
  if (input.retail) stock.marginCents = margin;
  const difference = creditCost - stock.costCents;
  const signed = [
    ["RETURN_SUPPLIER", gross], ["RETURN_INVENTORY", -inventory],
    ["RETURN_INPUT_VAT", -deductible], ["RETURN_MARGIN", margin],
    ["RETURN_INCLUDED_VAT", included], ["RETURN_LOSS", difference < BigInt(0) ? -difference : BigInt(0)],
    ["RETURN_GAIN", difference > BigInt(0) ? -difference : BigInt(0)]
  ] as const;
  if ([base, vat, gross, ...signed.map(([, amount]) => amount)].some(amount => amount > BigInt("99999999999999") || amount < -BigInt("99999999999999"))) returnFail("Iznos povrata prelazi dozvoljenu veličinu novčanog polja.");
  if (signed.reduce((sum, [, amount]) => sum + amount, BigInt(0)) !== BigInt(0)) returnFail("Povrat nije izbalansiran.");
  return { stock, base, vat, gross, deductible, margin, signed };
}
