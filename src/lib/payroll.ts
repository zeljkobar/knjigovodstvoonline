import { prisma } from "./prisma";

export const payrollStatuses = {
  draft: "DRAFT",
  calculated: "CALCULATED",
  reviewed: "REVIEWED",
  posted: "POSTED",
  locked: "LOCKED",
  deleted: "DELETED"
} as const;

export const payrollCategories = {
  regularWork: "REDOVAN_RAD"
} as const;

export const payrollCalculationTypes = {
  grossWithoutSeniority: "GROSS_WITHOUT_SENIORITY",
  grossWithSeniority: "GROSS_WITH_SENIORITY",
  netWithoutSeniority: "NET_WITHOUT_SENIORITY",
  netWithSeniority: "NET_WITH_SENIORITY",
  coefficientWithSeniority: "COEFFICIENT_WITH_SENIORITY",
  coefficientNetRecalculation: "COEFFICIENT_NET_RECALCULATION",
  coefficientWithoutSeniority: "COEFFICIENT_WITHOUT_SENIORITY"
} as const;

const contributionCodes = {
  employeePio: "EMPLOYEE_PIO",
  employeeHealth: "EMPLOYEE_HEALTH",
  employeeUnemployment: "EMPLOYEE_UNEMPLOYMENT",
  employerPio: "EMPLOYER_PIO",
  employerHealth: "EMPLOYER_HEALTH",
  employerUnemployment: "EMPLOYER_UNEMPLOYMENT",
  laborFund: "LABOR_FUND",
  union: "UNION",
  chamber: "CHAMBER"
} as const;

type RateLike = {
  sifra: string;
  stopa: { toString(): string } | string | number;
};

type TaxBracketLike = {
  bruto_od: number;
  bruto_do: number | null;
  stopa: { toString(): string } | string | number;
};

type IncomeFlags = {
  koristi_porez: boolean;
  koristi_zaposleni_pio: boolean;
  koristi_zaposleni_zdravstvo: boolean;
  koristi_zaposleni_nezaposleni: boolean;
  koristi_poslodavac_pio: boolean;
  koristi_poslodavac_zdravstvo: boolean;
  koristi_poslodavac_nezaposleni: boolean;
  koristi_fond_rada: boolean;
  koristi_sindikat: boolean;
  koristi_privredna_komora: boolean;
};

type CalculationType = {
  sifra: string;
  input_type: string;
  koristi_koeficijent: boolean;
  koristi_minuli_rad: boolean;
  seniority_mode: string;
  algoritam: string;
};

export type PayrollLineInput = {
  calculationDate: Date;
  incomeType: IncomeFlags;
  calculationType: CalculationType;
  netAmountCents: number;
  grossAmountCents: number;
  fixedPartCents: number;
  complexityCoefficient: number;
  usesSeniority: boolean;
  seniorityCoefficient: number;
  workingHours: number;
  workingHoursFund: number;
  municipality?: string | null;
};

export type PayrollLineResult = {
  baseAmountCents: number;
  amountForCalculationCents: number;
  netAmountCents: number;
  grossAmountCents: number;
  taxableGrossCents: number;
  personalIncomeTaxCents: number;
  surtaxCents: number;
  employeePioCents: number;
  employeeHealthCents: number;
  employeeUnemploymentCents: number;
  employerPioCents: number;
  employerHealthCents: number;
  employerUnemploymentCents: number;
  laborFundCents: number;
  unionCents: number;
  chamberCents: number;
  totalEmployeeContributionsCents: number;
  totalEmployerContributionsCents: number;
  totalCostCents: number;
  netForPaymentCents: number;
  surtaxRate: number;
  details: Record<string, unknown>;
};

