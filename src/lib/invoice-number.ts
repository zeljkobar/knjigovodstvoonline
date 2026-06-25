export function normalizeFiscalInvoiceNumber(value: string | null | undefined) {
  const raw = String(value ?? "").trim();

  if (!raw) {
    return "";
  }

  const parts = raw
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 4) {
    const possibleNumber = parts[parts.length - 3];
    const possibleYear = parts[parts.length - 2];

    if (/^\d+$/.test(possibleNumber) && /^\d{4}$/.test(possibleYear)) {
      return `${possibleNumber}/${possibleYear}`;
    }
  }

  const match = raw.match(/(?:^|\/)(\d+\/\d{4})(?:\/|$)/);

  return match?.[1] ?? raw;
}
