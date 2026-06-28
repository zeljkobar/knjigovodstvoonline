import type { Prisma } from "@prisma/client";
import { vatTransactionLabels, vatTransactionTypes, type VatTransactionType } from "./vat-transaction";

export const pdvPeriodStatuses = {
  open: "OPEN",
  ready: "READY",
  submitted: "SUBMITTED",
  posted: "POSTED",
  locked: "LOCKED",
  reopened: "REOPENED"
} as const;

export const pdvReturnStatuses = {
  draft: "DRAFT",
  ready: "READY",
  submitted: "SUBMITTED",
  posted: "POSTED",
  locked: "LOCKED"
} as const;

export const pdvMonths = [
  "Januar",
  "Februar",
  "Mart",
  "April",
  "Maj",
  "Jun",
  "Jul",
  "Avgust",
  "Septembar",
  "Oktobar",
  "Novembar",
  "Decembar"
];

export type PdvReturnColumn = "OUTPUT" | "INPUT" | "CHECK";

export type PdvReturnRow = {
  sifra: string;
  opis: string;
  kolona: PdvReturnColumn;
  redosljed: number;
  value: number;
};

type KifBookForPdv = {
  entries: Array<{
    total_base: Prisma.Decimal;
    total_output_vat: Prisma.Decimal;
    vat_transaction_type: string;
    posting_status?: string;
    journal_id?: string | null;
    tax_lines: Array<{
      output_vat_amount: Prisma.Decimal;
      tax_base: Prisma.Decimal;
      vat_rate_code: string;
      vat_rate_percent: Prisma.Decimal;
    }>;
  }>;
};

type KufBookForPdv = {
  entries: Array<{
    customs_vat_amount: Prisma.Decimal;
    deductible_vat: Prisma.Decimal;
    non_deductible_vat: Prisma.Decimal;
    total_input_vat: Prisma.Decimal;
    vat_transaction_type: string;
    posting_status?: string;
    journal_id?: string | null;
    tax_lines?: Array<{
      deductible_vat_amount: Prisma.Decimal;
      input_vat_amount: Prisma.Decimal;
      vat_rate_code: string;
      vat_rate_name: string;
      vat_rate_percent: Prisma.Decimal;
    }>;
  }>;
};

export type PdvPostingField = {
  code: string;
  label: string;
  rateCode: string | null;
  defaultDirection: "D" | "P";
  order: number;
};

export function decimalNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value == null) {
    return 0;
  }

  return typeof value === "number" ? value : Number(value.toString());
}

