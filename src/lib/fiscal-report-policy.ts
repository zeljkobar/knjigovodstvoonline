import type { Prisma } from "@prisma/client";

export const reportEnvironments = { Production: "Produkcija", Test: "Test" } as const;
export type ReportEnvironment = keyof typeof reportEnvironments;

export function reportEnvironment(value: unknown): ReportEnvironment {
  return value === "Test" ? "Test" : "Production";
}

/** Ordinary sales and their corrections only. Advances and informational workflows
 * require their own report; never infer a confirmed environment from company setup. */
export function confirmedSalesWhere(input: {
  agencijaId: string; firmaId: string; yearId: string;
  environment?: ReportEnvironment; posOnly?: boolean;
}): Prisma.FiskalniIzlazniRacunWhereInput {
  return {
    agencija_id: input.agencijaId,
    firma_id: input.firmaId,
    poslovna_godina_id: input.yearId,
    is_deleted: false,
    fiskalizacija_rezim: "SUMMA",
    fiscal_environment: input.environment ?? "Production",
    valuta: "EUR",
    fiscal_status: { in: ["Fiscalized", "StornoCreated"] },
    sales_channel: { in: input.posOnly ? ["POS"] : ["OFFICE", "POS"] },
    document_type: { in: input.posOnly
      ? ["POS_RECEIPT", "POS_RETURN"]
      : ["INVOICE", "OFFICE_STORNO", "POS_RECEIPT", "POS_RETURN"] },
    vrsta_racuna: { in: ["NORMAL", "CORRECTIVE"] }
  };
}
