export const openingBalanceJournalType = "OPENING_BALANCE";
export const openingBalanceSourceType = "OPENING_BALANCE";
export const openingBalanceSourceModule = "nalozi";

export type OpeningBalanceSourceLine = {
  duguje: unknown;
  potrazuje: unknown;
  komitent_id: string | null;
  komitent: {
    naziv: string;
  } | null;
  firma_konto: {
    id: string;
    sifra: string;
    naziv: string;
  };
};

export type OpeningBalanceLine = {
  accountId: string;
  accountCode: string;
  accountName: string;
  partnerId: string | null;
  partnerName: string | null;
  debitCents: number;
  creditCents: number;
};

function decimalToCents(value: unknown) {
  return Math.round(Number(value) * 100);
}

export function buildOpeningBalanceLines(sourceLines: OpeningBalanceSourceLine[]) {
  const grouped = new Map<
    string,
    Omit<OpeningBalanceLine, "debitCents" | "creditCents"> & { balanceCents: number }
  >();

  for (const line of sourceLines) {
    const key = `${line.firma_konto.id}:${line.komitent_id ?? ""}`;
    const existing = grouped.get(key) ?? {
      accountId: line.firma_konto.id,
      accountCode: line.firma_konto.sifra,
      accountName: line.firma_konto.naziv,
      partnerId: line.komitent_id,
      partnerName: line.komitent?.naziv ?? null,
      balanceCents: 0
    };

    existing.balanceCents +=
      decimalToCents(line.duguje) - decimalToCents(line.potrazuje);
    grouped.set(key, existing);
  }

  return Array.from(grouped.values())
    .filter((line) => line.balanceCents !== 0)
    .map<OpeningBalanceLine>((line) => ({
      accountId: line.accountId,
      accountCode: line.accountCode,
      accountName: line.accountName,
      partnerId: line.partnerId,
      partnerName: line.partnerName,
      debitCents: line.balanceCents > 0 ? line.balanceCents : 0,
      creditCents: line.balanceCents < 0 ? Math.abs(line.balanceCents) : 0
    }))
    .sort(
      (left, right) =>
        left.accountCode.localeCompare(right.accountCode, "sr-Latn") ||
        (left.partnerName ?? "").localeCompare(right.partnerName ?? "", "sr-Latn")
    );
}

export function openingBalanceTotals(lines: OpeningBalanceLine[]) {
  return lines.reduce(
    (totals, line) => ({
      debitCents: totals.debitCents + line.debitCents,
      creditCents: totals.creditCents + line.creditCents
    }),
    {
      debitCents: 0,
      creditCents: 0
    }
  );
}

export function accountClassFilter(accountClasses: string[]) {
  return accountClasses.map((accountClass) => ({
    firma_konto: {
      sifra: {
        startsWith: accountClass
      }
    }
  }));
}
