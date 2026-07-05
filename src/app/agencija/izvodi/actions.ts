"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auditLog } from "@/lib/audit";
import { accountOverrideTypes } from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import { formatJournalCode, journalStatuses } from "@/lib/journals";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

const bankStatementStatuses = {
  imported: "IMPORTED",
  needsReview: "NEEDS_REVIEW",
  ready: "READY",
  posted: "POSTED"
} as const;

const lineStatuses = {
  unmatched: "UNMATCHED",
  matchedPartner: "MATCHED_PARTNER",
  ready: "READY",
  needsReview: "NEEDS_REVIEW",
  ignored: "IGNORED"
} as const;

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function nullableValue(formData: FormData, key: string) {
  const data = value(formData, key);

  return data || null;
}

function redirectStatements(message: string, statementId?: string): never {
  const params = new URLSearchParams({
    poruka: message
  });

  if (statementId) {
    params.set("izvod", statementId);
  }

  redirect(`/agencija/izvodi?${params.toString()}`);
}

function parseDateInput(data: string) {
  if (!data) {
    return null;
  }

  const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(data)
    ? data
    : data
        .replace(/\s+/g, "")
        .replace(/^(\d{1,2})[./](\d{1,2})[./](\d{4})\.?$/, "$3-$2-$1");
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseMoneyToCents(input: string) {
  const raw = input.trim();

  if (!raw || raw === "-") {
    return 0;
  }

  const compact = raw.replace(/\s/g, "");
  const normalized = /^-?\d{1,3}(?:,\d{3})+\.\d{2}$/.test(compact)
    ? compact.replace(/,/g, "")
    : compact
        .replace(/\.(?=\d{3}(\D|$))/g, "")
        .replace(",", ".");
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.round(parsed * 100);
}

function parseOptionalMoneyToCents(input: string) {
  return input.trim() ? parseMoneyToCents(input) : null;
}

function centsToDecimal(cents: number) {
  return (cents / 100).toFixed(2);
}

function decimalToCents(value: Prisma.Decimal | number | string | null | undefined) {
  return Math.round(Number(value ?? 0) * 100);
}

function paymentStatus(totalCents: number, paidCents: number) {
  if (paidCents <= 0) {
    return "UNPAID";
  }

  if (paidCents < totalCents) {
    return "PARTIALLY_PAID";
  }

  if (paidCents === totalCents) {
    return "PAID";
  }

  return "OVERPAID";
}

async function refreshKifPaymentStatus(
  tx: Prisma.TransactionClient,
  entryId: string,
  userId: string
) {
  const entry = await tx.kifEntry.findUnique({
    where: {
      id: entryId
    },
    select: {
      total_gross: true
    }
  });

  if (!entry) {
    return;
  }

  const allocations = await tx.bankStatementLineAllocation.aggregate({
    where: {
      kif_entry_id: entryId
    },
    _sum: {
      amount: true
    }
  });

  await tx.kifEntry.update({
    where: {
      id: entryId
    },
    data: {
      payment_status: paymentStatus(
        decimalToCents(entry.total_gross),
        decimalToCents(allocations._sum.amount)
      ),
      updated_by: userId
    }
  });
}

async function refreshKufPaymentStatus(
  tx: Prisma.TransactionClient,
  entryId: string,
  userId: string
) {
  const entry = await tx.kufEntry.findUnique({
    where: {
      id: entryId
    },
    select: {
      total_gross: true
    }
  });

  if (!entry) {
    return;
  }

  const allocations = await tx.bankStatementLineAllocation.aggregate({
    where: {
      kuf_entry_id: entryId
    },
    _sum: {
      amount: true
    }
  });

  await tx.kufEntry.update({
    where: {
      id: entryId
    },
    data: {
      payment_status: paymentStatus(
        decimalToCents(entry.total_gross),
        decimalToCents(allocations._sum.amount)
      ),
      updated_by: userId
    }
  });
}

async function resolveCompanyAccount(
  tx: Prisma.TransactionClient | typeof prisma,
  firmaId: string,
  accountCode: string | null
) {
  const cleanCode = String(accountCode ?? "").trim();

  if (!cleanCode) {
    return null;
  }

  const companyAccount = await tx.firmaKonto.findUnique({
    where: {
      firma_id_sifra: {
        firma_id: firmaId,
        sifra: cleanCode
      }
    },
    select: {
      id: true,
      sifra: true,
      analitika_obavezna: true,
      override_type: true,
      aktivan: true
    }
  });

  if (companyAccount) {
    return companyAccount.aktivan &&
      companyAccount.override_type !== accountOverrideTypes.deactivated
      ? companyAccount
      : null;
  }

  const baseAccount = await tx.konto.findUnique({
    where: {
      sifra: cleanCode
    },
    select: {
      id: true,
      sifra: true,
      naziv: true,
      tip_konta: true,
      analitika_obavezna: true,
      sinteticki_konto: true,
      normalni_saldo: true,
      koristi_radnu_jedinicu: true,
      aktivan: true
    }
  });

  if (!baseAccount?.aktivan) {
    return null;
  }

  return tx.firmaKonto.create({
    data: {
      firma_id: firmaId,
      konto_id: baseAccount.id,
      sifra: baseAccount.sifra,
      naziv: baseAccount.naziv,
      tip_konta: baseAccount.tip_konta,
      analitika_obavezna: baseAccount.analitika_obavezna,
      sinteticki_konto: baseAccount.sinteticki_konto,
      normalni_saldo: baseAccount.normalni_saldo,
      koristi_radnu_jedinicu: baseAccount.koristi_radnu_jedinicu,
      override_type: accountOverrideTypes.baseLink,
      aktivan: true
    },
    select: {
      id: true,
      sifra: true,
      analitika_obavezna: true,
      override_type: true,
      aktivan: true
    }
  });
}

function normalizeAccountNumber(input: string | null | undefined) {
  return String(input ?? "").replace(/\D/g, "");
}

function containsText(source: string | null | undefined, needle: string | null | undefined) {
  const cleanNeedle = String(needle ?? "").trim().toLowerCase();

  if (!cleanNeedle) {
    return true;
  }

  return String(source ?? "").toLowerCase().includes(cleanNeedle);
}

function normalizePaymentCode(input: string | null | undefined) {
  const clean = String(input ?? "").toUpperCase().replace(/\s+/g, "").trim();

  if (!clean) {
    return "";
  }

  return clean.match(/[A-Z]\d{2}/)?.[0] ?? clean.match(/\d{3}/)?.[0] ?? clean.match(/\d{2}/)?.[0] ?? clean;
}

function comparablePaymentCode(input: string | null | undefined) {
  return normalizePaymentCode(input).replace(/^[A-Z](\d{2})$/, "$1");
}

function paymentCodesMatch(ruleCode: string | null | undefined, lineCode: string | null | undefined) {
  const normalizedRuleCode = normalizePaymentCode(ruleCode);

  if (!normalizedRuleCode) {
    return true;
  }

  const normalizedLineCode = normalizePaymentCode(lineCode);

  return (
    normalizedLineCode === normalizedRuleCode ||
    comparablePaymentCode(normalizedLineCode) === comparablePaymentCode(normalizedRuleCode)
  );
}

function amountTextToCents(input: string) {
  return parseMoneyToCents(input.replace(/[^\d,.\-\s]/g, ""));
}

function parseStatementJournalNumber(statementNumber: string) {
  const normalized = statementNumber.trim();

  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

type ParsedStatementLine = {
  postingDate: Date;
  valueDate?: Date | null;
  description: string;
  accountNumber: string | null;
  normalizedAccountNumber: string | null;
  counterpartyName?: string | null;
  referenceNumber?: string | null;
  paymentCode?: string | null;
  outflow: number;
  inflow: number;
  rawText: string;
};

type ParsedStatement = {
  parser: string;
  companyAccountNumber?: string | null;
  statementNumber?: string | null;
  statementDate?: Date | null;
  openingBalance?: number | null;
  totalInflow?: number | null;
  totalOutflow?: number | null;
  closingBalance?: number | null;
  lines: ParsedStatementLine[];
  notes?: string | null;
};

type PdfTextItem = {
  x: number;
  text: string;
};

type PdfTextRow = {
  page: number;
  y: number;
  items: PdfTextItem[];
};

function pdfRowText(row: PdfTextRow) {
  return row.items.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
}

function pdfItemsInRange(row: PdfTextRow, minX: number, maxX: number) {
  return row.items
    .filter((item) => item.x >= minX && item.x <= maxX)
    .map((item) => item.text.trim())
    .filter(Boolean);
}

function isMoneyText(input: string) {
  return /^-?\d{1,3}(?:\.\d{3})*,\d{2}$|^-?\d+,\d{2}$|^-?\d+(?:,\d{3})*\.\d{2}$/.test(input.trim());
}

function firstPdfItemInRange(
  row: PdfTextRow,
  minX: number,
  maxX: number,
  pattern?: RegExp
) {
  return pdfItemsInRange(row, minX, maxX).find((item) => !pattern || pattern.test(item)) ?? "";
}

function ckbMoneyValues(row: PdfTextRow) {
  return row.items
    .map((item) => item.text.trim())
    .filter(isMoneyText)
    .map((item) => parseMoneyToCents(item))
    .filter((amount): amount is number => amount !== null);
}

function parseCkbHeader(text: string, rows: PdfTextRow[]) {
  const normalizedText = text.replace(/\s+/g, " ");
  const headerMatch = normalizedText.match(
    /Izvod\s+broj\s+([^\s]+)\s+za\s+promet\s+i\s+stanje\s+ra[čc]una\s+(\d+)\s+na\s+dan\s+(\d{2}\.\d{2}\.\d{4})/i
  );
  const balanceHeaderIndex = rows.findIndex((row) => {
    const rowText = pdfRowText(row);

    return rowText.includes("Prethodno stanje") && rowText.includes("Novo stanje");
  });
  const balanceRow =
    balanceHeaderIndex >= 0
      ? rows
          .slice(balanceHeaderIndex + 1)
          .find((row) => ckbMoneyValues(row).length >= 4)
      : null;
  const balances = balanceRow ? ckbMoneyValues(balanceRow) : [];

  return {
    statementNumber: headerMatch?.[1] ?? null,
    companyAccountNumber: headerMatch?.[2] ?? null,
    statementDate: parseDateInput((headerMatch?.[3] ?? "").replace(/\./g, "/")),
    openingBalance: balances[0] ?? null,
    totalOutflow: balances[1] ?? null,
    totalInflow: balances[2] ?? null,
    closingBalance: balances[3] ?? null
  };
}

function isCkbNoiseRow(row: PdfTextRow) {
  const text = pdfRowText(row);

  return (
    !text ||
    /^(Strana:|Promet i stanje po ra[čc]unu|Mati[čc]ni broj|PIB|CKB|Prilog br\.)/i.test(text) ||
    text.includes("Prethodno stanje") ||
    text.includes("Izvod broj") ||
    text.includes("Rbr") ||
    (text.includes("Račun") && text.includes("Naziv / Svrha")) ||
    text.includes("Novo stanje") ||
    text.includes("UKUPNO")
  );
}

function parseCkbMainRow(row: PdfTextRow) {
  const rowText = pdfRowText(row);
  const textMatch = rowText.match(
    /^(\d+)\s+(\d{5,})\s+(\d{9,})(?:\s+(\d{3}))?\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})(?:\s+(.+))?$/
  );
  const rowNumber = firstPdfItemInRange(row, 45, 85, /^\d+$/) || textMatch?.[1] || "";
  const transactionId =
    firstPdfItemInRange(row, 80, 170, /^\d{5,}$/) || textMatch?.[2] || "";
  const accountNumber =
    firstPdfItemInRange(row, 140, 300, /^\d{9,}$/) || textMatch?.[3] || "";
  const postingDateText =
    firstPdfItemInRange(row, 315, 405, /^\d{2}\/\d{2}\/\d{4}$/) || textMatch?.[5] || "";
  const valueDateText =
    firstPdfItemInRange(row, 380, 470, /^\d{2}\/\d{2}\/\d{4}$/) || textMatch?.[6] || "";

  if (!rowNumber || !transactionId || !accountNumber || !postingDateText || !valueDateText) {
    return null;
  }

  const postingDate = parseDateInput(postingDateText);
  const valueDate = parseDateInput(valueDateText);
  const outflowText = firstPdfItemInRange(row, 450, 555, /^-?\d/);
  const inflowText = firstPdfItemInRange(row, 555, 620, /^-?\d/);
  const textMoneyItems = (textMatch?.[7]?.match(/-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2}/g) ?? [])
    .map((item) => item.trim())
    .filter(isMoneyText);
  const outflow = parseMoneyToCents(outflowText || textMoneyItems[0] || "");
  const inflow = parseMoneyToCents(inflowText || (textMoneyItems.length > 2 ? textMoneyItems[1] : "") || "");
  const paymentCode = firstPdfItemInRange(row, 250, 335, /^\d{3}$/) || textMatch?.[4] || null;
  const coordinateReference = pdfItemsInRange(row, 690, 820).join(" ").trim();
  const textReference =
    textMatch?.[7]
      ?.replace(/-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2}/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "";
  const referenceNumber = coordinateReference || textReference || null;

  if (!postingDate || !valueDate) {
    return null;
  }

  return {
    rowNumber,
    transactionId,
    accountNumber,
    paymentCode,
    postingDate,
    valueDate,
    outflow: outflow ?? 0,
    inflow: inflow ?? 0,
    referenceNumber
  };
}

