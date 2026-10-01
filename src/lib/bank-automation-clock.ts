export function bankAutomationDay(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Podgorica", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return { day: `${part("year")}-${part("month")}-${part("day")}`, due: Number(part("hour")) >= 10 };
}
