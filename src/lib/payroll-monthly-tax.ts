import type { Prisma } from "@prisma/client";
import type { PayrollLineResult, PayrollTaxHistory } from "./payroll";

type HistoryLine = {
  id: string; radnik_id: string; bruto_cent: number; oporezivi_bruto_cent: number;
  porez_cent: number; prirez_cent: number; detalji: Prisma.JsonValue;
};

export function progressivePayrollLine(line: HistoryLine) {
  const details = line.detalji as Record<string, unknown> | null;
  // Older snapshots predate the explicit marker. Rule-based linear income is separate.
  return details?.monthlyProgressiveTax === true ||
    (details?.monthlyProgressiveTax === undefined && details?.basisRule === null &&
      (line.oporezivi_bruto_cent > 0 || line.porez_cent > 0));
}

export function payrollHistoryKey(lines: HistoryLine[], workerId: string) {
  return JSON.stringify(lines.filter(line => line.radnik_id === workerId)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(line => [line.id, line.oporezivi_bruto_cent, line.porez_cent, line.prirez_cent, progressivePayrollLine(line)]));
}

export function payrollTaxHistory(lines: HistoryLine[], workerId: string): PayrollTaxHistory {
  return lines.filter(line => line.radnik_id === workerId && progressivePayrollLine(line))
    .reduce((sum, line) => ({baseCents: sum.baseCents + line.oporezivi_bruto_cent,
      taxCents: sum.taxCents + line.porez_cent, surtaxCents: sum.surtaxCents + line.prirez_cent}),
    {baseCents: 0, taxCents: 0, surtaxCents: 0});
}

export function appendPayrollTax(history: PayrollTaxHistory, line: PayrollLineResult) {
  if (line.details.monthlyProgressiveTax) {
    history.baseCents += line.taxableGrossCents;
    history.taxCents += line.personalIncomeTaxCents;
    history.surtaxCents += line.surtaxCents;
  }
}

export function postedMonthlyPayrollLines(tx: Prisma.TransactionClient, calculation: {
  id: string; agencija_id: string; firma_id: string; godina: number; mjesec: number;
}) {
  return tx.plateObracunStavka.findMany({where: {
    agencija_id: calculation.agencija_id, firma_id: calculation.firma_id,
    obracun: {id: {not: calculation.id}, agencija_id: calculation.agencija_id,
      firma_id: calculation.firma_id, godina: calculation.godina, mjesec: calculation.mjesec,
      is_deleted: false, status: {in: ["POSTED", "LOCKED"]},
      nalog: {is_deleted: false, status: "POSTED"}}
  }});
}
