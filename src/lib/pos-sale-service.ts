import "server-only";

import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { auditLog } from "@/lib/audit";
import {
  fiscalAdminApi,
  FiscalAdminApiError,
  type FiscalCompany
} from "@/lib/fiscal-admin-api";
import {
  decimalToScaled,
  scaledToDecimal
} from "@/lib/inventory-calculation";
import {
  calculateOutgoingInvoiceLine,
  calculateOutgoingInvoiceLineFromGross
} from "@/lib/outgoing-invoice";
import { applyPosInventoryMovement } from "@/lib/pos-inventory";
import {
  normalizeWarehouseSalesType,
  selectPosPrice,
  warehouseSalesTypes
} from "@/lib/pos-pricing";
import { finalizePosTransferAccounting } from "@/lib/pos-transfer-accounting";
import { posModule } from "@/lib/pos";
import { prisma } from "@/lib/prisma";
import { podgoricaBusinessDate } from "@/lib/direct-portal-policy";
import {
  buildPosSaleIdempotencyKey,
  isValidPosSubmissionId
} from "@/lib/pos-sale-policy";

type PosLine = {
  itemId?: string;
  quantity?: number;
};

type PosSaleContext = {
  agencijaId: string;
  firmaId: string;
  poslovnaGodinaId: string;
  userId: string;
  userName: string;
};

type PosSaleValidationCode =
  | "cijena"
  | "iznos"
  | "ino_kupac"
  | "kupac"
  | "lager"
  | "magacin"
  | "placanje"
  | "podesavanje"
  | "prava"
  | "smjena"
  | "stavke"
  | "submission";

export type PosSaleResult =
  | {
      status: "fiscalized";
      invoiceId: string;
      accountingIssue: string | null;
      existing: boolean;
    }
  | {
      status: "failed" | "pending";
      invoiceId: string;
      existing: boolean;
    };

export type PosRetryResult =
  | { status: "fiscalized"; invoiceId: string; correlationId: string | null }
  | { status: "failed" | "pending"; invoiceId: string; correlationId: string | null };

export class PosSaleValidationError extends Error {
  readonly code: PosSaleValidationCode;

  constructor(code: PosSaleValidationCode) {
    super(`POS prodaja nije prihvaćena: ${code}`);
    this.name = "PosSaleValidationError";
    this.code = code;
  }
}

const paymentTypes: Record<string, string> = {
  CASH: "Cash",
  CARD: "Card",
  BANK_TRANSFER: "BankAccount",
  OTHER: "Other"
};

