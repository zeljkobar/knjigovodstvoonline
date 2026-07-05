import type { Prisma } from "@prisma/client";
import { standardJournalTypes } from "./journals";
import { prisma } from "./prisma";

export const financialReportTypes = {
  incomeStatement: "BILANS_USPJEHA",
  balanceSheet: "BILANS_STANJA",
  statisticalAnnex: "STATISTICKI_ANEKS"
} as const;

type ReportPosition = {
  id: string;
  rbr: number;
  uslov: string | null;
  bold: boolean;
  grupa: number;
  pozicija: string;
  aop: string | null;
  nivo: number;
  prikazi: boolean;
  formula: string | null;
  konto: string | null;
  preskoci_konta: string | null;
  rucni_unos: boolean;
  znak: number;
};

type TrialBalanceLine = {
  accountCode: string;
  debit: number;
  credit: number;
};

export type IncomeStatementRow = ReportPosition & {
  tekucaGodina: number;
  prethodnaGodina: number;
};

export type BalanceSheetRow = ReportPosition & {
  tekucaGodina: number;
  prethodnaGodinaKraj: number;
  prethodnaGodinaPocetak: number;
};

export type StatisticalAnnexRow = ReportPosition & {
  tekucaGodina: number;
  prethodnaGodina: number;
};

export type IncomeStatementResult = {
  rows: IncomeStatementRow[];
  templateSource: "company" | "system";
};

export type BalanceSheetResult = {
  rows: BalanceSheetRow[];
  templateSource: "company" | "system";
};

export type StatisticalAnnexResult = {
  rows: StatisticalAnnexRow[];
  templateSource: "company" | "system";
};

