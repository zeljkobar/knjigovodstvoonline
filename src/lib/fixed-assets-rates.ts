// Quantities and rates are decimal strings at the boundaries; never currency floats.
export const fixedAssetMethodLabels: Record<string, string> = {
  LINEAR: "Linearna", DEGRESSIVE: "Degresivna", UNITS_OF_PRODUCTION: "Funkcionalna (po učinku)", NONE: "Bez amortizacije"
};
export const rateAlgorithm = "MONTHLY_RATE_V2";
export function scaledDecimal(value: unknown): bigint | null {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!/^\d{1,14}(\.\d{1,6})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0"));
}
export function decimalString(value: bigint): string {
  return `${value / BigInt(1_000_000)}.${String(value % BigInt(1_000_000)).padStart(6, "0")}`;
}
export function parseDepreciationFields(form: FormData, exempt = false) {
  if (exempt) return { metoda: "NONE", algoritam: rateAlgorithm, korisni_vijek_mjeseci: null,
    godisnja_stopa: null, jedinica_ucinka: null, ocekivani_ucinak: null, prethodni_ucinak: null,
    stopa_po_jedinici: null, izvor_stope: null };
  const method = String(form.get("metoda") ?? "");
  const annual = scaledDecimal(form.get("godisnja_stopa"));
  const monthsRaw = String(form.get("korisni_vijek_mjeseci") ?? "");
  const months = /^\d+$/.test(monthsRaw) ? Number(monthsRaw) : null;
  const base = { metoda: method, algoritam: rateAlgorithm, korisni_vijek_mjeseci: null as number | null,
    godisnja_stopa: null as string | null, jedinica_ucinka: null as string | null,
    ocekivani_ucinak: null as string | null, prethodni_ucinak: null as string | null,
    stopa_po_jedinici: null as string | null, izvor_stope: null as string | null };
  if (["LINEAR", "DEGRESSIVE"].includes(method)) {
    if (annual === null || annual <= BigInt(0) || annual > BigInt(100_000_000)) return null;
    if (method === "DEGRESSIVE" && (months === null || months < 1 || months > 1200)) return null;
    return { ...base, godisnja_stopa: decimalString(annual), korisni_vijek_mjeseci: method === "DEGRESSIVE" ? months : null };
  }
  if (method !== "UNITS_OF_PRODUCTION") return null;
  const unit = String(form.get("jedinica_ucinka") ?? "").trim();
  const total = scaledDecimal(form.get("ocekivani_ucinak"));
  const prior = scaledDecimal(form.get("prethodni_ucinak") ?? "0");
  const source = String(form.get("izvor_stope") ?? "DERIVED");
  const rate = scaledDecimal(form.get("stopa_po_jedinici"));
  if (!unit || unit.length > 40 || prior === null || (source === "DERIVED" && (total === null || total <= BigInt(0) || prior > total)) ||
    !["DERIVED", "MANUAL"].includes(source) || (source === "MANUAL" && (rate === null || rate <= BigInt(0)))) return null;
  return { ...base, jedinica_ucinka: unit, ocekivani_ucinak: source === "DERIVED" ? decimalString(total!) : null, prethodni_ucinak: decimalString(prior),
    izvor_stope: source, stopa_po_jedinici: source === "MANUAL" ? decimalString(rate!) : null };
}

export function completeDepreciationFields(fields: NonNullable<ReturnType<typeof parseDepreciationFields>>, basisCents: number) {
  if (fields.metoda !== "UNITS_OF_PRODUCTION" || fields.izvor_stope !== "MANUAL") return fields;
  const rate = scaledDecimal(fields.stopa_po_jedinici)!;
  const capacity = (BigInt(basisCents) * BigInt(10_000_000_000) + rate / BigInt(2)) / rate;
  const expected = scaledDecimal(decimalString(capacity));
  if (expected === null || expected <= BigInt(0) || scaledDecimal(fields.prethodni_ucinak)! > expected) return null;
  const reproducedCents = (expected * rate * BigInt(100) * BigInt(2) + BigInt(1_000_000_000_000)) / BigInt(2_000_000_000_000);
  // Reject a rate whose implied capacity cannot represent the basis at six decimals.
  const difference = reproducedCents - BigInt(basisCents);
  if (difference < BigInt(-1) || difference > BigInt(1)) return null;
  return { ...fields, ocekivani_ucinak: decimalString(expected) };
}

export function derivedUnitRate(basisCents: number, expectedUnits: string): string | null {
  const quantity = scaledDecimal(expectedUnits);
  return quantity && Number.isSafeInteger(basisCents) && basisCents >= 0
    ? decimalString((BigInt(basisCents) * BigInt(10_000_000_000) + quantity / BigInt(2)) / quantity)
    : null;
}
