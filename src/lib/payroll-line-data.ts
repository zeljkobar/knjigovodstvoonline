import type { Prisma } from "@prisma/client";
import type { PayrollLineResult } from "./payroll";

export function payrollLineResultData(line: PayrollLineResult) {
  return {
    iznos_za_obracun_cent: line.amountForCalculationCents,
    osnovica_cent: line.baseAmountCents,
    neto_cent: line.netAmountCents,
    bruto_cent: line.grossAmountCents,
    oporezivi_bruto_cent: line.taxableGrossCents,
    porez_cent: line.personalIncomeTaxCents,
    prirez_cent: line.surtaxCents,
    zaposleni_pio_cent: line.employeePioCents,
    zaposleni_zdravstvo_cent: line.employeeHealthCents,
    zaposleni_nezaposleni_cent: line.employeeUnemploymentCents,
    poslodavac_pio_cent: line.employerPioCents,
    poslodavac_zdravstvo_cent: line.employerHealthCents,
    poslodavac_nezaposleni_cent: line.employerUnemploymentCents,
    fond_rada_cent: line.laborFundCents,
    sindikat_cent: line.unionCents,
    privredna_komora_cent: line.chamberCents,
    doprinosi_zaposleni_cent: line.totalEmployeeContributionsCents,
    doprinosi_poslodavac_cent: line.totalEmployerContributionsCents,
    ukupni_trosak_cent: line.totalCostCents,
    neto_za_isplatu_cent: line.netForPaymentCents,
    stopa_prireza: line.surtaxRate,
    koeficijent_minuli_rad: line.seniorityCoefficient,
    detalji: line.details as Prisma.InputJsonValue,
  };
}