function parseCkbPdf(text: string, pdfRows?: PdfTextRow[]): ParsedStatement | null {
  if (!pdfRows?.length || !/promet\s+i\s+stanje\s+(?:po\s+)?ra[čc]un[au]/i.test(text)) {
    return null;
  }

  const header = parseCkbHeader(text, pdfRows);

  if (!header.statementNumber || !header.companyAccountNumber) {
    return null;
  }

  type WorkingLine = NonNullable<ReturnType<typeof parseCkbMainRow>> & {
    descriptionParts: string[];
  };
  const lines: ParsedStatementLine[] = [];
  let current: WorkingLine | null = null;
  const pushCurrent = () => {
    if (!current || (current.outflow === 0 && current.inflow === 0)) {
      return;
    }

    const rawDescription = current.descriptionParts.join(" · ").replace(/\s+/g, " ").trim();
    const counterpartyName = current.descriptionParts[0]?.trim() || null;
    const embeddedReference = rawDescription.match(/\bRefBr:?\s*([A-Z0-9/-]+)/i)?.[1] ?? null;
    const accountNumber = current.accountNumber || null;
    const normalizedAccountNumber = normalizeAccountNumber(accountNumber);

    lines.push({
      postingDate: current.postingDate,
      valueDate: current.valueDate,
      description: rawDescription || `CKB PDF stavka ${current.rowNumber}`,
      accountNumber,
      normalizedAccountNumber: normalizedAccountNumber || null,
      counterpartyName,
      referenceNumber: current.referenceNumber ?? embeddedReference,
      paymentCode: current.paymentCode,
      outflow: current.outflow,
      inflow: current.inflow,
      rawText: `CKB PDF stavka ${current.rowNumber}`
    });
  };

  for (const row of pdfRows) {
    const rowText = pdfRowText(row);

    if (rowText.includes("UKUPNO")) {
      pushCurrent();
      current = null;
      continue;
    }

    const mainRow = parseCkbMainRow(row);

    if (mainRow) {
      pushCurrent();
      current = {
        ...mainRow,
        descriptionParts: []
      };
      continue;
    }

    if (!current || isCkbNoiseRow(row)) {
      continue;
    }

    current.descriptionParts.push(rowText);
  }

  pushCurrent();

  return {
    parser: "CKB_PDF",
    companyAccountNumber: header.companyAccountNumber,
    statementNumber: header.statementNumber,
    statementDate: header.statementDate,
    openingBalance: header.openingBalance,
    totalInflow: header.totalInflow,
    totalOutflow: header.totalOutflow,
    closingBalance: header.closingBalance,
    lines,
    notes: "Ukupan priliv i odliv pročitani su iz zaglavlja CKB PDF izvoda."
  };
}

function hipotekarnaMoneyValues(row: PdfTextRow) {
  return row.items
    .filter((item) => item.x >= 380 && item.x <= 1200)
    .map((item) => item.text.trim())
    .filter(isMoneyText)
    .map((item) => parseMoneyToCents(item))
    .filter((amount): amount is number => amount !== null);
}

function parseHipotekarnaHeader(rows: PdfTextRow[]) {
  const statementRow = rows.find((row) => {
    const number = firstPdfItemInRange(row, 700, 790, /^\d+$/);
    const date = firstPdfItemInRange(row, 930, 1040, /^\d{2}\.\d{2}\.\d{4}\.?$/);

    return Boolean(number && date);
  });
  const accountRow = rows.find((row) => {
    const account = firstPdfItemInRange(row, 950, 1120, /^\d{9,}$/);

    return Boolean(account);
  });
  const totalsRow = rows
    .filter((row) => hipotekarnaMoneyValues(row).length >= 4)
    .sort((a, b) => a.y - b.y)[0];
  const totals = totalsRow ? hipotekarnaMoneyValues(totalsRow) : [];
  const statementNumber = statementRow
    ? firstPdfItemInRange(statementRow, 700, 790, /^\d+$/)
    : "";
  const statementDateText = statementRow
    ? firstPdfItemInRange(statementRow, 930, 1040, /^\d{2}\.\d{2}\.\d{4}\.?$/)
    : "";

  return {
    statementNumber: statementNumber || null,
    statementDate: parseDateInput(statementDateText),
    companyAccountNumber: accountRow
      ? firstPdfItemInRange(accountRow, 950, 1120, /^\d{9,}$/) || null
      : null,
    openingBalance: totals[0] ?? null,
    totalOutflow: totals[1] ?? null,
    totalInflow: totals[2] ?? null,
    closingBalance: totals[3] ?? null
  };
}

function isHipotekarnaAccountNumber(input: string | null | undefined) {
  const value = String(input ?? "").trim();
  const normalized = normalizeAccountNumber(value);

  return normalized.length >= 9 || /^\d{3}-\d{5,}-\d{2}$/.test(value);
}

function parseHipotekarnaMainRow(row: PdfTextRow) {
  const postingDateText = firstPdfItemInRange(row, 50, 150, /^\d{2}\.\d{2}\.\d{4}\.?$/);

  if (!postingDateText) {
    return null;
  }

  const postingDate = parseDateInput(postingDateText);
  const outflow = parseMoneyToCents(firstPdfItemInRange(row, 610, 720, /^-?\d/));
  const inflow = parseMoneyToCents(firstPdfItemInRange(row, 780, 860, /^-?\d/));

  if (!postingDate || outflow === null || inflow === null || (outflow === 0 && inflow === 0)) {
    return null;
  }

  const counterpartyName = pdfItemsInRange(row, 150, 610)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const paymentCode = firstPdfItemInRange(row, 860, 940, /^\d{3}$/) || null;
  const referenceNumber = pdfItemsInRange(row, 1200, 1500)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim() || null;

  return {
    postingDate,
    valueDate: postingDate,
    counterpartyName: counterpartyName || null,
    paymentCode,
    referenceNumber,
    outflow,
    inflow
  };
}

function isHipotekarnaNoiseRow(row: PdfTextRow) {
  const text = pdfRowText(row);

  return (
    !text ||
    row.y > 950 ||
    row.y < 180 ||
    /^1\.$/.test(text) ||
    text.includes("Ukupno") ||
    text.includes("Novo stanje") ||
    text.includes("Prethodno")
  );
}

function parseHipotekarnaPdf(text: string, pdfRows?: PdfTextRow[]): ParsedStatement | null {
  if (!pdfRows?.length) {
    return null;
  }

  const header = parseHipotekarnaHeader(pdfRows);

  if (
    !header.statementNumber ||
    !header.companyAccountNumber ||
    (!/HIPOTEKARNA BANKA|HIPOTEKARNA/i.test(text) &&
      header.openingBalance === null &&
      header.closingBalance === null)
  ) {
    return null;
  }

  type WorkingLine = NonNullable<ReturnType<typeof parseHipotekarnaMainRow>> & {
    accountNumber: string | null;
    descriptionParts: string[];
  };
  const lines: ParsedStatementLine[] = [];
  let current: WorkingLine | null = null;
  const pushCurrent = () => {
    if (!current) {
      return;
    }

    const rawDescription = Array.from(new Set([
      current.counterpartyName ?? "",
      ...current.descriptionParts
    ]))
      .filter(Boolean)
      .join(" · ")
      .replace(/\s+/g, " ")
      .trim();
    const accountNumber = isHipotekarnaAccountNumber(current.accountNumber)
      ? current.accountNumber
      : null;
    const normalizedAccountNumber = normalizeAccountNumber(accountNumber);

    lines.push({
      postingDate: current.postingDate,
      valueDate: current.valueDate,
      description: rawDescription || "Hipotekarna PDF stavka",
      accountNumber,
      normalizedAccountNumber: normalizedAccountNumber || null,
      counterpartyName: current.counterpartyName,
      referenceNumber: current.referenceNumber,
      paymentCode: current.paymentCode,
      outflow: current.outflow,
      inflow: current.inflow,
      rawText: rawDescription || "Hipotekarna PDF stavka"
    });
  };

  for (const row of pdfRows) {
    const mainRow = parseHipotekarnaMainRow(row);

    if (mainRow) {
      pushCurrent();
      current = {
        ...mainRow,
        accountNumber: null,
        descriptionParts: []
      };
      continue;
    }

    if (!current || isHipotekarnaNoiseRow(row)) {
      continue;
    }

    const accountCandidate = firstPdfItemInRange(row, 150, 330, /^[\d-]+$/);
    const purpose = pdfItemsInRange(row, 850, 1180)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const reference = pdfItemsInRange(row, 1200, 1520)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (accountCandidate && !current.accountNumber) {
      current.accountNumber = accountCandidate;
    }

    if (purpose) {
      current.descriptionParts.push(purpose);
    }

    if (reference) {
      current.referenceNumber = reference;
    }
  }

  pushCurrent();

  return {
    parser: "HIPOTEKARNA_PDF",
    companyAccountNumber: header.companyAccountNumber,
    statementNumber: header.statementNumber,
    statementDate: header.statementDate,
    openingBalance: header.openingBalance,
    totalInflow: header.totalInflow,
    totalOutflow: header.totalOutflow,
    closingBalance: header.closingBalance,
    lines,
    notes: "Kartične i gotovinske stavke bez žiro računa uvoze se bez računa partnera."
  };
}

function pdfColumnItems(row: PdfTextRow, minX: number, maxX: number) {
  return row.items
    .filter((item) => item.x >= minX && item.x < maxX)
    .map((item) => item.text.trim())
    .filter(Boolean);
}

function lovcenMoneyAtColumn(rows: PdfTextRow[], page: number, columnX: number, minY: number, maxY: number) {
  const moneyText = rows
    .filter((row) => row.page === page && row.y >= minY && row.y <= maxY)
    .flatMap((row) => row.items)
    .filter((item) => Math.abs(item.x - columnX) <= 2)
    .map((item) => item.text.trim())
    .find(isMoneyText);

  return parseMoneyToCents(moneyText ?? "") ?? 0;
}