export function money(value: number) {
  return value.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function parseMoneyInput(value: string) {
  const trimmed = value.trim();
  const normalized = trimmed.includes(",")
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed;

  if (!normalized) {
    return 0;
  }

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

export function periodDateRange(year: number, month: number) {
  return {
    dateFrom: new Date(Date.UTC(year, month - 1, 1)),
    dateTo: new Date(Date.UTC(year, month, 0))
  };
}

export function periodLabel(month: number, year: number) {
  return `${pdvMonths[month - 1] ?? month} ${year}`;
}

export function statusLabel(status: string) {
  if (status === pdvPeriodStatuses.ready || status === pdvReturnStatuses.ready) {
    return "Spreman";
  }

  if (status === pdvPeriodStatuses.submitted || status === pdvReturnStatuses.submitted) {
    return "Predat";
  }

  if (status === pdvReturnStatuses.posted) {
    return "Proknjižen";
  }

  if (status === pdvPeriodStatuses.locked || status === pdvReturnStatuses.locked) {
    return "Zaključan";
  }

  if (status === pdvPeriodStatuses.reopened) {
    return "Ponovo otvoren";
  }

  return "Otvoren";
}

export function vatTransactionLabel(value: string) {
  return vatTransactionLabels[value as VatTransactionType] ?? value;
}

export function buildPdvPostingFields(
  vatRates: Array<{ naziv: string; procenat: Prisma.Decimal; sifra: string }>
) {
  const sortedRates = [...vatRates].sort(
    (a, b) => decimalNumber(b.procenat) - decimalNumber(a.procenat)
  );
  const outputFields: PdvPostingField[] = sortedRates.map((rate, index) => ({
    code: `OUTPUT_VAT_${rate.sifra}`,
    label: `Izlazni PDV ${decimalNumber(rate.procenat)}%`,
    rateCode: rate.sifra,
    defaultDirection: "D",
    order: index + 1
  }));
  const inputFields: PdvPostingField[] = sortedRates.map((rate, index) => ({
    code: `INPUT_VAT_${rate.sifra}`,
    label: `Ulazni PDV ${decimalNumber(rate.procenat)}%`,
    rateCode: rate.sifra,
    defaultDirection: "P",
    order: 100 + index + 1
  }));

  return [
    ...outputFields,
    ...inputFields,
    {
      code: "IMPORT_VAT",
      label: "Carinski PDV",
      rateCode: null,
      defaultDirection: "P",
      order: 200
    },
    {
      code: "PAUSAL_VAT",
      label: "Paušalni PDV",
      rateCode: null,
      defaultDirection: "P",
      order: 210
    },
    {
      code: "VAT_PAYABLE",
      label: "PDV obaveza",
      rateCode: null,
      defaultDirection: "P",
      order: 300
    },
    {
      code: "VAT_CREDIT",
      label: "PDV kredit",
      rateCode: null,
      defaultDirection: "D",
      order: 310
    }
  ] satisfies PdvPostingField[];
}

export function calculatePdvPostingAmounts(kifBooks: KifBookForPdv[], kufBooks: KufBookForPdv[]) {
  const amounts = new Map<string, number>();

  for (const book of kifBooks) {
    for (const entry of book.entries) {
      if (entry.vat_transaction_type !== vatTransactionTypes.domestic) {
        continue;
      }

      for (const line of entry.tax_lines) {
        const key = `OUTPUT_VAT_${line.vat_rate_code}`;
        amounts.set(key, (amounts.get(key) ?? 0) + decimalNumber(line.output_vat_amount));
      }
    }
  }

  for (const book of kufBooks) {
    for (const entry of book.entries) {
      if (entry.vat_transaction_type === vatTransactionTypes.import) {
        amounts.set(
          "IMPORT_VAT",
          (amounts.get("IMPORT_VAT") ?? 0) +
            (decimalNumber(entry.customs_vat_amount) || decimalNumber(entry.total_input_vat))
        );
        continue;
      }

      for (const line of entry.tax_lines ?? []) {
        const key = `INPUT_VAT_${line.vat_rate_code}`;
        amounts.set(key, (amounts.get(key) ?? 0) + decimalNumber(line.deductible_vat_amount));
      }
    }
  }

  return amounts;
}

function sumKifBase(books: KifBookForPdv[], rate: number) {
  return books.reduce(
    (total, book) =>
      total +
      book.entries.reduce((entryTotal, entry) => {
        if (entry.vat_transaction_type !== vatTransactionTypes.domestic) {
          return entryTotal;
        }

        return (
          entryTotal +
          entry.tax_lines
            .filter((line) => decimalNumber(line.vat_rate_percent) === rate)
            .reduce((lineTotal, line) => lineTotal + decimalNumber(line.tax_base), 0)
        );
      }, 0),
    0
  );
}

function sumKifVat(books: KifBookForPdv[], rate: number) {
  return books.reduce(
    (total, book) =>
      total +
      book.entries.reduce((entryTotal, entry) => {
        if (entry.vat_transaction_type !== vatTransactionTypes.domestic) {
          return entryTotal;
        }

        return (
          entryTotal +
          entry.tax_lines
            .filter((line) => decimalNumber(line.vat_rate_percent) === rate)
            .reduce((lineTotal, line) => lineTotal + decimalNumber(line.output_vat_amount), 0)
        );
      }, 0),
    0
  );
}

function sumKifSpecialBase(books: KifBookForPdv[]) {
  return books.reduce(
    (total, book) =>
      total +
      book.entries
        .filter((entry) =>
          [vatTransactionTypes.export, vatTransactionTypes.exempt].includes(
            entry.vat_transaction_type as typeof vatTransactionTypes.export
          )
        )
        .reduce((entryTotal, entry) => entryTotal + decimalNumber(entry.total_base), 0),
    0
  );
}

function sumKuf(books: KufBookForPdv[], selector: (entry: KufBookForPdv["entries"][number]) => number) {
  return books.reduce(
    (total, book) => total + book.entries.reduce((entryTotal, entry) => entryTotal + selector(entry), 0),
    0
  );
}

export function buildPdvReturnRows(kifBooks: KifBookForPdv[], kufBooks: KufBookForPdv[]) {
  const output21 = sumKifVat(kifBooks, 21);
  const output15 = sumKifVat(kifBooks, 15);
  const output7 = sumKifVat(kifBooks, 7);
  const totalOutput = output21 + output15 + output7;
  const inputDomestic = sumKuf(kufBooks, (entry) =>
    entry.vat_transaction_type === vatTransactionTypes.domestic ? decimalNumber(entry.total_input_vat) : 0
  );
  const importVat = sumKuf(kufBooks, (entry) =>
    entry.vat_transaction_type === vatTransactionTypes.import
      ? decimalNumber(entry.customs_vat_amount) || decimalNumber(entry.total_input_vat)
      : 0
  );
  const totalInput = inputDomestic + importVat;
  const nonDeductible = sumKuf(kufBooks, (entry) => decimalNumber(entry.non_deductible_vat));
  const deductible = sumKuf(kufBooks, (entry) => decimalNumber(entry.deductible_vat)) + importVat;
  const payable = Math.max(totalOutput - deductible, 0);
  const credit = Math.max(deductible - totalOutput, 0);
  const hasTransactions = kifBooks.some((book) => book.entries.length > 0) || kufBooks.some((book) => book.entries.length > 0);

  const rows: PdvReturnRow[] = [
    { sifra: "9", opis: "Bez transakcija tokom poreskog perioda", kolona: "CHECK", redosljed: 9, value: hasTransactions ? 0 : 1 },
    { sifra: "10", opis: "Oporezivi promet (isporuke) po stopi od 21%", kolona: "OUTPUT", redosljed: 10, value: sumKifBase(kifBooks, 21) },
    { sifra: "11", opis: "Oporezivi promet (isporuke) po stopi od 15%", kolona: "OUTPUT", redosljed: 11, value: sumKifBase(kifBooks, 15) },
    { sifra: "12", opis: "Oporezivi promet (isporuke) po stopi od 7%", kolona: "OUTPUT", redosljed: 12, value: sumKifBase(kifBooks, 7) },
    { sifra: "13", opis: "Oporezivi promet (isporuke) po stopi od 0%", kolona: "OUTPUT", redosljed: 13, value: sumKifBase(kifBooks, 0) },
    { sifra: "14", opis: "Oslobođeni promet - isporuke", kolona: "OUTPUT", redosljed: 14, value: sumKifSpecialBase(kifBooks) },
    { sifra: "15", opis: "Promet za koji je primalac izvršio prenos poreske obaveze", kolona: "OUTPUT", redosljed: 15, value: 0 },
    { sifra: "16", opis: "PDV na domaći promet proizvoda i usluga po stopi od 21%", kolona: "OUTPUT", redosljed: 16, value: output21 },
    { sifra: "17", opis: "PDV na domaći promet proizvoda i usluga po stopi od 15%", kolona: "OUTPUT", redosljed: 17, value: output15 },
    { sifra: "18", opis: "PDV na domaći promet proizvoda i usluga po stopi od 7%", kolona: "OUTPUT", redosljed: 18, value: output7 },
    { sifra: "19", opis: "Ulazni PDV na domaći promet proizvoda i usluga", kolona: "INPUT", redosljed: 19, value: inputDomestic },
    { sifra: "20", opis: "PDV plaćen na uvoz", kolona: "INPUT", redosljed: 20, value: importVat },
    { sifra: "21", opis: "PDV na usluge inostranih lica", kolona: "INPUT", redosljed: 21, value: 0 },
    { sifra: "22", opis: "Paušalna nadoknada isplaćena poljoprivredniku po stopi od 8%", kolona: "INPUT", redosljed: 22, value: 0 },
    { sifra: "23", opis: "PDV na promet za koji je izvršen prenos poreske obaveze", kolona: "INPUT", redosljed: 23, value: 0 },
    { sifra: "24", opis: "Ukupan izlazni PDV na isporuke (16+17+18+21)", kolona: "OUTPUT", redosljed: 24, value: totalOutput },
    { sifra: "25", opis: "Ukupan ulazni PDV - pretporez (19+20+21+22)", kolona: "INPUT", redosljed: 25, value: totalInput },
    { sifra: "26", opis: "Ulazni PDV bez prava na odbitak", kolona: "INPUT", redosljed: 26, value: nonDeductible },
    { sifra: "27", opis: "Ulazni PDV sa pravom na odbitak (25-26)", kolona: "INPUT", redosljed: 27, value: deductible },
    { sifra: "28", opis: "Dospjeli PDV za uplatu (24-27)", kolona: "OUTPUT", redosljed: 28, value: payable },
    { sifra: "29", opis: "PDV kredit (27-24)", kolona: "INPUT", redosljed: 29, value: credit },
    { sifra: "30", opis: "Zahtijevam povraćaj PDV kredita sa rednog broja 29", kolona: "CHECK", redosljed: 30, value: 0 }
  ];

  return {
    rows,
    totals: {
      totalOutput,
      totalInput,
      deductible,
      nonDeductible,
      payable,
      credit
    }
  };
}
