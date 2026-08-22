import "server-only";

import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { auditLog } from "@/lib/audit";
import {
  fiscalAdminApi,
  FiscalAdminApiError,
  type FiscalInvoice
} from "@/lib/fiscal-admin-api";
import { inventoryModule } from "@/lib/inventory";
import {
  decimalToScaled,
  roundDivision,
  scaledToDecimal
} from "@/lib/inventory-calculation";
import {
  calculateOutgoingInvoiceLine,
  outgoingInvoiceFiscalModes
} from "@/lib/outgoing-invoice";
import { applyOutgoingInvoiceInventoryMovement } from "@/lib/pos-inventory";
import { prisma } from "@/lib/prisma";

export type OutgoingInvoiceServiceContext = {
  agencijaId: string;
  firmaId: string;
  poslovnaGodinaId: string;
  userId: string;
  userName: string;
};

export type OutgoingInvoiceAccountingMode = "CONFIGURED" | "FISCAL_ONLY";
export type OutgoingInvoicePartnerAccess = "AGENCY" | "DIRECT";

export type OutgoingInvoiceServiceOptions = {
  accountingMode: OutgoingInvoiceAccountingMode;
  partnerAccess: OutgoingInvoicePartnerAccess;
};

export type OutgoingInvoiceMutationResult = {
  invoiceId: string;
  existing?: boolean;
};

export type OutgoingInvoiceFiscalizationResult =
  | {
      status: "fiscalized";
      invoiceId: string;
      existing: boolean;
    }
  | {
      status: "pending";
      invoiceId: string;
      existing: true;
    }
  | {
      status: "failed";
      invoiceId: string;
      existing: boolean;
      errorCode: string;
      correlationId: string | null;
    };

export type OutgoingInvoiceServiceErrorCode =
  | "artikal"
  | "datum"
  | "fiskalizacija_nije_podesena"
  | "fiskalizacija_nije_summa"
  | "fiskalizacija_pib"
  | "fiskalizacija_suspendovana"
  | "godina"
  | "iznosi"
  | "kupac"
  | "lager"
  | "lokalni_zavrsetak"
  | "magacin"
  | "magacin_obavezan"
  | "nije_nacrt"
  | "obavezno"
  | "pdv"
  | "pdv_period"
  | "placanje"
  | "potvrda"
  | "stale_potvrda"
  | "stavke"
  | "submission"
  | "zakljucana";

export class OutgoingInvoiceServiceError extends Error {
  constructor(
    readonly code: OutgoingInvoiceServiceErrorCode,
    readonly detail?: string
  ) {
    super(detail ? `${code}:${detail}` : code);
    this.name = "OutgoingInvoiceServiceError";
  }

  get redirectCode() {
    return this.detail ? `${this.code}:${this.detail}` : this.code;
  }
}

type SubmittedLine = {
  itemId?: string;
  quantity?: string;
  netUnitPrice?: string;
  discountPercent?: string;
  note?: string;
};

const invoiceSubmissionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const staleFiscalAttemptMs = 2 * 60 * 1000;
const directPaymentMethod = "BANK_TRANSFER";
const allowedAgencyPaymentMethods = new Set([
  "BANK_TRANSFER",
  "CASH",
  "CARD",
  "OTHER"
]);

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function parseDateValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : parsed;
}

function submittedDate(formData: FormData, key: string) {
  const value = text(formData, key);
  return value ? parseDateValue(value) : null;
}

function addUtcDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function inBusinessYear(
  value: Date,
  year: { datum_od: Date; datum_do: Date }
) {
  return value >= year.datum_od && value <= year.datum_do;
}

function invoiceScope(context: OutgoingInvoiceServiceContext) {
  return {
    agencija_id: context.agencijaId,
    firma_id: context.firmaId,
    poslovna_godina_id: context.poslovnaGodinaId,
    document_type: "INVOICE",
    sales_channel: "OFFICE",
    is_deleted: false
  } as const;
}

function editableInvoiceScope(context: OutgoingInvoiceServiceContext) {
  return {
    ...invoiceScope(context),
    status: "DRAFT",
    fiscal_status: { in: ["DRAFT", "NOT_REQUIRED"] }
  };
}

function partnerScope(
  context: OutgoingInvoiceServiceContext,
  access: OutgoingInvoicePartnerAccess
): Prisma.KomitentWhereInput[] {
  return access === "DIRECT"
    ? [
        { scope: "GLOBAL" },
        { scope: "COMPANY", firma_id: context.firmaId }
      ]
    : [
        { scope: "GLOBAL" },
        { scope: "AGENCY", agencija_id: context.agencijaId },
        { scope: "COMPANY", firma_id: context.firmaId }
      ];
}

async function loadFirmAndYear(context: OutgoingInvoiceServiceContext) {
  const [firma, year] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: context.firmaId,
        agencija_id: context.agencijaId,
        aktivan: true,
        is_deleted: false
      },
      select: {
        id: true,
        naziv: true,
        skraceni_naziv: true,
        pib: true,
        pdv_broj: true,
        pdv_obveznik: true,
        dozvoli_negativan_lager: true,
        adresa: true,
        grad: true,
        drzava: true,
        telefon: true,
        email: true,
        web_sajt: true,
        fiscalCompanyLink: true
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: context.poslovnaGodinaId,
        firma_id: context.firmaId
      },
      select: {
        id: true,
        godina: true,
        datum_od: true,
        datum_do: true,
        zakljucena: true
      }
    })
  ]);

  if (!firma || !year) throw new OutgoingInvoiceServiceError("godina");
  if (year.zakljucena) throw new OutgoingInvoiceServiceError("zakljucana");

  return { firma, year };
}

async function loadBuyer(
  context: OutgoingInvoiceServiceContext,
  buyerId: string,
  access: OutgoingInvoicePartnerAccess
) {
  return prisma.komitent.findFirst({
    where: {
      id: buyerId,
      aktivan: true,
      OR: partnerScope(context, access)
    },
    select: {
      id: true,
      naziv: true,
      pib: true,
      pdv_broj: true,
      adresa: true,
      grad: true,
      drzava: true,
      email: true,
      telefon: true,
      is_foreign: true,
      country_code: true,
      firme: {
        where: { firma_id: context.firmaId, aktivan: true },
        select: { rok_placanja_dana: true },
        take: 1
      }
    }
  });
}

function issuerSnapshot(
  firma: Awaited<ReturnType<typeof loadFirmAndYear>>["firma"],
  bankAccount: { naziv_banke: string; broj_racuna: string } | null
) {
  return {
    naziv: firma.naziv,
    skraceniNaziv: firma.skraceni_naziv,
    pib: firma.pib,
    pdvBroj: firma.pdv_broj,
    adresa: firma.adresa,
    grad: firma.grad,
    drzava: firma.drzava,
    telefon: firma.telefon,
    email: firma.email,
    webSajt: firma.web_sajt,
    banka: bankAccount?.naziv_banke ?? null,
    ziroRacun: bankAccount?.broj_racuna ?? null
  };
}

