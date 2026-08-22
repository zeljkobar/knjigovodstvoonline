import type { Prisma } from "@prisma/client";
import { decimalToScaled } from "./inventory-calculation";
import type { ReadyDirectPortalContext } from "./direct-portal";
import {
  podgoricaBusinessDate,
  podgoricaDayUtcRange
} from "./direct-portal-policy";
import { prisma } from "./prisma";

export const DIRECT_PORTAL_REPORT_KINDS = [
  "promet",
  "artikli",
  "placanja"
] as const;

export type DirectPortalReportKind =
  (typeof DIRECT_PORTAL_REPORT_KINDS)[number];

export type DirectPortalReportSearchParams = Record<
  string,
  string | string[] | undefined
>;

export type DirectPortalReportFilters = {
  periodFrom: string;
  periodTo: string;
  registerId: string;
  salesChannel: string;
  paymentMethod: string;
  buyer: string;
  item: string;
  itemId: string;
  groupId: string;
  invalidPeriod: boolean;
};

export const directPortalReportPaymentLabels: Record<string, string> = {
  CASH: "Gotovina",
  CARD: "Kartica",
  BANK_TRANSFER: "Virman",
  OTHER: "Ostalo"
};

export const directPortalReportChannelLabels: Record<string, string> = {
  OFFICE: "OFFICE / fakture",
  POS: "POS / kasa"
};

export const directPortalReportDocumentLabels: Record<string, string> = {
  INVOICE: "Faktura",
  POS_RECEIPT: "POS račun",
  POS_RETURN: "Storno"
};

const paymentMethods = new Set(Object.keys(directPortalReportPaymentLabels));
const salesChannels = new Set(Object.keys(directPortalReportChannelLabels));
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function limited(value: string | string[] | undefined, length: number) {
  return first(value).trim().slice(0, length);
}

function allowed(
  value: string | string[] | undefined,
  values: ReadonlySet<string>
) {
  const candidate = first(value);
  return values.has(candidate) ? candidate : "";
}

function uuid(value: string | string[] | undefined) {
  const candidate = limited(value, 36);
  return uuidPattern.test(candidate) ? candidate : "";
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : "";
}

export function parseDirectPortalReportKind(
  value: string | null | undefined
): DirectPortalReportKind | null {
  return DIRECT_PORTAL_REPORT_KINDS.includes(
    value as DirectPortalReportKind
  )
    ? (value as DirectPortalReportKind)
    : null;
}

export function parseDirectPortalReportFilters(
  params: DirectPortalReportSearchParams,
  year: { datum_od: Date; datum_do: Date }
): DirectPortalReportFilters {
  const yearFrom = isoDate(year.datum_od);
  const yearTo = isoDate(year.datum_do);
  const businessDate = isoDate(podgoricaBusinessDate());
  const defaultTo =
    businessDate >= yearFrom && businessDate <= yearTo
      ? businessDate
      : yearTo;
  const monthStart = `${defaultTo.slice(0, 7)}-01`;
  const defaultFrom = monthStart < yearFrom ? yearFrom : monthStart;
  const requestedFrom = first(params.od).trim();
  const requestedTo = first(params.do).trim();
  const parsedFrom = requestedFrom ? validIsoDate(requestedFrom) : defaultFrom;
  const parsedTo = requestedTo ? validIsoDate(requestedTo) : defaultTo;
  const periodIsValid = Boolean(
    parsedFrom &&
      parsedTo &&
      parsedFrom >= yearFrom &&
      parsedTo <= yearTo &&
      parsedFrom <= parsedTo
  );

  return {
    periodFrom: periodIsValid ? parsedFrom : defaultFrom,
    periodTo: periodIsValid ? parsedTo : defaultTo,
    registerId: uuid(params.kasa),
    salesChannel: allowed(params.kanal, salesChannels),
    paymentMethod: allowed(params.placanje, paymentMethods),
    buyer: limited(params.kupac, 120),
    item: limited(params.artikal, 120),
    itemId: uuid(params.artikal_id),
    groupId: uuid(params.grupa),
    invalidPeriod: !periodIsValid
  };
}

