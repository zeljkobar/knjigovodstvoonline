import { calculateRatePeriods } from "./fixed-assets-monthly";
export const fixedAssetCalculationAlgorithm = "ACTUAL_DAYS_LIFE_V1";

export type FixedAssetCalculationParameter = {
  id: string;
  effectiveFrom: string;
  method: "LINEAR" | string;
  usefulLifeMonths: number;
  algorithm?: string;
  annualRate?: string | null;
  basisCents?: number | null;
  expectedUnits?: string | null;
  priorUnits?: string | null;
  unitRate?: string | null;
  rateSource?: string | null;
  residualCents: number;
};

export type FixedAssetCalculationInput = {
  assetId: string;
  grossCents: number;
  accumulatedCents: number;
  availableDate: string;
  disposalDate?: string | null;
  periodFrom: string;
  periodTo: string;
  parameters: FixedAssetCalculationParameter[];
  usage?: { parameterId: string; from: string; to: string; quantity: string }[];
};

export type FixedAssetCalculationError = {
  code:
    | "INVALID_PERIOD"
    | "INVALID_VALUE"
    | "MISSING_PARAMETERS"
    | "INVALID_PARAMETER"
    | "UNSUPPORTED_METHOD"
    | "MISSING_USAGE"
    | "INVALID_USAGE";
  parameterId?: string;
  detail?: string;
};

export type FixedAssetCalculationLine = {
  assetId: string;
  parameterId: string;
  method?: string;
  rate?: string;
  quantity?: string;
  algorithm?: string;
  month: string;
  segment: number;
  segmentStart: string;
  segmentEnd: string;
  elapsedDays: number;
  totalDays: number;
  basisCents: number;
  residualCents: number;
  accumulatedBeforeCents: number;
  amountCents: number;
  accumulatedAfterCents: number;
  netAfterCents: number;
};

export type FixedAssetCalculationResult = {
  algorithm: string;
  lines: FixedAssetCalculationLine[];
  totalCents: number;
  errors: FixedAssetCalculationError[];
};

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(value: string) {
  if (!isoDatePattern.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}

function toDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + days
  ));
}

