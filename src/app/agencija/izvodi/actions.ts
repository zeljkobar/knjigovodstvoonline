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
    : data.replace(/\s+/g, "").replace(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/, "$3-$2-$1");
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseMoneyToCents(input: string) {
  const raw = input.trim();

  if (!raw || raw === "-") {
    return 0;
  }

  const normalized = raw
    .replace(/\s/g, "")
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

function ruleKey(direction: string, normalizedAccountNumber: string) {
  return `${direction}:${normalizedAccountNumber}`;
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
  closingBalance?: number | null;
  lines: ParsedStatementLine[];
  notes?: string | null;
};

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

function parseStatement(text: string) {
  return parseNlbXml(text) ?? parseStatementText(text);
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
};

async function readUploadedFile(file: File): Promise<UploadedStatement> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
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
          fileType: null
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
          firma_id: null
        }
      ]
    },
    select: {
      normalized_account_number: true,
      partner_id: true
    }
  });
  const result = new Map<string, string>();

  for (const account of learnedAccounts) {
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
        id: true
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

  for (const uploaded of uploadedStatements) {
    const parsedStatement = parseStatement(uploaded.text);
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

    if (
      !uploaded.text.trim() ||
      !statementNumber ||
      !statementDate ||
      openingBalance === null ||
      closingBalance === null ||
      parsedStatement.lines.length === 0
    ) {
      invalidCount += 1;
      continue;
    }

    const parsedLines = parsedStatement.lines;
    const normalizedLineAccounts = parsedLines
      .map((line) => line.normalizedAccountNumber)
      .filter((account): account is string => Boolean(account));
    const partnerByAccount = await findPartnersByAccounts(
      user.agencija_id,
      firma.id,
      normalizedLineAccounts
    );
    const rules = await prisma.bankPostingRule.findMany({
      where: {
        agencija_id: user.agencija_id,
        firma_id: firma.id,
        rule_type: "BANK_ACCOUNT",
        active: true,
        counterparty_account_number_normalized: {
          in: normalizedLineAccounts
        }
      },
      include: {
        account: {
          select: {
            id: true,
            analitika_obavezna: true
          }
        }
      }
    });
    const ruleByAccount = new Map(
      rules.map((rule) => [
        ruleKey(rule.direction, rule.counterparty_account_number_normalized),
        rule
      ])
    );
    const totalInflow = parsedLines.reduce((sum, line) => sum + line.inflow, 0);
    const totalOutflow = parsedLines.reduce((sum, line) => sum + line.outflow, 0);
    const balanceOk = openingBalance + totalInflow - totalOutflow === closingBalance;
    const statementLines = parsedLines.map((line, index) => {
      const direction = line.inflow > 0 ? "INFLOW" : "OUTFLOW";
      const rule = line.normalizedAccountNumber
        ? ruleByAccount.get(ruleKey(direction, line.normalizedAccountNumber))
        : null;
      const partnerId = line.normalizedAccountNumber
        ? partnerByAccount.get(line.normalizedAccountNumber) ?? rule?.partner_id ?? null
        : null;
      const ruleAccountId = rule?.account_id ?? null;
      const ruleReady = Boolean(rule && (!rule.account.analitika_obavezna || partnerId));

      return {
        line_number: index + 1,
        posting_date: line.postingDate,
        value_date: line.valueDate ?? line.postingDate,
        reference_number: line.referenceNumber,
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
        confidence_score: ruleReady ? 95 : partnerId ? 85 : 0,
        raw_text: line.rawText,
        created_by: user.id,
        updated_by: user.id
      };
    });
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
        statement_date: statementDate,
        opening_balance: centsToDecimal(openingBalance),
        total_inflow: centsToDecimal(totalInflow),
        total_outflow: centsToDecimal(totalOutflow),
        closing_balance: centsToDecimal(closingBalance),
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
    redirectStatements(duplicateCount > 0 ? "izvod_duplikat" : "izvod_nema_stavki");
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
  const ignoredIds = new Set(formData.getAll("ignored_line_id").map((item) => String(item)));

  await prisma.$transaction(async (tx) => {
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

      if (postingStatus !== lineStatuses.ignored && selectedAccount) {
        const savedLine = await tx.bankStatementLine.findFirst({
          where: {
            id: lineId,
            bank_statement_id: statement.id
          },
          select: {
            counterparty_account_number: true,
            counterparty_account_number_normalized: true
          }
        });
        const normalizedAccount = savedLine?.counterparty_account_number_normalized;

        if (normalizedAccount) {
          const partnerId = partnerIds[index] ?? null;

          if (partnerId) {
            await tx.partnerBankAccount.upsert({
              where: {
                agencija_id_firma_id_normalized_account_number: {
                  agencija_id: agencijaId,
                  firma_id: firma.id,
                  normalized_account_number: normalizedAccount
                }
              },
              create: {
                agencija_id: agencijaId,
                firma_id: firma.id,
                partner_id: partnerId,
                account_number: savedLine.counterparty_account_number ?? normalizedAccount,
                normalized_account_number: normalizedAccount,
                source: "BANK_STATEMENT",
                created_by: user.id,
                updated_by: user.id
              },
              update: {
                partner_id: partnerId,
                account_number: savedLine.counterparty_account_number ?? normalizedAccount,
                source: "BANK_STATEMENT",
                is_active: true,
                updated_by: user.id
              }
            });
          }

          await tx.bankPostingRule.upsert({
            where: {
              firma_id_rule_type_direction_counterparty_account_number_normalized: {
                firma_id: firma.id,
                rule_type: "BANK_ACCOUNT",
                direction: lineDirection,
                counterparty_account_number_normalized: normalizedAccount
              }
            },
            create: {
              agencija_id: agencijaId,
              firma_id: firma.id,
              rule_type: "BANK_ACCOUNT",
              direction: lineDirection,
              counterparty_account_number: savedLine.counterparty_account_number ?? normalizedAccount,
              counterparty_account_number_normalized: normalizedAccount,
              account_id: selectedAccount.id,
              partner_id: partnerId,
              times_used: 1,
              last_used_at: new Date(),
              created_by: user.id,
              updated_by: user.id
            },
            update: {
              counterparty_account_number: savedLine.counterparty_account_number ?? normalizedAccount,
              account_id: selectedAccount.id,
              partner_id: partnerId,
              times_used: {
                increment: 1
              },
              last_used_at: new Date(),
              active: true,
              updated_by: user.id
            }
          });
        }
      }
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
  const accountNumber = value(formData, "counterparty_account_number");
  const direction = value(formData, "direction");
  const accountCode = nullableValue(formData, "account_code");
  const normalizedAccount = normalizeAccountNumber(accountNumber);

  if (
    !user.agencija_id ||
    !firma ||
    !poslovnaGodina ||
    !accountNumber ||
    !normalizedAccount ||
    !["INFLOW", "OUTFLOW"].includes(direction) ||
    !accountCode
  ) {
    redirect("/agencija/izvodi/pravila?poruka=pravilo_obavezno");
  }
  const agencijaId = user.agencija_id;

  if (poslovnaGodina.zakljucena) {
    redirect("/agencija/izvodi/pravila?poruka=godina_zakljucena");
  }

  const account = await prisma.$transaction(async (tx) =>
    resolveCompanyAccount(tx, firma.id, accountCode)
  );

  if (!account) {
    redirect("/agencija/izvodi/pravila?poruka=pravilo_obavezno");
  }

  await prisma.bankPostingRule.upsert({
    where: {
      firma_id_rule_type_direction_counterparty_account_number_normalized: {
        firma_id: firma.id,
        rule_type: "BANK_ACCOUNT",
        direction,
        counterparty_account_number_normalized: normalizedAccount
      }
    },
    create: {
      agencija_id: agencijaId,
      firma_id: firma.id,
      rule_type: "BANK_ACCOUNT",
      direction,
      counterparty_account_number: accountNumber,
      counterparty_account_number_normalized: normalizedAccount,
      account_id: account.id,
      times_used: 1,
      last_used_at: new Date(),
      active: true,
      created_by: user.id,
      updated_by: user.id
    },
    update: {
      counterparty_account_number: accountNumber,
      account_id: account.id,
      active: true,
      last_used_at: new Date(),
      updated_by: user.id
    }
  });

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