function lovcenColumnText(
  rows: PdfTextRow[],
  page: number,
  columnX: number,
  nextColumnX: number,
  minY: number,
  maxY: number
) {
  return rows
    .filter((row) => row.page === page && row.y >= minY && row.y <= maxY)
    .flatMap((row) => pdfColumnItems(row, columnX, nextColumnX))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function lovcenSummaryAmount(rows: PdfTextRow[], label: string) {
  const labelRow = rows.find((row) => pdfRowText(row).toLowerCase().includes(label.toLowerCase()));

  if (!labelRow) {
    return null;
  }

  const labelX = labelRow.items[0]?.x ?? 220;
  const amountText = rows
    .filter(
      (row) =>
        row.page === labelRow.page &&
        row.y > labelRow.y &&
        row.y <= labelRow.y + 100
    )
    .flatMap((row) => row.items)
    .filter((item) => item.x >= labelX - 20 && item.x <= labelX + 100)
    .map((item) => item.text.trim())
    .find(isMoneyText);

  return amountText ? parseMoneyToCents(amountText) : null;
}

function parseLovcenPaymentCode(purposeText: string) {
  const letterCode = purposeText.match(/\b([A-Z]\d{2})\b/i);

  if (letterCode) {
    return letterCode[1].toUpperCase();
  }

  const numericCode = purposeText.match(/\b(\d{3})\b/);

  if (numericCode) {
    return numericCode[1];
  }

  return null;
}

function cleanLovcenDescription(...parts: Array<string | null | undefined>) {
  return Array.from(new Set(parts.map((part) => String(part ?? "").replace(/\s+/g, " ").trim()).filter(Boolean)))
    .join(" · ")
    .trim();
}

function parseLovcenHeader(rows: PdfTextRow[]) {
  let statementNumber: string | null = null;
  let statementDate: Date | null = null;

  for (const row of rows) {
    const rowText = pdfRowText(row);
    const directMatch = rowText.match(/IZVOD\s+BR\.?\s*(\d+)\s+za\s+dan\s+(\d{2}\.\d{2}\.\d{4})/i);

    if (directMatch) {
      statementNumber = directMatch[1];
      statementDate = parseDateInput(directMatch[2]);
      break;
    }

    if (/IZVOD\s+BR\.?/i.test(rowText)) {
      const continuation = rows.find((candidate) => {
        const text = pdfRowText(candidate);

        return (
          candidate.page === row.page &&
          candidate.y > row.y &&
          candidate.y <= row.y + 100 &&
          /^\d+\s+za\s+dan\s+\d{2}\.\d{2}\.\d{4}/i.test(text)
        );
      });
      const continuationMatch = pdfRowText(continuation ?? row).match(/^(\d+)\s+za\s+dan\s+(\d{2}\.\d{2}\.\d{4})/i);

      if (continuationMatch) {
        statementNumber = continuationMatch[1];
        statementDate = parseDateInput(continuationMatch[2]);
        break;
      }
    }
  }

  const accountRow = rows.find((row) => pdfItemsInRange(row, 95, 125).some((item) => /^\d{9,}$/.test(item)));
  const companyAccountNumber =
    accountRow ? firstPdfItemInRange(accountRow, 95, 125, /^\d{9,}$/) || null : null;

  return {
    statementNumber,
    statementDate,
    companyAccountNumber,
    openingBalance: lovcenSummaryAmount(rows, "Predhodno stanje"),
    totalOutflow: lovcenSummaryAmount(rows, "Dnevni promet (duguje)"),
    totalInflow: lovcenSummaryAmount(rows, "Dnevni promet (potražuje)"),
    closingBalance: lovcenSummaryAmount(rows, "Novo stanje")
  };
}

function parseLovcenPdf(text: string, pdfRows?: PdfTextRow[]): ParsedStatement | null {
  if (!pdfRows?.length || !/Lovcen\s+Banka|Lov[ćc]en\s+Banka|IZVOD\s+BR/i.test(text)) {
    return null;
  }

  const header = parseLovcenHeader(pdfRows);

  if (!header.statementNumber || !header.companyAccountNumber) {
    return null;
  }

  const companyAccount = normalizeAccountNumber(header.companyAccountNumber);
  const lines: ParsedStatementLine[] = [];
  const pages = Array.from(new Set(pdfRows.map((row) => row.page))).sort((left, right) => left - right);

  for (const page of pages) {
    const dateColumns = pdfRows
      .filter((row) => row.page === page && row.y <= 35)
      .flatMap((row) => row.items)
      .filter((item) => /^\d{2}\.\d{2}\.\d{4}$/.test(item.text.trim()))
      .sort((left, right) => left.x - right.x);

    for (let index = 0; index < dateColumns.length; index += 1) {
      const dateColumn = dateColumns[index];
      const nextColumnX = dateColumns[index + 1]?.x ?? dateColumn.x + 24;
      const postingDate = parseDateInput(dateColumn.text);
      const outflow = lovcenMoneyAtColumn(pdfRows, page, dateColumn.x, 300, 330);
      const inflow = lovcenMoneyAtColumn(pdfRows, page, dateColumn.x, 390, 410);

      if (!postingDate || (outflow === 0 && inflow === 0)) {
        continue;
      }

      const nameAndAccount = lovcenColumnText(pdfRows, page, dateColumn.x, nextColumnX, 55, 70);
      const nameParts = nameAndAccount.split(/\s+/);
      const accountCandidate = nameParts.find((part) => normalizeAccountNumber(part).length >= 9) ?? null;
      const normalizedAccountCandidate = normalizeAccountNumber(accountCandidate);
      const accountNumber =
        normalizedAccountCandidate && normalizedAccountCandidate !== companyAccount
          ? accountCandidate
          : null;
      const counterpartyName = nameAndAccount
        .replace(accountCandidate ?? "", "")
        .replace(/\s+/g, " ")
        .trim() || null;
      const purposeText = lovcenColumnText(pdfRows, page, dateColumn.x, nextColumnX, 420, 435);
      const referenceNumber = cleanLovcenDescription(
        lovcenColumnText(pdfRows, page, dateColumn.x, nextColumnX, 605, 620),
        lovcenColumnText(pdfRows, page, dateColumn.x, nextColumnX, 710, 725)
      ) || null;
      const description = cleanLovcenDescription(counterpartyName, purposeText);
      const normalizedAccountNumber = normalizeAccountNumber(accountNumber);

      lines.push({
        postingDate,
        valueDate: postingDate,
        description: description || `Lovćen PDF stavka ${lines.length + 1}`,
        accountNumber,
        normalizedAccountNumber: normalizedAccountNumber || null,
        counterpartyName,
        referenceNumber,
        paymentCode: parseLovcenPaymentCode(purposeText),
        outflow,
        inflow,
        rawText: description || `Lovćen PDF stavka ${lines.length + 1}`
      });
    }
  }

  if (lines.length === 0) {
    return null;
  }

  return {
    parser: "LOVCEN_PDF",
    companyAccountNumber: header.companyAccountNumber,
    statementNumber: header.statementNumber,
    statementDate: header.statementDate,
    openingBalance: header.openingBalance,
    totalInflow: header.totalInflow,
    totalOutflow: header.totalOutflow,
    closingBalance: header.closingBalance,
    lines,
    notes: "Kartične stavke sa šifrom M02 uvoze se bez žiro računa partnera."
  };
}

function parsePrvaDateInput(data: string) {
  const clean = data.trim();

  if (/^\d{4}\.\d{2}\.\d{2}$/.test(clean)) {
    return parseDateInput(clean.replace(/^(\d{4})\.(\d{2})\.(\d{2})$/, "$1-$2-$3"));
  }

  return parseDateInput(clean);
}

function prvaMoneyValues(row: PdfTextRow) {
  return row.items
    .filter((item) => item.x >= 40 && item.x <= 310)
    .map((item) => item.text.trim())
    .filter(isMoneyText)
    .map((item) => parseMoneyToCents(item))
    .filter((amount): amount is number => amount !== null);
}

function parsePrvaHeader(text: string, rows: PdfTextRow[]) {
  const normalizedText = text.replace(/\s+/g, " ");
  const statementRow = rows.find((row) => firstPdfItemInRange(row, 480, 530, /^\d+$/));
  const statementNumber =
    (statementRow ? firstPdfItemInRange(statementRow, 480, 530, /^\d+$/) : "") ||
    normalizedText.match(/IZVOD\s+O\s+STANJU\s+I\s+PROMJENAMA\s+SREDSTAVA\s+BROJ\s+(\d+)/i)?.[1] ||
    null;
  const accountRow = rows.find((row) => firstPdfItemInRange(row, 120, 180, /^\d{3}-[\d-]+$/));
  const dateRow = rows.find((row) => pdfRowText(row).startsWith("Datum izvoda:"));
  const totalsRow = rows.find((row) => prvaMoneyValues(row).length >= 4);
  const totals = totalsRow ? prvaMoneyValues(totalsRow) : [];

  return {
    statementNumber,
    statementDate: parseDateInput(firstPdfItemInRange(dateRow ?? { page: 0, y: 0, items: [] }, 480, 530)),
    companyAccountNumber: accountRow
      ? firstPdfItemInRange(accountRow, 120, 170, /^\d{3}-[\d-]+$/) || null
      : null,
    openingBalance: totals[0] ?? null,
    totalOutflow: totals[1] ?? null,
    totalInflow: totals[2] ?? null,
    closingBalance: totals[3] ?? null
  };
}

function isPrvaAccountNumber(input: string | null | undefined) {
  return /^\d{3}-\d{1,13}-\d{1,3}$/.test(String(input ?? "").trim());
}

function prvaFirstAmountInRange(rows: PdfTextRow[], minX: number, maxX: number) {
  const value = rows
    .flatMap((row) => row.items)
    .filter((item) => item.x >= minX && item.x <= maxX)
    .map((item) => item.text.trim())
    .find(isMoneyText);

  return parseMoneyToCents(value ?? "") ?? 0;
}

function prvaTextInRange(rows: PdfTextRow[], minX: number, maxX: number) {
  return rows
    .flatMap((row) => pdfItemsInRange(row, minX, maxX))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePrvaLine(rows: PdfTextRow[], companyAccountNumber: string | null): ParsedStatementLine | null {
  const rowNumber = firstPdfItemInRange(rows[0], 40, 55, /^\d+$/);

  if (!rowNumber) {
    return null;
  }

  const postingDateText = rows
    .flatMap((row) => pdfItemsInRange(row, 245, 315))
    .find((item) => /^\d{4}[./]\d{2}[./]\d{2}$/.test(item));
  const postingDate = parsePrvaDateInput(postingDateText ?? "");
  const outflow = prvaFirstAmountInRange(rows, 330, 390);
  const inflow = prvaFirstAmountInRange(rows, 405, 450);
  const paymentCode = rows
    .flatMap((row) => pdfItemsInRange(row, 450, 480))
    .find((item) => /^\d{3}$/.test(item)) ?? null;

  if (!postingDate || (outflow === 0 && inflow === 0)) {
    return null;
  }

  const accountCandidate = rows
    .flatMap((row) => pdfItemsInRange(row, 55, 180))
    .find(isPrvaAccountNumber) ?? null;
  const normalizedAccountCandidate = normalizeAccountNumber(accountCandidate);
  const normalizedCompanyAccount = normalizeAccountNumber(companyAccountNumber);
  const accountNumber =
    normalizedAccountCandidate && normalizedAccountCandidate !== normalizedCompanyAccount
      ? accountCandidate
      : null;
  const normalizedAccountNumber = normalizeAccountNumber(accountNumber);
  const counterpartyName = rows
    .flatMap((row) => pdfItemsInRange(row, 60, 245))
    .filter((item) => !isPrvaAccountNumber(item))
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim() || null;
  const purpose = prvaTextInRange(rows, 480, 625);
  const referenceNumber = prvaTextInRange(rows, 625, 820)
    .replace(/\(\s*\)/g, "")
    .replace(/\(\d+\)/g, "")
    .replace(/\s+/g, " ")
    .trim() || null;
  const description = [counterpartyName, purpose].filter(Boolean).join(" · ");

  return {
    postingDate,
    valueDate: postingDate,
    description: description || `Prva banka PDF stavka ${rowNumber}`,
    accountNumber,
    normalizedAccountNumber: normalizedAccountNumber || null,
    counterpartyName,
    referenceNumber,
    paymentCode,
    outflow,
    inflow,
    rawText: description || `Prva banka PDF stavka ${rowNumber}`
  };
}

function parsePrvaBankaPdf(text: string, pdfRows?: PdfTextRow[]): ParsedStatement | null {
  if (
    !pdfRows?.length ||
    !/IZVOD\s+O\s+STANJU\s+I\s+PROMJENAMA\s+SREDSTAVA/i.test(text) ||
    !/PRVA\s+BANKA|prvabankacg\.com/i.test(text)
  ) {
    return null;
  }

  const header = parsePrvaHeader(text, pdfRows);

  if (!header.statementNumber || !header.companyAccountNumber) {
    return null;
  }

  const lines: ParsedStatementLine[] = [];
  let currentRows: PdfTextRow[] = [];
  const pushCurrent = () => {
    if (currentRows.length === 0) {
      return;
    }

    const line = parsePrvaLine(currentRows, header.companyAccountNumber);

    if (line) {
      lines.push(line);
    }

    currentRows = [];
  };

  for (const row of pdfRows) {
    const rowText = pdfRowText(row);
    const rowNumber = firstPdfItemInRange(row, 40, 55, /^\d+$/);
    const isHeaderRow = rowText.includes("Primalac plaćanja/platilac") || rowText === "RB";
    const isTotalRow =
      Boolean(firstPdfItemInRange(row, 260, 310, /^UKUPNO:$/)) ||
      Boolean(firstPdfItemInRange(row, 260, 310, /^Naknada:$/));

    if (isTotalRow) {
      pushCurrent();
      continue;
    }

    if (rowNumber && !isHeaderRow) {
      pushCurrent();
      currentRows = [row];
      continue;
    }

    if (currentRows.length > 0 && !isHeaderRow && !rowText.startsWith("Kreirano:")) {
      currentRows.push(row);
    }
  }

  pushCurrent();

  if (lines.length === 0) {
    return null;
  }

  return {
    parser: "PRVA_PDF",
    companyAccountNumber: header.companyAccountNumber,
    statementNumber: header.statementNumber,
    statementDate: header.statementDate,
    openingBalance: header.openingBalance,
    totalInflow: header.totalInflow,
    totalOutflow: header.totalOutflow,
    closingBalance: header.closingBalance,
    lines,
    notes: "PDF parser za Prvu banku čita tabelarne stavke i rekapitulaciju iz zaglavlja."
  };
}

function parseCsvLikeLine(rawLine: string): ParsedStatementLine | null {
  const parts = rawLine.split(";").map((part) => part.trim());

  if (parts.length < 5) {
    return null;
  }

  const postingDate = parseDateInput(parts[0]);
  const outflow = parseMoneyToCents(parts[3]);
  const inflow = parseMoneyToCents(parts[4]);

  if (!postingDate || outflow === null || inflow === null || (outflow === 0 && inflow === 0)) {
    return null;
  }

  const accountNumber = parts[2] || null;
  const normalizedAccountNumber = normalizeAccountNumber(accountNumber);

  return {
    postingDate,
    description: parts[1] || rawLine,
    accountNumber,
    normalizedAccountNumber: normalizedAccountNumber || null,
    valueDate: postingDate,
    outflow,
    inflow,
    rawText: rawLine
  };
}

function parseTextLine(rawLine: string): ParsedStatementLine | null {
  const dateMatch = rawLine.match(/\b(\d{1,2}\.\d{1,2}\.\d{4}\.|\d{4}-\d{2}-\d{2})\b/);

  if (!dateMatch) {
    return null;
  }

  const postingDate = parseDateInput(dateMatch[1]);

  if (!postingDate) {
    return null;
  }

  const amountMatches = [...rawLine.matchAll(/-?\d{1,3}(?:[.\s]\d{3})*,\d{2}|-?\d+[,.]\d{2}/g)];
  const accountMatch = rawLine.match(/\b\d{3}[-\s]?\d{5,13}[-\s]?\d{2}\b/);

  if (amountMatches.length === 0) {
    return null;
  }

  const lastAmount = amountMatches[amountMatches.length - 1]?.[0] ?? "";
  const amount = amountTextToCents(lastAmount);

  if (!amount || amount === 0) {
    return null;
  }

  const lower = rawLine.toLowerCase();
  const isOutflow =
    amount < 0 ||
    lower.includes("odliv") ||
    lower.includes("naknada") ||
    lower.includes("proviz") ||
    lower.includes("placanje") ||
    lower.includes("plaćanje") ||
    lower.includes("zaduzen") ||
    lower.includes("zadužen");
  const absoluteAmount = Math.abs(amount);
  const accountNumber = accountMatch?.[0] ?? null;
  const normalizedAccountNumber = normalizeAccountNumber(accountNumber);

  return {
    postingDate,
    description: rawLine
      .replace(dateMatch[0], "")
      .replace(lastAmount, "")
      .trim() || rawLine,
    accountNumber,
    normalizedAccountNumber: normalizedAccountNumber || null,
    valueDate: postingDate,
    outflow: isOutflow ? absoluteAmount : 0,
    inflow: isOutflow ? 0 : absoluteAmount,
    rawText: rawLine
  };
}

function xmlValue(source: string, tag: string) {
  const match = source.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));

  return match ? decodeXml(match[1]).trim() : "";
}

function xmlSection(source: string, tag: string) {
  const match = source.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));

  return match?.[1] ?? "";
}