function splitAccountList(value: string | null) {
  if (!value) {
    return [];
  }

  return value
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseAccountRule(value: string) {
  const match = value.match(/^(.+?)([DP])$/i);

  if (!match) {
    return {
      prefix: value,
      saldo: null as "D" | "P" | null
    };
  }

  return {
    prefix: match[1].trim(),
    saldo: match[2].toUpperCase() as "D" | "P"
  };
}

function accountRuleMatches(line: TrialBalanceLine, ruleValue: string) {
  const rule = parseAccountRule(ruleValue);

  if (!line.accountCode.startsWith(rule.prefix)) {
    return false;
  }

  if (!rule.saldo) {
    return true;
  }

  const net = line.debit - line.credit;

  return rule.saldo === "D" ? net > 0 : net < 0;
}

function accountMatches(line: TrialBalanceLine, prefixes: string[], skippedPrefixes: string[]) {
  return (
    prefixes.some((prefix) => accountRuleMatches(line, prefix)) &&
    !skippedPrefixes.some((prefix) => accountRuleMatches(line, prefix))
  );
}

function valueForAccounts(position: ReportPosition, lines: TrialBalanceLine[]) {
  const prefixes = splitAccountList(position.konto);

  if (prefixes.length === 0) {
    return 0;
  }

  const skippedPrefixes = splitAccountList(position.preskoci_konta);

  return lines.reduce((sum, line) => {
    if (!accountMatches(line, prefixes, skippedPrefixes)) {
      return sum;
    }

    return sum + (line.debit - line.credit) * position.znak;
  }, 0);
}

function evaluateFormula(formula: string, valuesByAop: Map<string, number>) {
  const tokens = formula.match(/A?\d+[a-z]?|[+-]/gi) ?? [];
  let sign = 1;
  let total = 0;

  for (const token of tokens) {
    if (token === "+") {
      sign = 1;
      continue;
    }

    if (token === "-") {
      sign = -1;
      continue;
    }

    total += sign * (valuesByAop.get(token) ?? 0);
    sign = 1;
  }

  return total;
}

async function getEffectiveTemplateForType(
  agencijaId: string,
  firmaId: string,
  tipSifra: string
) {
  const companyTemplate = await prisma.finansijskiIzvjestajSablon.findFirst({
    where: {
      agencija_id: agencijaId,
      firma_id: firmaId,
      tip_sifra: tipSifra
    },
    include: {
      pozicije: {
        orderBy: {
          rbr: "asc"
        }
      }
    }
  });

  if (companyTemplate) {
    return {
      source: "company" as const,
      template: companyTemplate
    };
  }

  const systemTemplate = await prisma.finansijskiIzvjestajSablon.findFirstOrThrow({
    where: {
      tip_sifra: tipSifra,
      sistemski: true,
      agencija_id: null,
      firma_id: null
    },
    include: {
      pozicije: {
        orderBy: {
          rbr: "asc"
        }
      }
    }
  });

  return {
    source: "system" as const,
    template: systemTemplate
  };
}

async function getEffectiveTemplate(agencijaId: string, firmaId: string) {
  return getEffectiveTemplateForType(agencijaId, firmaId, financialReportTypes.incomeStatement);
}

async function loadTrialBalanceLines(
  firmaId: string,
  poslovnaGodinaId: string,
  options: {
    excludeOpeningAndFinal?: boolean;
    excludeFinal?: boolean;
    onlyOpening?: boolean;
  } = {}
) {
  const excludedJournalTypes = options.excludeOpeningAndFinal
    ? [standardJournalTypes[0][0], standardJournalTypes[8][0]]
    : options.excludeFinal
      ? [standardJournalTypes[8][0]]
    : [];
  const stavke = await prisma.stavkaNaloga.findMany({
    where: {
      nalog: {
        firma_id: firmaId,
        poslovna_godina_id: poslovnaGodinaId,
        status: "POSTED",
        is_deleted: false,
        vrsta_naloga: {
          sifra: options.onlyOpening
            ? {
                equals: standardJournalTypes[0][0]
              }
            : {
                notIn: excludedJournalTypes
              }
        }
      }
    } satisfies Prisma.StavkaNalogaWhereInput,
    select: {
      duguje: true,
      potrazuje: true,
      firma_konto: {
        select: {
          sifra: true
        }
      }
    }
  });

  const rowsByAccount = new Map<string, TrialBalanceLine>();

  for (const stavka of stavke) {
    const code = stavka.firma_konto.sifra;
    const existing = rowsByAccount.get(code) ?? {
      accountCode: code,
      debit: 0,
      credit: 0
    };

    existing.debit += Number(stavka.duguje);
    existing.credit += Number(stavka.potrazuje);
    rowsByAccount.set(code, existing);
  }

  return Array.from(rowsByAccount.values());
}

function calculateRows(positions: ReportPosition[], lines: TrialBalanceLine[]) {
  const valuesByAop = new Map<string, number>();
  const values = positions.map((position) => valueForAccounts(position, lines));

  positions.forEach((position, index) => {
    if (position.aop) {
      valuesByAop.set(position.aop, values[index] ?? 0);
    }
  });

  for (let pass = 0; pass < 10; pass += 1) {
    positions.forEach((position, index) => {
      if (!position.formula) {
        return;
      }

      values[index] = evaluateFormula(position.formula, valuesByAop);

      if (position.aop) {
        valuesByAop.set(position.aop, values[index] ?? 0);
      }
    });
  }

  return values;
}

export async function calculateIncomeStatement({
  agencijaId,
  firmaId,
  poslovnaGodinaId
}: {
  agencijaId: string;
  firmaId: string;
  poslovnaGodinaId: string;
}): Promise<IncomeStatementResult> {
  const [{ source, template }, currentYear] = await Promise.all([
    getEffectiveTemplate(agencijaId, firmaId),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: poslovnaGodinaId,
        firma_id: firmaId
      },
      select: {
        godina: true
      }
    })
  ]);

  const previousYear = currentYear
    ? await prisma.poslovnaGodina.findFirst({
        where: {
          firma_id: firmaId,
          godina: currentYear.godina - 1
        },
        select: {
          id: true
        }
      })
    : null;

  const [currentLines, previousLines] = await Promise.all([
    loadTrialBalanceLines(firmaId, poslovnaGodinaId, {
      excludeOpeningAndFinal: true
    }),
    previousYear
      ? loadTrialBalanceLines(firmaId, previousYear.id, {
          excludeOpeningAndFinal: true
        })
      : Promise.resolve([])
  ]);
  const positions = template.pozicije;
  const currentValues = calculateRows(positions, currentLines);
  const previousValues = calculateRows(positions, previousLines);

  return {
    rows: positions.map((position, index) => ({
      ...position,
      tekucaGodina: currentValues[index] ?? 0,
      prethodnaGodina: previousValues[index] ?? 0
    })),
    templateSource: source
  };
}

