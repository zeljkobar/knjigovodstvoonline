export const journalStatuses = {
  draft: "DRAFT",
  posted: "POSTED",
  deleted: "DELETED"
} as const;

export const standardJournalTypes = [
  ["OPENING_BALANCE", "Početno stanje", "PS"],
  ["INCOMING_INVOICE", "Ulazni računi", "UR"],
  ["OUTGOING_INVOICE", "Izlazni računi", "IR"],
  ["CALCULATION", "Kalkulacije", "KAL"],
  ["BANK_STATEMENT", "Izvodi", "IZV"],
  ["PAYROLL", "Plate", "PL"],
  ["CASH_REGISTER", "Blagajna", "BLG"],
  ["DEPRECIATION", "Amortizacija", "AM"],
  ["FINAL_ACCOUNT", "Završni račun", "ZR"],
  ["MANUAL", "Ručni nalog", "RN"],
  ["CORRECTION", "Korektivni nalog", "KOR"],
  ["WAREHOUSE_TRANSFER", "Prenos robe", "PRN"],
  ["STOCK_COUNT", "Popis robe", "POP"],
  ["WRITE_OFF", "Otpis robe", "OTP"],
  ["PRICE_ADJUSTMENT", "Nivelacija cijena", "NIV"]
] as const;

export function formatJournalCode(
  prefix: string | null | undefined,
  year: number,
  number: number
) {
  const safePrefix = prefix?.trim() || "NAL";

  return `${safePrefix}-${year}-${String(number).padStart(4, "0")}`;
}

export function journalStatusLabel(status: string) {
  if (status === journalStatuses.posted) {
    return "Proknjižen";
  }

  if (status === journalStatuses.deleted) {
    return "Obrisan";
  }

  return "Nacrt";
}
