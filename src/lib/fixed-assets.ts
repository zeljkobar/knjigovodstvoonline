export const fixedAssetTypes = [
  "MATERIAL",
  "INTANGIBLE",
  "LAND",
  "RIGHT_OF_USE",
  "OTHER"
] as const;

export const fixedAssetTypeLabels: Record<(typeof fixedAssetTypes)[number], string> = {
  MATERIAL: "Materijalno sredstvo",
  INTANGIBLE: "Nematerijalna imovina",
  LAND: "Zemljište",
  RIGHT_OF_USE: "Pravo korišćenja",
  OTHER: "Ostalo"
};

export const fixedAssetStatusLabels: Record<string, string> = {
  DRAFT: "Nacrt",
  IN_PREPARATION: "U pripremi",
  ACTIVE: "Aktivno",
  DISPOSED: "Isknjiženo"
};

export const fixedAssetChangeLabels: Record<string, string> = {
  OPENING: "Početno stanje",
  ACQUISITION: "Nabavka",
  ACTIVATION: "Aktiviranje",
  CAPITAL_ADDITION: "Ulaganje",
  ESTIMATE_CHANGE: "Promjena procjene",
  TRANSFER: "Prenos",
  SALE: "Prodaja",
  WRITE_OFF: "Rashodovanje",
  REVERSAL: "Poništavanje"
};

export function parseFixedAssetMoney(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim().replace(/\s/g, "");
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const [whole, fraction = ""] = normalized.split(".");
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  // Decimal(14, 2): twelve whole digits and two decimal places.
  return cents <= BigInt("99999999999999") ? Number(cents) : null;
}

export function fixedAssetContextMatches(
  form: FormData,
  context: { firmaId: string | null; poslovnaGodinaId: string | null }
) {
  return Boolean(context.firmaId) &&
    form.get("ocekivana_firma_id") === context.firmaId &&
    form.get("ocekivana_godina_id") === (context.poslovnaGodinaId ?? "");
}

export function fixedAssetDepreciationEligibility(type: string) {
  if (type === "LAND") return "EXCLUDED";
  if (type === "MATERIAL" || type === "INTANGIBLE") return "SUPPORTED";
  return "UNSUPPORTED";
}

export function fixedAssetOpeningDates(cutoff: Date, yearStart: Date) {
  const start = new Date(cutoff.getTime() + 86_400_000);
  if (start.getTime() !== yearStart.getTime()) {
    throw new Error("OPENING_CUTOFF_INVALID");
  }
  return { effectiveFrom: start, eventDate: yearStart };
}

export function fixedAssetPage(value: string | undefined, count: number, size = 50) {
  const requested = value && /^[1-9]\d*$/.test(value) ? Number(value) : 1;
  const pages = Math.max(1, Math.ceil(count / size));
  const page = Math.min(Number.isSafeInteger(requested) ? requested : 1, pages);
  return { page, pages, skip: (page - 1) * size, take: size };
}

export function fixedAssetCentsToDecimal(cents: number) {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);

  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

export function fixedAssetDecimalToCents(value: { toString(): string }) {
  const raw = value.toString();

  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) {
    return null;
  }

  const negative = raw.startsWith("-");
  const [whole, fraction = ""] = raw.replace("-", "").split(".");
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  const signedCents = negative ? -cents : cents;

  return signedCents <= BigInt(Number.MAX_SAFE_INTEGER) &&
    signedCents >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(signedCents)
    : null;
}

export function fixedAssetCentsMoney(cents: number) {
  return new Intl.NumberFormat("sr-Latn-ME", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(cents / 100);
}

export function fixedAssetMoney(value: { toString(): string } | number) {
  return new Intl.NumberFormat("sr-Latn-ME", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value.toString()));
}

export function parseFixedAssetDate(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }

  const date = new Date(`${text}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text
    ? null
    : date;
}
