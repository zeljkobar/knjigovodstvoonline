import { prisma } from "./prisma";
import { findMunicipalitySurtax } from "./municipalities";

export const payrollStatuses = {
  draft: "DRAFT",
  calculated: "CALCULATED",
  reviewed: "REVIEWED",
  posted: "POSTED",
  locked: "LOCKED",
  deleted: "DELETED"
} as const;

export const payrollCategories = {
  regularWork: "REDOVAN_RAD",
  serviceContract: "UGOVOR_O_DJELU",
  rent: "ZAKUP",
  otherContracts: "OSTALI_UGOVORI"
} as const;

export const payrollCategoryLabels: Record<string, string> = {
  [payrollCategories.regularWork]: "Redovan rad",
  [payrollCategories.serviceContract]: "Ugovor o djelu",
  [payrollCategories.rent]: "Zakup",
  [payrollCategories.otherContracts]: "Ostali ugovori"
};

export const payrollCategoryOptions = Object.entries(payrollCategoryLabels).map(([value, label]) => ({
  value,
  label
}));

export function isPayrollCategory(value: string): value is (typeof payrollCategories)[keyof typeof payrollCategories] {
  return Object.values(payrollCategories).includes(value as never);
}

export function payrollCategoryLabel(category: string) {
  return payrollCategoryLabels[category] ?? category;
}

export function payrollCategoryRequiresEmployment(category: string) {
  return category === payrollCategories.regularWork;
}

export function defaultIncomeCodeForPayrollCategory(category: string) {
  if (category === payrollCategories.serviceContract || category === payrollCategories.otherContracts) {
    return "047";
  }

  if (category === payrollCategories.rent) {
    return "065";
  }

  return "001";
}