function buyerSnapshot(
  buyer: NonNullable<Awaited<ReturnType<typeof loadBuyer>>>
) {
  return {
    naziv: buyer.naziv,
    pib: buyer.pib,
    pdvBroj: buyer.pdv_broj,
    adresa: buyer.adresa,
    grad: buyer.grad,
    drzava: buyer.drzava,
    telefon: buyer.telefon,
    email: buyer.email
  };
}

async function ensurePdvPeriodOpen(
  context: OutgoingInvoiceServiceContext,
  dates: Date[]
) {
  const months = [...new Set(dates.map((value) => value.getUTCMonth() + 1))];
  const locked = await prisma.pdvPeriod.findFirst({
    where: {
      firma_id: context.firmaId,
      poslovna_godina_id: context.poslovnaGodinaId,
      mjesec: { in: months },
      status: "LOCKED"
    },
    select: { id: true }
  });
  if (locked) throw new OutgoingInvoiceServiceError("pdv_period");
}

async function lockInvoice(tx: Prisma.TransactionClient, invoiceId: string) {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`outgoing-invoice:${invoiceId}`}))`
  );
}

function paymentType(value: string) {
  return value === "CASH"
    ? "Cash"
    : value === "CARD"
      ? "Card"
      : value === "BANK_TRANSFER"
        ? "BankAccount"
        : "Other";
}

function apiNumber(value: { toString(): string }) {
  return Number(value.toString());
}

function grossDiscountAmount(line: {
  kolicina: { toString(): string };
  jedinicna_cijena_sa_pdv: { toString(): string };
  ukupno_sa_pdv: { toString(): string };
}) {
  const quantity = decimalToScaled(line.kolicina, 3);
  const unitGross = decimalToScaled(line.jedinicna_cijena_sa_pdv, 4);
  const total = decimalToScaled(line.ukupno_sa_pdv, 2);
  const beforeDiscount = roundDivision(quantity * unitGross, BigInt(100000));
  const discount = beforeDiscount > total ? beforeDiscount - total : BigInt(0);
  return Number(scaledToDecimal(discount, 2));
}

async function auditInvoice(input: {
  context: OutgoingInvoiceServiceContext;
  action: string;
  invoiceId: string;
  oldValue?: unknown;
  newValue?: unknown;
}) {
  await auditLog({
    korisnikId: input.context.userId,
    agencijaId: input.context.agencijaId,
    firmaId: input.context.firmaId,
    modul: inventoryModule,
    akcija: input.action,
    tipEntiteta: "FiskalniIzlazniRacun",
    entitetId: input.invoiceId,
    staraVrijednost: input.oldValue,
    novaVrijednost: input.newValue
  });
}

export async function createOutgoingInvoiceDraft(input: {
  context: OutgoingInvoiceServiceContext;
  formData: FormData;
  options: OutgoingInvoiceServiceOptions;
}): Promise<OutgoingInvoiceMutationResult> {
  const { context, formData, options } = input;
  const submittedId = text(formData, "submission_id");
  const submissionId =
    submittedId || (options.partnerAccess === "AGENCY" ? randomUUID() : "");
  if (!invoiceSubmissionIdPattern.test(submissionId)) {
    throw new OutgoingInvoiceServiceError("submission");
  }

  const buyerId = text(formData, "kupac_id");
  const warehouseId = text(formData, "magacin_id") || null;
  const invoiceDate = submittedDate(formData, "datum_racuna");
  const supplyDate = formData.has("datum_prometa")
    ? submittedDate(formData, "datum_prometa")
    : invoiceDate;
  if (!buyerId || !invoiceDate || !supplyDate) {
    throw new OutgoingInvoiceServiceError("obavezno");
  }

  const [{ firma, year }, buyer, bankAccount, warehouse] = await Promise.all([
    loadFirmAndYear(context),
    loadBuyer(context, buyerId, options.partnerAccess),
    prisma.firmaBankovniRacun.findFirst({
      where: {
        agencija_id: context.agencijaId,
        firma_id: context.firmaId,
        aktivan: true,
        is_deleted: false
      },
      orderBy: [{ glavni: "desc" }, { created_at: "asc" }],
      select: { naziv_banke: true, broj_racuna: true }
    }),
    warehouseId
      ? prisma.magacin.findFirst({
          where: {
            id: warehouseId,
            agencija_id: context.agencijaId,
            firma_id: context.firmaId,
            aktivan: true,
            is_deleted: false
          },
          select: { id: true }
        })
      : Promise.resolve(null)
  ]);
  if (!buyer) throw new OutgoingInvoiceServiceError("kupac");
  if (warehouseId && !warehouse) {
    throw new OutgoingInvoiceServiceError("magacin");
  }
  if (!inBusinessYear(invoiceDate, year) || !inBusinessYear(supplyDate, year)) {
    throw new OutgoingInvoiceServiceError("datum");
  }

  const submittedDueDate = submittedDate(formData, "datum_valute");
  const dueDate = submittedDueDate ?? addUtcDays(
    invoiceDate,
    buyer.firme[0]?.rok_placanja_dana ?? 7
  );
  if (dueDate < invoiceDate) throw new OutgoingInvoiceServiceError("datum");
  await ensurePdvPeriodOpen(context, [invoiceDate, supplyDate]);

  const idempotencyKey = `website:invoice:${context.firmaId}:${submissionId}`;
  const mode = options.accountingMode === "FISCAL_ONLY"
    ? outgoingInvoiceFiscalModes.summa
    : firma.fiscalCompanyLink?.fiscal_api_company_id &&
        !firma.fiscalCompanyLink.is_suspended
      ? outgoingInvoiceFiscalModes.summa
      : outgoingInvoiceFiscalModes.externalOrNone;

  const prepared = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${idempotencyKey}))`
    );
    const duplicate = await tx.fiskalniIzlazniRacun.findFirst({
      where: {
        ...invoiceScope(context),
        idempotency_key: idempotencyKey
      },
      select: { id: true }
    });
    if (duplicate) return { invoice: duplicate, existing: true as const };

    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${context.firmaId}:${year.id}:sales`}))`
    );
    const last = await tx.fiskalniIzlazniRacun.findFirst({
      where: {
        firma_id: context.firmaId,
        poslovna_godina_id: year.id
      },
      orderBy: { broj: "desc" },
      select: { broj: true }
    });
    const number = (last?.broj ?? 0) + 1;
    const internal = `IF-${year.godina}-${String(number).padStart(4, "0")}`;
    const invoice = await tx.fiskalniIzlazniRacun.create({
      data: {
        agencija_id: context.agencijaId,
        firma_id: context.firmaId,
        poslovna_godina_id: year.id,
        kupac_id: buyer.id,
        magacin_id: warehouse?.id ?? null,
        broj: number,
        interni_broj: internal,
        broj_racuna: internal,
        datum_racuna: invoiceDate,
        datum_prometa: supplyDate,
        datum_valute: dueDate,
        mjesto_izdavanja:
          text(formData, "mjesto_izdavanja") || firma.grad || null,
        document_type: "INVOICE",
        sales_channel: "OFFICE",
        nacin_placanja: directPaymentMethod,
        vat_transaction_type: buyer.is_foreign ? "EXPORT" : "DOMESTIC",
        fiskalizacija_rezim: mode,
        fiscal_status:
          mode === outgoingInvoiceFiscalModes.summa ? "DRAFT" : "NOT_REQUIRED",
        issuer_snapshot: issuerSnapshot(firma, bankAccount),
        buyer_snapshot: buyerSnapshot(buyer),
        idempotency_key: idempotencyKey,
        kif_status: "DRAFT",
        napomena: text(formData, "napomena") || null,
        created_by: context.userId,
        updated_by: context.userId
      }
    });
    return { invoice, existing: false as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (!prepared.existing) {
    await auditInvoice({
      context,
      action: "create_outgoing_invoice",
      invoiceId: prepared.invoice.id,
      newValue: {
        interni_broj: "interni_broj" in prepared.invoice
          ? prepared.invoice.interni_broj
          : undefined,
        fiskalizacija_rezim: "fiskalizacija_rezim" in prepared.invoice
          ? prepared.invoice.fiskalizacija_rezim
          : mode,
        accountingMode: options.accountingMode
      }
    });
  }

  return { invoiceId: prepared.invoice.id, existing: prepared.existing };
}

