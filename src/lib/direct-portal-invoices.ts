import type { Prisma } from "@prisma/client";
import { auditLog } from "./audit";
import type { ReadyDirectPortalContext } from "./direct-portal";
import { decimalToScaled } from "./inventory-calculation";
import { prisma } from "./prisma";

export const DIRECT_PORTAL_INVOICE_PAGE_SIZE = 25;

export const portalDocumentTypeLabels: Record<string, string> = {
  INVOICE: "Faktura",
  POS_RECEIPT: "POS račun",
  POS_RETURN: "Storno račun"
};

export const portalSalesChannelLabels: Record<string, string> = {
  OFFICE: "Faktura",
  POS: "POS"
};

export const portalPaymentFilterLabels: Record<string, string> = {
  CASH: "Gotovina",
  CARD: "Kartica",
  BANK_TRANSFER: "Virman",
  OTHER: "Ostalo"
};

export const portalFiscalStatusFilterLabels: Record<string, string> = {
  DRAFT: "Nacrt",
  ReadyForFiscalization: "Spremna za slanje",
  FiscalizationPending: "Fiskalizacija u toku",
  Fiscalized: "Fiskalizovana",
  FiscalizationFailed: "Fiskalizacija nije uspjela",
  StornoCreated: "Stornirana",
  NOT_REQUIRED: "Fiskalizacija nije potrebna"
};

export const portalFiscalEnvironmentLabels: Record<string, string> = {
  Test: "Test",
  Production: "Produkcija"
};

export type DirectPortalInvoiceSearchParams = Record<
  string,
  string | string[] | undefined
>;

export type DirectPortalInvoiceFilters = {
  periodFrom: string;
  periodTo: string;
  documentType: string;
  salesChannel: string;
  fiscalStatus: string;
  fiscalEnvironment: string;
  paymentMethod: string;
  registerId: string;
  buyer: string;
  number: string;
  ikof: string;
  jikr: string;
  page: number;
  invalidPeriod: boolean;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function limited(value: string | string[] | undefined, length: number) {
  return first(value).trim().slice(0, length);
}

function uuid(value: string | string[] | undefined) {
  const candidate = limited(value, 36);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    candidate
  )
    ? candidate
    : "";
}

function allowed(
  value: string | string[] | undefined,
  values: ReadonlySet<string>
) {
  const candidate = first(value);
  return values.has(candidate) ? candidate : "";
}

function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "";
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : "";
}

function dateValue(value: string) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

const documentTypes = new Set(["INVOICE", "POS_RECEIPT", "POS_RETURN"]);
const salesChannels = new Set(["OFFICE", "POS"]);
const fiscalStatuses = new Set(Object.keys(portalFiscalStatusFilterLabels));
const fiscalEnvironments = new Set(
  Object.keys(portalFiscalEnvironmentLabels)
);
const paymentMethods = new Set(Object.keys(portalPaymentFilterLabels));

export function parseDirectPortalInvoiceFilters(
  params: DirectPortalInvoiceSearchParams
): DirectPortalInvoiceFilters {
  const periodFrom = validIsoDate(first(params.od));
  const periodTo = validIsoDate(first(params.do));
  const requestedPage = Number.parseInt(first(params.stranica), 10);

  return {
    periodFrom,
    periodTo,
    documentType: allowed(params.tip, documentTypes),
    salesChannel: allowed(params.kanal, salesChannels),
    fiscalStatus: allowed(params.status, fiscalStatuses),
    fiscalEnvironment: allowed(params.okruzenje, fiscalEnvironments),
    paymentMethod: allowed(params.placanje, paymentMethods),
    registerId: uuid(params.kasa),
    buyer: limited(params.kupac, 120),
    number: limited(params.broj, 120),
    ikof: limited(params.ikof, 200),
    jikr: limited(params.jikr, 200),
    page:
      Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? requestedPage
        : 1,
    invalidPeriod: Boolean(
      periodFrom && periodTo && periodFrom.localeCompare(periodTo) > 0
    )
  };
}

function invoiceScope(context: ReadyDirectPortalContext) {
  if (!context.user.agencija_id) {
    throw new Error("Direct portal context nema agenciju.");
  }

  return {
    agencija_id: context.user.agencija_id,
    firma_id: context.firma.id,
    poslovna_godina_id: context.year.id,
    is_deleted: false
  } as const;
}