function xmlSections(source: string, tag: string) {
  const matches = [...source.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi"))];

  return matches.map((match) => match[1] ?? "");
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function cleanXmlText(text: string) {
  return text.replace(/\u0000/g, "").replace(/^\uFEFF/, "").trim();
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function cleanHtmlCell(value: string) {
  return decodeHtml(
    value
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function htmlText(value: string) {
  return cleanHtmlCell(value).join(" ").trim();
}

function htmlHeaderValue(html: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(
    new RegExp(`<td[^>]*>\\s*${escapedLabel}\\s*<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, "i")
  );

  return match ? htmlText(match[1] ?? "") : "";
}

function parseErsteStatementNumber(value: string) {
  return value.match(/^\s*(\d+)/)?.[1] ?? "";
}

function parseErstePaymentCode(lines: string[]) {
  const joined = lines.join(" ");

  return joined.match(/\b(\d{3})\b/)?.[1] ?? null;
}

function parseErsteHtml(text: string): ParsedStatement | null {
  const cleanText = text.replace(/\u0000/g, "").replace(/^\uFEFF/, "");

  if (!/ERSTE BANK/i.test(cleanText) || !/<!--ISPIS PROMETA-->/i.test(cleanText)) {
    return null;
  }

  const companyAccountNumber = htmlHeaderValue(cleanText, "Broj računa:");
  const statementNumberRaw = htmlHeaderValue(cleanText, "Broj izvoda:");
  const statementDateText =
    cleanText.match(/Stanje na dan<\/td>\s*<td[^>]*>\s*<b>\s*([^<]+)/i)?.[1]?.trim() ??
    cleanText.match(/Za period \(po datumu obrade\):\s*([^<\r\n]+)/i)?.[1]?.trim() ??
    "";
  const openingBalanceText =
    cleanText.match(/Početno stanje<\/b><\/td><td[^>]*>&nbsp;<\/td><td[^>]*><b>([^<]+)/i)?.[1] ?? "";
  const closingBalanceText =
    cleanText.match(/Konačno stanje<\/b><\/td><td[^>]*>&nbsp;<\/td><td[^>]*><b>([^<]+)/i)?.[1] ?? "";
  const debitRecap = parseMoneyToCents(
    cleanText.match(/Ukupni dugovni promet<\/td><td[^>]*>([^<]+)/i)?.[1] ?? ""
  );
  const creditRecap = parseMoneyToCents(
    cleanText.match(/Ukupni potražni promet<\/td><td[^>]*>([^<]+)/i)?.[1] ?? ""
  );
  const rows = [...cleanText.matchAll(/<!--ISPIS PROMETA-->\s*<tr>([\s\S]*?)<\/tr>/gi)];
  const lines: ParsedStatementLine[] = [];

  rows.forEach((row, index) => {
    const cells = [...(row[1] ?? "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) =>
      cleanHtmlCell(match[1] ?? "")
    );

    if (cells.length < 6) {
      return;
    }

    const dateLines = cells[0] ?? [];
    const counterpartyLines = cells[1] ?? [];
    const purposeLines = cells[2] ?? [];
    const referenceLines = cells[3] ?? [];
    const postingDate = parseDateInput(dateLines[2] ?? dateLines[0] ?? "");
    const valueDate = parseDateInput(dateLines[1] ?? dateLines[0] ?? "");
    const counterpartyName = counterpartyLines[0] ?? null;
    const accountNumber =
      counterpartyLines.find((line) => /\b\d{3}[-\s]?\d{5,13}[-\s]?\d{2}\b/.test(line)) ?? null;
    const normalizedAccountNumber = normalizeAccountNumber(accountNumber);
    const outflow = parseMoneyToCents(cells[4]?.join(" ") ?? "");
    const inflow = parseMoneyToCents(cells[5]?.join(" ") ?? "");
    const referenceNumber =
      [...referenceLines].reverse().find((line) => line && line !== "00") ?? null;
    const paymentCode = parseErstePaymentCode(purposeLines);

    if (!postingDate || outflow === null || inflow === null || (outflow === 0 && inflow === 0)) {
      return;
    }

    lines.push({
      postingDate,
      valueDate,
      description: [...purposeLines, counterpartyName ?? ""].filter(Boolean).join(" · "),
      accountNumber,
      normalizedAccountNumber: normalizedAccountNumber || null,
      counterpartyName,
      referenceNumber,
      paymentCode,
      outflow,
      inflow,
      rawText: `ERSTE HTM stavka ${index + 1}`
    });
  });

  const totalOutflow = lines.reduce((sum, line) => sum + line.outflow, 0);
  const totalInflow = lines.reduce((sum, line) => sum + line.inflow, 0);
  const totalMismatch =
    (debitRecap !== null && debitRecap !== totalOutflow) ||
    (creditRecap !== null && creditRecap !== totalInflow);

  return {
    parser: "ERSTE_HTM",
    companyAccountNumber: companyAccountNumber || null,
    statementNumber: parseErsteStatementNumber(statementNumberRaw) || statementNumberRaw || null,
    statementDate: parseDateInput(statementDateText),
    openingBalance: parseMoneyToCents(openingBalanceText),
    closingBalance: parseMoneyToCents(closingBalanceText),
    lines,
    notes: totalMismatch ? "Zbir stavki se ne slaže sa rekapitulacijom Erste izvoda." : null
  };
}

function parseNlbXml(text: string): ParsedStatement | null {
  const cleanText = cleanXmlText(text);

  if (!cleanText.includes("<stmtrs") || !cleanText.includes("<stmttrn>")) {
    return null;
  }

  const statementSection = xmlSection(cleanText, "stmtrs") || cleanText;
  const ledgerBalanceSection = xmlSection(statementSection, "ledgerbal");
  const availableBalanceSection = xmlSection(statementSection, "availbal");
  const statementDate =
    parseDateInput(xmlValue(availableBalanceSection, "dtasof").slice(0, 10)) ??
    parseDateInput(xmlValue(ledgerBalanceSection, "dtasof").slice(0, 10));
  const openingBalance = parseMoneyToCents(xmlValue(ledgerBalanceSection, "balamt"));
  const closingBalance = parseMoneyToCents(xmlValue(availableBalanceSection, "balamt"));
  const transactionSections = xmlSections(statementSection, "stmttrn");
  const lines: ParsedStatementLine[] = [];

  transactionSections.forEach((transaction, index) => {
    const benefit = xmlValue(transaction, "benefit").toLowerCase();
    const amount = parseMoneyToCents(xmlValue(transaction, "trnamt"));
    const postingDate = parseDateInput(xmlValue(transaction, "dtposted").slice(0, 10));
    const valueDate = parseDateInput(xmlValue(transaction, "dtavail").slice(0, 10));
    const payeeInfo = xmlSection(transaction, "payeeinfo");
    const payeeAccountInfo = xmlSection(transaction, "payeeaccountinfo");
    const accountNumber = xmlValue(payeeAccountInfo, "acctid") || null;
    const normalizedAccountNumber = normalizeAccountNumber(accountNumber);
    const counterpartyName = xmlValue(payeeInfo, "name") || null;
    const purpose = xmlValue(transaction, "purpose");
    const purposeCode = xmlValue(transaction, "purposecode");
    const referenceNumber =
      xmlValue(transaction, "payeerefnumber") ||
      xmlValue(transaction, "refnumber") ||
      xmlValue(transaction, "fitid") ||
      null;

    if (!postingDate || amount === null || amount === 0) {
      return;
    }

    lines.push({
      postingDate,
      valueDate,
      description: [purpose, purposeCode ? `Šifra ${purposeCode}` : "", counterpartyName ?? ""]
        .filter(Boolean)
        .join(" · "),
      accountNumber,
      normalizedAccountNumber: normalizedAccountNumber || null,
      counterpartyName,
      referenceNumber,
      paymentCode: purposeCode || null,
      outflow: benefit === "debit" ? amount : 0,
      inflow: benefit === "credit" ? amount : 0,
      rawText: `NLB XML stavka ${index + 1}`
    });
  });

  return {
    parser: "NLB_XML",
    companyAccountNumber: xmlValue(statementSection, "acctid") || null,
    statementNumber: xmlValue(statementSection, "stmtnumber") || null,
    statementDate,
    openingBalance,
    closingBalance,
    lines,
    notes: lines.length === transactionSections.length ? null : "Neke XML stavke nisu pročitane."
  };
}

function nlbMoneyValues(row: PdfTextRow) {
  return row.items
    .filter((item) => item.x >= 40 && item.x <= 530)
    .map((item) => item.text.trim())
    .filter(isMoneyText)
    .map((item) => parseMoneyToCents(item))
    .filter((amount): amount is number => amount !== null);
}

function parseNlbPdfHeader(text: string, rows: PdfTextRow[]) {
  const normalizedText = text.replace(/\s+/g, " ");
  const headerMatch = normalizedText.match(
    /IZVOD\s+BR\.\s*(\d+)\s+ZA\s+PROMJENU\s+SREDSTAVA\s+NA\s+RA[ČC]UNU\s+DANA\s+(\d{2}\.\d{2}\.\d{4})/i
  );
  const accountRow = rows.find((row) => firstPdfItemInRange(row, 650, 780, /^\d{3}-[\d-]+$/));
  const balanceRow = rows.find((row) => nlbMoneyValues(row).length >= 4);
  const balances = balanceRow ? nlbMoneyValues(balanceRow) : [];

  return {
    statementNumber: headerMatch?.[1] ?? null,
    statementDate: parseDateInput(headerMatch?.[2] ?? ""),
    companyAccountNumber: accountRow
      ? firstPdfItemInRange(accountRow, 650, 780, /^\d{3}-[\d-]+$/) || null
      : null,
    openingBalance: balances[0] ?? null,
    totalOutflow: balances[1] ?? null,
    totalInflow: balances[2] ?? null,
    closingBalance: balances[3] ?? null
  };
}

function isNlbAccountNumber(input: string | null | undefined) {
  return /^\d{3}-\d{1,13}-\d{1,3}$/.test(String(input ?? "").trim());
}

function nlbTextInRange(rows: PdfTextRow[], minX: number, maxX: number) {
  return rows
    .flatMap((row) => pdfItemsInRange(row, minX, maxX))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function nlbFirstMoneyInRange(rows: PdfTextRow[], minX: number, maxX: number) {
  const item = rows
    .flatMap((row) =>
      row.items
        .filter((pdfItem) => pdfItem.x >= minX && pdfItem.x <= maxX)
        .map((pdfItem) => pdfItem.text.trim())
    )
    .filter((value) => !/^Naknada:/i.test(value))
    .find(isMoneyText);

  return parseMoneyToCents(item ?? "") ?? 0;
}

function parseNlbPdfLine(rows: PdfTextRow[]): ParsedStatementLine | null {
  const mainRow = rows.find((row) => firstPdfItemInRange(row, 30, 50, /^\d+$/));
  const rowNumber = mainRow ? firstPdfItemInRange(mainRow, 30, 50, /^\d+$/) : "";

  if (!rowNumber) {
    return null;
  }

  const postingDateText = rows
    .flatMap((row) => pdfItemsInRange(row, 210, 260))
    .find((item) => /^\d{2}\.\d{2}\.\d{4}$/.test(item));
  const postingDate = parseDateInput(postingDateText ?? "");
  const outflow = nlbFirstMoneyInRange(rows, 300, 380);
  const inflow = nlbFirstMoneyInRange(rows, 380, 430);
  const paymentCode =
    rows.flatMap((row) => pdfItemsInRange(row, 430, 465)).find((item) => /^\d{3}$/.test(item)) ??
    null;

  if (!postingDate || (outflow === 0 && inflow === 0)) {
    return null;
  }

  const accountNumber =
    rows
      .flatMap((row) => pdfItemsInRange(row, 50, 190))
      .find(isNlbAccountNumber) ?? null;
  const normalizedAccountNumber = normalizeAccountNumber(accountNumber);
  const counterpartyName =
    rows
      .flatMap((row) => pdfItemsInRange(row, 55, 220))
      .filter((item) => !isNlbAccountNumber(item))
      .filter((item) => !/^\d{2}\.\d{2}\.\d{4}$/.test(item))
      .filter((item) => !/^BANKE$/i.test(item))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim() || null;
  const purpose = nlbTextInRange(rows, 465, 645);
  const referenceNumber = nlbTextInRange(rows, 645, 830)
    .replace(/\(\d+\)/g, "")
    .replace(/\s+/g, " ")
    .trim() || null;
  const feeText =
    rows
      .flatMap((row) => row.items.map((item) => item.text.trim()))
      .find((item) => /^Naknada:/i.test(item))
      ?.replace(/\s+/g, " ") ?? "";
  const description = [purpose, counterpartyName, feeText].filter(Boolean).join(" · ");

  return {
    postingDate,
    valueDate: postingDate,
    description: description || `NLB PDF stavka ${rowNumber}`,
    accountNumber,
    normalizedAccountNumber: normalizedAccountNumber || null,
    counterpartyName,
    referenceNumber,
    paymentCode,
    outflow,
    inflow,
    rawText: description || `NLB PDF stavka ${rowNumber}`
  };
}

function parseNlbPdf(text: string, pdfRows?: PdfTextRow[]): ParsedStatement | null {
  if (
    !pdfRows?.length ||
    !/IZVOD\s+BR\./i.test(text) ||
    !/PROMJENU\s+SREDSTAVA\s+NA\s+RA[ČC]UNU/i.test(text)
  ) {
    return null;
  }

  const header = parseNlbPdfHeader(text, pdfRows);

  if (!header.statementNumber || !header.companyAccountNumber) {
    return null;
  }

  const lines: ParsedStatementLine[] = [];
  const transactionRows = pdfRows.filter((row) => {
    const rowText = pdfRowText(row);

    return !(
      rowText.includes("PROMENE") ||
      rowText.includes("Naziv i sjedište") ||
      rowText.includes("Model i poziv") ||
      rowText.includes("broj računa") ||
      rowText.includes("nal.") ||
      rowText.includes("Ukupno za račun") ||
      rowText.includes("Ukupno EURA") ||
      rowText.includes("(postoji") ||
      rowText.includes("Prenos na sledeću stranu") ||
      rowText.includes("Prenos sa prethodne strane") ||
      rowText.startsWith("Izvod br.")
    );
  });
  const mainRows = transactionRows.filter((row) => firstPdfItemInRange(row, 30, 50, /^\d+$/));

  for (const mainRow of mainRows) {
    const lineRows = transactionRows.filter(
      (row) => row.page === mainRow.page && row.y <= mainRow.y + 22 && row.y >= mainRow.y - 16
    );
    const line = parseNlbPdfLine(lineRows);

    if (line) {
      lines.push(line);
    }
  }

  if (lines.length === 0) {
    return null;
  }

  return {
    parser: "NLB_PDF",
    companyAccountNumber: header.companyAccountNumber,
    statementNumber: header.statementNumber,
    statementDate: header.statementDate,
    openingBalance: header.openingBalance,
    totalInflow: header.totalInflow,
    totalOutflow: header.totalOutflow,
    closingBalance: header.closingBalance,
    lines,
    notes: "PDF parser za NLB izvode čita zaglavlje, rekapitulaciju i tabelarne stavke po koordinatama."
  };
}

function parseStatementText(text: string): ParsedStatement {
  const lines = text
    .replace(/\u0000/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    parser: "TEXT",
    lines: lines
      .map((line) => parseCsvLikeLine(line) ?? parseTextLine(line))
      .filter((line): line is ParsedStatementLine => Boolean(line))
  };
}

type StatementParser = (text: string, pdfRows?: PdfTextRow[]) => ParsedStatement | null;

const statementParserRegistry: Record<string, StatementParser[]> = {
  NLB: [parseNlbXml, parseNlbPdf],
  ERSTE: [parseErsteHtml],
  CKB: [parseCkbPdf],
  HIPOTEKARNA: [parseHipotekarnaPdf],
  LOVCEN: [parseLovcenPdf],
  PRVA: [parsePrvaBankaPdf]
};

const defaultStatementParsers: StatementParser[] = [
  parseNlbXml,
  parseNlbPdf,
  parseErsteHtml,
  parseCkbPdf,
  parseHipotekarnaPdf,
  parseLovcenPdf,
  parsePrvaBankaPdf
];

function bankParserKey(bankName: string | null | undefined) {
  const normalized = String(bankName ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (normalized.includes("NLB")) {
    return "NLB";
  }

  if (normalized.includes("ERSTE")) {
    return "ERSTE";
  }

  if (
    normalized.includes("CKB") ||
    normalized.includes("CRNOGORSKA KOMERCIJALNA") ||
    normalized.includes("KOMERCIJALNA BANKA")
  ) {
    return "CKB";
  }

  if (normalized.includes("HIPOTEKARNA")) {
    return "HIPOTEKARNA";
  }

  if (normalized.includes("LOVCEN")) {
    return "LOVCEN";
  }

  if (normalized.includes("PRVA")) {
    return "PRVA";
  }

  return null;
}

function parseStatement(text: string, bankName?: string | null, pdfRows?: PdfTextRow[]) {
  const preferredKey = bankParserKey(bankName);
  const preferredParsers = preferredKey ? statementParserRegistry[preferredKey] ?? [] : [];
  const parsers = [
    ...preferredParsers,
    ...defaultStatementParsers.filter((parser) => !preferredParsers.includes(parser))
  ];

  for (const parser of parsers) {
    const parsed = parser(text, pdfRows);

    if (parsed) {
      return parsed;
    }
  }

  return parseStatementText(text);
}

type BankPostingRuleForMatch = Prisma.BankPostingRuleGetPayload<{
  include: {
    account: {
      select: {
        id: true;
        sifra: true;
        analitika_obavezna: true;
      };
    };
  };
}>;

function ruleMatchesLine(
  rule: BankPostingRuleForMatch,
  direction: string,
  line: ParsedStatementLine
) {
  if (rule.direction !== direction || !rule.auto_apply) {
    return false;
  }

  if (
    rule.counterparty_account_number_normalized &&
    rule.counterparty_account_number_normalized !== line.normalizedAccountNumber
  ) {
    return false;
  }

  if (!containsText(line.description, rule.description_contains)) {
    return false;
  }

  if (!containsText(line.referenceNumber, rule.reference_contains)) {
    return false;
  }

  if (!paymentCodesMatch(rule.payment_code, line.paymentCode)) {
    return false;
  }

  return true;
}

function ruleSpecificity(rule: BankPostingRuleForMatch) {
  return (
    (rule.counterparty_account_number_normalized ? 20 : 0) +
    (rule.description_contains ? 30 : 0) +
    (rule.payment_code ? 25 : 0) +
    (rule.reference_contains ? 20 : 0)
  );
}

function bestRuleForLine(
  rules: BankPostingRuleForMatch[],
  direction: string,
  line: ParsedStatementLine,
  firmaId: string
) {
  return rules
    .filter((rule) => ruleMatchesLine(rule, direction, line))
    .sort((left, right) => {
      const scopeDiff = Number(right.firma_id === firmaId) - Number(left.firma_id === firmaId);

      if (scopeDiff !== 0) {
        return scopeDiff;
      }

      const priorityDiff = right.priority - left.priority;

      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      const specificityDiff = ruleSpecificity(right) - ruleSpecificity(left);

      if (specificityDiff !== 0) {
        return specificityDiff;
      }

      return right.times_used - left.times_used;
    })[0] ?? null;
}

function learnedDescriptionCondition(description: string | null | undefined) {
  const cleanDescription = String(description ?? "").replace(/\s+/g, " ").trim();
  const parts = cleanDescription
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);
  const usefulPart =
    parts.find((part) => /UPLATA|PAZAR|NAKNADA|PROVIZ|KARTIC|POS|ATM/i.test(part)) ??
    parts[parts.length - 1] ??
    cleanDescription;

  if (/platne\s+kartice|kartic/i.test(usefulPart)) {
    return "Platne kartice";
  }

  if (/uplata\s+pazara|pazar/i.test(usefulPart)) {
    return "Uplata pazara";
  }

  if (/naknada/i.test(usefulPart)) {
    return "Naknada";
  }

  if (/proviz/i.test(usefulPart)) {
    return "Proviz";
  }

  if (/pos/i.test(usefulPart)) {
    return "POS";
  }

  if (/atm/i.test(usefulPart)) {
    return "ATM";
  }

  return usefulPart || null;
}

function shouldLearnSpecificBankRule(descriptionContains: string | null, paymentCode: string | null) {
  return Boolean(descriptionContains && /UPLATA|PAZAR|NAKNADA|PROVIZ|KARTIC|POS|ATM/i.test(descriptionContains)) ||
    ["M02", "D30", "Z12"].includes(normalizePaymentCode(paymentCode));
}

async function getActiveContext() {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return {
      user,
      firma: null,
      poslovnaGodina: null
    };
  }

  const firma = await prisma.firma.findFirst({
    where: {
      id: workContext.firmaId,
      agencija_id: user.agencija_id,
      is_deleted: false,
      aktivan: true,
      ...(user.rola === "admin_agencije"
        ? {}
        : {
            korisnici: {
              some: {
                korisnik_id: user.id,
                is_deleted: false
              }
            }
          })
    },
    select: {
      id: true,
      naziv: true,
      agencija_id: true
    }
  });

  const poslovnaGodina = firma
    ? await prisma.poslovnaGodina.findFirst({
        where: {
          id: workContext.poslovnaGodinaId,
          firma_id: firma.id
        },
        select: {
          id: true,
          godina: true,
          zakljucena: true
        }
      })
    : null;

  return {
    user,
    firma,
    poslovnaGodina
  };
}

type UploadedStatement = {
  text: string;
  fileName: string | null;
  fileType: string | null;
  pdfRows?: PdfTextRow[];
};

async function extractPdfTextRows(bytes: Uint8Array) {
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({
    data: bytes
  }).promise;
  const rowsByKey = new Map<string, PdfTextRow>();

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();

    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim() || !("transform" in item)) {
        continue;
      }

      const x = Math.round(item.transform[4] ?? 0);
      const y = Math.round(item.transform[5] ?? 0);
      const key = `${pageNumber}:${y}`;
      const row = rowsByKey.get(key) ?? {
        page: pageNumber,
        y,
        items: []
      };

      row.items.push({
        x,
        text: item.str
      });
      rowsByKey.set(key, row);
    }
  }

  const rows = [...rowsByKey.values()]
    .map((row) => ({
      ...row,
      items: row.items.sort((left, right) => left.x - right.x)
    }))
    .sort((left, right) => left.page - right.page || right.y - left.y);
  const text = rows.map((row) => pdfRowText(row)).filter(Boolean).join("\n");

  return {
    text,
    rows
  };
}

async function readUploadedFile(file: File): Promise<UploadedStatement> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const fileHeader = new TextDecoder("ascii").decode(bytes.slice(0, 5));

  if (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf") ||
    fileHeader === "%PDF-"
  ) {
    const extracted = await extractPdfTextRows(bytes);

    return {
      text: extracted.text,
      fileName: file.name,
      fileType: file.type || "application/pdf",
      pdfRows: extracted.rows
    };
  }

  const utf8Probe = new TextDecoder("utf-8").decode(bytes.slice(0, 2048));
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : /charset\s*=\s*["']?windows-1250/i.test(utf8Probe)
          ? "windows-1250"
          : "utf-8";

  return {
    text: new TextDecoder(encoding).decode(bytes),
    fileName: file.name,
    fileType: file.type || null
  };
}

async function readUploadedStatements(formData: FormData): Promise<UploadedStatement[]> {
  const pastedText = value(formData, "raw_text");
  const files = formData
    .getAll("statement_file")
    .filter((file): file is File => file instanceof File && file.size > 0);

  if (files.length > 0) {
    return Promise.all(files.map((file) => readUploadedFile(file)));
  }

  return pastedText.trim()
    ? [
        {
          text: pastedText,
          fileName: null,
          fileType: null,
          pdfRows: undefined
        }
      ]
    : [];
}

async function findPartnersByAccounts(
  agencijaId: string,
  firmaId: string,
  normalizedAccounts: string[]
) {
  const uniqueAccounts = [...new Set(normalizedAccounts.filter(Boolean))];

  if (uniqueAccounts.length === 0) {
    return new Map<string, string>();
  }

  const learnedAccounts = await prisma.partnerBankAccount.findMany({
    where: {
      agencija_id: agencijaId,
      is_active: true,
      normalized_account_number: {
        in: uniqueAccounts
      },
      OR: [
        {
          firma_id: firmaId
        },
        {
          firma_id: {
            equals: null
          }
        }
      ]
    },
    select: {
      normalized_account_number: true,
      firma_id: true,
      partner_id: true
    }
  });
  const result = new Map<string, string>();

  for (const account of learnedAccounts.filter((account) => !account.firma_id)) {
    result.set(account.normalized_account_number, account.partner_id);
  }

  for (const account of learnedAccounts.filter((account) => account.firma_id === firmaId)) {
    result.set(account.normalized_account_number, account.partner_id);
  }

  const missingAccounts = uniqueAccounts.filter((account) => !result.has(account));

  if (missingAccounts.length === 0) {
    return result;
  }

  const ziroAccounts = await prisma.komitentZiroRacun.findMany({
    where: {
      aktivan: true
    },
    select: {
      broj_racuna: true,
      komitent_id: true
    }
  });

  for (const account of ziroAccounts) {
    const normalized = normalizeAccountNumber(account.broj_racuna);

    if (missingAccounts.includes(normalized) && !result.has(normalized)) {
      result.set(normalized, account.komitent_id);
    }
  }

  return result;
}

async function resolveStatementLineStatus(
  tx: Prisma.TransactionClient,
  firmaId: string,
  line: {
    direction: string;
    debit_account_code: string | null;
    credit_account_code: string | null;
    partner_id: string | null;
    posting_status: string;
  }
) {
  if (line.posting_status === lineStatuses.ignored) {
    return lineStatuses.ignored;
  }

  const accountId =
    line.direction === "INFLOW" ? line.credit_account_code : line.debit_account_code;

  if (!accountId) {
    return lineStatuses.needsReview;
  }

  const account = await resolveCompanyAccount(tx, firmaId, accountId);

  return account?.analitika_obavezna && !line.partner_id
    ? lineStatuses.needsReview
    : lineStatuses.ready;
}

export async function importBankStatement(formData: FormData) {
  const { user, firma, poslovnaGodina } = await getActiveContext();
  const companyBankAccountId = value(formData, "company_bank_account_id");
  const bankAccountKontoCode = nullableValue(formData, "bank_account_konto_code");
  const uploadedStatements = await readUploadedStatements(formData);

  if (
    !user.agencija_id ||
    !firma ||
    !poslovnaGodina ||
    !companyBankAccountId ||
    uploadedStatements.length === 0
  ) {
    redirectStatements("izvod_obavezno");
  }

  if (poslovnaGodina.zakljucena) {
    redirectStatements("godina_zakljucena");
  }

  const [companyBankAccount, bankAccountKonto] = await Promise.all([
    prisma.firmaBankovniRacun.findFirst({
      where: {
        id: companyBankAccountId,
        agencija_id: user.agencija_id,
        firma_id: firma.id,
        is_deleted: false,
        aktivan: true
      },
      select: {
        id: true,
        naziv_banke: true
      }
    }),
    bankAccountKontoCode
      ? resolveCompanyAccount(prisma, firma.id, bankAccountKontoCode)
      : null
  ]);

  const bankSetting = companyBankAccount
    ? await prisma.bankStatementAccountSetting.findUnique({
        where: {
          firma_id_company_bank_account_id: {
            firma_id: firma.id,
            company_bank_account_id: companyBankAccount.id
          }
        },
        select: {
          bank_account_konto_id: true
        }
      })
    : null;
  const effectiveBankAccountKonto = bankAccountKonto
    ? bankAccountKonto
    : bankSetting?.bank_account_konto_id
      ? { id: bankSetting.bank_account_konto_id }
      : null;

  if (!companyBankAccount || !effectiveBankAccountKonto) {
    redirectStatements("izvod_obavezno");
  }

  const manualOverridesAllowed = uploadedStatements.length === 1;
  const importedStatementIds: string[] = [];
  let duplicateCount = 0;
  let invalidCount = 0;
  let firstInvalidMessage: string | null = null;

  for (const uploaded of uploadedStatements) {
    const parsedStatement = parseStatement(
      uploaded.text,
      companyBankAccount.naziv_banke,
      uploaded.pdfRows
    );
    const statementNumber = manualOverridesAllowed
      ? value(formData, "statement_number") || parsedStatement.statementNumber || ""
      : parsedStatement.statementNumber || "";
    const statementDate = manualOverridesAllowed
      ? parseDateInput(value(formData, "statement_date")) ?? parsedStatement.statementDate ?? null
      : parsedStatement.statementDate ?? null;
    const openingBalance = manualOverridesAllowed
      ? parseOptionalMoneyToCents(value(formData, "opening_balance")) ??
        parsedStatement.openingBalance ??
        null
      : parsedStatement.openingBalance ?? null;
    const closingBalance = manualOverridesAllowed
      ? parseOptionalMoneyToCents(value(formData, "closing_balance")) ??
        parsedStatement.closingBalance ??
        null
      : parsedStatement.closingBalance ?? null;
    const invalidMessage = !uploaded.text.trim()
      ? "izvod_prazan"
      : !statementNumber
        ? "izvod_nema_broj"
        : !statementDate
          ? "izvod_nema_datum"
          : openingBalance === null || closingBalance === null
            ? "izvod_nema_stanja"
            : parsedStatement.lines.length === 0
              ? "izvod_nema_stavki"
              : null;

    if (invalidMessage) {
      firstInvalidMessage ??= invalidMessage;
      invalidCount += 1;
      console.warn("Bank statement import skipped", {
        fileName: uploaded.fileName,
        parser: parsedStatement.parser,
        reason: invalidMessage,
        statementNumber,
        hasStatementDate: Boolean(statementDate),
        hasOpeningBalance: openingBalance !== null,
        hasClosingBalance: closingBalance !== null,
        lineCount: parsedStatement.lines.length,
        textPreview: uploaded.text.slice(0, 160)
      });
      continue;
    }

    if (!statementDate || openingBalance === null || closingBalance === null) {
      continue;
    }

    const validStatementDate = statementDate;
    const validOpeningBalance = openingBalance;
    const validClosingBalance = closingBalance;
    const parsedLines = parsedStatement.lines;
    const normalizedLineAccounts = parsedLines
      .map((line) => line.normalizedAccountNumber)
      .filter((account): account is string => Boolean(account));
    const partnerByAccount = await findPartnersByAccounts(
      user.agencija_id,
      firma.id,
      normalizedLineAccounts
    );
    const [rules, ownBankAccounts, ownBankSettings] = await Promise.all([
      prisma.bankPostingRule.findMany({
        where: {
          agencija_id: user.agencija_id,
          active: true,
          auto_apply: true,
          OR: [
            {
              firma_id: firma.id
            },
            {
              firma_id: {
                equals: null
              }
            }
          ]
        },
        include: {
          account: {
            select: {
              id: true,
              sifra: true,
              analitika_obavezna: true
            }
          }
        }
      }),
      prisma.firmaBankovniRacun.findMany({
        where: {
          agencija_id: user.agencija_id,
          firma_id: firma.id,
          is_deleted: false,
          aktivan: true
        },
        select: {
          id: true,
          broj_racuna: true
        }
      }),
      prisma.bankStatementAccountSetting.findMany({
        where: {
          agencija_id: user.agencija_id,
          firma_id: firma.id
        },
        select: {
          company_bank_account_id: true,
          bank_account_konto: {
            select: {
              id: true,
              sifra: true,
              analitika_obavezna: true
            }
          }
        }
      })
    ]);
    const ownBankAccountByNormalized = new Map(
      ownBankAccounts
        .filter((account) => account.id !== companyBankAccount.id)
        .map((account) => [normalizeAccountNumber(account.broj_racuna), account])
        .filter(([normalized]) => Boolean(normalized)) as [string, (typeof ownBankAccounts)[number]][]
    );
    const ownBankSettingByAccountId = new Map(
      ownBankSettings
        .filter((setting) => setting.bank_account_konto)
        .map((setting) => [setting.company_bank_account_id, setting.bank_account_konto])
    );
    const totalInflow =
      parsedStatement.totalInflow ?? parsedLines.reduce((sum, line) => sum + line.inflow, 0);
    const totalOutflow =
      parsedStatement.totalOutflow ?? parsedLines.reduce((sum, line) => sum + line.outflow, 0);
    const balanceOk = validOpeningBalance + totalInflow - totalOutflow === validClosingBalance;
    const statementLines = await Promise.all(parsedLines.map(async (line, index) => {
      const direction = line.inflow > 0 ? "INFLOW" : "OUTFLOW";
      const ownCounterpartyAccount = line.normalizedAccountNumber
        ? ownBankAccountByNormalized.get(line.normalizedAccountNumber)
        : null;
      const ownTransferAccount = ownCounterpartyAccount
        ? ownBankSettingByAccountId.get(ownCounterpartyAccount.id) ?? null
        : null;
      const rule = ownTransferAccount ? null : bestRuleForLine(rules, direction, line, firma.id);
      const ruleAccount = rule
        ? await resolveCompanyAccount(prisma, firma.id, rule.account_code ?? rule.account.sifra)
        : null;
      const partnerId = ownTransferAccount
        ? null
        : line.normalizedAccountNumber
          ? partnerByAccount.get(line.normalizedAccountNumber) ?? rule?.partner_id ?? null
          : null;
      const ruleAccountId = ownTransferAccount?.id ?? ruleAccount?.id ?? null;
      const ruleAccountRequiresPartner = Boolean(ruleAccount?.analitika_obavezna);
      const ruleReady = Boolean(
        ownTransferAccount ||
          (rule && !rule.requires_review && ruleAccountId && (!ruleAccountRequiresPartner || partnerId))
      );

      return {
        line_number: index + 1,
        posting_date: line.postingDate,
        value_date: line.valueDate ?? line.postingDate,
        reference_number: line.referenceNumber,
        payment_code: line.paymentCode ?? null,
        counterparty_name: line.counterpartyName,
        description: line.description,
        counterparty_account_number: line.accountNumber,
        counterparty_account_number_normalized: line.normalizedAccountNumber,
        inflow_amount: centsToDecimal(line.inflow),
        outflow_amount: centsToDecimal(line.outflow),
        direction,
        partner_id: partnerId,
        debit_account_id: direction === "OUTFLOW" ? ruleAccountId : null,
        credit_account_id: direction === "INFLOW" ? ruleAccountId : null,
        match_status: partnerId ? lineStatuses.matchedPartner : lineStatuses.unmatched,
        posting_status: ruleReady ? lineStatuses.ready : lineStatuses.needsReview,
        confidence_score: ownTransferAccount ? 100 : ruleReady ? 95 : partnerId ? 85 : 0,
        raw_text: line.rawText,
        created_by: user.id,
        updated_by: user.id
      };
    }));
    const allLinesReady = statementLines.every((line) => line.posting_status === lineStatuses.ready);
    const initialStatus = balanceOk && allLinesReady
      ? bankStatementStatuses.ready
      : balanceOk
        ? bankStatementStatuses.needsReview
        : bankStatementStatuses.imported;

    const statement = await prisma.bankStatement.create({
      data: {
        agencija_id: user.agencija_id,
        firma_id: firma.id,
        poslovna_godina_id: poslovnaGodina.id,
        company_bank_account_id: companyBankAccount.id,
        bank_account_konto_id: effectiveBankAccountKonto.id,
        statement_number: statementNumber,
        statement_date: validStatementDate,
        opening_balance: centsToDecimal(validOpeningBalance),
        total_inflow: centsToDecimal(totalInflow),
        total_outflow: centsToDecimal(totalOutflow),
        closing_balance: centsToDecimal(validClosingBalance),
        status: initialStatus,
        file_name: uploaded.fileName,
        file_type: uploaded.fileType,
        raw_text: uploaded.text,
        parse_notes: [
          `Parser: ${parsedStatement.parser}`,
          parsedStatement.companyAccountNumber
            ? `Račun iz fajla: ${parsedStatement.companyAccountNumber}`
            : "",
          parsedStatement.notes ?? "",
          balanceOk ? "" : "Početno stanje + priliv - odliv nije jednako krajnjem stanju.",
          initialStatus === bankStatementStatuses.ready
            ? "Sve stavke su mapirane pravilima; izvod je spreman za knjiženje."
            : ""
        ]
          .filter(Boolean)
          .join(" | ") || null,
        created_by: user.id,
        updated_by: user.id,
        lines: {
          create: statementLines
        }
      },
      select: {
        id: true
      }
    }).catch(() => null);

    if (!statement) {
      duplicateCount += 1;
      continue;
    }

    importedStatementIds.push(statement.id);

    await auditLog({
      korisnikId: user.id,
      agencijaId: user.agencija_id,
      firmaId: firma.id,
      modul: "agencija.izvodi",
      akcija: "import",
      tipEntiteta: "BankStatement",
      entitetId: statement.id
    });
  }

  if (importedStatementIds.length === 0) {
    redirectStatements(
      duplicateCount > 0 ? "izvod_duplikat" : firstInvalidMessage ?? "izvod_nema_stavki"
    );
  }

  await prisma.bankStatementAccountSetting.upsert({
    where: {
      firma_id_company_bank_account_id: {
        firma_id: firma.id,
        company_bank_account_id: companyBankAccount.id
      }
    },
    create: {
      agencija_id: user.agencija_id,
      firma_id: firma.id,
      company_bank_account_id: companyBankAccount.id,
      bank_account_konto_id: effectiveBankAccountKonto.id,
      last_used_at: new Date(),
      created_by: user.id,
      updated_by: user.id
    },
    update: {
      bank_account_konto_id: effectiveBankAccountKonto.id,
      last_used_at: new Date(),
      updated_by: user.id
    }
  });

  revalidatePath("/agencija/izvodi");
  const message =
    importedStatementIds.length > 1
      ? duplicateCount > 0 || invalidCount > 0
        ? "izvodi_uvezeni_djelimicno"
        : "izvodi_uvezeni"
      : duplicateCount > 0 || invalidCount > 0
        ? "izvodi_uvezeni_djelimicno"
        : "izvod_uvezen";

  redirectStatements(message, importedStatementIds[0]);
}

export async function updateBankStatementLines(formData: FormData) {
  const { user, firma, poslovnaGodina } = await getActiveContext();
  const statementId = value(formData, "statement_id");

  if (!user.agencija_id || !firma || !poslovnaGodina || !statementId) {
    redirectStatements("izvod_greska");
  }
  const agencijaId = user.agencija_id;

  if (poslovnaGodina.zakljucena) {
    redirectStatements("godina_zakljucena", statementId);
  }

  const statement = await prisma.bankStatement.findFirst({
    where: {
      id: statementId,
      agencija_id: user.agencija_id,
      firma_id: firma.id,
      poslovna_godina_id: poslovnaGodina.id,
      is_deleted: false
    },
    select: {
      id: true,
      status: true,
      bank_account_konto_id: true,
      journal: {
        select: {
          is_deleted: true
        }
      }
    }
  });

  const hasValidJournal = Boolean(statement?.journal && !statement.journal.is_deleted);

  if (
    !statement ||
    (statement.status === bankStatementStatuses.posted && hasValidJournal) ||
    !statement.bank_account_konto_id
  ) {
    redirectStatements("izvod_greska", statementId);
  }

  const lineIds = formData.getAll("line_id").map((item) => String(item));
  const partnerIds = formData.getAll("partner_id").map((item) => String(item).trim() || null);
  const debitAccountCodes = formData.getAll("debit_account_code").map((item) => String(item).trim() || null);
  const creditAccountCodes = formData.getAll("credit_account_code").map((item) => String(item).trim() || null);
  const lineDirections = formData.getAll("line_direction").map((item) => String(item));
  const allocationTargets = formData.getAll("allocation_target").map((item) => String(item).trim());
  const ignoredIds = new Set(formData.getAll("ignored_line_id").map((item) => String(item)));

  await prisma.$transaction(async (tx) => {
    const affectedKifEntryIds = new Set<string>();
    const affectedKufEntryIds = new Set<string>();

    for (let index = 0; index < lineIds.length; index += 1) {
      const lineId = lineIds[index];
      const lineDirection = lineDirections[index] ?? "";
      const postingStatus = ignoredIds.has(lineId) ? lineStatuses.ignored : lineStatuses.needsReview;
      const debitAccount =
        lineDirection === "OUTFLOW"
          ? await resolveCompanyAccount(tx, firma.id, debitAccountCodes[index] ?? null)
          : null;
      const creditAccount =
        lineDirection === "INFLOW"
          ? await resolveCompanyAccount(tx, firma.id, creditAccountCodes[index] ?? null)
          : null;
      const lineStatus = await resolveStatementLineStatus(tx, firma.id, {
        direction: lineDirection,
        debit_account_code: debitAccountCodes[index] ?? null,
        credit_account_code: creditAccountCodes[index] ?? null,
        partner_id: partnerIds[index] ?? null,
        posting_status: postingStatus
      });

      await tx.bankStatementLine.updateMany({
        where: {
          id: lineId,
          bank_statement_id: statement.id
        },
        data: {
          partner_id: partnerIds[index] ?? null,
          debit_account_id:
            lineDirection === "OUTFLOW"
              ? debitAccount?.id ?? null
              : null,
          credit_account_id:
            lineDirection === "INFLOW"
              ? creditAccount?.id ?? null
              : null,
          match_status: partnerIds[index] ? lineStatuses.matchedPartner : lineStatuses.unmatched,
          posting_status: lineStatus,
          confidence_score: partnerIds[index] ? 85 : 0,
          updated_by: user.id
        }
      });

      const selectedAccount = lineDirection === "INFLOW" ? creditAccount : debitAccount;
      const savedLine = await tx.bankStatementLine.findFirst({
        where: {
          id: lineId,
          bank_statement_id: statement.id
        },
        select: {
          id: true,
          direction: true,
          inflow_amount: true,
          outflow_amount: true,
          partner_id: true,
          counterparty_account_number: true,
          counterparty_account_number_normalized: true,
          description: true,
          payment_code: true,
          reference_number: true,
          allocations: {
            select: {
              kif_entry_id: true,
              kuf_entry_id: true
            }
          }
        }
      });

      if (savedLine) {
        savedLine.allocations.forEach((allocation) => {
          if (allocation.kif_entry_id) {
            affectedKifEntryIds.add(allocation.kif_entry_id);
          }

          if (allocation.kuf_entry_id) {
            affectedKufEntryIds.add(allocation.kuf_entry_id);
          }
        });

        await tx.bankStatementLineAllocation.deleteMany({
          where: {
            bank_statement_line_id: savedLine.id
          }
        });

        const allocationTarget = allocationTargets[index] ?? "";

        if (postingStatus !== lineStatuses.ignored && allocationTarget) {
          const [documentType, entryId] = allocationTarget.split(":");
          const lineAmountCents =
            savedLine.direction === "INFLOW"
              ? decimalToCents(savedLine.inflow_amount)
              : decimalToCents(savedLine.outflow_amount);

          if (documentType === "KIF" && savedLine.direction === "INFLOW" && entryId && savedLine.partner_id) {
            const entry = await tx.kifEntry.findFirst({
              where: {
                id: entryId,
                agencija_id: agencijaId,
                firma_id: firma.id,
                poslovna_godina_id: poslovnaGodina.id,
                is_deleted: false,
                kupac_id: savedLine.partner_id
              },
              select: {
                id: true,
                total_gross: true
              }
            });

            if (entry) {
              const allocated = await tx.bankStatementLineAllocation.aggregate({
                where: {
                  kif_entry_id: entry.id
                },
                _sum: {
                  amount: true
                }
              });
              const remainingCents = Math.max(
                0,
                decimalToCents(entry.total_gross) - decimalToCents(allocated._sum.amount)
              );
              const allocationCents = Math.min(lineAmountCents, remainingCents || lineAmountCents);

              if (allocationCents > 0) {
                await tx.bankStatementLineAllocation.create({
                  data: {
                    agencija_id: agencijaId,
                    firma_id: firma.id,
                    poslovna_godina_id: poslovnaGodina.id,
                    bank_statement_line_id: savedLine.id,
                    document_type: "KIF",
                    kif_entry_id: entry.id,
                    amount: centsToDecimal(allocationCents),
                    created_by: user.id,
                    updated_by: user.id
                  }
                });
                affectedKifEntryIds.add(entry.id);
              }
            }
          }

          if (documentType === "KUF" && savedLine.direction === "OUTFLOW" && entryId && savedLine.partner_id) {
            const entry = await tx.kufEntry.findFirst({
              where: {
                id: entryId,
                agencija_id: agencijaId,
                firma_id: firma.id,
                poslovna_godina_id: poslovnaGodina.id,
                is_deleted: false,
                dobavljac_id: savedLine.partner_id
              },
              select: {
                id: true,
                total_gross: true
              }
            });

            if (entry) {
              const allocated = await tx.bankStatementLineAllocation.aggregate({
                where: {
                  kuf_entry_id: entry.id
                },
                _sum: {
                  amount: true
                }
              });
              const remainingCents = Math.max(
                0,
                decimalToCents(entry.total_gross) - decimalToCents(allocated._sum.amount)
              );
              const allocationCents = Math.min(lineAmountCents, remainingCents || lineAmountCents);

              if (allocationCents > 0) {
                await tx.bankStatementLineAllocation.create({
                  data: {
                    agencija_id: agencijaId,
                    firma_id: firma.id,
                    poslovna_godina_id: poslovnaGodina.id,
                    bank_statement_line_id: savedLine.id,
                    document_type: "KUF",
                    kuf_entry_id: entry.id,
                    amount: centsToDecimal(allocationCents),
                    created_by: user.id,
                    updated_by: user.id
                  }
                });
                affectedKufEntryIds.add(entry.id);
              }
            }
          }
        }
      }

      if (postingStatus !== lineStatuses.ignored && selectedAccount) {
        const normalizedAccount = savedLine?.counterparty_account_number_normalized;
        const partnerId = partnerIds[index] ?? null;

        if (normalizedAccount) {
          if (partnerId) {
            const learnedAccount =
              await tx.partnerBankAccount.findFirst({
                where: {
                  agencija_id: agencijaId,
                  firma_id: {
                    equals: null
                  },
                  normalized_account_number: normalizedAccount
                },
                select: {
                  id: true
                }
              }) ??
              await tx.partnerBankAccount.findFirst({
              where: {
                agencija_id: agencijaId,
                firma_id: firma.id,
                normalized_account_number: normalizedAccount,
                is_active: true
              },
              select: {
                id: true
              }
            });

            if (learnedAccount) {
              await tx.partnerBankAccount.update({
                where: {
                  id: learnedAccount.id
                },
                data: {
                  partner_id: partnerId,
                  account_number: savedLine.counterparty_account_number ?? normalizedAccount,
                  source: "BANK_STATEMENT",
                  is_active: true,
                  updated_by: user.id
                }
              });
            } else {
              await tx.partnerBankAccount.create({
                data: {
                  agencija_id: agencijaId,
                  firma_id: null,
                  partner_id: partnerId,
                  account_number: savedLine.counterparty_account_number ?? normalizedAccount,
                  normalized_account_number: normalizedAccount,
                  source: "BANK_STATEMENT",
                  created_by: user.id,
                  updated_by: user.id
                }
              });
            }
          }

          const descriptionContains = learnedDescriptionCondition(savedLine.description);
          const paymentCode = savedLine.payment_code ?? null;
          const learnSpecificRule = shouldLearnSpecificBankRule(descriptionContains, paymentCode);
          const existingRule = await tx.bankPostingRule.findFirst({
            where: {
              agencija_id: agencijaId,
              firma_id: firma.id,
              rule_type: learnSpecificRule ? "ADVANCED" : "BANK_ACCOUNT",
              direction: lineDirection,
              counterparty_account_number_normalized: normalizedAccount,
              description_contains: learnSpecificRule ? descriptionContains : null,
              reference_contains: null,
              payment_code: learnSpecificRule ? paymentCode : null
            },
            select: {
              id: true
            }
          });

          if (existingRule) {
            await tx.bankPostingRule.update({
              where: {
                id: existingRule.id
              },
              data: {
                partner_id: partnerId,
                counterparty_account_number: savedLine.counterparty_account_number ?? normalizedAccount,
                account_id: selectedAccount.id,
                account_code: selectedAccount.sifra,
                times_used: {
                  increment: 1
                },
                last_used_at: new Date(),
                active: true,
                updated_by: user.id
              }
            });
          } else {
            await tx.bankPostingRule.create({
              data: {
                agencija_id: agencijaId,
                firma_id: firma.id,
                rule_type: learnSpecificRule ? "ADVANCED" : "BANK_ACCOUNT",
                direction: lineDirection,
                counterparty_account_number: savedLine.counterparty_account_number ?? normalizedAccount,
                counterparty_account_number_normalized: normalizedAccount,
                description_contains: learnSpecificRule ? descriptionContains : null,
                reference_contains: null,
                payment_code: learnSpecificRule ? paymentCode : null,
                account_id: selectedAccount.id,
                account_code: selectedAccount.sifra,
                partner_id: partnerId,
                priority: 10,
                times_used: 1,
                last_used_at: new Date(),
                created_by: user.id,
                updated_by: user.id
              }
            });
          }
        } else if (savedLine) {
          const descriptionContains = learnedDescriptionCondition(savedLine.description);
          const paymentCode = savedLine.payment_code ?? null;

          if (descriptionContains || paymentCode) {
            const existingRule = await tx.bankPostingRule.findFirst({
              where: {
                agencija_id: agencijaId,
                firma_id: firma.id,
                rule_type: "ADVANCED",
                direction: lineDirection,
                counterparty_account_number_normalized: null,
                description_contains: descriptionContains,
                reference_contains: null,
                payment_code: paymentCode
              },
              select: {
                id: true
              }
            });

            if (existingRule) {
              await tx.bankPostingRule.update({
                where: {
                  id: existingRule.id
                },
                data: {
                  partner_id: partnerId,
                  account_id: selectedAccount.id,
                  account_code: selectedAccount.sifra,
                  times_used: {
                    increment: 1
                  },
                  last_used_at: new Date(),
                  active: true,
                  auto_apply: true,
                  requires_review: false,
                  updated_by: user.id
                }
              });
            } else {
              await tx.bankPostingRule.create({
                data: {
                  agencija_id: agencijaId,
                  firma_id: firma.id,
                  rule_type: "ADVANCED",
                  direction: lineDirection,
                  counterparty_account_number: null,
                  counterparty_account_number_normalized: null,
                  description_contains: descriptionContains,
                  reference_contains: null,
                  payment_code: paymentCode,
                  account_id: selectedAccount.id,
                  account_code: selectedAccount.sifra,
                  partner_id: partnerId,
                  priority: 10,
                  times_used: 1,
                  last_used_at: new Date(),
                  active: true,
                  auto_apply: true,
                  requires_review: false,
                  created_by: user.id,
                  updated_by: user.id
                }
              });
            }
          }
        }
      }
    }

    for (const entryId of affectedKifEntryIds) {
      await refreshKifPaymentStatus(tx, entryId, user.id);
    }

    for (const entryId of affectedKufEntryIds) {
      await refreshKufPaymentStatus(tx, entryId, user.id);
    }

    const lines = await tx.bankStatementLine.findMany({
      where: {
        bank_statement_id: statement.id
      },
      select: {
        posting_status: true
      }
    });
    const isReady = lines.every((line) =>
      [lineStatuses.ready, lineStatuses.ignored].includes(line.posting_status as typeof lineStatuses.ready)
    );

    await tx.bankStatement.update({
      where: {
        id: statement.id
      },
      data: {
        status: isReady ? bankStatementStatuses.ready : bankStatementStatuses.needsReview,
        journal_id: null,
        posted_at: null,
        posted_by: null,
        updated_by: user.id
      }
    });
  });

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: firma.id,
    modul: "agencija.izvodi",
    akcija: "update_lines",
    tipEntiteta: "BankStatement",
    entitetId: statement.id
  });

  revalidatePath("/agencija/izvodi");
  redirectStatements("stavke_sacuvane", statement.id);
}

export async function deleteBankStatement(formData: FormData) {
  const { user, firma, poslovnaGodina } = await getActiveContext();
  const statementId = value(formData, "statement_id");

  if (!user.agencija_id || !firma || !poslovnaGodina || !statementId) {
    redirectStatements("izvod_greska");
  }

  if (poslovnaGodina.zakljucena) {
    redirectStatements("godina_zakljucena", statementId);
  }

  const statement = await prisma.bankStatement.findFirst({
    where: {
      id: statementId,
      agencija_id: user.agencija_id,
      firma_id: firma.id,
      poslovna_godina_id: poslovnaGodina.id,
      is_deleted: false
    },
    select: {
      id: true,
      statement_number: true,
      statement_date: true,
      status: true,
      total_inflow: true,
      total_outflow: true,
      company_bank_account_id: true,
      journal_id: true,
      journal: {
        select: {
          id: true,
          sifra: true,
          is_deleted: true
        }
      },
      _count: {
        select: {
          lines: true
        }
      }
    }
  });

  const hasValidJournal = Boolean(statement?.journal && !statement.journal.is_deleted);

  if (!statement || statement.status === bankStatementStatuses.posted || hasValidJournal) {
    redirectStatements("izvod_greska", statementId);
  }

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: firma.id,
    modul: "agencija.izvodi",
    akcija: "delete",
    tipEntiteta: "BankStatement",
    entitetId: statement.id,
    staraVrijednost: {
      id: statement.id,
      statement_number: statement.statement_number,
      statement_date: statement.statement_date,
      status: statement.status,
      company_bank_account_id: statement.company_bank_account_id,
      total_inflow: statement.total_inflow,
      total_outflow: statement.total_outflow,
      line_count: statement._count.lines
    }
  });

  await prisma.bankStatement.delete({
    where: {
      id: statement.id
    }
  });

  revalidatePath("/agencija/izvodi");
  redirectStatements("izvod_obrisan");
}

export async function saveBankStatementAccountSettings(formData: FormData) {
  const { user, firma, poslovnaGodina } = await getActiveContext();
  const companyBankAccountIds = formData.getAll("company_bank_account_id").map((item) => String(item));
  const bankAccountKontoCodes = formData.getAll("bank_account_konto_code").map((item) => String(item).trim() || null);
  const journalTypeIds = formData.getAll("journal_type_id").map((item) => String(item).trim() || null);

  if (!user.agencija_id || !firma || !poslovnaGodina) {
    redirect("/agencija/izvodi/podesavanja?poruka=podesavanja_greska");
  }
  const agencijaId = user.agencija_id;

  if (poslovnaGodina.zakljucena) {
    redirect("/agencija/izvodi/podesavanja?poruka=godina_zakljucena");
  }

  await prisma.$transaction(async (tx) => {
    for (let index = 0; index < companyBankAccountIds.length; index += 1) {
      const companyBankAccountId = companyBankAccountIds[index];

      if (!companyBankAccountId) {
        continue;
      }

      const companyBankAccount = await tx.firmaBankovniRacun.findFirst({
        where: {
          id: companyBankAccountId,
          agencija_id: agencijaId,
          firma_id: firma.id,
          is_deleted: false,
          aktivan: true
        },
        select: {
          id: true
        }
      });

      if (!companyBankAccount) {
        continue;
      }

      const bankAccountKonto = await resolveCompanyAccount(tx, firma.id, bankAccountKontoCodes[index] ?? null);
      const journalTypeId = journalTypeIds[index] ?? null;
      const journalType = journalTypeId
        ? await tx.vrstaNaloga.findFirst({
            where: {
              id: journalTypeId,
              aktivan: true,
              OR: [
                {
                  agencija_id: agencijaId
                },
                {
                  agencija_id: null
                },
                {
                  firma_id: firma.id
                }
              ]
            },
            select: {
              id: true
            }
          })
        : null;

      await tx.bankStatementAccountSetting.upsert({
        where: {
          firma_id_company_bank_account_id: {
            firma_id: firma.id,
            company_bank_account_id: companyBankAccount.id
          }
        },
        create: {
          agencija_id: agencijaId,
          firma_id: firma.id,
          company_bank_account_id: companyBankAccount.id,
          bank_account_konto_id: bankAccountKonto?.id ?? null,
          journal_type_id: journalType?.id ?? null,
          created_by: user.id,
          updated_by: user.id
        },
        update: {
          bank_account_konto_id: bankAccountKonto?.id ?? null,
          journal_type_id: journalType?.id ?? null,
          updated_by: user.id
        }
      });
    }
  });

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: firma.id,
    modul: "agencija.izvodi",
    akcija: "save_bank_settings",
    tipEntiteta: "BankStatementAccountSetting"
  });

  revalidatePath("/agencija/izvodi");
  revalidatePath("/agencija/izvodi/podesavanja");
  redirect("/agencija/izvodi/podesavanja?poruka=podesavanja_sacuvana");
}

export async function createBankPostingRule(formData: FormData) {
  const { user, firma, poslovnaGodina } = await getActiveContext();
  const ruleId = nullableValue(formData, "rule_id");
  const scope = value(formData, "scope") === "AGENCY" ? "AGENCY" : "FIRM";
  const accountNumber = nullableValue(formData, "counterparty_account_number");
  const direction = value(formData, "direction");
  const accountCode = nullableValue(formData, "account_code");
  const descriptionContains = nullableValue(formData, "description_contains");
  const referenceContains = nullableValue(formData, "reference_contains");
  const paymentCode = normalizePaymentCode(nullableValue(formData, "payment_code")) || null;
  const priority = Number(value(formData, "priority") || "10");
  const normalizedAccount = normalizeAccountNumber(accountNumber);

  if (
    !user.agencija_id ||
    !firma ||
    !poslovnaGodina ||
    !["INFLOW", "OUTFLOW"].includes(direction) ||
    !accountCode ||
    (!normalizedAccount && !descriptionContains && !referenceContains && !paymentCode) ||
    !Number.isSafeInteger(priority)
  ) {
    redirect("/agencija/izvodi/pravila?poruka=pravilo_obavezno");
  }
  const agencijaId = user.agencija_id;
  const targetFirmaId = scope === "AGENCY" ? null : firma.id;

  if (poslovnaGodina.zakljucena) {
    redirect("/agencija/izvodi/pravila?poruka=godina_zakljucena");
  }

  const editedRule = ruleId
    ? await prisma.bankPostingRule.findFirst({
        where: {
          id: ruleId,
          agencija_id: agencijaId,
          OR: [
            {
              firma_id: firma.id
            },
            {
              firma_id: {
                equals: null
              }
            }
          ]
        },
        select: {
          id: true,
          firma_id: true
        }
      })
    : null;

  if (ruleId && !editedRule) {
    redirect("/agencija/izvodi/pravila?poruka=pravilo_obavezno");
  }

  const account = await prisma.$transaction(async (tx) =>
    resolveCompanyAccount(tx, firma.id, accountCode)
  );

  if (!account) {
    redirect("/agencija/izvodi/pravila?poruka=pravilo_obavezno");
  }

  const ruleType =
    descriptionContains || referenceContains || paymentCode || !normalizedAccount
      ? "ADVANCED"
      : "BANK_ACCOUNT";
  const updateExistingRuleId =
    editedRule && editedRule.firma_id === targetFirmaId
      ? editedRule.id
      : null;
  const duplicateRule = updateExistingRuleId
    ? null
    : await prisma.bankPostingRule.findFirst({
        where: {
          agencija_id: agencijaId,
          firma_id: targetFirmaId
            ? targetFirmaId
            : {
                equals: null
              },
          rule_type: ruleType,
          direction,
          counterparty_account_number_normalized: normalizedAccount || null,
          description_contains: descriptionContains,
          reference_contains: referenceContains,
          payment_code: paymentCode
        },
        select: {
          id: true
        }
      });
  const ruleToUpdateId = updateExistingRuleId ?? duplicateRule?.id ?? null;

  if (ruleToUpdateId) {
    await prisma.bankPostingRule.update({
      where: {
        id: ruleToUpdateId
      },
      data: {
        rule_type: ruleType,
        direction,
        counterparty_account_number: accountNumber,
        counterparty_account_number_normalized: normalizedAccount || null,
        description_contains: descriptionContains,
        reference_contains: referenceContains,
        payment_code: paymentCode,
        account_id: account.id,
        account_code: account.sifra,
        priority,
        active: true,
        auto_apply: true,
        requires_review: false,
        last_used_at: new Date(),
        updated_by: user.id
      }
    });
  } else {
    await prisma.bankPostingRule.create({
      data: {
        agencija_id: agencijaId,
        firma_id: targetFirmaId,
        rule_type: ruleType,
        direction,
        counterparty_account_number: accountNumber,
        counterparty_account_number_normalized: normalizedAccount || null,
        description_contains: descriptionContains,
        reference_contains: referenceContains,
        payment_code: paymentCode,
        account_id: account.id,
        account_code: account.sifra,
        priority,
        times_used: 1,
        last_used_at: new Date(),
        active: true,
        created_by: user.id,
        updated_by: user.id
      }
    });
  }

  await auditLog({
    korisnikId: user.id,
    agencijaId,
    firmaId: firma.id,
    modul: "agencija.izvodi",
    akcija: "create_posting_rule",
    tipEntiteta: "BankPostingRule"
  });

  revalidatePath("/agencija/izvodi/pravila");
  redirect("/agencija/izvodi/pravila?poruka=pravilo_sacuvano");
}

export async function deleteBankPostingRule(formData: FormData) {
  const { user, firma, poslovnaGodina } = await getActiveContext();
  const ruleId = value(formData, "rule_id");

  if (!user.agencija_id || !firma || !poslovnaGodina || !ruleId) {
    redirect("/agencija/izvodi/pravila?poruka=pravilo_obavezno");
  }

  if (poslovnaGodina.zakljucena) {
    redirect("/agencija/izvodi/pravila?poruka=godina_zakljucena");
  }

  const rule = await prisma.bankPostingRule.findFirst({
    where: {
      id: ruleId,
      agencija_id: user.agencija_id,
      active: true,
      OR: [
        {
          firma_id: firma.id
        },
        {
          firma_id: {
            equals: null
          }
        }
      ]
    },
    select: {
      id: true,
      firma_id: true,
      rule_type: true,
      direction: true,
      counterparty_account_number: true,
      counterparty_account_number_normalized: true,
      description_contains: true,
      reference_contains: true,
      payment_code: true,
      account_code: true,
      partner_id: true,
      priority: true
    }
  });

  if (!rule) {
    redirect("/agencija/izvodi/pravila?poruka=pravilo_obavezno");
  }

  await prisma.bankPostingRule.update({
    where: {
      id: rule.id
    },
    data: {
      active: false,
      updated_by: user.id
    }
  });

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: firma.id,
    modul: "agencija.izvodi",
    akcija: "delete_posting_rule",
    tipEntiteta: "BankPostingRule",
    entitetId: rule.id,
    staraVrijednost: rule
  });

  revalidatePath("/agencija/izvodi/pravila");
  redirect("/agencija/izvodi/pravila?poruka=pravilo_obrisano");
}

export async function postSelectedBankStatements(formData: FormData) {
  const { user, firma, poslovnaGodina } = await getActiveContext();
  const statementIds = formData.getAll("statement_id").map((item) => String(item));

  if (!user.agencija_id || !firma || !poslovnaGodina || statementIds.length === 0) {
    redirectStatements("izvod_nije_izabran");
  }

  if (poslovnaGodina.zakljucena) {
    redirectStatements("godina_zakljucena");
  }

  const postedIds: string[] = [];
  const agencijaId = user.agencija_id;
  const firmaId = firma.id;
  const poslovnaGodinaId = poslovnaGodina.id;
  const poslovnaGodinaValue = poslovnaGodina.godina;

  await prisma.$transaction(async (tx) => {
    const defaultJournalType = await tx.vrstaNaloga.findFirst({
      where: {
        aktivan: true,
        sifra: "BANK_STATEMENT"
      },
      select: {
        id: true,
        prefiks: true
      }
    });

    if (!defaultJournalType) {
      throw new Error("vrsta_izvoda_ne_postoji");
    }

    for (const statementId of statementIds) {
      const statement = await tx.bankStatement.findFirst({
        where: {
          id: statementId,
          agencija_id: agencijaId,
          firma_id: firmaId,
          poslovna_godina_id: poslovnaGodinaId,
          status: bankStatementStatuses.ready,
          is_deleted: false
        },
        include: {
          bank_account_konto: true,
          lines: {
            orderBy: {
              line_number: "asc"
            }
          }
        }
      }) as Prisma.BankStatementGetPayload<{
        include: {
          bank_account_konto: true;
          lines: true;
        };
      }> | null;

      if (!statement || statement.journal_id || !statement.bank_account_konto_id) {
        continue;
      }

      const bankSetting = await tx.bankStatementAccountSetting.findUnique({
        where: {
          firma_id_company_bank_account_id: {
            firma_id: firmaId,
            company_bank_account_id: statement.company_bank_account_id
          }
        },
        include: {
          journal_type: {
            select: {
              id: true,
              prefiks: true
            }
          }
        }
      });
      const journalType = bankSetting?.journal_type ?? defaultJournalType;

      const openingBalance = Math.round(Number(statement.opening_balance) * 100);
      const totalInflow = Math.round(Number(statement.total_inflow) * 100);
      const totalOutflow = Math.round(Number(statement.total_outflow) * 100);
      const closingBalance = Math.round(Number(statement.closing_balance) * 100);

      if (openingBalance + totalInflow - totalOutflow !== closingBalance) {
        continue;
      }

      const activeLines = statement.lines.filter(
        (line) => line.posting_status !== lineStatuses.ignored
      );

      if (
        activeLines.length === 0 ||
        activeLines.some(
          (line) =>
            line.posting_status !== lineStatuses.ready ||
            (line.direction === "INFLOW" ? !line.credit_account_id : !line.debit_account_id)
        )
      ) {
        continue;
      }

      const broj = parseStatementJournalNumber(statement.statement_number);

      if (!broj) {
        throw new Error("izvod_broj_naloga_greska");
      }

      const existingJournal = await tx.nalog.findFirst({
        where: {
          agencija_id: agencijaId,
          firma_id: firmaId,
          poslovna_godina_id: poslovnaGodinaId,
          vrsta_naloga_id: journalType.id,
          broj
        },
        select: {
          id: true
        }
      });

      if (existingJournal) {
        throw new Error("izvod_broj_naloga_zauzet");
      }

      const sifra = formatJournalCode(journalType.prefiks, poslovnaGodinaValue, broj);

      const nalog = await tx.nalog.create({
        data: {
          agencija_id: agencijaId,
          firma_id: firmaId,
          poslovna_godina_id: poslovnaGodinaId,
          vrsta_naloga_id: journalType.id,
          broj,
          sifra,
          datum: statement.statement_date,
          datum_knjizenja: new Date(),
          opis: `Izvod ${statement.statement_number}`,
          status: journalStatuses.posted,
          source_type: "BANK_STATEMENT",
          source_module: "IZVODI",
          izvorni_dokument_id: statement.id,
          kreirao_korisnik_id: user.id,
          created_by: user.id,
          updated_by: user.id,
          proknjizen_at: new Date(),
          proknjizen_by: user.id
        },
        select: {
          id: true
        }
      });

      let lineNumber = 1;

      if (totalInflow > 0) {
        await tx.stavkaNaloga.create({
          data: {
            nalog_id: nalog.id,
            konto_id: statement.bank_account_konto_id,
            duguje: centsToDecimal(totalInflow),
            potrazuje: "0.00",
            opis: `Ukupan priliv po izvodu ${statement.statement_number}`,
            broj_dokumenta: statement.statement_number,
            datum_dokumenta: statement.statement_date,
            datum_valute: statement.statement_date,
            redni_broj: lineNumber,
            created_by: user.id,
            updated_by: user.id
          }
        });
        lineNumber += 1;
      }

      if (totalOutflow > 0) {
        await tx.stavkaNaloga.create({
          data: {
            nalog_id: nalog.id,
            konto_id: statement.bank_account_konto_id,
            duguje: "0.00",
            potrazuje: centsToDecimal(totalOutflow),
            opis: `Ukupan odliv po izvodu ${statement.statement_number}`,
            broj_dokumenta: statement.statement_number,
            datum_dokumenta: statement.statement_date,
            datum_valute: statement.statement_date,
            redni_broj: lineNumber,
            created_by: user.id,
            updated_by: user.id
          }
        });
        lineNumber += 1;
      }

      for (const line of activeLines) {
        const amount =
          Math.round(Number(line.inflow_amount) * 100) ||
          Math.round(Number(line.outflow_amount) * 100);
        const accountId =
          line.direction === "INFLOW" ? line.credit_account_id : line.debit_account_id;

        if (!accountId) {
          throw new Error("konto_nevalidno");
        }

        const account = await tx.firmaKonto.findFirst({
          where: {
            id: accountId
          },
          select: {
            id: true,
            analitika_obavezna: true
          }
        });

        if (account?.analitika_obavezna && !line.partner_id) {
          throw new Error("partner_obavezan");
        }

        await tx.stavkaNaloga.create({
          data: {
            nalog_id: nalog.id,
            konto_id: accountId,
            komitent_id: account?.analitika_obavezna ? line.partner_id : null,
            duguje: line.direction === "OUTFLOW" ? centsToDecimal(amount) : "0.00",
            potrazuje: line.direction === "INFLOW" ? centsToDecimal(amount) : "0.00",
            opis: line.description,
            broj_dokumenta: statement.statement_number,
            datum_dokumenta: line.posting_date,
            datum_valute: line.value_date,
            redni_broj: lineNumber,
            created_by: user.id,
            updated_by: user.id
          }
        });
        lineNumber += 1;
      }

      await tx.bankStatement.update({
        where: {
          id: statement.id
        },
        data: {
          journal_id: nalog.id,
          status: bankStatementStatuses.posted,
          posted_at: new Date(),
          posted_by: user.id,
          updated_by: user.id
        }
      });
      postedIds.push(statement.id);
    }
  }).catch((error) => {
    if (error instanceof Error && error.message === "partner_obavezan") {
      redirectStatements("partner_obavezan");
    }

    if (error instanceof Error && error.message === "izvod_broj_naloga_greska") {
      redirectStatements("izvod_broj_naloga_greska");
    }

    if (error instanceof Error && error.message === "izvod_broj_naloga_zauzet") {
      redirectStatements("izvod_broj_naloga_zauzet");
    }

    redirectStatements("knjizenje_greska");
  });

  if (postedIds.length === 0) {
    redirectStatements("nema_spremnih_izvoda");
  }

  await auditLog({
    korisnikId: user.id,
    agencijaId: user.agencija_id,
    firmaId: firma.id,
    modul: "agencija.izvodi",
    akcija: "post",
    tipEntiteta: "BankStatement",
    novaVrijednost: {
      ids: postedIds
    }
  });

  revalidatePath("/agencija/izvodi");
  revalidatePath("/agencija/nalozi");
  redirectStatements("izvodi_proknjizeni", postedIds[0]);
}

export async function postReadyBankStatements() {
  const { user, firma, poslovnaGodina } = await getActiveContext();

  if (!user.agencija_id || !firma || !poslovnaGodina) {
    redirectStatements("nema_spremnih_izvoda");
  }

  const readyStatements = await prisma.bankStatement.findMany({
    where: {
      agencija_id: user.agencija_id,
      firma_id: firma.id,
      poslovna_godina_id: poslovnaGodina.id,
      status: bankStatementStatuses.ready,
      journal_id: null,
      is_deleted: false
    },
    orderBy: [
      {
        statement_date: "asc"
      },
      {
        statement_number: "asc"
      }
    ],
    select: {
      id: true
    }
  });

  if (readyStatements.length === 0) {
    redirectStatements("nema_spremnih_izvoda");
  }

  const formData = new FormData();

  for (const statement of readyStatements) {
    formData.append("statement_id", statement.id);
  }

  return postSelectedBankStatements(formData);
}
