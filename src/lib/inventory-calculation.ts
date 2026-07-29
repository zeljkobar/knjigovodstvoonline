export const calculationStatuses = {
  draft: "DRAFT",
  waitingKuf: "WAITING_KUF",
  posted: "POSTED",
  deleted: "DELETED",
  needsReview: "NEEDS_REVIEW"
} as const;

export const calculationSaleTypes = {
  wholesale: "WHOLESALE",
  retail: "RETAIL"
} as const;

export const calculationPostingScope = {
  documentType: "CALCULATION",
  subtype: "DOMESTIC",
  vatRate: "GENERAL"
} as const;

export const calculationPostingFields = [
  {
    purpose: "CALCULATION_GOODS",
    label: "Roba",
    defaultDirection: "D",
    description: "Nabavna vrijednost u veleprodaji, odnosno prodajna vrijednost sa PDV-om u maloprodaji."
  },
  {
    purpose: "CALCULATION_INPUT_VAT",
    label: "Ulazni PDV",
    defaultDirection: "D",
    description: "Ulazni PDV koji firma može odbiti."
  },
  {
    purpose: "CALCULATION_SUPPLIER",
    label: "Dobavljač",
    defaultDirection: "P",
    description: "Ukupan iznos računa dobavljača sa PDV-om."
  },
  {
    purpose: "CALCULATION_PRICE_DIFFERENCE",
    label: "Razlika u cijeni",
    defaultDirection: "P",
    description: "Razlika između prodajne vrijednosti bez PDV-a i nabavne vrijednosti u maloprodaji."
  },
  {
    purpose: "CALCULATION_INCLUDED_VAT",
    label: "Ukalkulisani PDV",
    defaultDirection: "P",
    description: "PDV sadržan u maloprodajnoj vrijednosti robe."
  },
  {
    purpose: "CALCULATION_DEPENDENT_COSTS",
    label: "Zavisni troškovi",
    defaultDirection: "P",
    description: "Prevoz, špedicija i ostali troškovi uključeni u nabavnu vrijednost."
  }
] as const;

export const dependentCostAllocationMethods = {
  byValue: "BY_VALUE",
  manual: "MANUAL"
} as const;

function normalizeNumber(value: string) {
  return value.trim().replace(/\s/g, "").replace(",", ".");
}

export function parseScaledInteger(value: string, decimals: number) {
  const normalized = normalizeNumber(value);
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d+))?$/);

  if (!match) {
    return null;
  }

  const negative = match[1] === "-";
  const whole = match[2];
  const fraction = (match[3] ?? "").padEnd(decimals, "0").slice(0, decimals);
  const scaled = BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt(fraction || "0");

  return negative ? -scaled : scaled;
}

export function roundDivision(numerator: bigint, denominator: bigint) {
  if (denominator <= BigInt(0)) {
    throw new Error("Imenilac mora biti pozitivan.");
  }

  return (numerator + denominator / BigInt(2)) / denominator;
}

export function scaledToDecimal(value: bigint, decimals: number) {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, "0");

  return `${negative ? "-" : ""}${whole.toString()}${decimals ? `.${fraction}` : ""}`;
}

export function decimalToScaled(value: { toString(): string }, decimals: number) {
  return parseScaledInteger(value.toString(), decimals) ?? BigInt(0);
}