export async function saveOutgoingInvoiceDraft(input: {
  context: OutgoingInvoiceServiceContext;
  formData: FormData;
  options: OutgoingInvoiceServiceOptions;
}): Promise<OutgoingInvoiceMutationResult> {
  const { context, formData } = input;
  const invoiceId = text(formData, "faktura_id");
  const raw = text(formData, "stavke_json");
  if (!invoiceId || !raw || raw.length > 500_000) {
    throw new OutgoingInvoiceServiceError("stavke");
  }

  let submitted: SubmittedLine[];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    submitted = parsed as SubmittedLine[];
  } catch {
    throw new OutgoingInvoiceServiceError("stavke");
  }
  const clean = submitted.filter((line) => line.itemId);
  if (!clean.length || clean.length > 500) {
    throw new OutgoingInvoiceServiceError("stavke");
  }

  const { firma } = await loadFirmAndYear(context);
  const invoice = await prisma.fiskalniIzlazniRacun.findFirst({
    where: { id: invoiceId, ...editableInvoiceScope(context) },
    select: { id: true, datum_racuna: true }
  });
  if (!invoice) throw new OutgoingInvoiceServiceError("nije_nacrt");
  await ensurePdvPeriodOpen(context, [invoice.datum_racuna]);

  const requestedIds = [...new Set(clean.map((line) => line.itemId!))];
  const items = await prisma.artikal.findMany({
    where: {
      id: { in: requestedIds },
      firma_id: context.firmaId,
      agencija_id: context.agencijaId,
      aktivan: true,
      is_deleted: false
    },
    include: { jedinica_mjere: true, pdv_stopa: true }
  });
  if (items.length !== requestedIds.length) {
    throw new OutgoingInvoiceServiceError("artikal");
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  const rows: Array<
    Omit<Prisma.StavkaIzlazneFaktureCreateManyInput, "izlazna_faktura_id">
  > = [];
  let discount = BigInt(0);
  let base = BigInt(0);
  let vat = BigInt(0);
  let total = BigInt(0);

  for (let index = 0; index < clean.length; index += 1) {
    const source = clean[index];
    const item = byId.get(source.itemId!);
    if (!item?.pdv_stopa) throw new OutgoingInvoiceServiceError("pdv");
    const amount = calculateOutgoingInvoiceLine({
      quantity: source.quantity ?? "",
      netUnitPrice: source.netUnitPrice ?? "",
      discountPercent: source.discountPercent ?? "0",
      vatPercent: firma.pdv_obveznik
        ? item.pdv_stopa.procenat.toString()
        : "0"
    });
    if (!amount) throw new OutgoingInvoiceServiceError("iznosi");
    discount += amount.discountCents;
    base += amount.baseCents;
    vat += amount.vatCents;
    total += amount.totalCents;
    rows.push({
      redni_broj: index + 1,
      artikal_id: item.id,
      sifra_artikla: item.sifra,
      naziv_artikla: item.naziv,
      jedinica_mjere: item.jedinica_mjere.oznaka,
      usluga: item.usluga,
      kolicina: amount.quantity,
      jedinicna_cijena_bez_pdv: amount.unitNet,
      rabat_procenat: amount.discountPercent,
      rabat_iznos: amount.discount,
      osnovica: amount.base,
      pdv_stopa_id: item.pdv_stopa.id,
      pdv_stopa_sifra: item.pdv_stopa.sifra,
      pdv_stopa_naziv: item.pdv_stopa.naziv,
      pdv_stopa_procenat: firma.pdv_obveznik ? item.pdv_stopa.procenat : 0,
      pdv_iznos: amount.vat,
      jedinicna_cijena_sa_pdv: amount.unitGross,
      ukupno_sa_pdv: amount.total,
      napomena: source.note?.trim() || null,
      created_by: context.userId,
      updated_by: context.userId
    });
  }

  await prisma.$transaction(async (tx) => {
    await lockInvoice(tx, invoiceId);
    const current = await tx.fiskalniIzlazniRacun.findFirst({
      where: { id: invoiceId, ...editableInvoiceScope(context) },
      select: { id: true }
    });
    if (!current) throw new OutgoingInvoiceServiceError("nije_nacrt");
    await tx.stavkaIzlazneFakture.deleteMany({
      where: { izlazna_faktura_id: invoiceId }
    });
    await tx.stavkaIzlazneFakture.createMany({
      data: rows.map((row) => ({ ...row, izlazna_faktura_id: invoiceId }))
    });
    await tx.fiskalniIzlazniRacun.update({
      where: { id: invoiceId },
      data: {
        ukupno_rabat: scaledToDecimal(discount, 2),
        ukupno_osnovica: scaledToDecimal(base, 2),
        ukupno_izlazni_pdv: scaledToDecimal(vat, 2),
        ukupno_sa_pdv: scaledToDecimal(total, 2),
        updated_by: context.userId
      }
    });
  });

  await auditInvoice({
    context,
    action: "update_outgoing_invoice_lines",
    invoiceId,
    newValue: {
      broj_stavki: rows.length,
      ukupno: scaledToDecimal(total, 2)
    }
  });
  return { invoiceId };
}

