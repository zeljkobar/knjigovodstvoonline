import type { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { vatTransactionLabels, type VatTransactionType } from "./vat-transaction";

type WorkbookColumnWidth = {
  wch: number;
};

function decimalNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value == null) {
    return 0;
  }

  return typeof value === "number" ? value : Number(value.toString());
}

export function excelDate(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "";
}

export function vatTransactionLabel(value: string) {
  return vatTransactionLabels[value as VatTransactionType] ?? value;
}

export function postingStatusLabel(value: string) {
  if (value === "POSTED") {
    return "Knjižena";
  }

  if (value === "PARTIALLY_POSTED") {
    return "Djelimično knjižena";
  }

  return "Otvorena";
}

export function moneyCell(value: Prisma.Decimal | number | null | undefined) {
  return decimalNumber(value);
}

export function kifTaxSummary(
  taxLines: Array<{
    output_vat_amount: Prisma.Decimal;
    tax_base: Prisma.Decimal;
    total_with_vat: Prisma.Decimal;
    vat_rate_percent: Prisma.Decimal;
  }>
) {
  return taxLines
    .map((line) => {
      const rate = decimalNumber(line.vat_rate_percent);
      const base = decimalNumber(line.tax_base).toFixed(2);
      const vat = decimalNumber(line.output_vat_amount).toFixed(2);
      const total = decimalNumber(line.total_with_vat).toFixed(2);

      return `${rate}%: osnovica ${base}, PDV ${vat}, ukupno ${total}`;
    })
    .join("; ");
}

export function kufTaxSummary(
  taxLines: Array<{
    deductible_vat_amount: Prisma.Decimal;
    input_vat_amount: Prisma.Decimal;
    non_deductible_vat_amount: Prisma.Decimal;
    tax_base: Prisma.Decimal;
    total_with_vat: Prisma.Decimal;
    vat_rate_percent: Prisma.Decimal;
  }>
) {
  return taxLines
    .map((line) => {
      const rate = decimalNumber(line.vat_rate_percent);
      const base = decimalNumber(line.tax_base).toFixed(2);
      const vat = decimalNumber(line.input_vat_amount).toFixed(2);
      const deductible = decimalNumber(line.deductible_vat_amount).toFixed(2);
      const nonDeductible = decimalNumber(line.non_deductible_vat_amount).toFixed(2);
      const total = decimalNumber(line.total_with_vat).toFixed(2);

      return `${rate}%: osnovica ${base}, PDV ${vat}, odbitni ${deductible}, neodbitni ${nonDeductible}, ukupno ${total}`;
    })
    .join("; ");
}

export function workbookBuffer(
  sheetName: string,
  rows: Array<Record<string, string | number>>,
  columnWidths: WorkbookColumnWidth[]
) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = columnWidths;
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  return XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer"
  }) as Buffer;
}

export function workbookResponse(buffer: Buffer, fileName: string) {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }
  });
}
