import { decimalToScaled, parseScaledInteger, roundDivision, scaledToDecimal } from "@/lib/inventory-calculation";

export const outgoingInvoiceStatuses = { draft: "DRAFT", waitingKif: "WAITING_KIF", posted: "POSTED", cancelled: "CANCELLED" } as const;
export const outgoingInvoiceFiscalModes = { summa: "SUMMA", externalOrNone: "EXTERNAL_OR_NONE" } as const;
export const outgoingInvoicePostingScope = { documentType: "OUTGOING_INVOICE", subtype: "GENERAL", vatRate: "GENERAL" } as const;
export const outgoingInvoicePostingFields = [
  { purpose: "INVOICE_CUSTOMER", label: "Kupac", defaultDirection: "D", description: "Ukupan iznos potraživanja od kupca." },
  { purpose: "INVOICE_REVENUE", label: "Prihod", defaultDirection: "P", description: "Ukupna poreska osnovica/prihod fakture." },
  { purpose: "INVOICE_OUTPUT_VAT", label: "Izlazni PDV", defaultDirection: "P", description: "Obračunati izlazni PDV po izabranoj stopi." },
  { purpose: "INVOICE_COGS", label: "Nabavna vrijednost prodate robe", defaultDirection: "D", description: "Trošak robe razdužene sa lagera." },
  { purpose: "INVOICE_INVENTORY", label: "Zalihe robe", defaultDirection: "P", description: "Smanjenje nabavne vrijednosti zaliha." }
] as const;

export type InvoicePostingRule = { namjena: string; pdv_stopa_sifra: string; sifra_konta: string; smjer: string };
/** Specific rate overrides GENERAL; GENERAL covers only rates without an explicit row. */
export function buildOutgoingInvoicePostingLines(input: {
  settings: InvoicePostingRule[];
  lines: Array<{pdv_stopa_sifra: string; osnovica: {toString(): string}; pdv_iznos: {toString(): string}}>;
  gross: bigint; cogs: bigint; correction?: boolean;
}) {
  const amounts = new Map<InvoicePostingRule, bigint>();
  const add = (purpose: string, rate: string, amount: bigint) => {
    if (!amount) return true;
    const rule = input.settings.find(r=>r.namjena===purpose && r.pdv_stopa_sifra===rate)
      ?? input.settings.find(r=>r.namjena===purpose && r.pdv_stopa_sifra==="GENERAL");
    if (!rule?.sifra_konta || !["D","P"].includes(rule.smjer)) return false;
    amounts.set(rule,(amounts.get(rule)??BigInt(0))+amount);
    return true;
  };
  if (!add("INVOICE_CUSTOMER","GENERAL",input.gross) || !add("INVOICE_COGS","GENERAL",input.cogs) || !add("INVOICE_INVENTORY","GENERAL",input.cogs)) return null;
  for (const line of input.lines) {
    if (!add("INVOICE_REVENUE",line.pdv_stopa_sifra,decimalToScaled(line.osnovica.toString(),2)) ||
        !add("INVOICE_OUTPUT_VAT",line.pdv_stopa_sifra,decimalToScaled(line.pdv_iznos.toString(),2))) return null;
  }
  return [...amounts].filter(([,amount])=>amount!==BigInt(0)).map(([rule,amount])=>({
    amount, direction: rule.smjer as "D"|"P", code: rule.sifra_konta
  }));
}

export function calculateOutgoingInvoiceLine(input: {
  quantity: string;
  netUnitPrice: string;
  discountPercent: string;
  vatPercent: string;
}) {
  const quantity = parseScaledInteger(input.quantity, 3);
  const unitPrice = parseScaledInteger(input.netUnitPrice, 4);
  const discount = parseScaledInteger(input.discountPercent || "0", 4);
  const vat = parseScaledInteger(input.vatPercent || "0", 2);
  if (quantity === null || quantity <= BigInt(0) || unitPrice === null || unitPrice < BigInt(0) || discount === null || discount < BigInt(0) || discount > BigInt(1000000) || vat === null || vat < BigInt(0)) return null;

  const grossBeforeDiscount = roundDivision(quantity * unitPrice, BigInt(100000));
  const discountCents = roundDivision(grossBeforeDiscount * discount, BigInt(1000000));
  const baseCents = grossBeforeDiscount - discountCents;
  const vatCents = roundDivision(baseCents * vat, BigInt(10000));
  const totalCents = baseCents + vatCents;
  const grossUnit = roundDivision(unitPrice * (BigInt(10000) + vat), BigInt(10000));
  return {
    quantity: scaledToDecimal(quantity, 3),
    unitNet: scaledToDecimal(unitPrice, 4),
    discountPercent: scaledToDecimal(discount, 4),
    discount: scaledToDecimal(discountCents, 2),
    base: scaledToDecimal(baseCents, 2),
    vat: scaledToDecimal(vatCents, 2),
    unitGross: scaledToDecimal(grossUnit, 4),
    total: scaledToDecimal(totalCents, 2),
    discountCents,
    baseCents,
    vatCents,
    totalCents
  };
}

export function calculateOutgoingInvoiceLineFromGross(input: {
  quantity: string;
  grossUnitPrice: string;
  discountPercent: string;
  vatPercent: string;
}) {
  const quantity = parseScaledInteger(input.quantity, 3);
  const unitGross = parseScaledInteger(input.grossUnitPrice, 4);
  const discount = parseScaledInteger(input.discountPercent || "0", 4);
  const vat = parseScaledInteger(input.vatPercent || "0", 2);
  if (quantity === null || quantity <= BigInt(0) || unitGross === null || unitGross < BigInt(0) || discount === null || discount < BigInt(0) || discount > BigInt(1000000) || vat === null || vat < BigInt(0)) return null;

  const totalBeforeDiscount = roundDivision(quantity * unitGross, BigInt(100000));
  const discountCents = roundDivision(totalBeforeDiscount * discount, BigInt(1000000));
  const totalCents = totalBeforeDiscount - discountCents;
  const baseCents = vat > BigInt(0)
    ? roundDivision(totalCents * BigInt(10000), BigInt(10000) + vat)
    : totalCents;
  const vatCents = totalCents - baseCents;
  const unitNet = vat > BigInt(0)
    ? roundDivision(unitGross * BigInt(10000), BigInt(10000) + vat)
    : unitGross;

  return {
    quantity: scaledToDecimal(quantity, 3),
    unitNet: scaledToDecimal(unitNet, 4),
    discountPercent: scaledToDecimal(discount, 4),
    discount: scaledToDecimal(discountCents, 2),
    base: scaledToDecimal(baseCents, 2),
    vat: scaledToDecimal(vatCents, 2),
    unitGross: scaledToDecimal(unitGross, 4),
    total: scaledToDecimal(totalCents, 2),
    discountCents,
    baseCents,
    vatCents,
    totalCents
  };
}

export function outgoingInvoiceStatusLabel(status: string) {
  return ({ DRAFT: "Nacrt", WAITING_KIF: "Čeka KIF", POSTED: "Prenesena u KIF", CANCELLED: "Stornirana" } as Record<string, string>)[status] ?? status;
}