function addMonthsClamped(date: Date, months: number) {
  const targetMonthIndex = date.getUTCMonth() + months;
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();

  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    Math.min(date.getUTCDate(), lastDay)
  ));
}

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function nextMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function daysBetween(from: Date, to: Date) {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function laterDate(first: Date, second: Date) {
  return first > second ? first : second;
}

function earlierDate(first: Date, second: Date) {
  return first < second ? first : second;
}

function roundHalfUp(numerator: bigint, denominator: bigint) {
  const two = BigInt(2);

  return (numerator * two + denominator) / (denominator * two);
}

function cumulativeAmount(basisCents: number, elapsedDays: number, totalDays: number) {
  if (elapsedDays <= 0 || basisCents <= 0) {
    return 0;
  }

  if (elapsedDays >= totalDays) {
    return basisCents;
  }

  return Number(roundHalfUp(BigInt(basisCents) * BigInt(elapsedDays), BigInt(totalDays)));
}

function invalidMoney(value: number) {
  return !Number.isSafeInteger(value) || value < 0;
}

export function calculateLegacyPeriods(
  input: FixedAssetCalculationInput
): FixedAssetCalculationResult {
  const emptyResult = (errors: FixedAssetCalculationError[]): FixedAssetCalculationResult => ({
    algorithm: fixedAssetCalculationAlgorithm,
    lines: [],
    totalCents: 0,
    errors
  });
  const availableDate = parseDateOnly(input.availableDate);
  const periodFrom = parseDateOnly(input.periodFrom);
  const periodTo = parseDateOnly(input.periodTo);
  const disposalDate = input.disposalDate ? parseDateOnly(input.disposalDate) : null;

  if (!availableDate || !periodFrom || !periodTo || periodFrom > periodTo || (input.disposalDate && !disposalDate)) {
    return emptyResult([{ code: "INVALID_PERIOD" }]);
  }

  if (
    invalidMoney(input.grossCents) ||
    invalidMoney(input.accumulatedCents) ||
    input.accumulatedCents > input.grossCents
  ) {
    return emptyResult([{ code: "INVALID_VALUE" }]);
  }

  if (input.parameters.length === 0) {
    return emptyResult([{ code: "MISSING_PARAMETERS" }]);
  }

  const parameters = input.parameters
    .map((parameter) => ({
      ...parameter,
      date: parseDateOnly(parameter.effectiveFrom)
    }))
    .sort((first, second) =>
      (first.date?.getTime() ?? 0) - (second.date?.getTime() ?? 0)
    );
  const parameterErrors: FixedAssetCalculationError[] = [];

  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index];
    const previous = parameters[index - 1];

    if (parameter.method !== "LINEAR") {
      parameterErrors.push({ code: "UNSUPPORTED_METHOD", parameterId: parameter.id });
    }
    if (
      !parameter.date ||
      parameter.date < availableDate ||
      !Number.isInteger(parameter.usefulLifeMonths) ||
      parameter.usefulLifeMonths <= 0 ||
      parameter.usefulLifeMonths > 1200 ||
      invalidMoney(parameter.residualCents) ||
      (previous?.date && parameter.date.getTime() === previous.date.getTime())
    ) {
      parameterErrors.push({ code: "INVALID_PARAMETER", parameterId: parameter.id });
    }
  }

  if (parameterErrors.length > 0) {
    return emptyResult(parameterErrors);
  }

  if (disposalDate && disposalDate < availableDate) {
    return emptyResult([{ code: "INVALID_PERIOD" }]);
  }

  const periodEndExclusive = addDays(periodTo, 1);
  const calculationEnd = disposalDate
    ? earlierDate(periodEndExclusive, disposalDate)
    : periodEndExclusive;
  const lines: FixedAssetCalculationLine[] = [];
  const segmentCounts = new Map<string, number>();
  let depreciationBeforeSegment = 0;
  let netAtSegmentStart = input.grossCents - input.accumulatedCents;

  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index];
    const segmentStart = parameter.date!;
    const plannedEnd = addMonthsClamped(segmentStart, parameter.usefulLifeMonths);
    const nextParameterDate = parameters[index + 1]?.date;
    let segmentEnd = nextParameterDate
      ? earlierDate(plannedEnd, nextParameterDate)
      : plannedEnd;

    if (disposalDate) {
      segmentEnd = earlierDate(segmentEnd, disposalDate);
    }

    const totalDays = daysBetween(segmentStart, plannedEnd);
    const basisCents = Math.max(0, netAtSegmentStart - parameter.residualCents);
    const effectiveSegmentDays = Math.max(0, daysBetween(segmentStart, segmentEnd));
    const depreciationAtSegmentEnd = cumulativeAmount(
      basisCents,
      effectiveSegmentDays,
      totalDays
    );
    const visibleStart = laterDate(segmentStart, periodFrom);
    const visibleEnd = earlierDate(segmentEnd, calculationEnd);

    if (visibleStart < visibleEnd && basisCents > 0) {
      let monthStart = startOfMonth(visibleStart);

      while (monthStart < visibleEnd) {
        const monthEnd = nextMonth(monthStart);
        const lineStart = laterDate(visibleStart, monthStart);
        const lineEnd = earlierDate(visibleEnd, monthEnd);

        if (lineStart < lineEnd) {
          const elapsedAtStart = daysBetween(segmentStart, lineStart);
          const elapsedAtEnd = daysBetween(segmentStart, lineEnd);
          const amountBefore = cumulativeAmount(basisCents, elapsedAtStart, totalDays);
          const amountAfter = cumulativeAmount(basisCents, elapsedAtEnd, totalDays);
          const amountCents = amountAfter - amountBefore;
          const accumulatedBeforeCents =
            input.accumulatedCents + depreciationBeforeSegment + amountBefore;
          const accumulatedAfterCents = accumulatedBeforeCents + amountCents;
          const month = toDateOnly(monthStart).slice(0, 7);
          const segment = (segmentCounts.get(month) ?? 0) + 1;

          segmentCounts.set(month, segment);

          lines.push({
            assetId: input.assetId,
            parameterId: parameter.id,
            month,
            segment,
            segmentStart: toDateOnly(lineStart),
            segmentEnd: toDateOnly(lineEnd),
            elapsedDays: daysBetween(lineStart, lineEnd),
            totalDays,
            basisCents,
            residualCents: parameter.residualCents,
            accumulatedBeforeCents,
            amountCents,
            accumulatedAfterCents,
            netAfterCents: input.grossCents - accumulatedAfterCents
          });
        }

        monthStart = monthEnd;
      }
    }

    depreciationBeforeSegment += depreciationAtSegmentEnd;
    netAtSegmentStart -= depreciationAtSegmentEnd;
  }

  return {
    algorithm: fixedAssetCalculationAlgorithm,
    lines,
    totalCents: lines.reduce((sum, line) => sum + line.amountCents, 0),
    errors: []
  };
}

export function calculateAssetPeriods(input: FixedAssetCalculationInput): FixedAssetCalculationResult {
  return input.parameters.every(p => !p.algorithm || p.algorithm === fixedAssetCalculationAlgorithm)
    ? calculateLegacyPeriods(input) : calculateRatePeriods(input);
}