export function calculateLineAmounts(input: {
  quantityMilli: bigint;
  invoiceUnitPriceTenThousand: bigint;
  rebatePercentTenThousand: bigint;
  vatPercentHundred: bigint;
  dependentCostCents: bigint;
  marginPercentTenThousand: bigint;
  saleGrossUnitPriceTenThousand: bigint | null;
  netInvoiceValueCentsOverride?: bigint | null;
  inputVatCentsOverride?: bigint | null;
}) {
  const invoiceValueCents = roundDivision(
    input.quantityMilli * input.invoiceUnitPriceTenThousand,
    BigInt(100000)
  );
  const calculatedRebateCents = roundDivision(
    invoiceValueCents * input.rebatePercentTenThousand,
    BigInt(1000000)
  );
  const netInvoiceValueCents =
    input.netInvoiceValueCentsOverride ?? invoiceValueCents - calculatedRebateCents;
  const rebateCents = invoiceValueCents - netInvoiceValueCents;
  const netInvoiceUnitPriceTenThousand = roundDivision(
    netInvoiceValueCents * BigInt(100000),
    input.quantityMilli
  );
  const inputVatCents =
    input.inputVatCentsOverride ??
    roundDivision(netInvoiceValueCents * input.vatPercentHundred, BigInt(10000));
  const acquisitionValueCents = netInvoiceValueCents + input.dependentCostCents;
  const unitAcquisitionTenThousand = roundDivision(
    acquisitionValueCents * BigInt(100000),
    input.quantityMilli
  );
  const calculatedSaleNetValueCents = roundDivision(
    acquisitionValueCents * (BigInt(1000000) + input.marginPercentTenThousand),
    BigInt(1000000)
  );
  const calculatedSaleNetUnitTenThousand = roundDivision(
    calculatedSaleNetValueCents * BigInt(100000),
    input.quantityMilli
  );
  const calculatedSaleGrossUnitTenThousand = roundDivision(
    calculatedSaleNetUnitTenThousand * (BigInt(10000) + input.vatPercentHundred),
    BigInt(10000)
  );
  const saleGrossUnitTenThousand =
    input.saleGrossUnitPriceTenThousand ?? calculatedSaleGrossUnitTenThousand;
  const saleNetUnitTenThousand = roundDivision(
    saleGrossUnitTenThousand * BigInt(10000),
    BigInt(10000) + input.vatPercentHundred
  );
  const saleNetValueCents = roundDivision(
    input.quantityMilli * saleNetUnitTenThousand,
    BigInt(100000)
  );
  const saleGrossValueCents = roundDivision(
    input.quantityMilli * saleGrossUnitTenThousand,
    BigInt(100000)
  );
  const includedVatCents = saleGrossValueCents - saleNetValueCents;
  const marginCents = saleNetValueCents - acquisitionValueCents;
  const marginPercentTenThousand =
    acquisitionValueCents > BigInt(0)
      ? roundDivision(marginCents * BigInt(1000000), acquisitionValueCents)
      : BigInt(0);
  const rucPercentTenThousand =
    saleNetValueCents > BigInt(0)
      ? roundDivision(marginCents * BigInt(1000000), saleNetValueCents)
      : BigInt(0);

  return {
    invoiceValueCents,
    rebateCents,
    netInvoiceUnitPriceTenThousand,
    netInvoiceValueCents,
    inputVatCents,
    acquisitionValueCents,
    unitAcquisitionTenThousand,
    marginCents,
    marginPercentTenThousand,
    saleNetUnitTenThousand,
    saleGrossUnitTenThousand,
    saleNetValueCents,
    saleGrossValueCents,
    includedVatCents,
    rucPercentTenThousand
  };
}

export function allocateByValue(
  totalCents: bigint,
  lines: Array<{ id: string; valueCents: bigint }>
) {
  const totalValue = lines.reduce((sum, line) => sum + line.valueCents, BigInt(0));

  if (totalCents <= BigInt(0) || totalValue <= BigInt(0) || lines.length === 0) {
    return new Map(lines.map((line) => [line.id, BigInt(0)]));
  }

  const allocations = lines.map((line) => {
    const numerator = totalCents * line.valueCents;
    return {
      id: line.id,
      cents: numerator / totalValue,
      remainder: numerator % totalValue
    };
  });
  let remaining = totalCents - allocations.reduce((sum, item) => sum + item.cents, BigInt(0));

  allocations.sort((a, b) =>
    a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1
  );

  for (const item of allocations) {
    if (remaining <= BigInt(0)) {
      break;
    }

    item.cents += BigInt(1);
    remaining -= BigInt(1);
  }

  return new Map(allocations.map((item) => [item.id, item.cents]));
}

export function calculationStatusLabel(status: string) {
  return (
    {
      DRAFT: "Nacrt",
      WAITING_KUF: "Čeka prenos u KUF",
      POSTED: "Prenesena u KUF",
      DELETED: "Obrisana",
      NEEDS_REVIEW: "Za kontrolu"
    }[status] ?? status
  );
}