export async function getIncomeStatementSettings(agencijaId: string, firmaId: string) {
  return getEffectiveTemplate(agencijaId, firmaId);
}

export async function calculateBalanceSheet({
  agencijaId,
  firmaId,
  poslovnaGodinaId
}: {
  agencijaId: string;
  firmaId: string;
  poslovnaGodinaId: string;
}): Promise<BalanceSheetResult> {
  const [{ source, template }, currentYear] = await Promise.all([
    getEffectiveTemplateForType(agencijaId, firmaId, financialReportTypes.balanceSheet),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: poslovnaGodinaId,
        firma_id: firmaId
      },
      select: {
        godina: true
      }
    })
  ]);

  const previousYear = currentYear
    ? await prisma.poslovnaGodina.findFirst({
        where: {
          firma_id: firmaId,
          godina: currentYear.godina - 1
        },
        select: {
          id: true
        }
      })
    : null;

  const [currentLines, previousEndLines, previousOpeningLines] = await Promise.all([
    loadTrialBalanceLines(firmaId, poslovnaGodinaId),
    previousYear ? loadTrialBalanceLines(firmaId, previousYear.id) : Promise.resolve([]),
    previousYear
      ? loadTrialBalanceLines(firmaId, previousYear.id, {
          onlyOpening: true
        })
      : Promise.resolve([])
  ]);
  const positions = template.pozicije;
  const currentValues = calculateRows(positions, currentLines);
  const previousEndValues = calculateRows(positions, previousEndLines);
  const previousOpeningValues = calculateRows(positions, previousOpeningLines);

  return {
    rows: positions.map((position, index) => ({
      ...position,
      tekucaGodina: currentValues[index] ?? 0,
      prethodnaGodinaKraj: previousEndValues[index] ?? 0,
      prethodnaGodinaPocetak: previousOpeningValues[index] ?? 0
    })),
    templateSource: source
  };
}

export async function getBalanceSheetSettings(agencijaId: string, firmaId: string) {
  return getEffectiveTemplateForType(agencijaId, firmaId, financialReportTypes.balanceSheet);
}

export async function calculateStatisticalAnnex({
  agencijaId,
  firmaId,
  poslovnaGodinaId
}: {
  agencijaId: string;
  firmaId: string;
  poslovnaGodinaId: string;
}): Promise<StatisticalAnnexResult> {
  const [{ source, template }, currentYear] = await Promise.all([
    getEffectiveTemplateForType(agencijaId, firmaId, financialReportTypes.statisticalAnnex),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: poslovnaGodinaId,
        firma_id: firmaId
      },
      select: {
        godina: true
      }
    })
  ]);

  const previousYear = currentYear
    ? await prisma.poslovnaGodina.findFirst({
        where: {
          firma_id: firmaId,
          godina: currentYear.godina - 1
        },
        select: {
          id: true
        }
      })
    : null;

  const [currentLines, previousLines] = await Promise.all([
    loadTrialBalanceLines(firmaId, poslovnaGodinaId, {
      excludeFinal: true
    }),
    previousYear
      ? loadTrialBalanceLines(firmaId, previousYear.id, {
          excludeFinal: true
        })
      : Promise.resolve([])
  ]);
  const positions = template.pozicije;
  const currentValues = calculateRows(positions, currentLines);
  const previousValues = calculateRows(positions, previousLines);

  return {
    rows: positions.map((position, index) => ({
      ...position,
      tekucaGodina: currentValues[index] ?? 0,
      prethodnaGodina: previousValues[index] ?? 0
    })),
    templateSource: source
  };
}

export async function getStatisticalAnnexSettings(agencijaId: string, firmaId: string) {
  return getEffectiveTemplateForType(agencijaId, firmaId, financialReportTypes.statisticalAnnex);
}