export async function updateOutgoingInvoiceDraftHeader(input: {
  context: OutgoingInvoiceServiceContext;
  formData: FormData;
  options: OutgoingInvoiceServiceOptions;
}): Promise<OutgoingInvoiceMutationResult> {
  const { context, formData, options } = input;
  const invoiceId = text(formData, "faktura_id");
  const { year } = await loadFirmAndYear(context);
  const current = await prisma.fiskalniIzlazniRacun.findFirst({
    where: { id: invoiceId, ...editableInvoiceScope(context) },
    include: { kupac: true }
  });
  if (!current) throw new OutgoingInvoiceServiceError("nije_nacrt");

  const buyerId = formData.has("kupac_id")
    ? text(formData, "kupac_id")
    : current.kupac_id;
  if (!buyerId) throw new OutgoingInvoiceServiceError("kupac");
  const buyer = await loadBuyer(context, buyerId, options.partnerAccess);
  if (!buyer) throw new OutgoingInvoiceServiceError("kupac");

  const invoiceDate = formData.has("datum_racuna")
    ? submittedDate(formData, "datum_racuna")
    : current.datum_racuna;
  const supplyDate = formData.has("datum_prometa")
    ? submittedDate(formData, "datum_prometa")
    : current.datum_prometa;
  const dueDate = formData.has("datum_valute")
    ? submittedDate(formData, "datum_valute")
    : current.datum_valute;
  if (!invoiceDate || !supplyDate || !dueDate) {
    throw new OutgoingInvoiceServiceError("datum");
  }
  if (
    !inBusinessYear(invoiceDate, year) ||
    !inBusinessYear(supplyDate, year) ||
    dueDate < invoiceDate
  ) {
    throw new OutgoingInvoiceServiceError("datum");
  }
  await ensurePdvPeriodOpen(context, [current.datum_racuna, invoiceDate]);

  const warehouseId = formData.has("magacin_id")
    ? text(formData, "magacin_id") || null
    : current.magacin_id;
  if (warehouseId) {
    const warehouse = await prisma.magacin.findFirst({
      where: {
        id: warehouseId,
        agencija_id: context.agencijaId,
        firma_id: context.firmaId,
        aktivan: true,
        is_deleted: false
      },
      select: { id: true }
    });
    if (!warehouse) throw new OutgoingInvoiceServiceError("magacin");
  }

  const requestedPayment = text(formData, "nacin_placanja");
  const payment = options.partnerAccess === "DIRECT"
    ? directPaymentMethod
    : requestedPayment || current.nacin_placanja;
  if (!allowedAgencyPaymentMethods.has(payment)) {
    throw new OutgoingInvoiceServiceError("placanje");
  }
  const note = formData.has("napomena")
    ? text(formData, "napomena") || null
    : current.napomena;
  const place = formData.has("mjesto_izdavanja")
    ? text(formData, "mjesto_izdavanja") || null
    : current.mjesto_izdavanja;

  await prisma.$transaction(async (tx) => {
    await lockInvoice(tx, invoiceId);
    const editable = await tx.fiskalniIzlazniRacun.findFirst({
      where: { id: invoiceId, ...editableInvoiceScope(context) },
      select: { id: true }
    });
    if (!editable) throw new OutgoingInvoiceServiceError("nije_nacrt");
    await tx.fiskalniIzlazniRacun.update({
      where: { id: invoiceId },
      data: {
        kupac_id: buyer.id,
        buyer_snapshot: buyerSnapshot(buyer),
        vat_transaction_type: buyer.is_foreign ? "EXPORT" : "DOMESTIC",
        datum_racuna: invoiceDate,
        datum_prometa: supplyDate,
        datum_valute: dueDate,
        mjesto_izdavanja: place,
        magacin_id: warehouseId,
        nacin_placanja: payment,
        napomena: note,
        updated_by: context.userId
      }
    });
  });

  await auditInvoice({
    context,
    action: "update_outgoing_invoice_header",
    invoiceId,
    oldValue: {
      kupac_id: current.kupac_id,
      datum_racuna: current.datum_racuna,
      datum_prometa: current.datum_prometa,
      datum_valute: current.datum_valute,
      mjesto_izdavanja: current.mjesto_izdavanja,
      magacin_id: current.magacin_id,
      nacin_placanja: current.nacin_placanja,
      napomena: current.napomena
    },
    newValue: {
      kupac_id: buyer.id,
      datum_racuna: invoiceDate,
      datum_prometa: supplyDate,
      datum_valute: dueDate,
      mjesto_izdavanja: place,
      magacin_id: warehouseId,
      nacin_placanja: payment,
      napomena: note
    }
  });
  return { invoiceId };
}

async function loadFiscalInvoice(
  context: OutgoingInvoiceServiceContext,
  invoiceId: string
) {
  return prisma.fiskalniIzlazniRacun.findFirst({
    where: { id: invoiceId, ...invoiceScope(context) },
    include: {
      stavke: {
        orderBy: { redni_broj: "asc" },
        include: {
          artikal: {
            select: {
              usluga: true,
              prati_zalihe: true,
              posljednja_nabavna_cijena: true
            }
          }
        }
      },
      kupac: true,
      magacin: true,
      firma: {
        select: {
          pib: true,
          dozvoli_negativan_lager: true,
          fiscalCompanyLink: true
        }
      }
    }
  });
}

async function preflightOutgoingInvoice(input: {
  context: OutgoingInvoiceServiceContext;
  invoice: NonNullable<Awaited<ReturnType<typeof loadFiscalInvoice>>>;
  options: OutgoingInvoiceServiceOptions;
}) {
  const { context, invoice, options } = input;
  if (invoice.status !== "DRAFT") {
    throw new OutgoingInvoiceServiceError("nije_nacrt");
  }
  if (!invoice.stavke.length || decimalToScaled(invoice.ukupno_sa_pdv, 2) <= BigInt(0)) {
    throw new OutgoingInvoiceServiceError("stavke");
  }
  if (
    options.partnerAccess === "DIRECT" &&
    invoice.nacin_placanja !== directPaymentMethod
  ) {
    throw new OutgoingInvoiceServiceError("placanje");
  }
  await ensurePdvPeriodOpen(context, [invoice.datum_racuna]);

  const goods = invoice.stavke.filter(
    (line) => !line.artikal.usluga && line.artikal.prati_zalihe
  );
  if (goods.length && !invoice.magacin_id) {
    throw new OutgoingInvoiceServiceError("magacin_obavezan");
  }
  for (const line of goods) {
    const state = await prisma.stanjeZaliha.findUnique({
      where: {
        firma_id_poslovna_godina_id_magacin_id_artikal_id: {
          firma_id: context.firmaId,
          poslovna_godina_id: context.poslovnaGodinaId,
          magacin_id: invoice.magacin_id!,
          artikal_id: line.artikal_id
        }
      }
    });
    const quantity = decimalToScaled(line.kolicina, 3);
    const available = decimalToScaled(state?.kolicina ?? 0, 3);
    const allowNegative =
      invoice.magacin?.dozvoli_negativan_lager ??
      invoice.firma.dozvoli_negativan_lager;
    if (!allowNegative && available < quantity) {
      throw new OutgoingInvoiceServiceError(
        "lager",
        `${line.naziv_artikla}:${scaledToDecimal(available, 3)}`
      );
    }
  }
}