export const payrollCalculationTypes = {
  grossWithoutSeniority: "GROSS_WITHOUT_SENIORITY",
  grossWithSeniority: "GROSS_WITH_SENIORITY",
  netWithoutSeniority: "NET_WITHOUT_SENIORITY",
  netWithSeniority: "NET_WITH_SENIORITY",
  coefficientWithSeniority: "COEFFICIENT_WITH_SENIORITY",
  coefficientNetRecalculation: "COEFFICIENT_NET_RECALCULATION",
  coefficientWithoutSeniority: "COEFFICIENT_WITHOUT_SENIORITY",
  netOtherIncome: "NET_OTHER_INCOME",
  grossOtherIncome: "GROSS_OTHER_INCOME",
  gross2OtherIncome: "GROSS2_OTHER_INCOME"
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

type BasisRateLike = {
  tip: string;
  teret: string;
  stopa: { toString(): string } | string | number;
  osnovica_tip: string | null;
};

type BasisRuleLike = {
  id: string;
  osnova_id: string;
  osnovica_pio_tip: string | null;
  osnovica_pio_proc: { toString(): string } | string | number;
  osnovica_rfzo_tip: string | null;
  osnovica_rfzo_proc: { toString(): string } | string | number;
  osnovica_zzz_tip: string | null;
  osnovica_zzz_proc: { toString(): string } | string | number;
  osnovica_porez_tip: string | null;
  osnovica_porez_proc: { toString(): string } | string | number;
  napomena: string | null;
  stope: BasisRateLike[];
};

type IncomeFlags = {
  sifra?: string;
  osnova_obracuna_id?: string | null;
  osnovica_porez_proc_override?: { toString(): string } | string | number | null;
  obracunski_koeficijent?: { toString(): string } | string | number | null;
  koeficijent_tip?: string | null;
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
  seniorityYears?: number;
  seniorityMonths?: number;
  seniorityDays?: number;
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
  seniorityCoefficient: number;
  seniorityAmountCents: number;
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

function percentNumber(value: { toString(): string } | string | number | null | undefined, fallback = 100) {
  if (value === null || value === undefined) {
    return fallback;
  }

  const parsed = Number(value.toString());

  return Number.isFinite(parsed) ? parsed : fallback;
}

function prorateAmount(cents: number, workingHours: number, workingHoursFund: number) {
  if (workingHoursFund <= 0) {
    return cents;
  }

  return Math.round((cents * workingHours) / workingHoursFund);
}

export function calculateSeniorityCoefficient(completedYears: number) {
  const years = Math.max(0, Math.floor(completedYears));
  const firstIntervalYears = Math.min(years, 10);
  const secondIntervalYears = Math.min(Math.max(years - 10, 0), 10);
  const thirdIntervalYears = Math.max(years - 20, 0);

  return firstIntervalYears * 0.005 + secondIntervalYears * 0.0075 + thirdIntervalYears * 0.01;
}

export function calculateCompletedYears(
  startDate: Date | string | null | undefined,
  referenceDate: Date | string | null | undefined
) {
  if (!startDate || !referenceDate) {
    return 0;
  }

  const start = new Date(startDate);
  const reference = new Date(referenceDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(reference.getTime()) || start > reference) {
    return 0;
  }

  let years = reference.getUTCFullYear() - start.getUTCFullYear();
  const referenceMonth = reference.getUTCMonth();
  const startMonth = start.getUTCMonth();

  if (
    referenceMonth < startMonth ||
    (referenceMonth === startMonth && reference.getUTCDate() < start.getUTCDate())
  ) {
    years -= 1;
  }

  return Math.max(0, years);
}

export function effectiveSeniorityYears({
  manualYears,
  startDate,
  referenceDate
}: {
  manualYears?: number | null;
  startDate?: Date | string | null;
  referenceDate?: Date | string | null;
}) {
  const manual = Math.max(0, Math.floor(manualYears ?? 0));

  return manual > 0 ? manual : calculateCompletedYears(startDate, referenceDate);
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

function basisAmount({
  grossCents,
  tip,
  percent
}: {
  grossCents: number;
  tip?: string | null;
  percent: { toString(): string } | string | number;
}) {
  if (!tip) {
    return 0;
  }

  const normalized = tip.toUpperCase();

  if (normalized === "BRUTO" || normalized === "PROCENAT_BRUTO" || normalized === "NETO") {
    return Math.round((grossCents * percentNumber(percent)) / 100);
  }

  return 0;
}

function basisForRate(rate: BasisRateLike, bases: Record<string, number>) {
  const basisType = rate.osnovica_tip?.toUpperCase();

  if (basisType === "OSNOVICA_POREZ") {
    return bases.porez;
  }

  if (basisType === "OSNOVICA_PIO") {
    return bases.pio;
  }

  if (basisType === "OSNOVICA_RFZO") {
    return bases.rfzo;
  }

  if (basisType === "OSNOVICA_ZZZ") {
    return bases.zzz;
  }

  if (basisType === "BRUTO") {
    return bases.bruto;
  }

  if (rate.tip === "POREZ") {
    return bases.porez;
  }

  if (rate.tip === "PIO") {
    return bases.pio;
  }

  if (rate.tip === "RFZO") {
    return bases.rfzo;
  }

  if (rate.tip === "ZZZ") {
    return bases.zzz;
  }

  return bases.bruto;
}

function calculateFromBasisRule({
  grossCents,
  rule,
  surtaxRate,
  taxBasePercentOverride
}: {
  grossCents: number;
  rule: BasisRuleLike;
  surtaxRate: number;
  taxBasePercentOverride?: { toString(): string } | string | number | null;
}) {
  const bases = {
    bruto: grossCents,
    pio: basisAmount({
      grossCents,
      tip: rule.osnovica_pio_tip,
      percent: rule.osnovica_pio_proc
    }),
    rfzo: basisAmount({
      grossCents,
      tip: rule.osnovica_rfzo_tip,
      percent: rule.osnovica_rfzo_proc
    }),
    zzz: basisAmount({
      grossCents,
      tip: rule.osnovica_zzz_tip,
      percent: rule.osnovica_zzz_proc
    }),
    porez: basisAmount({
      grossCents,
      tip: rule.osnovica_porez_tip,
      percent: taxBasePercentOverride ?? rule.osnovica_porez_proc
    })
  };
  let personalIncomeTaxCents = 0;
  let employeePioCents = 0;
  let employeeHealthCents = 0;
  let employeeUnemploymentCents = 0;
  let employerPioCents = 0;
  let employerHealthCents = 0;
  let employerUnemploymentCents = 0;
  let laborFundCents = 0;
  let unionCents = 0;
  let chamberCents = 0;

  for (const rate of rule.stope) {
    const amount = roundedRateAmount(basisForRate(rate, bases), rateNumber(rate));
    const type = rate.tip.toUpperCase();
    const burden = rate.teret.toUpperCase();

    if (type === "POREZ") {
      personalIncomeTaxCents += amount;
    } else if (type === "PIO" && burden === "ZAPOSLENI") {
      employeePioCents += amount;
    } else if (type === "RFZO" && burden === "ZAPOSLENI") {
      employeeHealthCents += amount;
    } else if (type === "ZZZ" && burden === "ZAPOSLENI") {
      employeeUnemploymentCents += amount;
    } else if (type === "PIO" && burden === "POSLODAVAC") {
      employerPioCents += amount;
    } else if (type === "RFZO" && burden === "POSLODAVAC") {
      employerHealthCents += amount;
    } else if (type === "ZZZ" && burden === "POSLODAVAC") {
      employerUnemploymentCents += amount;
    } else if (type === "FOND_RADA") {
      laborFundCents += amount;
    } else if (type === "SINDIKAT") {
      unionCents += amount;
    } else if (type === "KOMORA" || type === "PRIVREDNA_KOMORA") {
      chamberCents += amount;
    }
  }

  const surtaxCents = roundedRateAmount(personalIncomeTaxCents, surtaxRate);
  const totalEmployeeContributionsCents =
    employeePioCents + employeeHealthCents + employeeUnemploymentCents;
  const totalEmployerContributionsCents =
    employerPioCents + employerHealthCents + employerUnemploymentCents + laborFundCents + unionCents + chamberCents;
  const netAmountCents =
    grossCents - totalEmployeeContributionsCents - personalIncomeTaxCents - surtaxCents;

  return {
    netAmountCents,
    grossAmountCents: grossCents,
    taxableGrossCents: bases.porez || grossCents,
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
    netForPaymentCents: netAmountCents,
    bases
  };
}

function grossFromNetWithCalculator(
  targetNetCents: number,
  calculateNet: (grossCents: number) => number
) {
  let low = targetNetCents;
  let high = Math.max(targetNetCents * 2, 100000);

  while (calculateNet(high) < targetNetCents) {
    high *= 2;
  }

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const calculatedNet = calculateNet(mid);

    if (calculatedNet >= targetNetCents) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  return low;
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
  return grossFromNetWithCalculator(targetNetCents, (grossCents) =>
    calculateFromGross({
      grossCents,
      rates,
      taxBrackets,
      incomeType,
      surtaxRate
    }).netAmountCents
  );
}

async function activeBasisRuleForIncomeType(incomeType: IncomeFlags, calculationDate: Date) {
  if (incomeType.sifra === "001" || (!incomeType.osnova_obracuna_id && !incomeType.sifra)) {
    return null;
  }

  const basis = await prisma.plateOsnovaObracuna.findFirst({
    where: {
      ...(incomeType.osnova_obracuna_id ? { id: incomeType.osnova_obracuna_id } : { sifra: incomeType.sifra }),
      ...activeOn(calculationDate)
    },
    orderBy: {
      valid_from: "desc"
    },
    select: {
      id: true
    }
  });

  if (!basis && incomeType.osnova_obracuna_id && incomeType.sifra) {
    const fallbackBasis = await prisma.plateOsnovaObracuna.findFirst({
      where: {
        sifra: incomeType.sifra,
        ...activeOn(calculationDate)
      },
      orderBy: {
        valid_from: "desc"
      },
      select: {
        id: true
      }
    });

    if (!fallbackBasis) {
      return null;
    }

    return activeBasisRuleByBasisId(fallbackBasis.id, calculationDate);
  }

  return basis ? activeBasisRuleByBasisId(basis.id, calculationDate) : null;
}

function activeBasisRuleByBasisId(basisId: string, calculationDate: Date) {
  return prisma.plateOsnovaPravilo.findFirst({
    where: {
      osnova_id: basisId,
      ...activeOn(calculationDate)
    },
    orderBy: {
      valid_from: "desc"
    },
    select: {
      id: true,
      osnova_id: true,
      osnovica_pio_tip: true,
      osnovica_pio_proc: true,
      osnovica_rfzo_tip: true,
      osnovica_rfzo_proc: true,
      osnovica_zzz_tip: true,
      osnovica_zzz_proc: true,
      osnovica_porez_tip: true,
      osnovica_porez_proc: true,
      napomena: true,
      stope: {
        where: activeOn(calculationDate),
        select: {
          tip: true,
          teret: true,
          stopa: true,
          osnovica_tip: true
        }
      }
    }
  });
}

export async function calculatePayrollLine(input: PayrollLineInput): Promise<PayrollLineResult> {
  const [rates, taxBrackets, surtax, basisRule] = await Promise.all([
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
      ? findMunicipalitySurtax(input.municipality, input.calculationDate)
      : null,
    activeBasisRuleForIncomeType(input.incomeType, input.calculationDate)
  ]);
  const surtaxRate = rateNumber(surtax);
  const ruleBasedCalculation =
    input.incomeType.sifra !== "001" && basisRule && basisRule.stope.length > 0
      ? basisRule
      : null;
  const workingHours = input.workingHours || input.workingHoursFund;
  const workingHoursFund = input.workingHoursFund || workingHours || 1;
  const usesSeniority =
    input.usesSeniority && input.calculationType.koristi_minuli_rad;
  const completedSeniorityYears = Math.max(0, Math.floor(input.seniorityYears ?? 0));
  const seniorityRuleCoefficient = calculateSeniorityCoefficient(completedSeniorityYears);
  const seniorityCoefficient =
    usesSeniority && seniorityRuleCoefficient > 0
      ? seniorityRuleCoefficient
      : usesSeniority
        ? Math.max(0, input.seniorityCoefficient)
        : 0;
  let baseAmountCents = 0;
  const incomeCoefficient = Math.max(
    0,
    percentNumber(input.incomeType.obracunski_koeficijent, 1)
  );
  const appliesIncomeCoefficient =
    input.incomeType.koeficijent_tip === "IZNOS" && incomeCoefficient !== 1;

  if (input.calculationType.koristi_koeficijent) {
    baseAmountCents = Math.round(
      input.fixedPartCents * (input.complexityCoefficient || 0)
    );
  } else if (input.calculationType.input_type === "GROSS") {
    baseAmountCents = input.grossAmountCents;
  } else {
    baseAmountCents = input.netAmountCents;
  }

  if (appliesIncomeCoefficient) {
    baseAmountCents = Math.round(baseAmountCents * incomeCoefficient);
  }

  baseAmountCents = prorateAmount(baseAmountCents, workingHours, workingHoursFund);
  let amountForCalculationCents = baseAmountCents;
  let seniorityAmountCents = 0;

  if (usesSeniority && input.calculationType.seniority_mode === "ADD_TO_BASE_BEFORE_GROSSING") {
    seniorityAmountCents = roundedRateAmount(baseAmountCents, seniorityCoefficient);
    amountForCalculationCents += seniorityAmountCents;
  }

  let grossCents = 0;

  if (
    input.calculationType.input_type === "NET" ||
    input.calculationType.algoritam === "NET_TO_GROSS" ||
    input.calculationType.algoritam === "COEFFICIENT_TO_NET"
  ) {
    grossCents = ruleBasedCalculation
      ? grossFromNetWithCalculator(amountForCalculationCents, (candidateGrossCents) =>
          calculateFromBasisRule({
            grossCents: candidateGrossCents,
            rule: ruleBasedCalculation,
            surtaxRate,
            taxBasePercentOverride: input.incomeType.osnovica_porez_proc_override
          }).netAmountCents
        )
      : grossFromNet({
          targetNetCents: amountForCalculationCents,
          rates,
          taxBrackets,
          incomeType: input.incomeType,
          surtaxRate
        });
  } else {
    grossCents = amountForCalculationCents;

    if (usesSeniority && input.calculationType.seniority_mode !== "ADD_TO_BASE_BEFORE_GROSSING") {
      seniorityAmountCents = roundedRateAmount(grossCents, seniorityCoefficient);
      grossCents += seniorityAmountCents;
      amountForCalculationCents = grossCents;
    }
  }

  const result = ruleBasedCalculation
    ? calculateFromBasisRule({
        grossCents,
        rule: ruleBasedCalculation,
        surtaxRate,
        taxBasePercentOverride: input.incomeType.osnovica_porez_proc_override
      })
    : calculateFromGross({
        grossCents,
        rates,
        taxBrackets,
        incomeType: input.incomeType,
        surtaxRate
      });
  const basisRuleBases = "bases" in result ? result.bases : null;

  return {
    baseAmountCents,
    amountForCalculationCents,
    ...result,
    surtaxRate,
    seniorityCoefficient,
    seniorityAmountCents,
    details: {
      inputType: input.calculationType.input_type,
      algorithm: input.calculationType.algoritam,
      workingHours,
      workingHoursFund,
      usesSeniority,
      seniorityCompletedYears: completedSeniorityYears,
      seniorityMonths: Math.max(0, Math.floor(input.seniorityMonths ?? 0)),
      seniorityDays: Math.max(0, Math.floor(input.seniorityDays ?? 0)),
      seniorityCoefficient,
      seniorityPercent: seniorityCoefficient * 100,
      seniorityAmountCents,
      seniorityRule: "CG_PROGRESSIVE_COMPLETED_YEARS",
      incomeCoefficient,
      incomeCoefficientType: input.incomeType.koeficijent_tip ?? "NE_PRIMJENJUJE",
      incomeCoefficientApplied: appliesIncomeCoefficient,
      taxBasePercentOverride:
        input.incomeType.osnovica_porez_proc_override === null ||
        input.incomeType.osnovica_porez_proc_override === undefined
          ? null
          : percentNumber(input.incomeType.osnovica_porez_proc_override),
      basisRule: ruleBasedCalculation
        ? {
            ruleId: ruleBasedCalculation.id,
            basisId: ruleBasedCalculation.osnova_id,
            incomeCode: input.incomeType.sifra,
            taxBaseType: ruleBasedCalculation.osnovica_porez_tip,
            taxBasePercent:
              input.incomeType.osnovica_porez_proc_override === null ||
              input.incomeType.osnovica_porez_proc_override === undefined
                ? percentNumber(ruleBasedCalculation.osnovica_porez_proc)
                : percentNumber(input.incomeType.osnovica_porez_proc_override),
            pioBaseType: ruleBasedCalculation.osnovica_pio_tip,
            pioBasePercent: percentNumber(ruleBasedCalculation.osnovica_pio_proc),
            healthBaseType: ruleBasedCalculation.osnovica_rfzo_tip,
            healthBasePercent: percentNumber(ruleBasedCalculation.osnovica_rfzo_proc),
            unemploymentBaseType: ruleBasedCalculation.osnovica_zzz_tip,
            unemploymentBasePercent: percentNumber(ruleBasedCalculation.osnovica_zzz_proc),
            note: ruleBasedCalculation.napomena,
            rates: ruleBasedCalculation.stope.map((rate) => ({
              type: rate.tip,
              burden: rate.teret,
              rate: rateNumber(rate),
              baseType: rate.osnovica_tip
            })),
            bases: basisRuleBases
          }
        : null
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