export function money(cents: number) {
  return (cents / 100).toLocaleString("sr-Latn-ME", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function parseMoneyToCents(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();

  if (!raw) {
    return 0;
  }

  const normalized =
    raw.includes(",") && raw.includes(".")
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(",", ".");
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed * 100);
}

export function dateInputValue(date: Date | string | null | undefined) {
  if (!date) {
    return "";
  }

  return new Date(date).toISOString().slice(0, 10);
}

function rateNumber(rate: { stopa: { toString(): string } | string | number } | null | undefined) {
  if (!rate) {
    return 0;
  }

  const parsed = Number(rate.stopa.toString());

  return Number.isFinite(parsed) ? parsed : 0;
}

function activeOn(date: Date) {
  return {
    valid_from: {
      lte: date
    },
    OR: [
      {
        valid_to: null
      },
      {
        valid_to: {
          gte: date
        }
      }
    ],
    aktivan: true
  };
}

function rateByCode(rates: RateLike[], code: string) {
  return rateNumber(rates.find((rate) => rate.sifra === code));
}

function roundedRateAmount(cents: number, rate: number) {
  return Math.round(cents * rate);
}

function prorateAmount(cents: number, workingHours: number, workingHoursFund: number) {
  if (workingHoursFund <= 0) {
    return cents;
  }

  return Math.round((cents * workingHours) / workingHoursFund);
}

function calculateTax(grossCents: number, brackets: TaxBracketLike[]) {
  return brackets.reduce((sum, bracket) => {
    const from = bracket.bruto_od;
    const to = bracket.bruto_do ?? grossCents;
    const taxable = Math.max(0, Math.min(grossCents, to) - from);

    if (taxable <= 0) {
      return sum;
    }

    return sum + roundedRateAmount(taxable, rateNumber(bracket));
  }, 0);
}

function calculateFromGross({
  grossCents,
  rates,
  taxBrackets,
  incomeType,
  surtaxRate
}: {
  grossCents: number;
  rates: RateLike[];
  taxBrackets: TaxBracketLike[];
  incomeType: IncomeFlags;
  surtaxRate: number;
}) {
  const employeePioCents = incomeType.koristi_zaposleni_pio
    ? roundedRateAmount(grossCents, rateByCode(rates, contributionCodes.employeePio))
    : 0;
  const employeeHealthCents = incomeType.koristi_zaposleni_zdravstvo
    ? roundedRateAmount(grossCents, rateByCode(rates, contributionCodes.employeeHealth))
    : 0;
  const employeeUnemploymentCents = incomeType.koristi_zaposleni_nezaposleni
    ? roundedRateAmount(grossCents, rateByCode(rates, contributionCodes.employeeUnemployment))
    : 0;
  const personalIncomeTaxCents = incomeType.koristi_porez
    ? calculateTax(grossCents, taxBrackets)
    : 0;
  const surtaxCents = roundedRateAmount(personalIncomeTaxCents, surtaxRate);
  const employerPioCents = incomeType.koristi_poslodavac_pio
    ? roundedRateAmount(grossCents, rateByCode(rates, contributionCodes.employerPio))
    : 0;
  const employerHealthCents = incomeType.koristi_poslodavac_zdravstvo
    ? roundedRateAmount(grossCents, rateByCode(rates, contributionCodes.employerHealth))
    : 0;
  const employerUnemploymentCents = incomeType.koristi_poslodavac_nezaposleni
    ? roundedRateAmount(grossCents, rateByCode(rates, contributionCodes.employerUnemployment))
    : 0;
  const laborFundCents = incomeType.koristi_fond_rada
    ? roundedRateAmount(grossCents, rateByCode(rates, contributionCodes.laborFund))
    : 0;
  const unionCents = incomeType.koristi_sindikat
    ? roundedRateAmount(grossCents, rateByCode(rates, contributionCodes.union))
    : 0;
  const chamberCents = incomeType.koristi_privredna_komora
    ? roundedRateAmount(grossCents, rateByCode(rates, contributionCodes.chamber))
    : 0;
  const totalEmployeeContributionsCents =
    employeePioCents + employeeHealthCents + employeeUnemploymentCents;
  const totalEmployerContributionsCents =
    employerPioCents + employerHealthCents + employerUnemploymentCents + laborFundCents + unionCents + chamberCents;
  const netAmountCents =
    grossCents - totalEmployeeContributionsCents - personalIncomeTaxCents - surtaxCents;

  return {
    netAmountCents,
    grossAmountCents: grossCents,
    taxableGrossCents: grossCents,
    personalIncomeTaxCents,
    surtaxCents,
    employeePioCents,
    employeeHealthCents,
    employeeUnemploymentCents,
    employerPioCents,
    employerHealthCents,
    employerUnemploymentCents,
    laborFundCents,
    unionCents,
    chamberCents,
    totalEmployeeContributionsCents,
    totalEmployerContributionsCents,
    totalCostCents: grossCents + totalEmployerContributionsCents,
    netForPaymentCents: netAmountCents
  };
}

function grossFromNet({
  targetNetCents,
  rates,
  taxBrackets,
  incomeType,
  surtaxRate
}: {
  targetNetCents: number;
  rates: RateLike[];
  taxBrackets: TaxBracketLike[];
  incomeType: IncomeFlags;
  surtaxRate: number;
}) {
  let low = targetNetCents;
  let high = Math.max(targetNetCents * 2, 100000);

  while (
    calculateFromGross({
      grossCents: high,
      rates,
      taxBrackets,
      incomeType,
      surtaxRate
    }).netAmountCents < targetNetCents
  ) {
    high *= 2;
  }

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const calculatedNet = calculateFromGross({
      grossCents: mid,
      rates,
      taxBrackets,
      incomeType,
      surtaxRate
    }).netAmountCents;

    if (calculatedNet >= targetNetCents) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  return low;
}

export async function calculatePayrollLine(input: PayrollLineInput): Promise<PayrollLineResult> {
  const [rates, taxBrackets, surtax] = await Promise.all([
    prisma.plateDoprinosStopa.findMany({
      where: activeOn(input.calculationDate),
      orderBy: {
        sifra: "asc"
      },
      select: {
        sifra: true,
        stopa: true
      }
    }),
    prisma.platePorezRazred.findMany({
      where: {
        sifra: "REGULAR_SALARY",
        ...activeOn(input.calculationDate)
      },
      orderBy: {
        bruto_od: "asc"
      },
      select: {
        bruto_od: true,
        bruto_do: true,
        stopa: true
      }
    }),
    input.municipality
      ? prisma.platePrirezStopa.findFirst({
          where: {
            opstina: input.municipality.toUpperCase(),
            ...activeOn(input.calculationDate)
          },
          orderBy: {
            valid_from: "desc"
          },
          select: {
            stopa: true
          }
        })
      : null
  ]);
  const surtaxRate = rateNumber(surtax);
  const workingHours = input.workingHours || input.workingHoursFund;
  const workingHoursFund = input.workingHoursFund || workingHours || 1;
  const usesSeniority =
    input.usesSeniority && input.calculationType.koristi_minuli_rad;
  let baseAmountCents = 0;

  if (input.calculationType.koristi_koeficijent) {
    baseAmountCents = Math.round(
      input.fixedPartCents * (input.complexityCoefficient || 0)
    );
  } else if (input.calculationType.input_type === "GROSS") {
    baseAmountCents = input.grossAmountCents;
  } else {
    baseAmountCents = input.netAmountCents;
  }

  baseAmountCents = prorateAmount(baseAmountCents, workingHours, workingHoursFund);

  if (usesSeniority && input.calculationType.seniority_mode === "ADD_TO_BASE_BEFORE_GROSSING") {
    baseAmountCents += roundedRateAmount(baseAmountCents, input.seniorityCoefficient);
  }

  let grossCents = 0;

  if (
    input.calculationType.input_type === "NET" ||
    input.calculationType.algoritam === "NET_TO_GROSS" ||
    input.calculationType.algoritam === "COEFFICIENT_TO_NET"
  ) {
    grossCents = grossFromNet({
      targetNetCents: baseAmountCents,
      rates,
      taxBrackets,
      incomeType: input.incomeType,
      surtaxRate
    });
  } else {
    grossCents = baseAmountCents;

    if (usesSeniority && input.calculationType.seniority_mode !== "ADD_TO_BASE_BEFORE_GROSSING") {
      grossCents += roundedRateAmount(grossCents, input.seniorityCoefficient);
    }
  }

  const result = calculateFromGross({
    grossCents,
    rates,
    taxBrackets,
    incomeType: input.incomeType,
    surtaxRate
  });

  return {
    baseAmountCents,
    amountForCalculationCents: baseAmountCents,
    ...result,
    surtaxRate,
    details: {
      inputType: input.calculationType.input_type,
      algorithm: input.calculationType.algoritam,
      workingHours,
      workingHoursFund,
      usesSeniority
    }
  };
}

export function payrollStatusLabel(status: string) {
  if (status === payrollStatuses.calculated) {
    return "Obračunat";
  }

  if (status === payrollStatuses.reviewed) {
    return "Pregledan";
  }

  if (status === payrollStatuses.posted) {
    return "Proknjižen";
  }

  if (status === payrollStatuses.locked) {
    return "Zaključan";
  }

  if (status === payrollStatuses.deleted) {
    return "Obrisan";
  }

  return "Nacrt";
}
