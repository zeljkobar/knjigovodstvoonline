export type SettlementItem = {
  id: string; accountId: string; partnerId: string; document: string;
  date: string; signedCents: number; remainingCents: number;
};
export type SettlementPair = { debitId: string; creditId: string; cents: number };
// Exact matching is deliberately mutual: repeated equal invoices or payments
// are ambiguous even when iteration order would happen to pick a winner.
export function exactSettlementPlan(items: SettlementItem[]): SettlementPair[] {
  const candidates = items.filter(i => i.remainingCents !== 0);
  const matches = (a: SettlementItem, b: SettlementItem) => a.accountId === b.accountId && a.partnerId === b.partnerId && a.remainingCents === -b.remainingCents;
  return candidates.filter(i => i.remainingCents > 0).flatMap(d => {
    const credits = candidates.filter(c => matches(d, c));
    if (credits.length !== 1 || candidates.filter(other => matches(credits[0], other)).length !== 1) return [];
    return [{ debitId: d.id, creditId: credits[0].id, cents: d.remainingCents }];
  });
}
export function oldestSettlementPlan(items: SettlementItem[]): SettlementPair[] {
  const sorted = items.filter(i => i.remainingCents).map(i => ({ ...i })).sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const result: SettlementPair[] = [];
  for (const debit of sorted.filter(i => i.remainingCents > 0)) {
    for (const credit of sorted.filter(i => i.remainingCents < 0 && i.accountId === debit.accountId && i.partnerId === debit.partnerId)) {
      const cents = Math.min(debit.remainingCents, -credit.remainingCents);
      if (cents <= 0) continue;
      result.push({ debitId: debit.id, creditId: credit.id, cents });
      debit.remainingCents -= cents; credit.remainingCents += cents;
    }
  }
  return result;
}