function invoiceWhere(
  context: ReadyDirectPortalContext,
  filters: DirectPortalInvoiceFilters
): Prisma.FiskalniIzlazniRacunWhereInput {
  const conditions: Prisma.FiskalniIzlazniRacunWhereInput[] = [];
  const from = dateValue(filters.periodFrom);
  const to = dateValue(filters.periodTo);

  if (from || to) {
    conditions.push({
      datum_racuna: {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {})
      }
    });
  }

  if (filters.documentType) {
    conditions.push({ document_type: filters.documentType });
  }

  if (filters.salesChannel) {
    conditions.push({ sales_channel: filters.salesChannel });
  }

  if (filters.fiscalStatus) {
    conditions.push({ fiscal_status: filters.fiscalStatus });
  }

  if (filters.fiscalEnvironment) {
    conditions.push({ fiscal_environment: filters.fiscalEnvironment });
  }

  if (filters.paymentMethod) {
    conditions.push({
      OR: [
        { nacin_placanja: filters.paymentMethod },
        { placanja: { some: { payment_method: filters.paymentMethod } } }
      ]
    });
  }

  if (filters.registerId) {
    conditions.push({ pos_register_id: filters.registerId });
  }

  if (filters.buyer) {
    conditions.push({
      kupac: {
        OR: [
          { naziv: { contains: filters.buyer, mode: "insensitive" } },
          { pib: { contains: filters.buyer, mode: "insensitive" } },
          {
            foreign_tax_number: {
              contains: filters.buyer,
              mode: "insensitive"
            }
          }
        ]
      }
    });
  }

  if (filters.number) {
    conditions.push({
      OR: [
        { interni_broj: { contains: filters.number, mode: "insensitive" } },
        { broj_racuna: { contains: filters.number, mode: "insensitive" } },
        {
          official_invoice_number: {
            contains: filters.number,
            mode: "insensitive"
          }
        }
      ]
    });
  }

  if (filters.ikof) {
    conditions.push({ iic: { equals: filters.ikof, mode: "insensitive" } });
  }

  if (filters.jikr) {
    conditions.push({ jikr: { equals: filters.jikr, mode: "insensitive" } });
  }

  return {
    ...invoiceScope(context),
    ...(conditions.length > 0 ? { AND: conditions } : {})
  };
}

export async function loadDirectPortalInvoiceList(
  context: ReadyDirectPortalContext,
  filters: DirectPortalInvoiceFilters
) {
  const where = invoiceWhere(context, filters);
  const [total, registers] = await Promise.all([
    prisma.fiskalniIzlazniRacun.count({ where }),
    prisma.posRegister.findMany({
      where: {
        agencija_id: context.user.agencija_id!,
        firma_id: context.firma.id,
        is_deleted: false
      },
      orderBy: [{ aktivan: "desc" }, { naziv: "asc" }],
      select: { id: true, sifra: true, naziv: true, aktivan: true }
    })
  ]);
  const totalPages = Math.max(
    1,
    Math.ceil(total / DIRECT_PORTAL_INVOICE_PAGE_SIZE)
  );
  const page = Math.min(filters.page, totalPages);
  const invoices = await prisma.fiskalniIzlazniRacun.findMany({
    where,
    select: {
      id: true,
      interni_broj: true,
      broj_racuna: true,
      official_invoice_number: true,
      document_type: true,
      sales_channel: true,
      issued_at: true,
      created_at: true,
      datum_racuna: true,
      fiscal_status: true,
      fiscal_environment: true,
      status: true,
      iic: true,
      jikr: true,
      qr_code_data: true,
      nacin_placanja: true,
      ukupno_sa_pdv: true,
      original_invoice_id: true,
      kupac: { select: { naziv: true, pib: true } },
      pos_register: { select: { naziv: true, sifra: true } },
      placanja: {
        orderBy: { redni_broj: "asc" },
        select: { payment_method: true }
      }
    },
    orderBy: [{ issued_at: "desc" }, { created_at: "desc" }],
    skip: (page - 1) * DIRECT_PORTAL_INVOICE_PAGE_SIZE,
    take: DIRECT_PORTAL_INVOICE_PAGE_SIZE
  });

  return { invoices, registers, total, totalPages, page };
}

