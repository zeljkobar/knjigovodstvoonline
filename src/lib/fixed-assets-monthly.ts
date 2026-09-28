import { calculateLegacyPeriods, type FixedAssetCalculationInput, type FixedAssetCalculationResult, type FixedAssetCalculationLine } from "./fixed-assets-calculation";
import { scaledDecimal, rateAlgorithm, derivedUnitRate } from "./fixed-assets-rates";

// Exact fractions allow cumulative half-up rounding across 28/29/30/31-day months.
type Fraction = { n: bigint; d: bigint };
const fraction = (n: bigint, d = BigInt(1)): Fraction => ({ n, d });
function gcd(a: bigint, b: bigint): bigint { return b === BigInt(0) ? a : gcd(b, a % b); }
function add(a: Fraction, b: Fraction): Fraction {
  const n = a.n * b.d + b.n * a.d, d = a.d * b.d, g = gcd(n, d);
  return { n: n / g, d: d / g };
}
const mul = (a: Fraction, n: bigint, d = BigInt(1)): Fraction => ({ n: a.n * n, d: a.d * d });
const round = (a: Fraction) => Number((a.n * BigInt(2) + a.d) / (BigInt(2) * a.d));
const date = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const days = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);
const monthEnd = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
const min = (...ds: Date[]) => new Date(Math.min(...ds.map(d => d.getTime())));
const max = (a: Date, b: Date) => a > b ? a : b;
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(date(s).getTime()) && iso(date(s)) === s;
function endOfLife(start: Date, months: number) {
  const target = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(start.getUTCDate(), days(target, monthEnd(target)))));
}
function monthsBetween(start: Date, end: Date): Fraction {
  let result = fraction(BigInt(0));
  for (let d = start; d < end; d = monthEnd(d)) {
    const e = min(monthEnd(d), end);
    result = add(result, fraction(BigInt(days(d, e)), BigInt(days(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)), monthEnd(d)))));
  }
  return result;
}
export function calculateRatePeriods(input: FixedAssetCalculationInput): FixedAssetCalculationResult {
  const fail = (code: FixedAssetCalculationResult["errors"][number]["code"], parameterId?: string, detail?: string): FixedAssetCalculationResult => ({ algorithm: rateAlgorithm, lines: [], totalCents: 0, errors: [{ code, parameterId, detail }] });
  if (![input.availableDate, input.periodFrom, input.periodTo, ...(input.disposalDate ? [input.disposalDate] : [])].every(validDate) || input.periodFrom > input.periodTo || (input.disposalDate && input.disposalDate < input.availableDate)) return fail("INVALID_PERIOD");
  if (![input.grossCents, input.accumulatedCents].every(n => Number.isSafeInteger(n) && n >= 0) || input.accumulatedCents > input.grossCents) return fail("INVALID_VALUE");
  if (!input.parameters.length) return fail("MISSING_PARAMETERS");
  const parameters = [...input.parameters].sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  for (let i = 0; i < parameters.length; i++) {
    const p = parameters[i];
    if (!validDate(p.effectiveFrom) || p.effectiveFrom < input.availableDate || p.effectiveFrom === parameters[i-1]?.effectiveFrom || !Number.isSafeInteger(p.residualCents) || p.residualCents < 0) return fail("INVALID_PARAMETER", p.id);
    if (p.algorithm && ![rateAlgorithm, "ACTUAL_DAYS_LIFE_V1"].includes(p.algorithm)) return fail("INVALID_PARAMETER", p.id);
  }
  const until = min(day(date(input.periodTo), 1), input.disposalDate ? date(input.disposalDate) : day(date(input.periodTo), 1));
  const queryStart = date(input.periodFrom);
  let accumulated = input.accumulatedCents;
  const lines: FixedAssetCalculationLine[] = [];
  for (let i = 0; i < parameters.length; i++) {
    const p = parameters[i], start = date(p.effectiveFrom);
    if (start >= until) break;
    const segmentEnd = min(until, parameters[i+1] ? date(parameters[i+1].effectiveFrom) : until);
    if (p.residualCents > input.grossCents - accumulated) return fail("INVALID_PARAMETER", p.id, "Ostatak premašuje neto vrijednost na datum promjene.");
    if (!p.algorithm || p.algorithm === "ACTUAL_DAYS_LIFE_V1") {
      const all = calculateLegacyPeriods({ ...input, accumulatedCents: accumulated, parameters: [p], periodFrom: p.effectiveFrom, periodTo: iso(day(segmentEnd, -1)) });
      if (all.errors.length) return all;
      if (queryStart < segmentEnd) {
        const visible = calculateLegacyPeriods({ ...input, accumulatedCents: accumulated, parameters: [p], periodFrom: iso(max(start,queryStart)), periodTo: iso(day(segmentEnd,-1)) });
        lines.push(...visible.lines.map(l => ({ ...l, method: "LINEAR", algorithm: "ACTUAL_DAYS_LIFE_V1" })));
      }
      accumulated += all.totalCents;
      continue;
    }
    const remaining = input.grossCents - accumulated - p.residualCents;
    const basis = p.basisCents;
    if (basis == null || !Number.isSafeInteger(basis) || basis < 0 || basis > input.grossCents) return fail("INVALID_PARAMETER",p.id);
    const initialAccumulated = accumulated;
    let cumulative = fraction(BigInt(0));
    const annualRate = scaledDecimal(p.annualRate);
    const totalUnits = scaledDecimal(p.expectedUnits), priorUnits = scaledDecimal(p.priorUnits ?? "0"), unitRate = scaledDecimal(p.unitRate);
    const functional = p.method === "UNITS_OF_PRODUCTION";
    if (!functional && !["LINEAR","DEGRESSIVE"].includes(p.method)) return fail("UNSUPPORTED_METHOD",p.id);
    if (!functional && (annualRate === null || annualRate <= BigInt(0) || annualRate > BigInt(100_000_000))) return fail("INVALID_PARAMETER",p.id);
    if (functional && (totalUnits === null || totalUnits <= BigInt(0) || priorUnits === null || priorUnits > totalUnits || !["DERIVED","MANUAL"].includes(p.rateSource ?? "") || (p.rateSource === "MANUAL" && (unitRate === null || unitRate <= BigInt(0))))) return fail("INVALID_PARAMETER",p.id);
    if (p.method === "DEGRESSIVE" && (!Number.isInteger(p.usefulLifeMonths) || p.usefulLifeMonths < 1 || p.usefulLifeMonths > 1200)) return fail("INVALID_PARAMETER",p.id);
    const end = p.method === "DEGRESSIVE" ? min(segmentEnd,endOfLife(start,p.usefulLifeMonths)) : segmentEnd;
    if (functional) cumulative = p.rateSource === "MANUAL"
      ? fraction(priorUnits! * unitRate! * BigInt(100), BigInt(1_000_000_000_000))
      : fraction(BigInt(basis) * priorUnits!, totalUnits!);
    const carriedAmount = functional ? round(cumulative) : 0;
    const amount = (value: Fraction) => Math.min(remaining, round(value) - carriedAmount);
    let units = priorUnits ?? BigInt(0);
    let year = -1, annual = fraction(BigInt(0)), switched = false;
    let annualBasis = basis;
    const usages = (input.usage ?? []).filter(u => u.parameterId === p.id).sort((a,b) => a.from.localeCompare(b.from));
    for (let j=0;j<usages.length;j++) {
      const u = usages[j];
      if (!validDate(u.from) || !validDate(u.to) || u.from > u.to || u.from < p.effectiveFrom || u.from.slice(0,7) !== u.to.slice(0,7) || (parameters[i+1] && u.to >= parameters[i+1].effectiveFrom) || (input.disposalDate && u.to >= input.disposalDate) || (j>0 && u.from <= usages[j-1].to) || scaledDecimal(u.quantity) === null) return fail("INVALID_USAGE",p.id);
    }
    for (let cursor = start; cursor < end;) {
      const e = min(monthEnd(cursor), end), monthDays = days(new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth(),1)),monthEnd(cursor));
      if (functional) {
        let covered = cursor;
        const relevant = usages.filter(u => date(u.to) >= cursor && date(u.from) < e);
        for (const u of relevant) {
          // Never interpolate a quantity across a requested partial interval.
          if (date(u.from).getTime() !== covered.getTime() || day(date(u.to),1) > e || (queryStart > date(u.from) && queryStart <= date(u.to))) return fail("INVALID_USAGE",p.id, "Uskladite period obračuna sa granicama unesenog učinka.");
          const quantity = scaledDecimal(u.quantity)!;
          units += quantity;
          if (units > totalUnits!) return fail("INVALID_USAGE",p.id,"Učinak premašuje procijenjeni kapacitet; unesite novu procjenu.");
          const before = amount(cumulative);
          cumulative = add(cumulative, p.rateSource === "MANUAL" ? fraction(quantity * unitRate! * BigInt(100), BigInt(1_000_000_000_000)) : fraction(BigInt(basis) * quantity, totalUnits!));
          const after = amount(cumulative);
          const uEnd = day(date(u.to),1);
          if (uEnd > queryStart) push(date(u.from),uEnd,before,after,u.quantity);
          covered = uEnd;
        }
        if (covered < e) return fail("MISSING_USAGE",p.id, `${iso(covered)} – ${iso(day(e,-1))}`);
      } else {
        if (cursor.getUTCFullYear() !== year) {
          year = cursor.getUTCFullYear();
          const net = input.grossCents - initialAccumulated - amount(cumulative);
          annualBasis = p.method === "LINEAR" ? basis : net;
          annual = fraction(BigInt(annualBasis) * annualRate!,BigInt(100_000_000));
          if (p.method === "DEGRESSIVE") {
            const months = monthsBetween(cursor,endOfLife(start,p.usefulLifeMonths));
            const straight = fraction(BigInt(Math.max(0,net-p.residualCents)) * BigInt(12) * months.d,months.n);
            if (switched || straight.n * annual.d >= annual.n * straight.d) { annual = straight; switched = true; annualBasis = Math.max(0, net-p.residualCents); }
          }
        }
        const portion = (to: Date) => add(cumulative, mul(annual,BigInt(days(cursor,to)),BigInt(12*monthDays)));
        const visibleStart = max(cursor,queryStart);
        if (visibleStart < e) push(visibleStart,e,Math.min(remaining,round(portion(visibleStart))),Math.min(remaining,round(portion(e))));
        cumulative = portion(e);
      }
      cursor = e;
    }
    accumulated = initialAccumulated + amount(cumulative);
    function push(from: Date, to: Date, before: number, after: number, quantity?: string) {
      lines.push({ assetId: input.assetId, parameterId: p.id, algorithm: rateAlgorithm, method: p.method, rate: functional ? (p.rateSource === "MANUAL" ? p.unitRate! : derivedUnitRate(basis!,p.expectedUnits!)!) : `${p.annualRate}%${switched ? " → linearni završetak" : ""}`, quantity,
        month: iso(from).slice(0,7),segment: i+1,segmentStart: iso(from),segmentEnd: iso(to),elapsedDays: days(from,to),totalDays: days(new Date(Date.UTC(from.getUTCFullYear(),from.getUTCMonth(),1)),monthEnd(from)),basisCents: annualBasis,residualCents: p.residualCents,accumulatedBeforeCents: initialAccumulated+before,amountCents: after-before,accumulatedAfterCents: initialAccumulated+after,netAfterCents: input.grossCents-initialAccumulated-after });
    }
  }
  return { algorithm: rateAlgorithm, lines, totalCents: lines.reduce((s,l) => s+l.amountCents,0), errors: [] };
}
