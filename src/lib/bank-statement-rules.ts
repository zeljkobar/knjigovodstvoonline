export type BankStatementRuleMatchInput = {
  firma_id: string | null;
  direction: string;
  auto_apply: boolean;
  counterparty_account_number_normalized: string | null;
  description_contains: string | null;
  reference_contains: string | null;
  payment_code: string | null;
  priority: number;
  times_used: number;
};

export type BankStatementLineMatchInput = {
  description: string;
  normalizedAccountNumber: string | null;
  referenceNumber?: string | null;
  paymentCode?: string | null;
};

export type BankStatementLineReadinessInput = {
  lineNumber: number;
  ignored: boolean;
  postingStatus: string;
  accountCode: string | null;
  accountRequiresPartner: boolean;
  partnerId: string | null;
};

function containsText(source: string | null | undefined, needle: string | null | undefined) {
  const cleanNeedle = String(needle ?? "").trim().toLowerCase();

  if (!cleanNeedle) {
    return true;
  }

  return String(source ?? "").toLowerCase().includes(cleanNeedle);
}

export function normalizeBankPaymentCode(input: string | null | undefined) {
  const clean = String(input ?? "").toUpperCase().replace(/\s+/g, "").trim();

  if (!clean) {
    return "";
  }

  return clean.match(/[A-Z]\d{2}/)?.[0] ?? clean.match(/\d{3}/)?.[0] ?? clean.match(/\d{2}/)?.[0] ?? clean;
}

function comparablePaymentCode(input: string | null | undefined) {
  return normalizeBankPaymentCode(input).replace(/^[A-Z](\d{2})$/, "$1");
}

export function bankPaymentCodesMatch(
  ruleCode: string | null | undefined,
  lineCode: string | null | undefined
) {
  const normalizedRuleCode = normalizeBankPaymentCode(ruleCode);

  if (!normalizedRuleCode) {
    return true;
  }

  const normalizedLineCode = normalizeBankPaymentCode(lineCode);

  return (
    normalizedLineCode === normalizedRuleCode ||
    comparablePaymentCode(normalizedLineCode) === comparablePaymentCode(normalizedRuleCode)
  );
}

export function bankStatementRuleMatchesLine(
  rule: BankStatementRuleMatchInput,
  direction: string,
  line: BankStatementLineMatchInput
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

  return (
    containsText(line.description, rule.description_contains) &&
    containsText(line.referenceNumber, rule.reference_contains) &&
    bankPaymentCodesMatch(rule.payment_code, line.paymentCode)
  );
}

function ruleSpecificity(rule: BankStatementRuleMatchInput) {
  return (
    (rule.counterparty_account_number_normalized ? 20 : 0) +
    (rule.description_contains ? 30 : 0) +
    (rule.payment_code ? 25 : 0) +
    (rule.reference_contains ? 20 : 0)
  );
}

export function bestBankStatementRuleForLine<T extends BankStatementRuleMatchInput>(
  rules: T[],
  direction: string,
  line: BankStatementLineMatchInput,
  firmaId: string
) {
  return rules
    .filter((rule) => bankStatementRuleMatchesLine(rule, direction, line))
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

export function bankStatementLineBlockers(line: BankStatementLineReadinessInput) {
  if (line.ignored) {
    return [];
  }

  const blockers: string[] = [];

  if (!line.accountCode) {
    blockers.push(`Stavka ${line.lineNumber}: nije izabrano konto stavke.`);
  } else if (line.accountRequiresPartner && !line.partnerId) {
    blockers.push(
      `Stavka ${line.lineNumber}: partner je obavezan za analitički konto ${line.accountCode}.`
    );
  }

  if (blockers.length === 0 && line.postingStatus !== "READY") {
    blockers.push(`Stavka ${line.lineNumber}: sačuvajte predlog naloga da bi stavka bila spremna.`);
  }

  return blockers;
}