function expectedConfirmation(environment: string) {
  return environment === "Production"
    ? "CONFIRM_PRODUCTION"
    : environment === "Test"
      ? "CONFIRM_TEST"
      : null;
}

function verifyDirectConfirmation(input: {
  environment: string | null | undefined;
  confirmation: string;
  expectedUpdatedAt: string;
  invoiceUpdatedAt: Date;
}) {
  const expected = expectedConfirmation(input.environment ?? "");
  if (!expected || input.confirmation !== expected) {
    throw new OutgoingInvoiceServiceError("potvrda");
  }
  const version = new Date(input.expectedUpdatedAt);
  if (
    !input.expectedUpdatedAt ||
    Number.isNaN(version.getTime()) ||
    version.getTime() !== input.invoiceUpdatedAt.getTime()
  ) {
    throw new OutgoingInvoiceServiceError("stale_potvrda");
  }
}

async function claimFiscalization(input: {
  context: OutgoingInvoiceServiceContext;
  invoiceId: string;
  options: OutgoingInvoiceServiceOptions;
  confirmation: string;
  expectedUpdatedAt: string;
}) {
  const { context, invoiceId, options } = input;
  return prisma.$transaction(async (tx) => {
    await lockInvoice(tx, invoiceId);
    const current = await tx.fiskalniIzlazniRacun.findFirst({
      where: { id: invoiceId, ...invoiceScope(context) },
      include: {
        stavke: { orderBy: { redni_broj: "asc" } },
        kupac: true,
        firma: { select: { pib: true, fiscalCompanyLink: true } }
      }
    });
    if (!current) throw new OutgoingInvoiceServiceError("nije_nacrt");
    if (current.fiscal_status === "Fiscalized") {
      return { kind: "fiscalized" as const, invoice: current };
    }
    if (current.status !== "DRAFT") {
      throw new OutgoingInvoiceServiceError("nije_nacrt");
    }
    if (options.accountingMode === "FISCAL_ONLY") {
      verifyDirectConfirmation({
        environment:
          current.fiscal_environment ??
          current.firma.fiscalCompanyLink?.fiscal_environment,
        confirmation: input.confirmation,
        expectedUpdatedAt: input.expectedUpdatedAt,
        invoiceUpdatedAt: current.updated_at
      });
    }
    const staleBefore = new Date(Date.now() - staleFiscalAttemptMs);
    if (
      current.fiscal_status === "FiscalizationPending" &&
      current.last_fiscal_attempt_at &&
      current.last_fiscal_attempt_at >= staleBefore
    ) {
      return { kind: "pending" as const, invoice: current };
    }

    const baseKey =
      current.idempotency_key ??
      `website:invoice:${context.firmaId}:${current.id}`;
    const lastAttempt = await tx.fiscalizationAttempt.findFirst({
      where: { fiskalni_izlazni_racun_id: current.id },
      orderBy: { attempt_number: "desc" },
      select: { attempt_number: true }
    });
    const attemptNumber = (lastAttempt?.attempt_number ?? 0) + 1;
    const attemptKey = `${baseKey}:attempt:${attemptNumber}`;
    const issuedAt = current.issued_at ?? new Date();
    await tx.fiskalniIzlazniRacun.update({
      where: { id: current.id },
      data: {
        idempotency_key: baseKey,
        issued_at: issuedAt,
        fiscal_status: "FiscalizationPending",
        fiscal_error_code: null,
        fiscal_error_message: null,
        last_fiscal_attempt_at: new Date(),
        updated_by: context.userId
      }
    });
    await tx.fiscalizationAttempt.create({
      data: {
        fiskalni_izlazni_racun_id: current.id,
        attempt_number: attemptNumber,
        idempotency_key: attemptKey,
        status: "PENDING",
        created_by: context.userId
      }
    });
    return {
      kind: "claimed" as const,
      invoice: { ...current, idempotency_key: baseKey, issued_at: issuedAt },
      attemptKey
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function lockFiscalEnvironmentSnapshot(input: {
  context: OutgoingInvoiceServiceContext;
  invoiceId: string;
  environment: "Test" | "Production";
}) {
  return prisma.$transaction(async (tx) => {
    await lockInvoice(tx, input.invoiceId);
    const current = await tx.fiskalniIzlazniRacun.findFirst({
      where: { id: input.invoiceId, ...invoiceScope(input.context) },
      select: { fiscal_environment: true }
    });
    if (!current) throw new OutgoingInvoiceServiceError("nije_nacrt");
    if (
      current.fiscal_environment &&
      current.fiscal_environment !== input.environment
    ) {
      throw new FiscalAdminApiError(
        "FISCAL_ENVIRONMENT_CHANGED",
        "Fiskalno okruzenje dokumenta se razlikuje od aktivnog okruzenja."
      );
    }
    if (!current.fiscal_environment) {
      await tx.fiskalniIzlazniRacun.update({
        where: { id: input.invoiceId },
        data: {
          fiscal_environment: input.environment,
          updated_by: input.context.userId
        }
      });
    }
    return input.environment;
  });
}

function taxSummaryRows(
  invoiceId: string,
  userId: string,
  lines: Array<{
    pdv_stopa_sifra: string;
    pdv_stopa_naziv: string;
    pdv_stopa_procenat: Prisma.Decimal;
    osnovica: Prisma.Decimal;
    pdv_iznos: Prisma.Decimal;
    ukupno_sa_pdv: Prisma.Decimal;
  }>
) {
  const groups = new Map<
    string,
    {
      name: string;
      percent: Prisma.Decimal;
      base: bigint;
      vat: bigint;
      total: bigint;
    }
  >();
  for (const line of lines) {
    const group = groups.get(line.pdv_stopa_sifra) ?? {
      name: line.pdv_stopa_naziv,
      percent: line.pdv_stopa_procenat,
      base: BigInt(0),
      vat: BigInt(0),
      total: BigInt(0)
    };
    group.base += decimalToScaled(line.osnovica, 2);
    group.vat += decimalToScaled(line.pdv_iznos, 2);
    group.total += decimalToScaled(line.ukupno_sa_pdv, 2);
    groups.set(line.pdv_stopa_sifra, group);
  }
  return [...groups.entries()].map(([code, group]) => ({
    fiskalni_izlazni_racun_id: invoiceId,
    vat_rate_code: code,
    vat_rate_name: group.name,
    vat_rate_percent: group.percent,
    tax_base: scaledToDecimal(group.base, 2),
    output_vat_amount: scaledToDecimal(group.vat, 2),
    total_with_vat: scaledToDecimal(group.total, 2),
    created_by: userId
  }));
}

async function persistFiscalResult(input: {
  context: OutgoingInvoiceServiceContext;
  invoice: NonNullable<Awaited<ReturnType<typeof loadFiscalInvoice>>>;
  attemptKey: string;
  fiscalInvoiceId: string;
  finalInvoice: FiscalInvoice;
  environment: "Test" | "Production";
  correlationId: string | null;
  startedAt: number;
}) {
  const { context, invoice } = input;
  await prisma.$transaction(async (tx) => {
    await lockInvoice(tx, invoice.id);
    await tx.fiskalniIzlazniRacunPorez.deleteMany({
      where: { fiskalni_izlazni_racun_id: invoice.id }
    });
    await tx.fiskalniIzlazniRacunPorez.createMany({
      data: taxSummaryRows(invoice.id, context.userId, invoice.stavke)
    });
    await tx.salesDocumentPayment.deleteMany({
      where: { fiskalni_izlazni_racun_id: invoice.id }
    });
    await tx.salesDocumentPayment.create({
      data: {
        fiskalni_izlazni_racun_id: invoice.id,
        redni_broj: 1,
        payment_method: invoice.nacin_placanja,
        amount: invoice.ukupno_sa_pdv,
        reference: invoice.interni_broj,
        created_by: context.userId
      }
    });
    await tx.fiskalniIzlazniRacun.update({
      where: { id: invoice.id },
      data: {
        fiscal_api_invoice_id: input.fiscalInvoiceId,
        fiscal_status: "Fiscalized",
        fiscal_environment: input.environment,
        official_invoice_number: input.finalInvoice.officialInvoiceNumber,
        broj_racuna:
          input.finalInvoice.officialInvoiceNumber ?? invoice.broj_racuna,
        iic: input.finalInvoice.iic,
        jikr: input.finalInvoice.jikr,
        qr_code_data: input.finalInvoice.qrCodeData,
        correlation_id: input.correlationId,
        fiscalized_at: new Date(),
        last_fiscal_attempt_at: new Date(),
        fiscal_error_code: null,
        fiscal_error_message: null,
        updated_by: context.userId
      }
    });
    await tx.fiscalizationAttempt.update({
      where: { idempotency_key: input.attemptKey },
      data: {
        status: "SUCCEEDED",
        fiscal_api_invoice_id: input.fiscalInvoiceId,
        correlation_id: input.correlationId,
        finished_at: new Date(),
        duration_ms: Date.now() - input.startedAt
      }
    });
  });
}

type ConfirmedOutgoingFiscalResult = {
  fiscalInvoiceId: string;
  environment: "Test" | "Production";
  finalInvoice: FiscalInvoice & {
    iic: string;
    jikr: string;
    qrCodeData: string;
  };
  correlationId: string | null;
};

async function preserveConfirmedOutgoingFiscalResult(input: {
  context: OutgoingInvoiceServiceContext;
  invoiceId: string;
  attemptKey: string;
  startedAt: number;
  result: ConfirmedOutgoingFiscalResult;
}) {
  const now = new Date();
  await prisma.fiskalniIzlazniRacun.update({
    where: { id: input.invoiceId },
    data: {
      fiscal_api_invoice_id: input.result.fiscalInvoiceId,
      fiscal_status: "Fiscalized",
      fiscal_environment: input.result.environment,
      official_invoice_number:
        input.result.finalInvoice.officialInvoiceNumber,
      broj_racuna:
        input.result.finalInvoice.officialInvoiceNumber ?? undefined,
      iic: input.result.finalInvoice.iic,
      jikr: input.result.finalInvoice.jikr,
      qr_code_data: input.result.finalInvoice.qrCodeData,
      correlation_id: input.result.correlationId,
      fiscalized_at: now,
      last_fiscal_attempt_at: now,
      fiscal_error_code: "LOCAL_RECONCILIATION_REQUIRED",
      fiscal_error_message:
        "Fiskalizacija je potvrđena, ali lokalna obrada zahtijeva usklađivanje.",
      updated_by: input.context.userId
    }
  });
  await prisma.fiscalizationAttempt.updateMany({
    where: { idempotency_key: input.attemptKey },
    data: {
      status: "SUCCEEDED",
      fiscal_api_invoice_id: input.result.fiscalInvoiceId,
      correlation_id: input.result.correlationId,
      error_code: "LOCAL_RECONCILIATION_REQUIRED",
      error_message:
        "Remote fiskalni rezultat je potvrđen; lokalna obrada nije kompletna.",
      finished_at: now,
      duration_ms: Date.now() - input.startedAt
    }
  });
}

async function finalizeFiscalOnlyInvoice(input: {
  context: OutgoingInvoiceServiceContext;
  invoiceId: string;
}) {
  const { context, invoiceId } = input;
  return prisma.$transaction(async (tx) => {
    await lockInvoice(tx, invoiceId);
    const invoice = await tx.fiskalniIzlazniRacun.findFirst({
      where: { id: invoiceId, ...invoiceScope(context) },
      include: { magacin: true, firma: { select: { dozvoli_negativan_lager: true } } }
    });
    if (!invoice || invoice.fiscal_status !== "Fiscalized") {
      throw new OutgoingInvoiceServiceError("lokalni_zavrsetak");
    }
    if (invoice.status === "FINALIZED") return { alreadyFinalized: true };
    await applyOutgoingInvoiceInventoryMovement(tx, {
      agencijaId: context.agencijaId,
      firmaId: context.firmaId,
      poslovnaGodinaId: context.poslovnaGodinaId,
      magacinId: invoice.magacin_id,
      invoiceId: invoice.id,
      datumPrometa: invoice.datum_prometa,
      allowNegative:
        invoice.magacin?.dozvoli_negativan_lager ??
        invoice.firma.dozvoli_negativan_lager,
      userId: context.userId
    });
    await tx.fiskalniIzlazniRacun.update({
      where: { id: invoice.id },
      data: {
        status: "FINALIZED",
        kif_status: "NOT_REQUIRED",
        nalog_id: null,
        kif_entry_id: null,
        updated_by: context.userId
      }
    });
    return { alreadyFinalized: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function recoverFiscalOnlyFinalization(input: {
  context: OutgoingInvoiceServiceContext;
  invoiceId: string;
}) {
  try {
    await finalizeFiscalOnlyInvoice(input);
  } catch {
    await auditInvoice({
      context: input.context,
      action: "finalize_outgoing_invoice_failed",
      invoiceId: input.invoiceId,
      newValue: { code: "LOCAL_FINALIZATION_FAILED", recovered: true }
    });
    throw new OutgoingInvoiceServiceError("lokalni_zavrsetak");
  }
}

async function recordFiscalFailure(input: {
  context: OutgoingInvoiceServiceContext;
  invoiceId: string;
  attemptKey: string;
  remoteInvoiceId: string | null;
  correlationId: string | null;
  error: FiscalAdminApiError;
  startedAt: number;
}) {
  await prisma.$transaction([
    prisma.fiskalniIzlazniRacun.updateMany({
      where: {
        id: input.invoiceId,
        ...invoiceScope(input.context),
        fiscal_status: { not: "Fiscalized" }
      },
      data: {
        fiscal_api_invoice_id: input.remoteInvoiceId,
        fiscal_status: "FiscalizationFailed",
        fiscal_error_code: input.error.code,
        fiscal_error_message: input.error.message,
        correlation_id: input.correlationId,
        last_fiscal_attempt_at: new Date(),
        updated_by: input.context.userId
      }
    }),
    prisma.fiscalizationAttempt.update({
      where: { idempotency_key: input.attemptKey },
      data: {
        status: "FAILED",
        fiscal_api_invoice_id: input.remoteInvoiceId,
        error_code: input.error.code,
        error_message: input.error.message,
        correlation_id: input.correlationId,
        finished_at: new Date(),
        duration_ms: Date.now() - input.startedAt
      }
    })
  ]);
  await auditInvoice({
    context: input.context,
    action: "fiscalize_outgoing_invoice_failed",
    invoiceId: input.invoiceId,
    newValue: {
      code: input.error.code,
      correlationId: input.correlationId,
      fiscalInvoiceId: input.remoteInvoiceId
    }
  });
}

export async function fiscalizeOutgoingInvoiceDocument(input: {
  context: OutgoingInvoiceServiceContext;
  formData: FormData;
  options: OutgoingInvoiceServiceOptions;
}): Promise<OutgoingInvoiceFiscalizationResult> {
  const { context, formData, options } = input;
  const invoiceId = text(formData, "faktura_id");
  const confirmation = text(formData, "confirmation");
  const expectedUpdatedAt = text(formData, "expected_updated_at");
  const reviewed = text(formData, "reviewed");
  const { firma } = await loadFirmAndYear(context);
  let invoice = await loadFiscalInvoice(context, invoiceId);
  if (!invoice) throw new OutgoingInvoiceServiceError("nije_nacrt");
  if (options.accountingMode === "FISCAL_ONLY" && reviewed !== "yes") {
    throw new OutgoingInvoiceServiceError("potvrda");
  }

  if (invoice.fiskalizacija_rezim !== outgoingInvoiceFiscalModes.summa) {
    throw new OutgoingInvoiceServiceError("fiskalizacija_nije_summa");
  }
  const link = invoice.firma.fiscalCompanyLink;
  if (!link?.fiscal_api_company_id) {
    throw new OutgoingInvoiceServiceError("fiskalizacija_nije_podesena");
  }
  if (link.is_suspended) {
    throw new OutgoingInvoiceServiceError("fiskalizacija_suspendovana");
  }
  if (!firma.pib) throw new OutgoingInvoiceServiceError("fiskalizacija_pib");

  if (invoice.fiscal_status === "Fiscalized") {
    if (options.accountingMode === "FISCAL_ONLY") {
      await recoverFiscalOnlyFinalization({ context, invoiceId });
    }
    return { status: "fiscalized", invoiceId, existing: true };
  }
  if (
    invoice.fiscal_status === "FiscalizationPending" &&
    invoice.last_fiscal_attempt_at &&
    invoice.last_fiscal_attempt_at >=
      new Date(Date.now() - staleFiscalAttemptMs)
  ) {
    return { status: "pending", invoiceId, existing: true };
  }

  if (options.accountingMode === "FISCAL_ONLY") {
    verifyDirectConfirmation({
      environment: invoice.fiscal_environment ?? link.fiscal_environment,
      confirmation,
      expectedUpdatedAt,
      invoiceUpdatedAt: invoice.updated_at
    });
  }
  await preflightOutgoingInvoice({ context, invoice, options });

  const claim = await claimFiscalization({
    context,
    invoiceId,
    options,
    confirmation,
    expectedUpdatedAt
  });
  if (claim.kind === "pending") {
    return { status: "pending", invoiceId, existing: true };
  }
  if (claim.kind === "fiscalized") {
    if (options.accountingMode === "FISCAL_ONLY") {
      await recoverFiscalOnlyFinalization({ context, invoiceId });
    }
    return { status: "fiscalized", invoiceId, existing: true };
  }

  invoice = await loadFiscalInvoice(context, invoiceId);
  if (!invoice) throw new OutgoingInvoiceServiceError("nije_nacrt");
  const startedAt = Date.now();
  const actor = { id: context.userId, name: context.userName };
  let remoteInvoiceId = invoice.fiscal_api_invoice_id;
  let correlationId = invoice.correlation_id;
  let fiscalResultPersisted = false;
  let confirmedRemoteResult: ConfirmedOutgoingFiscalResult | null = null;

  try {
    const [companyResponse, readiness, units, devices, operators] =
      await Promise.all([
        fiscalAdminApi.getCompany(link.fiscal_api_company_id, actor),
        fiscalAdminApi.getReadiness(link.fiscal_api_company_id, actor),
        fiscalAdminApi.listBusinessUnits(link.fiscal_api_company_id, actor),
        fiscalAdminApi.listDevices(link.fiscal_api_company_id, actor),
        fiscalAdminApi.listOperators(link.fiscal_api_company_id, actor)
      ]);
    const company = companyResponse.data;
    if (!company.isActive || !readiness.data.isReady) {
      throw new FiscalAdminApiError(
        "COMPANY_NOT_READY",
        "Firma nije spremna za fiskalizaciju."
      );
    }
    if (
      options.accountingMode === "FISCAL_ONLY" &&
      confirmation !== expectedConfirmation(company.environment)
    ) {
      throw new FiscalAdminApiError(
        "FISCAL_CONFIRMATION_INVALID",
        "Potvrda fiskalnog okruzenja nije ispravna."
      );
    }
    const environmentSnapshot = await lockFiscalEnvironmentSnapshot({
      context,
      invoiceId,
      environment: company.environment
    });
    const unit = units.data.find(
      (item) =>
        item.isActive &&
        (!item.environment || item.environment === company.environment)
    );
    const device = devices.data.find(
      (item) => item.isActive && item.businessUnitId === unit?.id
    );
    const operator = operators.data.find(
      (item) =>
        item.isActive &&
        (!item.environment || item.environment === company.environment)
    );
    if (!unit || !device || !operator) {
      throw new FiscalAdminApiError(
        "FISCAL_CONFIGURATION_MISSING",
        "Nedostaje aktivna poslovna jedinica, ENU ili operater."
      );
    }

    let finalInvoice: FiscalInvoice | null = null;
    if (remoteInvoiceId) {
      const response = await fiscalAdminApi.getInvoice(remoteInvoiceId, actor);
      finalInvoice = response.data;
      correlationId = response.correlationId ?? correlationId;
    } else {
      const created = await fiscalAdminApi.createInvoice(
        {
          companyId: link.fiscal_api_company_id,
          businessUnitId: unit.id,
          deviceId: device.id,
          operatorId: operator.id,
          invoiceType: "Normal",
          invoiceNumber: "",
          issueDateTime: invoice.issued_at!.toISOString(),
          currency: "EUR",
          buyer: invoice.kupac.pib
            ? {
                identificationType: "Tin",
                identificationNumber: invoice.kupac.pib,
                name: invoice.kupac.naziv,
                address: invoice.kupac.adresa ?? null,
                town: invoice.kupac.grad ?? null,
                country:
                  invoice.kupac.drzava?.toUpperCase() === "CRNA GORA"
                    ? "MNE"
                    : invoice.kupac.country_code ?? "MNE",
                taxIdentificationCode: invoice.kupac.pdv_broj ?? null
              }
            : null,
          supplyPeriodStart: invoice.datum_prometa.toISOString().slice(0, 10),
          supplyPeriodEnd: invoice.datum_prometa.toISOString().slice(0, 10),
          paymentDeadline: (invoice.datum_valute ?? invoice.datum_racuna)
            .toISOString()
            .slice(0, 10),
          items: invoice.stavke.map((line) => ({
            name: line.naziv_artikla,
            quantity: apiNumber(line.kolicina),
            unitPrice: apiNumber(line.jedinicna_cijena_sa_pdv),
            vatRate: apiNumber(line.pdv_stopa_procenat),
            itemCode: line.sifra_artikla,
            unitOfMeasure: line.jedinica_mjere,
            discountAmount: grossDiscountAmount(line)
          })),
          payments: [
            {
              paymentType: paymentType(invoice.nacin_placanja),
              amount: apiNumber(invoice.ukupno_sa_pdv),
              reference: invoice.interni_broj
            }
          ]
        },
        invoice.idempotency_key!,
        actor
      );
      remoteInvoiceId = created.data.id;
      finalInvoice = created.data;
      correlationId = created.correlationId ?? correlationId;
      await prisma.$transaction([
        prisma.fiskalniIzlazniRacun.update({
          where: { id: invoice.id },
          data: {
            fiscal_api_invoice_id: remoteInvoiceId,
            official_invoice_number: created.data.officialInvoiceNumber,
            correlation_id: correlationId,
            last_fiscal_attempt_at: new Date(),
            updated_by: context.userId
          }
        }),
        prisma.fiscalizationAttempt.update({
          where: { idempotency_key: claim.attemptKey },
          data: {
            fiscal_api_invoice_id: remoteInvoiceId,
            correlation_id: correlationId
          }
        })
      ]);
    }

    if (finalInvoice.status !== "Fiscalized") {
      const fiscalConfirmation = company.environment === "Production"
        ? `FISCALIZE_PRODUCTION:${firma.pib}:${remoteInvoiceId}`
        : `FISCALIZE_TEST:${remoteInvoiceId}`;
      const submitted = await fiscalAdminApi.fiscalizeInvoice(
        remoteInvoiceId!,
        fiscalConfirmation,
        actor
      );
      correlationId = submitted.correlationId ?? correlationId;
      if (
        !submitted.data.isSuccess ||
        submitted.data.status !== "Fiscalized" ||
        !submitted.data.jikr
      ) {
        throw new FiscalAdminApiError(
          submitted.data.faultCode ?? "FISCALIZATION_FAILED",
          submitted.data.faultMessage ?? "Racun nije fiskalizovan.",
          submitted.correlationId
        );
      }
      const response = await fiscalAdminApi.getInvoice(remoteInvoiceId!, actor);
      finalInvoice = response.data;
      correlationId = response.correlationId ?? correlationId;
    }
    if (
      finalInvoice.status !== "Fiscalized" ||
      !finalInvoice.iic ||
      !finalInvoice.jikr ||
      !finalInvoice.qrCodeData
    ) {
      throw new FiscalAdminApiError(
        "FISCAL_RESULT_INCOMPLETE",
        "Fiscal API nije vratio kompletan IKOF, JIKR i QR podatak.",
        correlationId ?? undefined
      );
    }
    confirmedRemoteResult = {
      fiscalInvoiceId: remoteInvoiceId!,
      environment: environmentSnapshot,
      finalInvoice: {
        ...finalInvoice,
        iic: finalInvoice.iic,
        jikr: finalInvoice.jikr,
        qrCodeData: finalInvoice.qrCodeData
      },
      correlationId
    };

    await persistFiscalResult({
      context,
      invoice,
      attemptKey: claim.attemptKey,
      fiscalInvoiceId: remoteInvoiceId!,
      finalInvoice,
      environment: environmentSnapshot,
      correlationId,
      startedAt
    });
    fiscalResultPersisted = true;

    if (options.accountingMode === "FISCAL_ONLY") {
      await finalizeFiscalOnlyInvoice({ context, invoiceId });
    }
    await auditInvoice({
      context,
      action: "fiscalize_outgoing_invoice",
      invoiceId,
      newValue: {
        fiscalInvoiceId: remoteInvoiceId,
        environment: company.environment,
        officialInvoiceNumber: finalInvoice.officialInvoiceNumber,
        iic: finalInvoice.iic,
        jikr: finalInvoice.jikr,
        accountingMode: options.accountingMode
      }
    });
    return { status: "fiscalized", invoiceId, existing: false };
  } catch (error) {
    if (fiscalResultPersisted) {
      await auditInvoice({
        context,
        action: "finalize_outgoing_invoice_failed",
        invoiceId,
        newValue: {
          code: "LOCAL_FINALIZATION_FAILED",
          correlationId,
          fiscalInvoiceId: remoteInvoiceId
        }
      });
      throw new OutgoingInvoiceServiceError("lokalni_zavrsetak");
    }
    if (confirmedRemoteResult) {
      await preserveConfirmedOutgoingFiscalResult({
        context,
        invoiceId,
        attemptKey: claim.attemptKey,
        startedAt,
        result: confirmedRemoteResult
      });
      try {
        await auditInvoice({
          context,
          action: "fiscalize_outgoing_invoice_local_reconciliation_required",
          invoiceId,
          newValue: {
            code: "LOCAL_RECONCILIATION_REQUIRED",
            correlationId: confirmedRemoteResult.correlationId,
            fiscalInvoiceId: confirmedRemoteResult.fiscalInvoiceId,
            environment: confirmedRemoteResult.environment
          }
        });
      } catch {
        // Potvrđeni fiskalni rezultat ostaje sačuvan i ako audit privremeno padne.
      }
      throw new OutgoingInvoiceServiceError("lokalni_zavrsetak");
    }
    const fiscalError = error instanceof FiscalAdminApiError
      ? error
      : new FiscalAdminApiError(
          "FISCALIZATION_FAILED",
          "Fiskalizacija nije uspjela.",
          correlationId ?? undefined
        );
    await recordFiscalFailure({
      context,
      invoiceId,
      attemptKey: claim.attemptKey,
      remoteInvoiceId,
      correlationId: fiscalError.correlationId ?? correlationId,
      error: fiscalError,
      startedAt
    });
    return {
      status: "failed",
      invoiceId,
      existing: false,
      errorCode: fiscalError.code,
      correlationId: fiscalError.correlationId ?? correlationId
    };
  }
}
