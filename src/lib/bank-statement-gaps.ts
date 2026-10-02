export function statementSequenceNumber(raw: string, year: number): number | null {
  const match = raw.trim().match(/^(\d+)(?:\s*\/\s*(\d{4}))?$/);
  if (!match || (match[2] && Number(match[2]) !== year)) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) && number > 0 && number <= 2147483647 ? number : null;
}

export function bankStatementGaps(numbers: readonly string[], year: number) {
  const recognized = numbers.map(raw => statementSequenceNumber(raw, year));
  const sorted = [...new Set(recognized.filter((n): n is number => n !== null))].sort((a,b)=>a-b);
  const ranges: {from: number; to: number}[] = [];
  let previous = 0;
  let missingCount = 0;
  for (const current of sorted) {
    if (current > previous + 1) {
      ranges.push({from: previous + 1, to: current - 1});
      missingCount += current - previous - 1;
    }
    previous = current;
  }
  return { ranges, missingCount, highest: sorted.at(-1) ?? null,
    unrecognized: numbers.filter((_,i)=>recognized[i] === null), presentCount: sorted.length };
}