function input(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function apiNumber(value: { toString(): string }) {
  return Number(value.toString());
}

function existingResult(invoice: {
  id: string;
  fiscal_status: string;
}): PosSaleResult {
  if (invoice.fiscal_status === "Fiscalized") {
    return {
      status: "fiscalized",
      invoiceId: invoice.id,
      accountingIssue: null,
      existing: true
    };
  }

  return {
    status:
      invoice.fiscal_status === "FiscalizationFailed"
        ? "failed"
        : "pending",
    invoiceId: invoice.id,
    existing: true
  };
}

async function validatePosStockBeforeFiscalization(input: {
  agencijaId: string;
  firmaId: string;
  poslovnaGodinaId: string;
  magacinId: string | null;
  allowNegativeStock: boolean;
  lines: Array<{
    artikalId: string;
    naziv: string;
    quantity: { toString(): string };
    tracksStock: boolean;
  }>;
}) {
  const requested = new Map<string, { naziv: string; quantity: bigint }>();

  for (const line of input.lines) {
    if (!line.tracksStock) continue;
    const previous = requested.get(line.artikalId);
    requested.set(line.artikalId, {
      naziv: line.naziv,
      quantity:
        (previous?.quantity ?? BigInt(0)) +
        decimalToScaled(line.quantity, 3)
    });
  }

  if (!requested.size) return null;
  if (!input.magacinId) return "magacin" as const;
  if (input.allowNegativeStock) return null;

  const stock = await prisma.stanjeZaliha.findMany({
    where: {
      agencija_id: input.agencijaId,
      firma_id: input.firmaId,
      poslovna_godina_id: input.poslovnaGodinaId,
      magacin_id: input.magacinId,
      artikal_id: { in: [...requested.keys()] }
    },
    select: { artikal_id: true, kolicina: true }
  });
  const available = new Map(
    stock.map((row) => [row.artikal_id, decimalToScaled(row.kolicina, 3)])
  );

  return [...requested.entries()].some(
    ([artikalId, value]) =>
      (available.get(artikalId) ?? BigInt(0)) < value.quantity
  )
    ? ("lager" as const)
    : null;
}

async function enforceDirectPaymentPolicy(input: {
  fiscalCompanyId: string;
  fiscalEnvironment: "Test" | "Production";
  paymentMethod: string;
  actor: { id: string; name: string };
}) {
  if (input.fiscalEnvironment === "Test") {
    if (!["CASH", "CARD", "BANK_TRANSFER"].includes(input.paymentMethod)) {
      throw new PosSaleValidationError("placanje");
    }
    return;
  }

  let paymentPolicy: string | null | undefined;

  try {
    const response = await fiscalAdminApi.getProductionProfile(
      input.fiscalCompanyId,
      input.actor
    );
    paymentPolicy = response.data.paymentPolicy?.trim();
  } catch {
    throw new PosSaleValidationError("placanje");
  }

  if (paymentPolicy?.toLowerCase() === "bankonly") {
    if (input.paymentMethod !== "BANK_TRANSFER") {
      throw new PosSaleValidationError("placanje");
    }
    return;
  }

  if (!paymentPolicy) {
    if (
      !["CASH", "CARD", "BANK_TRANSFER"].includes(input.paymentMethod)
    ) {
      throw new PosSaleValidationError("placanje");
    }
    return;
  }

  throw new PosSaleValidationError("placanje");
}

function fiscalEnvironment(value: string | null | undefined) {
  if (value === "Test" || value === "Production") return value;
  throw new PosSaleValidationError("podesavanje");
}

async function finishTransferAccounting(input: {
  invoiceId: string;
  paymentMethod: string;
  enabled: boolean;
  context: PosSaleContext;
  year: number;
}) {
  if (!input.enabled || input.paymentMethod !== "BANK_TRANSFER") return null;

  try {
    const result = await finalizePosTransferAccounting({
      invoiceId: input.invoiceId,
      agencijaId: input.context.agencijaId,
      firmaId: input.context.firmaId,
      poslovnaGodinaId: input.context.poslovnaGodinaId,
      year: input.year,
      userId: input.context.userId
    });
    return result.ok ? null : result.reason;
  } catch {
    return "neocekivano";
  }
}

type ConfirmedPosFiscalResult = {
  fiscalInvoiceId: string;
  environment: "Test" | "Production";
  officialInvoiceNumber: string | null;
  iic: string;
  jikr: string;
  qrCodeData: string;
  correlationId: string | null;
};

async function preserveConfirmedPosFiscalResult(input: {
  invoiceId: string;
  attemptKey: string;
  userId: string;
  accountingMode: "CONFIGURED" | "FISCAL_ONLY";
  result: ConfirmedPosFiscalResult;
  started: number;
}) {
  const now = new Date();
  await prisma.fiskalniIzlazniRacun.update({
    where: { id: input.invoiceId },
    data: {
      fiscal_api_invoice_id: input.result.fiscalInvoiceId,
      fiscal_status: "Fiscalized",
      fiscal_environment: input.result.environment,
      official_invoice_number: input.result.officialInvoiceNumber,
      broj_racuna: input.result.officialInvoiceNumber ?? undefined,
      iic: input.result.iic,
      jikr: input.result.jikr,
      qr_code_data: input.result.qrCodeData,
      correlation_id: input.result.correlationId,
      fiscalized_at: now,
      last_fiscal_attempt_at: now,
      fiscal_error_code: "LOCAL_RECONCILIATION_REQUIRED",
      fiscal_error_message:
        "Fiskalizacija je potvrÄ‘ena, ali lokalna obrada zahtijeva usklaÄ‘ivanje.",
      ...(input.accountingMode === "FISCAL_ONLY"
        ? { status: "FINALIZED" }
        : {}),
      updated_by: input.userId
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
        "Remote fiskalni rezultat je potvrÄ‘en; lokalna obrada nije kompletna.",
      finished_at: now,
      duration_ms: Date.now() - input.started
    }
  });
}

async function auditConfirmedPosRecovery(input: {
  context: PosSaleContext;
  invoiceId: string;
  result: ConfirmedPosFiscalResult;
}) {
  try {
    await auditLog({
      korisnikId: input.context.userId,
      agencijaId: input.context.agencijaId,
      firmaId: input.context.firmaId,
      modul: posModule,
      akcija: "pos_sale_local_reconciliation_required",
      tipEntiteta: "FiskalniIzlazniRacun",
      entitetId: input.invoiceId,
      novaVrijednost: {
        fiscalInvoiceId: input.result.fiscalInvoiceId,
        environment: input.result.environment,
        correlationId: input.result.correlationId
      }
    });
  } catch {
    // Fiskalni rezultat je veÄ‡ trajno saÄuvan; audit kvar ga ne smije poniÅ¡titi.
  }
}

export async function createAndFiscalizePosSale(inputData: {
  context: PosSaleContext;
  formData: FormData;
  accountingMode: "CONFIGURED" | "FISCAL_ONLY";
  partnerAccess: "AGENCY" | "DIRECT";
}): Promise<PosSaleResult> {
  const { context, formData } = inputData;
  const submittedId = input(formData, "submission_id");
  const submissionId =
    submittedId ||
    (inputData.partnerAccess === "AGENCY" ? randomUUID() : "");

  if (!isValidPosSubmissionId(submissionId)) {
    throw new PosSaleValidationError("submission");
  }

  const idempotencyKey = buildPosSaleIdempotencyKey(
    context.firmaId,
    submissionId
  );
  const now = new Date();
  const day = podgoricaBusinessDate(now);
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

  if (
    !firma ||
    !year ||
    year.zakljucena ||
    day < year.datum_od ||
    day > year.datum_do
  ) {
    throw new PosSaleValidationError("prava");
  }

  const existing = await prisma.fiskalniIzlazniRacun.findFirst({
    where: {
      agencija_id: context.agencijaId,
      firma_id: firma.id,
      poslovna_godina_id: year.id,
      sales_channel: "POS",
      document_type: "POS_RECEIPT",
      idempotency_key: idempotencyKey
    },
    select: { id: true, fiscal_status: true }
  });

  if (existing) return existingResult(existing);

  const registerId = input(formData, "register_id");
  const paymentMethod = input(formData, "payment_method");
  const buyerId = input(formData, "buyer_id");
  let submitted: PosLine[] = [];

  try {
    const parsed = JSON.parse(input(formData, "lines_json"));
    if (!Array.isArray(parsed)) throw new Error("POS stavke nisu niz.");
    submitted = parsed as PosLine[];
  } catch {
    throw new PosSaleValidationError("stavke");
  }

  const clean = submitted.filter(
    (line) => line.itemId && Number(line.quantity) > 0
  );
  if (!clean.length || !paymentTypes[paymentMethod]) {
    throw new PosSaleValidationError("stavke");
  }

  const buyerScopes: Prisma.KomitentWhereInput[] =
    inputData.partnerAccess === "DIRECT"
      ? [
          { scope: "GLOBAL" },
          { scope: "COMPANY", firma_id: firma.id }
        ]
      : [
          { scope: "GLOBAL" },
          { scope: "AGENCY", agencija_id: context.agencijaId },
          { scope: "COMPANY", firma_id: firma.id }
        ];
  const [settings, register, items, selectedBuyer, bankAccount] =
    await Promise.all([
      prisma.posPodesavanje.findUnique({ where: { firma_id: firma.id } }),
      prisma.posRegister.findFirst({
        where: {
          id: registerId,
          agencija_id: context.agencijaId,
          firma_id: firma.id,
          aktivan: true,
          is_deleted: false
        },
        include: {
          magacin: {
            select: {
              dozvoli_negativan_lager: true,
              tip_prodaje: true
            }
          }
        }
      }),
      prisma.artikal.findMany({
        where: {
          id: { in: clean.map((line) => line.itemId!) },
          agencija_id: context.agencijaId,
          firma_id: firma.id,
          aktivan: true,
          is_deleted: false
        },
        include: {
          jedinica_mjere: true,
          pdv_stopa: true,
          cijene: {
            where: {
              aktivna: true,
              is_deleted: false,
              tip: {
                in: [
                  "RETAIL",
                  "MALOPRODAJNA",
                  "WHOLESALE",
                  "VELEPRODAJNA"
                ]
              },
              OR: [{ vazi_od: null }, { vazi_od: { lte: day } }],
              AND: [
                {
                  OR: [
                    { vazi_do: null },
                    { vazi_do: { gte: day } }
                  ]
                }
              ]
            },
            orderBy: [{ vazi_od: "desc" }, { created_at: "desc" }]
          }
        }
      }),
      buyerId
        ? prisma.komitent.findFirst({
            where: {
              id: buyerId,
              aktivan: true,
              OR: buyerScopes
            },
            select: {
              id: true,
              naziv: true,
              pib: true,
              pdv_broj: true,
              adresa: true,
              grad: true,
              drzava: true,
              country_code: true,
              telefon: true,
              email: true,
              is_foreign: true
            }
          })
        : null,
      prisma.firmaBankovniRacun.findFirst({
        where: {
          firma_id: firma.id,
          aktivan: true,
          is_deleted: false
        },
        orderBy: [{ glavni: "desc" }, { created_at: "asc" }],
        select: { naziv_banke: true, broj_racuna: true }
      })
    ]);

  const fiscalCompanyId =
    firma.fiscalCompanyLink?.fiscal_api_company_id ?? null;
  if (
    !settings?.aktivan ||
    !register ||
    !fiscalCompanyId ||
    firma.fiscalCompanyLink?.is_suspended
  ) {
    throw new PosSaleValidationError("podesavanje");
  }

  const actor = { id: context.userId, name: context.userName };
  let company: FiscalCompany;
  try {
    company = (await fiscalAdminApi.getCompany(fiscalCompanyId, actor)).data;
  } catch {
    throw new PosSaleValidationError("podesavanje");
  }
  if (!company.isActive) throw new PosSaleValidationError("podesavanje");
  const environment = fiscalEnvironment(company.environment);

  if (inputData.partnerAccess === "DIRECT") {
    await enforceDirectPaymentPolicy({
      fiscalCompanyId,
      fiscalEnvironment: environment,
      paymentMethod,
      actor
    });
  }

  if (settings.zahtijeva_smjenu) {
    const shift = await prisma.posSmjena.findFirst({
      where: {
        agencija_id: context.agencijaId,
        firma_id: firma.id,
        poslovna_godina_id: year.id,
        pos_register_id: register.id,
        opened_by: context.userId,
        status: "OPEN"
      },
      select: { id: true }
    });
    if (!shift) throw new PosSaleValidationError("smjena");
  }

  if (
    (buyerId && !selectedBuyer) ||
    (paymentMethod === "BANK_TRANSFER" && !selectedBuyer)
  ) {
    throw new PosSaleValidationError("kupac");
  }

  if (
    inputData.partnerAccess === "DIRECT" &&
    selectedBuyer &&
    (selectedBuyer.is_foreign ||
      Boolean(
        selectedBuyer.country_code &&
          selectedBuyer.country_code.toUpperCase() !== "MNE"
      ))
  ) {
    throw new PosSaleValidationError("ino_kupac");
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  const warehouseType = normalizeWarehouseSalesType(
    register.magacin?.tip_prodaje
  );
  const rows: Prisma.StavkaIzlazneFaktureCreateManyInput[] = [];
  let discount = BigInt(0);
  let base = BigInt(0);
  let vat = BigInt(0);
  let total = BigInt(0);

  for (let index = 0; index < clean.length; index += 1) {
    const source = clean[index];
    const item = byId.get(source.itemId!);
    const price = item
      ? selectPosPrice(item.cijene, register.magacin_id, warehouseType)
      : null;
    if (!item?.pdv_stopa || !price) {
      throw new PosSaleValidationError("cijena");
    }

    const vatPercent = firma.pdv_obveznik
      ? item.pdv_stopa.procenat.toString()
      : "0";
    const calculated =
      warehouseType === warehouseSalesTypes.retail
        ? calculateOutgoingInvoiceLineFromGross({
            quantity: String(source.quantity),
            grossUnitPrice: price.cijena_sa_pdv.toString(),
            discountPercent: "0",
            vatPercent
          })
        : calculateOutgoingInvoiceLine({
            quantity: String(source.quantity),
            netUnitPrice: price.cijena_bez_pdv.toString(),
            discountPercent: "0",
            vatPercent
          });
    if (!calculated) throw new PosSaleValidationError("iznos");

    discount += calculated.discountCents;
    base += calculated.baseCents;
    vat += calculated.vatCents;
    total += calculated.totalCents;
    rows.push({
      izlazna_faktura_id: "00000000-0000-0000-0000-000000000000",
      redni_broj: index + 1,
      artikal_id: item.id,
      sifra_artikla: item.sifra,
      naziv_artikla: item.naziv,
      jedinica_mjere: item.jedinica_mjere.oznaka,
      usluga: item.usluga,
      kolicina: calculated.quantity,
      jedinicna_cijena_bez_pdv: calculated.unitNet,
      rabat_procenat: calculated.discountPercent,
      rabat_iznos: calculated.discount,
      osnovica: calculated.base,
      pdv_stopa_id: item.pdv_stopa.id,
      pdv_stopa_sifra: item.pdv_stopa.sifra,
      pdv_stopa_naziv: item.pdv_stopa.naziv,
      pdv_stopa_procenat: firma.pdv_obveznik
        ? item.pdv_stopa.procenat
        : 0,
      pdv_iznos: calculated.vat,
      jedinicna_cijena_sa_pdv: calculated.unitGross,
      ukupno_sa_pdv: calculated.total,
      created_by: context.userId,
      updated_by: context.userId
    });
  }

  const effectiveAllowNegative =
    register.magacin?.dozvoli_negativan_lager ??
    firma.dozvoli_negativan_lager;
  const stockError = await validatePosStockBeforeFiscalization({
    agencijaId: context.agencijaId,
    firmaId: firma.id,
    poslovnaGodinaId: year.id,
    magacinId: register.magacin_id,
    allowNegativeStock: effectiveAllowNegative,
    lines: rows.map((row) => {
      const item = byId.get(row.artikal_id!);
      return {
        artikalId: row.artikal_id!,
        naziv: row.naziv_artikla,
        quantity: row.kolicina,
        tracksStock: Boolean(
          item && !item.usluga && item.prati_zalihe
        )
      };
    })
  });
  if (stockError) throw new PosSaleValidationError(stockError);

  const dueDate = new Date(day);
  if (paymentMethod === "BANK_TRANSFER") {
    dueDate.setUTCDate(dueDate.getUTCDate() + 7);
  }
  const accountingEnabled =
    inputData.accountingMode === "CONFIGURED" &&
    settings.racunovodstvena_integracija;

  const prepared = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${idempotencyKey}))`;
    const duplicate = await tx.fiskalniIzlazniRacun.findFirst({
      where: {
        agencija_id: context.agencijaId,
        firma_id: firma.id,
        poslovna_godina_id: year.id,
        sales_channel: "POS",
        document_type: "POS_RECEIPT",
        idempotency_key: idempotencyKey
      },
      select: { id: true, fiscal_status: true }
    });
    if (duplicate) {
      return { kind: "existing" as const, invoice: duplicate };
    }

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${firma.id}:${year.id}:sales`}))`;
    let buyer = selectedBuyer;
    buyer ??= await tx.komitent.findFirst({
      where: {
        firma_id: firma.id,
        scope: "COMPANY",
        naziv: "KRAJNJI POTROŠAČ",
        aktivan: true
      }
    });
    buyer ??= await tx.komitent.create({
      data: {
        naziv: "KRAJNJI POTROŠAČ",
        scope: "COMPANY",
        agencija_id: context.agencijaId,
        firma_id: firma.id
      }
    });
    const last = await tx.fiskalniIzlazniRacun.findFirst({
      where: {
        firma_id: firma.id,
        poslovna_godina_id: year.id
      },
      orderBy: { broj: "desc" },
      select: { broj: true }
    });
    const number = (last?.broj ?? 0) + 1;
    const internal = `POS-${year.godina}-${String(number).padStart(6, "0")}`;
    const accountingStatus = !accountingEnabled
      ? "NOT_REQUIRED"
      : paymentMethod === "BANK_TRANSFER"
        ? "ACCOUNTING_PENDING"
        : "WAITING_PAZAR";
    const created = await tx.fiskalniIzlazniRacun.create({
      data: {
        agencija_id: context.agencijaId,
        firma_id: firma.id,
        poslovna_godina_id: year.id,
        kupac_id: buyer.id,
        magacin_id: register.magacin_id,
        pos_register_id: register.id,
        broj: number,
        interni_broj: internal,
        broj_racuna: internal,
        datum_racuna: day,
        datum_prometa: day,
        datum_valute: dueDate,
        vrsta_racuna: "NORMAL",
        document_type: "POS_RECEIPT",
        sales_channel: "POS",
        issued_at: now,
        status: "DRAFT",
        nacin_placanja: paymentMethod,
        fiskalizacija_rezim: "SUMMA",
        vat_transaction_type: buyer.is_foreign ? "EXPORT" : "DOMESTIC",
        ukupno_osnovica: scaledToDecimal(base, 2),
        ukupno_rabat: scaledToDecimal(discount, 2),
        ukupno_izlazni_pdv: scaledToDecimal(vat, 2),
        ukupno_sa_pdv: scaledToDecimal(total, 2),
        issuer_snapshot: {
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
        },
        buyer_snapshot: {
          naziv: buyer.naziv,
          pib: buyer.pib,
          pdvBroj: buyer.pdv_broj,
          adresa: buyer.adresa,
          grad: buyer.grad,
          drzava: buyer.drzava,
          telefon: buyer.telefon,
          email: buyer.email
        },
        idempotency_key: idempotencyKey,
        fiscal_status: "FiscalizationPending",
        fiscal_environment: environment,
        kif_status: accountingStatus,
        created_by: context.userId,
        updated_by: context.userId
      }
    });
    await tx.stavkaIzlazneFakture.createMany({
      data: rows.map((row) => ({
        ...row,
        izlazna_faktura_id: created.id
      }))
    });
    await tx.salesDocumentPayment.create({
      data: {
        fiskalni_izlazni_racun_id: created.id,
        payment_method: paymentMethod,
        amount: scaledToDecimal(total, 2),
        reference: internal,
        created_by: context.userId
      }
    });
    await tx.fiscalizationAttempt.create({
      data: {
        fiskalni_izlazni_racun_id: created.id,
        attempt_number: 1,
        idempotency_key: idempotencyKey,
        status: "PENDING",
        created_by: context.userId
      }
    });
    return { kind: "created" as const, invoice: created };
  });

  if (prepared.kind === "existing") {
    return existingResult(prepared.invoice);
  }

  const invoice = prepared.invoice;
  const started = Date.now();
  let remoteInvoiceId: string | null = null;
  let confirmedFiscalResult: ConfirmedPosFiscalResult | null = null;

  try {
    const created = await fiscalAdminApi.createInvoice(
      {
        companyId: fiscalCompanyId,
        businessUnitId: register.fiscal_business_unit_id,
        deviceId: register.fiscal_device_id,
        operatorId: register.fiscal_operator_id,
        invoiceType: "Normal",
        invoiceNumber: "",
        issueDateTime: now.toISOString(),
        currency: "EUR",
        buyer: selectedBuyer?.pib
          ? {
              identificationType: "Tin",
              identificationNumber: selectedBuyer.pib,
              name: selectedBuyer.naziv,
              address: selectedBuyer.adresa ?? null,
              town: selectedBuyer.grad ?? null,
              country:
                selectedBuyer.drzava?.toUpperCase() === "CRNA GORA"
                  ? "MNE"
                  : selectedBuyer.country_code ?? "MNE",
              taxIdentificationCode: selectedBuyer.pdv_broj ?? null
            }
          : null,
        supplyPeriodStart: day.toISOString().slice(0, 10),
        supplyPeriodEnd: day.toISOString().slice(0, 10),
        paymentDeadline: dueDate.toISOString().slice(0, 10),
        items: rows.map((line) => ({
          name: line.naziv_artikla,
          quantity: apiNumber(line.kolicina as Prisma.Decimal),
          unitPrice: apiNumber(
            line.jedinicna_cijena_sa_pdv as Prisma.Decimal
          ),
          vatRate: apiNumber(line.pdv_stopa_procenat as Prisma.Decimal),
          itemCode: line.sifra_artikla,
          unitOfMeasure: line.jedinica_mjere,
          discountAmount: 0
        })),
        payments: [
          {
            paymentType: paymentTypes[paymentMethod],
            amount: Number(scaledToDecimal(total, 2)),
            reference: invoice.interni_broj
          }
        ]
      },
      idempotencyKey,
      actor
    );
    remoteInvoiceId = created.data.id;
    const confirmation =
      environment === "Production"
        ? `FISCALIZE_PRODUCTION:${firma.pib}:${created.data.id}`
        : `FISCALIZE_TEST:${created.data.id}`;
    const submittedResult = await fiscalAdminApi.fiscalizeInvoice(
      created.data.id,
      confirmation,
      actor
    );
    if (
      !submittedResult.data.isSuccess ||
      submittedResult.data.status !== "Fiscalized" ||
      !submittedResult.data.jikr
    ) {
      throw new FiscalAdminApiError(
        submittedResult.data.faultCode ?? "FISCALIZATION_FAILED",
        submittedResult.data.faultMessage ?? "Račun nije fiskalizovan.",
        submittedResult.correlationId
      );
    }
    const finalInvoice = (
      await fiscalAdminApi.getInvoice(created.data.id, actor)
    ).data;
    if (!finalInvoice.iic || !finalInvoice.jikr || !finalInvoice.qrCodeData) {
      throw new FiscalAdminApiError(
        "FISCAL_RESULT_INCOMPLETE",
        "Fiscal API nije vratio kompletan fiskalni rezultat."
      );
    }
    confirmedFiscalResult = {
      fiscalInvoiceId: created.data.id,
      environment,
      officialInvoiceNumber: finalInvoice.officialInvoiceNumber ?? null,
      iic: finalInvoice.iic,
      jikr: finalInvoice.jikr,
      qrCodeData: finalInvoice.qrCodeData,
      correlationId: submittedResult.correlationId ?? null
    };

    await prisma.$transaction(async (tx) => {
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
      for (const row of rows) {
        const code = String(row.pdv_stopa_sifra);
        const group = groups.get(code) ?? {
          name: String(row.pdv_stopa_naziv),
          percent: new Prisma.Decimal(String(row.pdv_stopa_procenat)),
          base: BigInt(0),
          vat: BigInt(0),
          total: BigInt(0)
        };
        group.base += BigInt(Math.round(Number(row.osnovica) * 100));
        group.vat += BigInt(Math.round(Number(row.pdv_iznos) * 100));
        group.total += BigInt(
          Math.round(Number(row.ukupno_sa_pdv) * 100)
        );
        groups.set(code, group);
      }
      await tx.fiskalniIzlazniRacunPorez.createMany({
        data: [...groups.entries()].map(([code, group]) => ({
          fiskalni_izlazni_racun_id: invoice.id,
          vat_rate_code: code,
          vat_rate_name: group.name,
          vat_rate_percent: group.percent,
          tax_base: scaledToDecimal(group.base, 2),
          output_vat_amount: scaledToDecimal(group.vat, 2),
          total_with_vat: scaledToDecimal(group.total, 2),
          created_by: context.userId
        }))
      });
      await tx.fiskalniIzlazniRacun.update({
        where: { id: invoice.id },
        data: {
          fiscal_api_invoice_id: created.data.id,
          fiscal_status: "Fiscalized",
          fiscal_environment: environment,
          official_invoice_number: finalInvoice.officialInvoiceNumber,
          broj_racuna:
            finalInvoice.officialInvoiceNumber ?? invoice.broj_racuna,
          iic: finalInvoice.iic,
          jikr: finalInvoice.jikr,
          qr_code_data: finalInvoice.qrCodeData,
          correlation_id: submittedResult.correlationId,
          fiscalized_at: new Date(),
          last_fiscal_attempt_at: new Date(),
          fiscal_error_code: null,
          fiscal_error_message: null,
          ...(inputData.accountingMode === "FISCAL_ONLY"
            ? { status: "FINALIZED" }
            : {}),
          updated_by: context.userId
        }
      });
      await tx.fiscalizationAttempt.update({
        where: { idempotency_key: idempotencyKey },
        data: {
          status: "SUCCEEDED",
          fiscal_api_invoice_id: created.data.id,
          correlation_id: submittedResult.correlationId,
          finished_at: new Date(),
          duration_ms: Date.now() - started
        }
      });
    });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pos-inventory:${invoice.id}`}))`;
      await applyPosInventoryMovement(tx, {
        agencijaId: context.agencijaId,
        firmaId: firma.id,
        poslovnaGodinaId: year.id,
        magacinId: register.magacin_id,
        invoiceId: invoice.id,
        datumPrometa: day,
        allowNegative: effectiveAllowNegative,
        userId: context.userId
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const accountingIssue = await finishTransferAccounting({
      invoiceId: invoice.id,
      paymentMethod,
      enabled: accountingEnabled,
      context,
      year: year.godina
    });
    await auditLog({
      korisnikId: context.userId,
      agencijaId: context.agencijaId,
      firmaId: firma.id,
      modul: posModule,
      akcija: "pos_sale_fiscalized",
      tipEntiteta: "FiskalniIzlazniRacun",
      entitetId: invoice.id,
      novaVrijednost: {
        register: register.sifra,
        paymentMethod,
        total: scaledToDecimal(total, 2),
        jikr: finalInvoice.jikr,
        environment
      }
    });

    return {
      status: "fiscalized",
      invoiceId: invoice.id,
      accountingIssue,
      existing: false
    };
  } catch (error) {
    if (confirmedFiscalResult) {
      await preserveConfirmedPosFiscalResult({
        invoiceId: invoice.id,
        attemptKey: idempotencyKey,
        userId: context.userId,
        accountingMode: inputData.accountingMode,
        result: confirmedFiscalResult,
        started
      });
      await auditConfirmedPosRecovery({
        context,
        invoiceId: invoice.id,
        result: confirmedFiscalResult
      });
      return {
        status: "fiscalized",
        invoiceId: invoice.id,
        accountingIssue: "lokalno_uskladjivanje",
        existing: false
      };
    }

    const fiscalError =
      error instanceof FiscalAdminApiError
        ? error
        : new FiscalAdminApiError(
            "FISCALIZATION_FAILED",
            "Fiskalizacija nije uspjela."
          );
    await prisma.$transaction([
      prisma.fiskalniIzlazniRacun.updateMany({
        where: { id: invoice.id, fiscal_status: { not: "Fiscalized" } },
        data: {
          fiscal_api_invoice_id: remoteInvoiceId,
          fiscal_status: "FiscalizationFailed",
          fiscal_error_code: fiscalError.code,
          fiscal_error_message: fiscalError.message,
          correlation_id: fiscalError.correlationId,
          last_fiscal_attempt_at: new Date(),
          updated_by: context.userId
        }
      }),
      prisma.fiscalizationAttempt.update({
        where: { idempotency_key: idempotencyKey },
        data: {
          status: "FAILED",
          error_code: fiscalError.code,
          error_message: fiscalError.message,
          correlation_id: fiscalError.correlationId,
          finished_at: new Date(),
          duration_ms: Date.now() - started
        }
      })
    ]);
    await auditLog({
      korisnikId: context.userId,
      agencijaId: context.agencijaId,
      firmaId: firma.id,
      modul: posModule,
      akcija: "pos_sale_fiscalization_failed",
      tipEntiteta: "FiskalniIzlazniRacun",
      entitetId: invoice.id,
      novaVrijednost: {
        code: fiscalError.code,
        remoteInvoiceId
      }
    });
    return {
      status: "failed",
      invoiceId: invoice.id,
      existing: false
    };
  }
}

export async function retryPosFiscalization(inputData: {
  context: PosSaleContext;
  invoiceId: string;
  accountingMode: "CONFIGURED" | "FISCAL_ONLY";
}): Promise<PosRetryResult> {
  const { context, invoiceId } = inputData;
  const prepared = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pos-retry:${invoiceId}`}))`;
    const invoice = await tx.fiskalniIzlazniRacun.findFirst({
      where: {
        id: invoiceId,
        agencija_id: context.agencijaId,
        firma_id: context.firmaId,
        poslovna_godina_id: context.poslovnaGodinaId,
        sales_channel: "POS",
        document_type: "POS_RECEIPT",
        fiscal_status: "FiscalizationFailed",
        is_deleted: false
      },
      include: {
        firma: { select: { pib: true, dozvoli_negativan_lager: true, fiscalCompanyLink: true } },
        pos_register: { include: { magacin: { select: { dozvoli_negativan_lager: true } } } },
        kupac: true,
        stavke: {
          orderBy: { redni_broj: "asc" },
          include: { artikal: { select: { usluga: true, prati_zalihe: true } } }
        },
        placanja: { orderBy: { redni_broj: "asc" } },
        fiskalni_pokusaji: {
          orderBy: { attempt_number: "desc" },
          take: 1,
          select: { attempt_number: true }
        }
      }
    });
    if (
      !invoice?.pos_register ||
      !invoice.idempotency_key ||
      !invoice.issued_at ||
      !invoice.placanja.length ||
      !invoice.stavke.length
    ) {
      return null;
    }
    const attemptNumber =
      (invoice.fiskalni_pokusaji[0]?.attempt_number ?? 0) + 1;
    const attemptKey = `${invoice.idempotency_key}:attempt:${attemptNumber}`;
    await tx.fiscalizationAttempt.create({
      data: {
        fiskalni_izlazni_racun_id: invoice.id,
        attempt_number: attemptNumber,
        idempotency_key: attemptKey,
        status: "PENDING",
        created_by: context.userId
      }
    });
    await tx.fiskalniIzlazniRacun.update({
      where: { id: invoice.id },
      data: {
        fiscal_status: "FiscalizationPending",
        fiscal_error_code: null,
        fiscal_error_message: null,
        last_fiscal_attempt_at: new Date(),
        updated_by: context.userId
      }
    });
    return { invoice, attemptKey };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (!prepared) throw new PosSaleValidationError("podesavanje");
  const { invoice, attemptKey } = prepared;
  const register = invoice.pos_register;
  const issuedAt = invoice.issued_at;
  const baseIdempotencyKey = invoice.idempotency_key;
  const rejectClaim = async (code: string) => {
    await prisma.$transaction([
      prisma.fiskalniIzlazniRacun.updateMany({
        where: { id: invoice.id, fiscal_status: "FiscalizationPending" },
        data: {
          fiscal_status: "FiscalizationFailed",
          fiscal_error_code: code,
          fiscal_error_message: "Ponovni pokušaj nije prošao lokalnu provjeru.",
          updated_by: context.userId
        }
      }),
      prisma.fiscalizationAttempt.update({
        where: { idempotency_key: attemptKey },
        data: {
          status: "FAILED",
          error_code: code,
          error_message: "Ponovni pokušaj nije prošao lokalnu provjeru.",
          finished_at: new Date()
        }
      })
    ]);
  };
  if (!register || !issuedAt || !baseIdempotencyKey) {
    await rejectClaim("POS_RETRY_CONFIGURATION_INVALID");
    throw new PosSaleValidationError("podesavanje");
  }
  const link = invoice.firma.fiscalCompanyLink;
  if (!link?.fiscal_api_company_id || link.is_suspended || !invoice.firma.pib) {
    await rejectClaim("POS_RETRY_FISCAL_LINK_INVALID");
    throw new PosSaleValidationError("podesavanje");
  }
  const allowNegative =
    register.magacin?.dozvoli_negativan_lager ??
    invoice.firma.dozvoli_negativan_lager;
  const stockError = await validatePosStockBeforeFiscalization({
    agencijaId: context.agencijaId,
    firmaId: context.firmaId,
    poslovnaGodinaId: context.poslovnaGodinaId,
    magacinId: invoice.magacin_id,
    allowNegativeStock: allowNegative,
    lines: invoice.stavke.map((line) => ({
      artikalId: line.artikal_id,
      naziv: line.naziv_artikla,
      quantity: line.kolicina,
      tracksStock: !line.artikal.usluga && line.artikal.prati_zalihe
    }))
  });
  if (stockError) {
    await rejectClaim(`POS_RETRY_${stockError.toUpperCase()}`);
    throw new PosSaleValidationError(stockError);
  }

  const actor = { id: context.userId, name: context.userName };
  const started = Date.now();
  let remoteInvoiceId = invoice.fiscal_api_invoice_id;
  let correlationId = invoice.correlation_id;
  let confirmed: ConfirmedPosFiscalResult | null = null;

  try {
    const [companyResponse, readiness] = await Promise.all([
      fiscalAdminApi.getCompany(link.fiscal_api_company_id, actor),
      fiscalAdminApi.getReadiness(link.fiscal_api_company_id, actor)
    ]);
    const company = companyResponse.data;
    if (!company.isActive || !readiness.data.isReady) {
      throw new FiscalAdminApiError("COMPANY_NOT_READY", "Firma nije spremna za fiskalizaciju.");
    }
    if (invoice.fiscal_environment && invoice.fiscal_environment !== company.environment) {
      throw new FiscalAdminApiError("FISCAL_ENVIRONMENT_CHANGED", "Fiskalno okruženje dokumenta se razlikuje od aktivnog okruženja.");
    }

    let remote = remoteInvoiceId
      ? (await fiscalAdminApi.getInvoice(remoteInvoiceId, actor)).data
      : null;
    if (!remote) {
      const created = await fiscalAdminApi.createInvoice({
        companyId: link.fiscal_api_company_id,
        businessUnitId: register.fiscal_business_unit_id,
        deviceId: register.fiscal_device_id,
        operatorId: register.fiscal_operator_id,
        invoiceType: "Normal",
        invoiceNumber: "",
        issueDateTime: issuedAt.toISOString(),
        currency: invoice.valuta,
        buyer: invoice.kupac.pib ? {
          identificationType: "Tin",
          identificationNumber: invoice.kupac.pib,
          name: invoice.kupac.naziv,
          address: invoice.kupac.adresa ?? null,
          town: invoice.kupac.grad ?? null,
          country: invoice.kupac.drzava?.toUpperCase() === "CRNA GORA" ? "MNE" : invoice.kupac.country_code ?? "MNE",
          taxIdentificationCode: invoice.kupac.pdv_broj ?? null
        } : null,
        supplyPeriodStart: invoice.datum_prometa.toISOString().slice(0, 10),
        supplyPeriodEnd: invoice.datum_prometa.toISOString().slice(0, 10),
        paymentDeadline: (invoice.datum_valute ?? invoice.datum_racuna).toISOString().slice(0, 10),
        items: invoice.stavke.map((line) => ({
          name: line.naziv_artikla,
          quantity: apiNumber(line.kolicina),
          unitPrice: apiNumber(line.jedinicna_cijena_sa_pdv),
          vatRate: apiNumber(line.pdv_stopa_procenat),
          itemCode: line.sifra_artikla,
          unitOfMeasure: line.jedinica_mjere,
          discountAmount: apiNumber(line.rabat_iznos)
        })),
        payments: invoice.placanja.map((payment) => ({
          paymentType: paymentTypes[payment.payment_method] ?? "Other",
          amount: apiNumber(payment.amount),
          reference: payment.reference ?? invoice.interni_broj
        }))
      }, baseIdempotencyKey, actor);
      remote = created.data;
      remoteInvoiceId = created.data.id;
      correlationId = created.correlationId ?? correlationId;
    }
    if (!remoteInvoiceId) throw new FiscalAdminApiError("FISCAL_RESULT_MISSING", "Fiscal API dokument nije pronađen.");
    if (remote.status !== "Fiscalized") {
      const confirmation = company.environment === "Production"
        ? `FISCALIZE_PRODUCTION:${invoice.firma.pib}:${remoteInvoiceId}`
        : `FISCALIZE_TEST:${remoteInvoiceId}`;
      const submitted = await fiscalAdminApi.fiscalizeInvoice(remoteInvoiceId, confirmation, actor);
      correlationId = submitted.correlationId ?? correlationId;
      if (!submitted.data.isSuccess || submitted.data.status !== "Fiscalized" || !submitted.data.jikr) {
        throw new FiscalAdminApiError(submitted.data.faultCode ?? "FISCALIZATION_FAILED", submitted.data.faultMessage ?? "Račun nije fiskalizovan.", submitted.correlationId);
      }
      remote = (await fiscalAdminApi.getInvoice(remoteInvoiceId, actor)).data;
    }
    if (!remote.iic || !remote.jikr || !remote.qrCodeData) {
      throw new FiscalAdminApiError("FISCAL_RESULT_INCOMPLETE", "Fiscal API nije vratio kompletan fiskalni rezultat.", correlationId ?? undefined);
    }
    confirmed = {
      fiscalInvoiceId: remoteInvoiceId,
      environment: company.environment,
      officialInvoiceNumber: remote.officialInvoiceNumber ?? null,
      iic: remote.iic,
      jikr: remote.jikr,
      qrCodeData: remote.qrCodeData,
      correlationId
    };

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pos-inventory:${invoice.id}`}))`;
      const groups = new Map<string, { name: string; percent: Prisma.Decimal; base: Prisma.Decimal; vat: Prisma.Decimal; total: Prisma.Decimal }>();
      for (const line of invoice.stavke) {
        const group = groups.get(line.pdv_stopa_sifra) ?? { name: line.pdv_stopa_naziv, percent: line.pdv_stopa_procenat, base: new Prisma.Decimal(0), vat: new Prisma.Decimal(0), total: new Prisma.Decimal(0) };
        group.base = group.base.plus(line.osnovica);
        group.vat = group.vat.plus(line.pdv_iznos);
        group.total = group.total.plus(line.ukupno_sa_pdv);
        groups.set(line.pdv_stopa_sifra, group);
      }
      await tx.fiskalniIzlazniRacunPorez.deleteMany({ where: { fiskalni_izlazni_racun_id: invoice.id } });
      await tx.fiskalniIzlazniRacunPorez.createMany({ data: [...groups.entries()].map(([code, group]) => ({ fiskalni_izlazni_racun_id: invoice.id, vat_rate_code: code, vat_rate_name: group.name, vat_rate_percent: group.percent, tax_base: group.base, output_vat_amount: group.vat, total_with_vat: group.total, created_by: context.userId })) });
      await applyPosInventoryMovement(tx, { agencijaId: context.agencijaId, firmaId: context.firmaId, poslovnaGodinaId: context.poslovnaGodinaId, magacinId: invoice.magacin_id, invoiceId: invoice.id, datumPrometa: invoice.datum_prometa, allowNegative, userId: context.userId });
      await tx.fiskalniIzlazniRacun.update({ where: { id: invoice.id }, data: { fiscal_api_invoice_id: remoteInvoiceId, fiscal_status: "Fiscalized", fiscal_environment: company.environment, official_invoice_number: remote.officialInvoiceNumber, broj_racuna: remote.officialInvoiceNumber ?? invoice.broj_racuna, iic: remote.iic, jikr: remote.jikr, qr_code_data: remote.qrCodeData, correlation_id: correlationId, fiscalized_at: new Date(), last_fiscal_attempt_at: new Date(), fiscal_error_code: null, fiscal_error_message: null, ...(inputData.accountingMode === "FISCAL_ONLY" ? { status: "FINALIZED", kif_status: "NOT_REQUIRED", nalog_id: null, kif_entry_id: null } : {}), updated_by: context.userId } });
      await tx.fiscalizationAttempt.update({ where: { idempotency_key: attemptKey }, data: { status: "SUCCEEDED", fiscal_api_invoice_id: remoteInvoiceId, correlation_id: correlationId, finished_at: new Date(), duration_ms: Date.now() - started } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await auditLog({ korisnikId: context.userId, agencijaId: context.agencijaId, firmaId: context.firmaId, modul: posModule, akcija: "retry_pos_fiscalization_succeeded", tipEntiteta: "FiskalniIzlazniRacun", entitetId: invoice.id, novaVrijednost: { attemptKey, fiscalInvoiceId: remoteInvoiceId, jikr: remote.jikr, recoveredExistingRemote: Boolean(invoice.fiscal_api_invoice_id) } });
    return { status: "fiscalized", invoiceId: invoice.id, correlationId };
  } catch (error) {
    if (confirmed) {
      await preserveConfirmedPosFiscalResult({ invoiceId: invoice.id, attemptKey, userId: context.userId, accountingMode: inputData.accountingMode, result: confirmed, started });
      await auditConfirmedPosRecovery({ context, invoiceId: invoice.id, result: confirmed });
      return { status: "fiscalized", invoiceId: invoice.id, correlationId: confirmed.correlationId };
    }
    const fiscalError = error instanceof FiscalAdminApiError ? error : new FiscalAdminApiError("FISCALIZATION_FAILED", "Fiskalizacija nije uspjela.", correlationId ?? undefined);
    correlationId = fiscalError.correlationId ?? correlationId;
    await prisma.$transaction([
      prisma.fiskalniIzlazniRacun.updateMany({ where: { id: invoice.id, fiscal_status: { not: "Fiscalized" } }, data: { fiscal_api_invoice_id: remoteInvoiceId, fiscal_status: "FiscalizationFailed", fiscal_error_code: fiscalError.code, fiscal_error_message: fiscalError.message, correlation_id: correlationId, last_fiscal_attempt_at: new Date(), updated_by: context.userId } }),
      prisma.fiscalizationAttempt.update({ where: { idempotency_key: attemptKey }, data: { status: "FAILED", fiscal_api_invoice_id: remoteInvoiceId, error_code: fiscalError.code, error_message: fiscalError.message, correlation_id: correlationId, finished_at: new Date(), duration_ms: Date.now() - started } })
    ]);
    await auditLog({ korisnikId: context.userId, agencijaId: context.agencijaId, firmaId: context.firmaId, modul: posModule, akcija: "retry_pos_fiscalization_failed", tipEntiteta: "FiskalniIzlazniRacun", entitetId: invoice.id, novaVrijednost: { attemptKey, fiscalInvoiceId: remoteInvoiceId, code: fiscalError.code, correlationId } });
    return { status: "failed", invoiceId: invoice.id, correlationId };
  }
}