function localDayRange(from: string, to: string) {
  const fromRange = podgoricaDayUtcRange(
    new Date(`${from}T12:00:00.000Z`)
  );
  const toRange = podgoricaDayUtcRange(new Date(`${to}T12:00:00.000Z`));

  return {
    start: fromRange.start,
    endExclusive: toRange.end,
    dateFrom: new Date(`${from}T00:00:00.000Z`),
    dateTo: new Date(`${to}T00:00:00.000Z`)
  };
}

function reportScope(context: ReadyDirectPortalContext) {
  const agencijaId = context.user.agencija_id;
  if (!agencijaId) throw new Error("Direct portal context nema agenciju.");

  return {
    agencija_id: agencijaId,
    firma_id: context.firma.id,
    poslovna_godina_id: context.year.id,
    is_deleted: false
  } as const;
}

function reportWhere(
  context: ReadyDirectPortalContext,
  filters: DirectPortalReportFilters,
  kind: DirectPortalReportKind
): Prisma.FiskalniIzlazniRacunWhereInput {
  const scope = reportScope(context);
  const range = localDayRange(filters.periodFrom, filters.periodTo);
  const conditions: Prisma.FiskalniIzlazniRacunWhereInput[] = [
    {
      OR: [
        {
          issued_at: {
            gte: range.start,
            lt: range.endExclusive
          }
        },
        {
          issued_at: null,
          datum_racuna: {
            gte: range.dateFrom,
            lte: range.dateTo
          }
        }
      ]
    }
  ];

  if (filters.registerId) {
    conditions.push({ pos_register_id: filters.registerId });
  }

  if (filters.salesChannel) {
    conditions.push({ sales_channel: filters.salesChannel });
  }

  if (filters.paymentMethod) {
    conditions.push({
      OR: [
        { nacin_placanja: filters.paymentMethod },
        {
          placanja: {
            some: { payment_method: filters.paymentMethod }
          }
        }
      ]
    });
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

  if (
    kind === "artikli" &&
    (filters.itemId || filters.item || filters.groupId)
  ) {
    const lineConditions: Prisma.StavkaIzlazneFaktureWhereInput[] = [];

    if (filters.itemId) lineConditions.push({ artikal_id: filters.itemId });
    if (filters.item) {
      lineConditions.push({
        OR: [
          { sifra_artikla: { contains: filters.item, mode: "insensitive" } },
          { naziv_artikla: { contains: filters.item, mode: "insensitive" } }
        ]
      });
    }
    if (filters.groupId) {
      lineConditions.push({
        artikal: {
          agencija_id: scope.agencija_id,
          firma_id: scope.firma_id,
          grupa_artikla_id: filters.groupId
        }
      });
    }

    conditions.push({
      stavke: {
        some: lineConditions.length > 1 ? { AND: lineConditions } : lineConditions[0]
      }
    });
  }

  return {
    ...scope,
    fiskalizacija_rezim: "SUMMA",
    fiscal_status: { in: ["Fiscalized", "StornoCreated"] },
    document_type: { in: ["INVOICE", "POS_RECEIPT", "POS_RETURN"] },
    sales_channel: { in: ["OFFICE", "POS"] },
    AND: conditions
  };
}

function isCorrection(invoice: {
  original_invoice_id: string | null;
  document_type: string;
  vrsta_racuna: string;
}) {
  return (
    Boolean(invoice.original_invoice_id) ||
    invoice.document_type === "POS_RETURN" ||
    invoice.vrsta_racuna === "CORRECTIVE"
  );
}

function signedScaled(
  value: { toString(): string },
  digits: number,
  correction: boolean
) {
  const scaled = decimalToScaled(value, digits);
  return correction && scaled > BigInt(0) ? -scaled : scaled;
}

function lineMatches(
  line: {
    artikal_id: string;
    sifra_artikla: string;
    naziv_artikla: string;
    artikal: { grupa_artikla_id: string | null };
  },
  filters: DirectPortalReportFilters,
  kind: DirectPortalReportKind
) {
  if (kind !== "artikli") return true;
  if (filters.itemId && line.artikal_id !== filters.itemId) return false;
  if (filters.groupId && line.artikal.grupa_artikla_id !== filters.groupId) {
    return false;
  }
  if (filters.item) {
    const needle = filters.item.toLocaleLowerCase("sr-Latn-ME");
    if (
      !line.sifra_artikla.toLocaleLowerCase("sr-Latn-ME").includes(needle) &&
      !line.naziv_artikla.toLocaleLowerCase("sr-Latn-ME").includes(needle)
    ) {
      return false;
    }
  }
  return true;
}

export async function loadDirectPortalReportOptions(
  context: ReadyDirectPortalContext,
  filters?: Pick<DirectPortalReportFilters, "itemId">
) {
  const agencijaId = context.user.agencija_id;
  if (!agencijaId) throw new Error("Direct portal context nema agenciju.");

  const [registers, groups, selectedItem] = await Promise.all([
    prisma.posRegister.findMany({
      where: {
        agencija_id: agencijaId,
        firma_id: context.firma.id,
        is_deleted: false
      },
      orderBy: [{ aktivan: "desc" }, { naziv: "asc" }],
      select: { id: true, sifra: true, naziv: true, aktivan: true }
    }),
    prisma.grupaArtikla.findMany({
      where: {
        agencija_id: agencijaId,
        firma_id: context.firma.id,
        is_deleted: false
      },
      orderBy: [{ aktivna: "desc" }, { naziv: "asc" }],
      select: { id: true, sifra: true, naziv: true, aktivna: true }
    }),
    filters?.itemId
      ? prisma.artikal.findFirst({
          where: {
            id: filters.itemId,
            agencija_id: agencijaId,
            firma_id: context.firma.id,
            is_deleted: false
          },
          select: { id: true, sifra: true, naziv: true }
        })
      : null
  ]);

  return { registers, groups, selectedItem };
}

export async function loadDirectPortalReport(
  context: ReadyDirectPortalContext,
  filters: DirectPortalReportFilters,
  kind: DirectPortalReportKind
) {
  const invoices = await prisma.fiskalniIzlazniRacun.findMany({
    where: reportWhere(context, filters, kind),
    select: {
      id: true,
      interni_broj: true,
      broj_racuna: true,
      official_invoice_number: true,
      datum_racuna: true,
      issued_at: true,
      created_at: true,
      document_type: true,
      sales_channel: true,
      vrsta_racuna: true,
      original_invoice_id: true,
      nacin_placanja: true,
      ukupno_osnovica: true,
      ukupno_izlazni_pdv: true,
      ukupno_sa_pdv: true,
      kupac: {
        select: { id: true, naziv: true, pib: true, foreign_tax_number: true }
      },
      pos_register: { select: { id: true, sifra: true, naziv: true } },
      placanja: {
        orderBy: { redni_broj: "asc" },
        select: { payment_method: true, amount: true }
      },
      poreske_stavke: {
        select: {
          vat_rate_code: true,
          vat_rate_name: true,
          vat_rate_percent: true,
          tax_base: true,
          output_vat_amount: true,
          total_with_vat: true
        }
      },
      stavke: {
        orderBy: { redni_broj: "asc" },
        select: {
          artikal_id: true,
          sifra_artikla: true,
          naziv_artikla: true,
          jedinica_mjere: true,
          usluga: true,
          kolicina: true,
          osnovica: true,
          pdv_iznos: true,
          ukupno_sa_pdv: true,
          artikal: {
            select: {
              grupa_artikla_id: true,
              grupa_artikla: { select: { sifra: true, naziv: true } }
            }
          }
        }
      }
    },
    orderBy: [{ issued_at: "desc" }, { datum_racuna: "desc" }, { broj: "desc" }]
  });

  let base = BigInt(0);
  let vat = BigInt(0);
  let gross = BigInt(0);
  let ordinaryCount = 0;
  let correctionCount = 0;
  const payments = new Map<string, bigint>();
  const taxes = new Map<
    string,
    {
      code: string;
      name: string;
      rate: string;
      base: bigint;
      vat: bigint;
      gross: bigint;
    }
  >();
  const channels = new Map<
    string,
    { channel: string; count: number; gross: bigint }
  >();
  const registers = new Map<
    string,
    { id: string; code: string; name: string; count: number; gross: bigint }
  >();
  const items = new Map<
    string,
    {
      id: string;
      code: string;
      name: string;
      unit: string;
      service: boolean;
      group: string;
      quantity: bigint;
      base: bigint;
      vat: bigint;
      gross: bigint;
      invoiceIds: Set<string>;
    }
  >();

  const documents = invoices.map((invoice) => {
    const correction = isCorrection(invoice);
    const matchingLines = invoice.stavke.filter((line) =>
      lineMatches(line, filters, kind)
    );
    const invoiceBase = signedScaled(invoice.ukupno_osnovica, 2, correction);
    const invoiceVat = signedScaled(
      invoice.ukupno_izlazni_pdv,
      2,
      correction
    );
    const invoiceGross = signedScaled(invoice.ukupno_sa_pdv, 2, correction);
    let reportBase = invoiceBase;
    let reportVat = invoiceVat;
    let reportGross = invoiceGross;

    if (kind === "artikli" && (filters.itemId || filters.item || filters.groupId)) {
      reportBase = BigInt(0);
      reportVat = BigInt(0);
      reportGross = BigInt(0);
      for (const line of matchingLines) {
        reportBase += signedScaled(line.osnovica, 2, correction);
        reportVat += signedScaled(line.pdv_iznos, 2, correction);
        reportGross += signedScaled(line.ukupno_sa_pdv, 2, correction);
      }
    }

    base += reportBase;
    vat += reportVat;
    gross += reportGross;
    if (correction) correctionCount += 1;
    else ordinaryCount += 1;

    const channel = channels.get(invoice.sales_channel) ?? {
      channel: invoice.sales_channel,
      count: 0,
      gross: BigInt(0)
    };
    channel.count += 1;
    channel.gross += reportGross;
    channels.set(invoice.sales_channel, channel);

    const registerId = invoice.pos_register?.id ?? "office";
    const register = registers.get(registerId) ?? {
      id: registerId,
      code: invoice.pos_register?.sifra ?? "OFFICE",
      name: invoice.pos_register?.naziv ?? "OFFICE / bez POS kase",
      count: 0,
      gross: BigInt(0)
    };
    register.count += 1;
    register.gross += reportGross;
    registers.set(registerId, register);

    if (invoice.placanja.length > 0) {
      for (const payment of invoice.placanja) {
        if (
          filters.paymentMethod &&
          payment.payment_method !== filters.paymentMethod
        ) {
          continue;
        }
        const amount = signedScaled(payment.amount, 2, correction);
        payments.set(
          payment.payment_method,
          (payments.get(payment.payment_method) ?? BigInt(0)) + amount
        );
      }
    } else if (
      !filters.paymentMethod ||
      invoice.nacin_placanja === filters.paymentMethod
    ) {
      payments.set(
        invoice.nacin_placanja,
        (payments.get(invoice.nacin_placanja) ?? BigInt(0)) + invoiceGross
      );
    }

    if (kind === "artikli") {
      for (const line of matchingLines) {
        const item = items.get(line.artikal_id) ?? {
          id: line.artikal_id,
          code: line.sifra_artikla,
          name: line.naziv_artikla,
          unit: line.jedinica_mjere,
          service: line.usluga,
          group: line.artikal.grupa_artikla
            ? `${line.artikal.grupa_artikla.sifra} · ${line.artikal.grupa_artikla.naziv}`
            : "Bez grupe",
          quantity: BigInt(0),
          base: BigInt(0),
          vat: BigInt(0),
          gross: BigInt(0),
          invoiceIds: new Set<string>()
        };
        item.quantity += signedScaled(line.kolicina, 3, correction);
        item.base += signedScaled(line.osnovica, 2, correction);
        item.vat += signedScaled(line.pdv_iznos, 2, correction);
        item.gross += signedScaled(line.ukupno_sa_pdv, 2, correction);
        item.invoiceIds.add(invoice.id);
        items.set(line.artikal_id, item);
      }
    }

    if (kind !== "artikli" || !(filters.itemId || filters.item || filters.groupId)) {
      for (const tax of invoice.poreske_stavke) {
        const key = `${tax.vat_rate_code}:${tax.vat_rate_percent.toString()}`;
        const row = taxes.get(key) ?? {
          code: tax.vat_rate_code,
          name: tax.vat_rate_name,
          rate: tax.vat_rate_percent.toString(),
          base: BigInt(0),
          vat: BigInt(0),
          gross: BigInt(0)
        };
        row.base += signedScaled(tax.tax_base, 2, correction);
        row.vat += signedScaled(tax.output_vat_amount, 2, correction);
        row.gross += signedScaled(tax.total_with_vat, 2, correction);
        taxes.set(key, row);
      }
    } else {
      for (const line of matchingLines) {
        const key = `line:${line.artikal_id}:${line.pdv_iznos.toString()}`;
        const rateLabel = "Stopa sa stavke";
        const row = taxes.get(key) ?? {
          code: "",
          name: rateLabel,
          rate: "",
          base: BigInt(0),
          vat: BigInt(0),
          gross: BigInt(0)
        };
        row.base += signedScaled(line.osnovica, 2, correction);
        row.vat += signedScaled(line.pdv_iznos, 2, correction);
        row.gross += signedScaled(line.ukupno_sa_pdv, 2, correction);
        taxes.set(key, row);
      }
    }

    const paymentMethodsForDocument =
      invoice.placanja.length > 0
        ? invoice.placanja.map((payment) => payment.payment_method)
        : [invoice.nacin_placanja];

    return {
      id: invoice.id,
      date: invoice.issued_at ?? invoice.datum_racuna ?? invoice.created_at,
      localNumber: invoice.interni_broj,
      officialNumber: invoice.official_invoice_number ?? invoice.broj_racuna,
      documentType: invoice.document_type,
      channel: invoice.sales_channel,
      correction,
      buyer: invoice.kupac.naziv,
      buyerTaxNumber:
        invoice.kupac.pib ?? invoice.kupac.foreign_tax_number ?? "",
      register: invoice.pos_register?.naziv ?? "—",
      paymentMethods: [...new Set(paymentMethodsForDocument)],
      base: invoiceBase,
      vat: invoiceVat,
      gross: invoiceGross,
      reportAmount: reportGross
    };
  });

  return {
    filters,
    totals: {
      count: invoices.length,
      ordinaryCount,
      correctionCount,
      base,
      vat,
      gross
    },
    payments: [...payments.entries()]
      .map(([method, amount]) => ({ method, amount }))
      .sort((left, right) => left.method.localeCompare(right.method)),
    taxes: [...taxes.values()].sort(
      (left, right) => Number(right.rate || 0) - Number(left.rate || 0)
    ),
    channels: [...channels.values()].sort((left, right) =>
      left.channel.localeCompare(right.channel)
    ),
    registers: [...registers.values()].sort((left, right) =>
      left.name.localeCompare(right.name, "sr-Latn-ME")
    ),
    items: [...items.values()]
      .map(({ invoiceIds, ...item }) => ({
        ...item,
        invoiceCount: invoiceIds.size
      }))
      .sort((left, right) =>
        left.gross === right.gross ? 0 : left.gross > right.gross ? -1 : 1
      ),
    documents
  };
}

export type DirectPortalReport = Awaited<
  ReturnType<typeof loadDirectPortalReport>
>;

export function directPortalReportQuery(
  filters: DirectPortalReportFilters,
  overrides: Partial<Record<
    "od" | "do" | "kasa" | "kanal" | "placanje" | "kupac" | "artikal" | "artikal_id" | "grupa",
    string | null
  >> = {}
) {
  const values: Record<string, string> = {
    od: filters.periodFrom,
    do: filters.periodTo,
    kasa: filters.registerId,
    kanal: filters.salesChannel,
    placanje: filters.paymentMethod,
    kupac: filters.buyer,
    artikal: filters.item,
    artikal_id: filters.itemId,
    grupa: filters.groupId
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) delete values[key];
    else if (value !== undefined) values[key] = value;
  }

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) query.set(key, value);
  }
  return query.toString();
}

export function safeCsvCell(value: unknown) {
  const normalized = String(value ?? "").replace(/\u0000/g, "");
  const protectedValue = /^[\s\u0001-\u001f]*[=+\-@]/.test(normalized)
    ? `'${normalized}`
    : normalized;
  return `"${protectedValue.replace(/"/g, '""')}"`;
}

export function directPortalCsv(rows: unknown[][]) {
  return `\uFEFF${rows
    .map((row) => row.map((cell) => safeCsvCell(cell)).join(";"))
    .join("\r\n")}\r\n`;
}