export async function findDirectPortalInvoice(
  context: ReadyDirectPortalContext,
  id: string
) {
  if (!uuid(id)) {
    return null;
  }

  const scope = invoiceScope(context);
  const invoice = await prisma.fiskalniIzlazniRacun.findFirst({
    where: {
      id,
      ...scope
    },
    include: {
      firma: {
        include: {
          bankovni_racuni: {
            where: { aktivan: true, is_deleted: false },
            orderBy: [{ glavni: "desc" }, { created_at: "asc" }],
            take: 1
          }
        }
      },
      poslovna_godina: { select: { godina: true, zakljucena: true } },
      kupac: true,
      magacin: true,
      pos_register: true,
      stavke: { orderBy: { redni_broj: "asc" } },
      poreske_stavke: { orderBy: { vat_rate_percent: "desc" } },
      placanja: { orderBy: { redni_broj: "asc" } },
      fiskalni_pokusaji: {
        orderBy: { started_at: "desc" },
        take: 10,
        select: {
          id: true,
          attempt_number: true,
          status: true,
          correlation_id: true,
          error_code: true,
          started_at: true,
          finished_at: true
        }
      }
    }
  });

  if (!invoice) {
    return null;
  }

  const relatedSelect = {
    id: true,
    interni_broj: true,
    broj_racuna: true,
    official_invoice_number: true,
    fiscal_status: true
  } as const;
  const [originalInvoice, correctiveInvoices] = await Promise.all([
    invoice.original_invoice_id
      ? prisma.fiskalniIzlazniRacun.findFirst({
          where: { id: invoice.original_invoice_id, ...scope },
          select: relatedSelect
        })
      : null,
    prisma.fiskalniIzlazniRacun.findMany({
      where: { original_invoice_id: invoice.id, ...scope },
      orderBy: { created_at: "desc" },
      select: relatedSelect
    })
  ]);

  return {
    ...invoice,
    original_invoice: originalInvoice,
    corrective_invoices: correctiveInvoices
  };
}

export function formatPortalDecimal(
  value: { toString(): string },
  digits = 2
) {
  const scaled = decimalToScaled(value, digits);
  const negative = scaled < BigInt(0);
  const absolute = negative ? -scaled : scaled;
  const scale = BigInt(10) ** BigInt(digits);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(digits, "0");

  return `${negative ? "-" : ""}${whole.toLocaleString("sr-Latn-ME")}${
    digits > 0 ? `,${fraction}` : ""
  }`;
}

export function portalFiscalStatusTone(status: string) {
  if (status === "Fiscalized") return "status-pill--success";
  if (
    status === "FiscalizationFailed" ||
    status === "FiscalizationPending" ||
    status === "StornoCreated"
  ) {
    return "status-pill--warning";
  }
  return "status-pill--muted";
}

export function isFinalPortalFiscalDocument(invoice: {
  status: string;
  fiscal_status: string;
  iic: string | null;
  jikr: string | null;
  qr_code_data: string | null;
}) {
  return (
    invoice.status === "FINALIZED" &&
    ["Fiscalized", "StornoCreated"].includes(invoice.fiscal_status) &&
    Boolean(invoice.iic && invoice.jikr && invoice.qr_code_data)
  );
}

export function isFinalPortalPosReceipt(invoice: {
  sales_channel: string;
  status: string;
  fiscal_status: string;
  iic: string | null;
  jikr: string | null;
  qr_code_data: string | null;
}) {
  return (
    invoice.sales_channel === "POS" &&
    isFinalPortalFiscalDocument(invoice)
  );
}

export async function auditDirectPortalInvoicePrint(input: {
  context: ReadyDirectPortalContext;
  invoice: {
    id: string;
    interni_broj: string;
    fiscal_status: string;
    fiscal_environment: string | null;
  };
  format: "A4" | "THERMAL_58" | "THERMAL_80";
}) {
  await auditLog({
    korisnikId: input.context.user.id,
    agencijaId: input.context.user.agencija_id,
    firmaId: input.context.firma.id,
    modul: "fiskalizacija",
    akcija: "direct_portal_invoice_print_opened",
    tipEntiteta: "FiskalniIzlazniRacun",
    entitetId: input.invoice.id,
    novaVrijednost: {
      format: input.format,
      interniBroj: input.invoice.interni_broj,
      fiscalStatus: input.invoice.fiscal_status,
      fiscalEnvironment: input.invoice.fiscal_environment
    }
  });
}
