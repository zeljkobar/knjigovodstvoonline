"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { accountOverrideTypes } from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import {
  allocateByValue,
  calculateLineAmounts,
  calculationPostingFields,
  calculationPostingScope,
  calculationSaleTypes,
  calculationStatuses,
  decimalToScaled,
  dependentCostAllocationMethods,
  parseScaledInteger,
  roundDivision,
  scaledToDecimal
} from "@/lib/inventory-calculation";
import {
  calculateItemPriceAmounts,
  inventoryCentsToDecimal,
  inventoryModule,
  itemPriceTypes,
  normalizeInventoryCode
} from "@/lib/inventory";
import { formatJournalCode, journalStatuses, standardJournalTypes } from "@/lib/journals";
import { fetchMaprInvoice, MaprInvoiceError } from "@/lib/mapr-invoice";
import { hasPermission, type PermissionAction } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

function text(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function nullableText(value: FormDataEntryValue | null) {
  return text(value) || null;
}

function parseDate(value: FormDataEntryValue | null) {
  const normalized = text(value);
  if (!normalized) return null;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function calculationRedirect(path: string, poruka: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}poruka=${encodeURIComponent(poruka)}`);
}

function detailPath(id: string) {
  return `/agencija/robno/kalkulacije/${id}`;
}

class CalculationPostError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "CalculationPostError";
  }
}

async function requireCalculationContext(
  action: PermissionAction,
  expectedFirmaId: string,
  path: string
) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (
    !user.agencija_id ||
    !workContext.firmaId ||
    !workContext.poslovnaGodinaId ||
    workContext.firmaId !== expectedFirmaId
  ) {
    calculationRedirect(path, "kontekst");
  }

  const [firma, godina, allowed] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: expectedFirmaId,
        agencija_id: user.agencija_id,
        aktivan: true,
        is_deleted: false,
        ...(user.rola === "admin_agencije"
          ? {}
          : {
              korisnici: {
                some: { korisnik_id: user.id, is_deleted: false, moze_da_mijenja: true }
              }
            })
      },
      select: { id: true, naziv: true, pdv_obveznik: true }
    }),
    prisma.poslovnaGodina.findFirst({
      where: { id: workContext.poslovnaGodinaId, firma_id: expectedFirmaId },
      select: { id: true, godina: true, datum_od: true, datum_do: true, zakljucena: true }
    }),
    hasPermission(user, { firmaId: expectedFirmaId, modul: inventoryModule, akcija: action })
  ]);

  if (!firma || !godina || godina.zakljucena) calculationRedirect(path, "zakljucana_godina");
  if (!allowed) calculationRedirect(path, "prava");

  return { user, agencijaId: user.agencija_id, firma, godina };
}

async function editableCalculation(id: string, firmaId: string, agencijaId: string, godinaId: string) {
  return prisma.kalkulacija.findFirst({
    where: {
      id,
      agencija_id: agencijaId,
      firma_id: firmaId,
      poslovna_godina_id: godinaId,
      status: calculationStatuses.draft,
      is_deleted: false
    }
  });
}

function cents(value: bigint) {
  return scaledToDecimal(value, 2);
}

async function resolveCompanyAccount(
  tx: Prisma.TransactionClient,
  firmaId: string,
  accountCode: string
) {
  const companyAccount = await tx.firmaKonto.findUnique({
    where: { firma_id_sifra: { firma_id: firmaId, sifra: accountCode } },
    select: {
      id: true,
      sifra: true,
      tip_konta: true,
      override_type: true,
      aktivan: true
    }
  });
  if (companyAccount) {
    return companyAccount.aktivan &&
      companyAccount.override_type !== accountOverrideTypes.deactivated &&
      companyAccount.tip_konta === "analiticko"
      ? companyAccount
      : null;
  }

  const base = await tx.konto.findFirst({
    where: { sifra: accountCode, aktivan: true, tip_konta: "analiticko" }
  });
  if (!base) return null;
  return tx.firmaKonto.create({
    data: {
      firma_id: firmaId,
      konto_id: base.id,
      sifra: base.sifra,
      naziv: base.naziv,
      tip_konta: base.tip_konta,
      analitika_obavezna: base.analitika_obavezna,
      sinteticki_konto: base.sinteticki_konto,
      normalni_saldo: base.normalni_saldo,
      koristi_radnu_jedinicu: base.koristi_radnu_jedinicu,
      override_type: accountOverrideTypes.baseLink,
      aktivan: true
    },
    select: {
      id: true,
      sifra: true,
      tip_konta: true,
      override_type: true,
      aktivan: true
    }
  });
}

async function nextJournalNumber(
  tx: Prisma.TransactionClient,
  firmaId: string,
  yearId: string,
  journalTypeId: string
) {
  const last = await tx.nalog.findFirst({
    where: {
      firma_id: firmaId,
      poslovna_godina_id: yearId,
      vrsta_naloga_id: journalTypeId
    },
    orderBy: { broj: "desc" },
    select: { broj: true }
  });
  return (last?.broj ?? 0) + 1;
}

async function recalculateCalculation(
  tx: Prisma.TransactionClient,
  calculationId: string,
  userId: string
) {
  const calculation = await tx.kalkulacija.findUnique({
    where: { id: calculationId },
    select: {
      id: true,
      firma: { select: { pdv_obveznik: true } },
      stavke: { orderBy: { redni_broj: "asc" } },
      zavisniTroskovi: true
    }
  });
  if (!calculation) throw new Error("Kalkulacija nije pronađena.");

  const dependentTotal = calculation.zavisniTroskovi.reduce(
    (sum, cost) => sum + decimalToScaled(cost.iznos, 2),
    BigInt(0)
  );
  const allocations = allocateByValue(
    dependentTotal,
    calculation.stavke.map((line) => ({
      id: line.id,
      valueCents: decimalToScaled(line.neto_fakturna_vrijednost, 2)
    }))
  );
  const totals = {
    invoice: BigInt(0),
    rebate: BigInt(0),
    net: BigInt(0),
    inputVat: BigInt(0),
    invoiceGross: BigInt(0),
    acquisition: BigInt(0),
    saleNet: BigInt(0),
    saleGross: BigInt(0),
    margin: BigInt(0),
    includedVat: BigInt(0)
  };

  for (const line of calculation.stavke) {
    const dependentCost = allocations.get(line.id) ?? BigInt(0);
    const vatPercent = decimalToScaled(line.ulazni_pdv_stopa, 2);
    const common = {
      quantityMilli: decimalToScaled(line.kolicina, 3),
      invoiceUnitPriceTenThousand: decimalToScaled(line.fakturna_cijena, 4),
      rebatePercentTenThousand: decimalToScaled(line.rabat_procenat, 4),
      vatPercentHundred: vatPercent,
      marginPercentTenThousand: decimalToScaled(line.marza_procenat, 4),
      saleGrossUnitPriceTenThousand: decimalToScaled(line.prodajna_cijena_sa_pdv, 4),
      netInvoiceValueCentsOverride:
        line.izvor_neto_fakturna_vrijednost !== null
          ? decimalToScaled(line.izvor_neto_fakturna_vrijednost, 2)
          : null,
      inputVatCentsOverride:
        line.izvor_ulazni_pdv_iznos !== null
          ? decimalToScaled(line.izvor_ulazni_pdv_iznos, 2)
          : null
    };
    const preliminary = calculateLineAmounts({ ...common, dependentCostCents: BigInt(0) });
    const acquisitionAddition =
      dependentCost + (calculation.firma.pdv_obveznik ? BigInt(0) : preliminary.inputVatCents);
    const amount = calculateLineAmounts({ ...common, dependentCostCents: acquisitionAddition });

    await tx.stavkaKalkulacije.update({
      where: { id: line.id },
      data: {
        fakturna_vrijednost: cents(amount.invoiceValueCents),
        rabat_iznos: cents(amount.rebateCents),
        neto_fakturna_cijena: scaledToDecimal(amount.netInvoiceUnitPriceTenThousand, 4),
        neto_fakturna_vrijednost: cents(amount.netInvoiceValueCents),
        zavisni_trosak: cents(dependentCost),
        nabavna_vrijednost: cents(amount.acquisitionValueCents),
        jedinicna_nabavna_cijena: scaledToDecimal(amount.unitAcquisitionTenThousand, 4),
        ulazni_pdv_iznos: cents(amount.inputVatCents),
        marza_procenat: scaledToDecimal(amount.marginPercentTenThousand, 4),
        marza_iznos: cents(amount.marginCents),
        prodajna_cijena_bez_pdv: scaledToDecimal(amount.saleNetUnitTenThousand, 4),
        prodajna_vrijednost_bez_pdv: cents(amount.saleNetValueCents),
        prodajna_vrijednost_sa_pdv: cents(amount.saleGrossValueCents),
        ukalkulisani_pdv_iznos: cents(amount.includedVatCents),
        razlika_u_cijeni: cents(amount.marginCents),
        ruc_procenat: scaledToDecimal(amount.rucPercentTenThousand, 4),
        updated_by: userId
      }
    });

    totals.invoice += amount.invoiceValueCents;
    totals.rebate += amount.rebateCents;
    totals.net += amount.netInvoiceValueCents;
    totals.inputVat += amount.inputVatCents;
    totals.invoiceGross += amount.netInvoiceValueCents + amount.inputVatCents;
    totals.acquisition += amount.acquisitionValueCents;
    totals.saleNet += amount.saleNetValueCents;
    totals.saleGross += amount.saleGrossValueCents;
    totals.margin += amount.marginCents;
    totals.includedVat += amount.includedVatCents;
  }

  await tx.kalkulacija.update({
    where: { id: calculation.id },
    data: {
      ukupno_fakturno_bez_pdv: cents(totals.invoice),
      ukupno_rabat: cents(totals.rebate),
      ukupno_neto_fakturno: cents(totals.net),
      ukupno_ulazni_pdv: cents(totals.inputVat),
      ukupno_racun_sa_pdv: cents(totals.invoiceGross),
      ukupno_zavisni_troskovi: cents(dependentTotal),
      ukupno_nabavna_vrijednost: cents(totals.acquisition),
      ukupno_prodajna_vrijednost_bez_pdv: cents(totals.saleNet),
      ukupno_prodajna_vrijednost_sa_pdv: cents(totals.saleGross),
      ukupno_razlika_u_cijeni: cents(totals.margin),
      ukupno_ukalkulisani_pdv: cents(totals.includedVat),
      updated_by: userId
    }
  });
}

function revalidateCalculation(id?: string) {
  revalidatePath("/agencija/robno");
  revalidatePath("/agencija/robno/kalkulacije");
  if (id) {
    revalidatePath(detailPath(id));
    revalidatePath(`/stampa/robno/kalkulacije/${id}`);
  }
}

type MaprImportLineInput = {
  sourceLineKey?: string;
  externalKey?: string;
  resolution?: "EXISTING" | "NEW" | "";
  artikalId?: string | null;
  saleGrossPrice?: string;
  newCode?: string;
  newName?: string;
  groupId?: string;
  unitId?: string | null;
  vatRateId?: string | null;
};

type MaprImportPayload = {
  version?: number;
  qrUrl?: string;
  lines?: MaprImportLineInput[];
};

function normalizePib(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 7 ? `0${digits}` : digits;
}

function maprNumber(value: number, digits: number) {
  return value.toFixed(digits);
}

async function createMaprCalculation(
  formData: FormData,
  context: Awaited<ReturnType<typeof requireCalculationContext>>,
  path: string
) {
  const firmaId = context.firma.id;
  let payload: MaprImportPayload;
  try {
    payload = JSON.parse(text(formData.get("mapr_import_payload"))) as MaprImportPayload;
  } catch {
    calculationRedirect(path, "mapr_pregled");
  }
  if (payload.version !== 1 || !payload.qrUrl || !Array.isArray(payload.lines)) {
    calculationRedirect(path, "mapr_pregled");
  }

  let invoice;
  try {
    invoice = await fetchMaprInvoice(payload.qrUrl);
  } catch (error) {
    calculationRedirect(path, error instanceof MaprInvoiceError ? "mapr_nedostupan" : "mapr_greska");
  }

  const warehouseId = text(formData.get("magacin_id"));
  const supplierId = text(formData.get("dobavljac_id"));
  const calculationDate = parseDate(formData.get("datum_kalkulacije"));
  const dueDate = parseDate(formData.get("datum_valute"));
  const saleType =
    text(formData.get("tip_prodaje")) === calculationSaleTypes.wholesale
      ? calculationSaleTypes.wholesale
      : calculationSaleTypes.retail;
  const invoiceDate = parseDate(invoice.identifiers.qrDateTimeCreated.slice(0, 10));
  const sellerTin = normalizePib(invoice.seller.tin);
  const sellerPibs = [...new Set([sellerTin, sellerTin.replace(/^0/, "")].filter(Boolean))];

  if (!warehouseId || !supplierId || !calculationDate || !invoiceDate) {
    calculationRedirect(path, "obavezna_polja");
  }
  if (calculationDate < context.godina.datum_od || calculationDate > context.godina.datum_do) {
    calculationRedirect(path, "datum_van_godine");
  }
  if (payload.lines.length !== invoice.items.length) {
    calculationRedirect(path, "mapr_pregled");
  }

  const payloadBySourceLine = new Map<string, MaprImportLineInput>();
  for (const line of payload.lines) {
    const sourceLineKey = String(line.sourceLineKey ?? "");
    if (!sourceLineKey || payloadBySourceLine.has(sourceLineKey)) {
      calculationRedirect(path, "mapr_pregled");
    }
    payloadBySourceLine.set(sourceLineKey, line);
  }

  const normalizedLines = invoice.items.map((sourceItem) => {
    const input = payloadBySourceLine.get(sourceItem.sourceLineKey);
    const saleGross = parseScaledInteger(String(input?.saleGrossPrice ?? ""), 4);
    if (
      !input ||
      input.externalKey !== sourceItem.externalKey ||
      !["EXISTING", "NEW"].includes(String(input.resolution)) ||
      saleGross === null ||
      saleGross <= BigInt(0)
    ) {
      calculationRedirect(path, "mapr_stavke");
    }
    return { sourceItem, input, saleGross };
  });
  const invoiceNetTotal = parseScaledInteger(maprNumber(invoice.totalWithoutVat, 2), 2);
  const invoiceVatTotal = parseScaledInteger(maprNumber(invoice.totalVat, 2), 2);
  if (
    invoiceNetTotal === null ||
    invoiceNetTotal < BigInt(0) ||
    invoiceVatTotal === null ||
    invoiceVatTotal < BigInt(0)
  ) {
    calculationRedirect(path, "mapr_stavke");
  }
  const sourceNetAllocations = allocateByValue(
    invoiceNetTotal,
    normalizedLines.map(({ sourceItem }) => ({
      id: sourceItem.sourceLineKey,
      valueCents:
        parseScaledInteger(maprNumber(sourceItem.priceBeforeVat, 4), 4) ?? BigInt(0)
    }))
  );
  const sourceVatAllocations = allocateByValue(
    invoiceVatTotal,
    normalizedLines.map(({ sourceItem }) => ({
      id: sourceItem.sourceLineKey,
      valueCents: parseScaledInteger(maprNumber(sourceItem.vatAmount, 4), 4) ?? BigInt(0)
    }))
  );
  const allocatedNetTotal = [...sourceNetAllocations.values()].reduce(
    (sum, value) => sum + value,
    BigInt(0)
  );
  const allocatedVatTotal = [...sourceVatAllocations.values()].reduce(
    (sum, value) => sum + value,
    BigInt(0)
  );
  if (allocatedNetTotal !== invoiceNetTotal || allocatedVatTotal !== invoiceVatTotal) {
    calculationRedirect(path, "mapr_stavke");
  }

  const resolutionByExternalKey = new Map<string, string>();
  for (const { sourceItem, input } of normalizedLines) {
    const resolutionIdentity =
      input.resolution === "EXISTING"
        ? `EXISTING:${String(input.artikalId ?? "")}`
        : [
            "NEW",
            normalizeInventoryCode(String(input.newCode ?? "")),
            String(input.newName ?? "").trim(),
            String(input.groupId ?? ""),
            String(input.unitId ?? ""),
            String(input.vatRateId ?? "")
          ].join(":");
    const existing = resolutionByExternalKey.get(sourceItem.externalKey);
    if (existing && existing !== resolutionIdentity) {
      calculationRedirect(path, "mapr_povezivanje");
    }
    resolutionByExternalKey.set(sourceItem.externalKey, resolutionIdentity);
  }

  const [warehouse, supplier, duplicateCalculation, duplicateKuf] = await Promise.all([
    prisma.magacin.findFirst({
      where: {
        id: warehouseId,
        agencija_id: context.agencijaId,
        firma_id: firmaId,
        aktivan: true,
        is_deleted: false
      },
      select: { id: true, poslovna_jedinica_id: true }
    }),
    prisma.komitent.findFirst({
      where: {
        id: supplierId,
        pib: { in: sellerPibs },
        aktivan: true,
        OR: [
          { scope: "GLOBAL" },
          { scope: "AGENCY", agencija_id: context.agencijaId },
          { scope: "COMPANY", firma_id: firmaId }
        ]
      },
      select: { id: true, pib: true }
    }),
    prisma.kalkulacija.findFirst({
      where: {
        firma_id: firmaId,
        is_deleted: false,
        OR: [
          { fiscal_iic: invoice.identifiers.iic },
          {
            dobavljac_id: supplierId,
            broj_racuna_dobavljaca: invoice.invoiceNumber,
            datum_racuna_dobavljaca: invoiceDate
          }
        ]
      },
      select: { id: true }
    }),
    prisma.kufEntry.findFirst({
      where: {
        firma_id: firmaId,
        is_deleted: false,
        OR: [
          { fiscal_iic: invoice.identifiers.iic },
          {
            dobavljac_id: supplierId,
            supplier_invoice_number: invoice.invoiceNumber,
            invoice_date: invoiceDate
          }
        ]
      },
      select: { id: true }
    })
  ]);

  if (!warehouse || !supplier) calculationRedirect(path, "mapr_dobavljac_magacin");
  if (duplicateCalculation || duplicateKuf) calculationRedirect(path, "dupli_racun");

  const existingItemIds = [
    ...new Set(
      normalizedLines
        .filter(({ input }) => input.resolution === "EXISTING")
        .map(({ input }) => String(input.artikalId ?? ""))
        .filter(Boolean)
    )
  ];
  const newInputs = [
    ...new Map(
      normalizedLines
        .filter(({ input }) => input.resolution === "NEW")
        .map(({ sourceItem, input, saleGross }) => [
          sourceItem.externalKey,
          { sourceItem, input, saleGross }
        ])
    ).values()
  ];
  const referenceUnitIds = [
    ...new Set(newInputs.map(({ input }) => String(input.unitId ?? "")).filter(Boolean))
  ];
  const referenceVatRateIds = [
    ...new Set(newInputs.map(({ input }) => String(input.vatRateId ?? "")).filter(Boolean))
  ];
  const referenceGroupIds = [
    ...new Set(newInputs.map(({ input }) => String(input.groupId ?? "")).filter(Boolean))
  ];

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(
        hashtext(${firmaId}),
        hashtext('mapr_kalkulacija')
      )`
    );
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(
        hashtext(${firmaId}),
        hashtext('artikli_sifra')
      )`
    );
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(
        hashtext(${firmaId}),
        hashtext('kalkulacije_broj')
      )`
    );

    const [existingItems, units, vatRates, groups, duplicateInTransaction] = await Promise.all([
      tx.artikal.findMany({
        where: {
          id: { in: existingItemIds },
          agencija_id: context.agencijaId,
          firma_id: firmaId,
          aktivan: true,
          is_deleted: false,
          usluga: false,
          prati_zalihe: true
        },
        include: {
          jedinica_mjere: true,
          pdv_stopa: true
        }
      }),
      tx.jedinicaMjere.findMany({
        where: { id: { in: referenceUnitIds }, aktivna: true }
      }),
      tx.pdvStopa.findMany({
        where: {
          id: { in: referenceVatRateIds },
          agencija_id: context.agencijaId,
          aktivna: true
        }
      }),
      tx.grupaArtikla.findMany({
        where: {
          id: { in: referenceGroupIds },
          agencija_id: context.agencijaId,
          firma_id: firmaId,
          aktivna: true,
          is_deleted: false
        }
      }),
      tx.kalkulacija.findFirst({
        where: {
          firma_id: firmaId,
          is_deleted: false,
          fiscal_iic: invoice.identifiers.iic
        },
        select: { id: true }
      })
    ]);
    if (duplicateInTransaction) throw new CalculationPostError("dupli_racun");
    if (
      existingItems.length !== existingItemIds.length ||
      units.length !== referenceUnitIds.length ||
      vatRates.length !== referenceVatRateIds.length ||
      groups.length !== referenceGroupIds.length
    ) {
      throw new CalculationPostError("mapr_reference");
    }

    const itemMap = new Map(existingItems.map((item) => [item.id, item]));
    const unitMap = new Map(units.map((unit) => [unit.id, unit]));
    const vatRateMap = new Map(vatRates.map((rate) => [rate.id, rate]));
    const groupIdSet = new Set(groups.map((group) => group.id));
    const manualCodes = new Set<string>();

    const rows = await tx.$queryRaw<Array<{ max_code: bigint | null }>>(
      Prisma.sql`SELECT MAX(CAST("sifra" AS bigint)) AS "max_code"
        FROM "artikli"
        WHERE "firma_id" = CAST(${firmaId} AS uuid)
          AND "sifra" ~ '^[0-9]+$'`
    );
    let nextCode = Number(rows[0]?.max_code ?? 0) + 1;
    const createdItems: Array<{ id: string; sifra: string; naziv: string }> = [];

    for (const { sourceItem, input, saleGross } of newInputs) {
      const unitId = String(input.unitId ?? "");
      const vatRateId = String(input.vatRateId ?? "");
      const groupId = String(input.groupId ?? "") || null;
      const unit = unitMap.get(unitId);
      const vatRate = vatRateMap.get(vatRateId);
      const name = String(input.newName ?? "").trim();
      if (
        !unit ||
        !vatRate ||
        !name ||
        (groupId && !groupIdSet.has(groupId)) ||
        Number(vatRate.procenat.toString()) !== Number(sourceItem.vatRate)
      ) {
        throw new CalculationPostError("mapr_reference");
      }

      let code = normalizeInventoryCode(String(input.newCode ?? ""));
      if (!code) {
        do {
          code = String(nextCode).padStart(6, "0");
          nextCode += 1;
        } while (manualCodes.has(code));
      }
      if (manualCodes.has(code)) throw new CalculationPostError("mapr_sifra");
      const duplicateCode = await tx.artikal.findFirst({
        where: { firma_id: firmaId, sifra: code },
        select: { id: true }
      });
      if (duplicateCode) throw new CalculationPostError("mapr_sifra");
      manualCodes.add(code);

      const created = await tx.artikal.create({
        data: {
          agencija_id: context.agencijaId,
          firma_id: firmaId,
          grupa_artikla_id: groupId,
          jedinica_mjere_id: unit.id,
          pdv_stopa_id: vatRate.id,
          sifra: code,
          naziv: name,
          usluga: false,
          prati_zalihe: true,
          created_by: context.user.id,
          updated_by: context.user.id
        },
        include: {
          jedinica_mjere: true,
          pdv_stopa: true
        }
      });
      const saleGrossCents = Number(roundDivision(saleGross, BigInt(100)));
      const initialPrice = calculateItemPriceAmounts(
        "SA_PDV",
        saleGrossCents,
        Number(vatRate.procenat.toString())
      );
      await tx.cijenaArtikla.create({
        data: {
          agencija_id: context.agencijaId,
          firma_id: firmaId,
          artikal_id: created.id,
          tip: itemPriceTypes.retail,
          cijena_bez_pdv: inventoryCentsToDecimal(initialPrice.netCents),
          cijena_sa_pdv: inventoryCentsToDecimal(initialPrice.grossCents),
          pdv_stopa_procenat: vatRate.procenat,
          valuta: "EUR",
          created_by: context.user.id,
          updated_by: context.user.id
        }
      });
      itemMap.set(created.id, created);
      resolutionByExternalKey.set(sourceItem.externalKey, `EXISTING:${created.id}`);
      createdItems.push({ id: created.id, sifra: created.sifra, naziv: created.naziv });
    }

    const resolvedByExternalKey = new Map<string, (typeof existingItems)[number]>();
    for (const { sourceItem, input } of normalizedLines) {
      const resolvedId =
        input.resolution === "EXISTING"
          ? String(input.artikalId ?? "")
          : resolutionByExternalKey.get(sourceItem.externalKey)?.replace("EXISTING:", "") ?? "";
      const item = itemMap.get(resolvedId);
      if (!item) throw new CalculationPostError("mapr_povezivanje");
      if (Number(item.pdv_stopa?.procenat.toString() ?? "0") !== Number(sourceItem.vatRate)) {
        throw new CalculationPostError("mapr_pdv_artikal");
      }
      resolvedByExternalKey.set(sourceItem.externalKey, item);
    }

    for (const sourceItem of invoice.items) {
      const item = resolvedByExternalKey.get(sourceItem.externalKey);
      if (!item) throw new CalculationPostError("mapr_povezivanje");
      await tx.dobavljacArtikalVeza.upsert({
        where: {
          firma_id_dobavljac_id_external_key: {
            firma_id: firmaId,
            dobavljac_id: supplier.id,
            external_key: sourceItem.externalKey
          }
        },
        create: {
          agencija_id: context.agencijaId,
          firma_id: firmaId,
          dobavljac_id: supplier.id,
          artikal_id: item.id,
          external_key: sourceItem.externalKey,
          external_code: sourceItem.code || null,
          external_name: sourceItem.name,
          external_unit: sourceItem.unit || null,
          external_vat_rate: maprNumber(sourceItem.vatRate, 2),
          created_by: context.user.id,
          updated_by: context.user.id
        },
        update: {
          artikal_id: item.id,
          external_code: sourceItem.code || null,
          external_name: sourceItem.name,
          external_unit: sourceItem.unit || null,
          external_vat_rate: maprNumber(sourceItem.vatRate, 2),
          updated_by: context.user.id
        }
      });
    }

    const last = await tx.kalkulacija.findFirst({
      where: { firma_id: firmaId, poslovna_godina_id: context.godina.id },
      orderBy: { broj: "desc" },
      select: { broj: true }
    });
    const broj = (last?.broj ?? 0) + 1;
    const fiscalDate = new Date(invoice.identifiers.dateTimeCreated);
    const calculation = await tx.kalkulacija.create({
      data: {
        agencija_id: context.agencijaId,
        firma_id: firmaId,
        poslovna_godina_id: context.godina.id,
        magacin_id: warehouse.id,
        poslovna_jedinica_id: warehouse.poslovna_jedinica_id,
        dobavljac_id: supplier.id,
        broj,
        interni_broj: `KAL-${context.godina.godina}-${String(broj).padStart(4, "0")}`,
        broj_racuna_dobavljaca: invoice.invoiceNumber,
        datum_racuna_dobavljaca: invoiceDate,
        datum_kalkulacije: calculationDate,
        datum_valute: dueDate,
        tip_prodaje: saleType,
        napomena: nullableText(formData.get("napomena")),
        fiscal_iic: invoice.identifiers.iic,
        fiscal_fic: invoice.identifiers.fic || null,
        fiscal_seller_tin: invoice.seller.tin,
        fiscal_datetime: Number.isNaN(fiscalDate.getTime()) ? null : fiscalDate,
        fiscal_source_url: invoice.identifiers.qrUrl,
        created_by: context.user.id,
        updated_by: context.user.id
      }
    });

    for (const [index, { sourceItem, saleGross }] of normalizedLines.entries()) {
      const item = resolvedByExternalKey.get(sourceItem.externalKey);
      if (!item) throw new CalculationPostError("mapr_povezivanje");
      const quantity = parseScaledInteger(maprNumber(sourceItem.quantity, 3), 3);
      const invoicePrice = parseScaledInteger(maprNumber(sourceItem.unitPriceBeforeVat, 4), 4);
      const rebate = parseScaledInteger(maprNumber(sourceItem.rebate, 4), 4);
      const vat = parseScaledInteger(maprNumber(sourceItem.vatRate, 2), 2);
      const sourceNet = sourceNetAllocations.get(sourceItem.sourceLineKey);
      const sourceVat = sourceVatAllocations.get(sourceItem.sourceLineKey);
      if (
        quantity === null ||
        quantity <= BigInt(0) ||
        invoicePrice === null ||
        invoicePrice < BigInt(0) ||
        rebate === null ||
        rebate < BigInt(0) ||
        vat === null ||
        sourceNet === undefined ||
        sourceNet < BigInt(0) ||
        sourceVat === undefined ||
        sourceVat < BigInt(0)
      ) {
        throw new CalculationPostError("mapr_stavke");
      }
      const amount = calculateLineAmounts({
        quantityMilli: quantity,
        invoiceUnitPriceTenThousand: invoicePrice,
        rebatePercentTenThousand: rebate,
        vatPercentHundred: vat,
        dependentCostCents: BigInt(0),
        marginPercentTenThousand: BigInt(0),
        saleGrossUnitPriceTenThousand: saleGross,
        netInvoiceValueCentsOverride: sourceNet,
        inputVatCentsOverride: sourceVat
      });
      await tx.stavkaKalkulacije.create({
        data: {
          kalkulacija_id: calculation.id,
          redni_broj: index + 1,
          artikal_id: item.id,
          kolicina: scaledToDecimal(quantity, 3),
          fakturna_cijena: scaledToDecimal(invoicePrice, 4),
          fakturna_vrijednost: cents(amount.invoiceValueCents),
          rabat_procenat: scaledToDecimal(rebate, 4),
          rabat_iznos: cents(amount.rebateCents),
          neto_fakturna_cijena: scaledToDecimal(amount.netInvoiceUnitPriceTenThousand, 4),
          neto_fakturna_vrijednost: cents(amount.netInvoiceValueCents),
          izvor_neto_fakturna_vrijednost: cents(sourceNet),
          nabavna_vrijednost: cents(amount.acquisitionValueCents),
          jedinicna_nabavna_cijena: scaledToDecimal(amount.unitAcquisitionTenThousand, 4),
          ulazni_pdv_stopa: scaledToDecimal(vat, 2),
          ulazni_pdv_iznos: cents(amount.inputVatCents),
          izvor_ulazni_pdv_iznos: cents(sourceVat),
          marza_procenat: scaledToDecimal(amount.marginPercentTenThousand, 4),
          marza_iznos: cents(amount.marginCents),
          prodajna_cijena_bez_pdv: scaledToDecimal(amount.saleNetUnitTenThousand, 4),
          prodajna_cijena_sa_pdv: scaledToDecimal(amount.saleGrossUnitTenThousand, 4),
          prodajna_vrijednost_bez_pdv: cents(amount.saleNetValueCents),
          prodajna_vrijednost_sa_pdv: cents(amount.saleGrossValueCents),
          ukalkulisani_pdv_iznos: cents(amount.includedVatCents),
          razlika_u_cijeni: cents(amount.marginCents),
          ruc_procenat: scaledToDecimal(amount.rucPercentTenThousand, 4),
          created_by: context.user.id,
          updated_by: context.user.id
        }
      });
    }
    await recalculateCalculation(tx, calculation.id, context.user.id);
    return { calculation, createdItems };
  }).catch((error: unknown) => {
    if (error instanceof CalculationPostError) {
      calculationRedirect(path, error.reason);
    }
    if (
      error instanceof Error &&
      (error.message.includes("numeric field overflow") || error.message.includes('code: "22003"'))
    ) {
      calculationRedirect(path, "iznos_van_opsega");
    }
    throw error;
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "create_mapr_calculation",
    tipEntiteta: "Kalkulacija",
    entitetId: result.calculation.id,
    novaVrijednost: {
      kalkulacija: result.calculation,
      mapr_iic: invoice.identifiers.iic,
      broj_stavki: invoice.items.length,
      novi_artikli: result.createdItems
    }
  });
  revalidateCalculation(result.calculation.id);
  const newCodes = result.createdItems.map((item) => item.sifra).join(",");
  redirect(
    `${detailPath(result.calculation.id)}?poruka=mapr_kreirana${
      newCodes ? `&nove_sifre=${encodeURIComponent(newCodes)}` : ""
    }`
  );
}

export async function createCalculation(formData: FormData) {
  const path = "/agencija/robno/kalkulacije";
  const firmaId = text(formData.get("firma_id"));
  const context = await requireCalculationContext("create", firmaId, path);
  if (text(formData.get("mapr_import_payload"))) {
    return createMaprCalculation(formData, context, path);
  }
  const magacinId = text(formData.get("magacin_id"));
  const supplierId = text(formData.get("dobavljac_id"));
  const invoiceNumber = text(formData.get("broj_racuna_dobavljaca"));
  const invoiceDate = parseDate(formData.get("datum_racuna_dobavljaca"));
  const calculationDate = parseDate(formData.get("datum_kalkulacije"));
  const dueDate = parseDate(formData.get("datum_valute"));
  const saleType =
    text(formData.get("tip_prodaje")) === calculationSaleTypes.wholesale
      ? calculationSaleTypes.wholesale
      : calculationSaleTypes.retail;

  if (!magacinId || !supplierId || !invoiceNumber || !invoiceDate || !calculationDate) {
    calculationRedirect(path, "obavezna_polja");
  }
  if (calculationDate < context.godina.datum_od || calculationDate > context.godina.datum_do) {
    calculationRedirect(path, "datum_van_godine");
  }

  const [warehouse, supplier, duplicate] = await Promise.all([
    prisma.magacin.findFirst({
      where: {
        id: magacinId,
        agencija_id: context.agencijaId,
        firma_id: firmaId,
        aktivan: true,
        is_deleted: false
      },
      select: { id: true, poslovna_jedinica_id: true }
    }),
    prisma.komitent.findFirst({
      where: {
        id: supplierId,
        aktivan: true,
        OR: [
          { scope: "GLOBAL" },
          { scope: "AGENCY", agencija_id: context.agencijaId },
          { scope: "COMPANY", firma_id: firmaId }
        ]
      },
      select: { id: true }
    }),
    prisma.kalkulacija.findFirst({
      where: {
        firma_id: firmaId,
        dobavljac_id: supplierId,
        broj_racuna_dobavljaca: invoiceNumber,
        datum_racuna_dobavljaca: invoiceDate,
        is_deleted: false
      },
      select: { id: true }
    })
  ]);
  if (!warehouse || !supplier) calculationRedirect(path, "neispravne_reference");
  if (duplicate) calculationRedirect(path, "dupli_racun");

  const calculation = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(
        hashtext(${firmaId}),
        hashtext('kalkulacije_broj')
      )`
    );
    const last = await tx.kalkulacija.findFirst({
      where: { firma_id: firmaId, poslovna_godina_id: context.godina.id },
      orderBy: { broj: "desc" },
      select: { broj: true }
    });
    const broj = (last?.broj ?? 0) + 1;
    return tx.kalkulacija.create({
      data: {
        agencija_id: context.agencijaId,
        firma_id: firmaId,
        poslovna_godina_id: context.godina.id,
        magacin_id: warehouse.id,
        poslovna_jedinica_id: warehouse.poslovna_jedinica_id,
        dobavljac_id: supplier.id,
        broj,
        interni_broj: `KAL-${context.godina.godina}-${String(broj).padStart(4, "0")}`,
        broj_racuna_dobavljaca: invoiceNumber,
        datum_racuna_dobavljaca: invoiceDate,
        datum_kalkulacije: calculationDate,
        datum_valute: dueDate,
        tip_prodaje: saleType,
        napomena: nullableText(formData.get("napomena")),
        created_by: context.user.id,
        updated_by: context.user.id
      }
    });
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "create_calculation",
    tipEntiteta: "Kalkulacija",
    entitetId: calculation.id,
    novaVrijednost: calculation
  });
  revalidateCalculation(calculation.id);
  redirect(`${detailPath(calculation.id)}?poruka=kreirana`);
}

export async function updateCalculationHeader(formData: FormData) {
  const id = text(formData.get("kalkulacija_id"));
  const path = detailPath(id);
  const firmaId = text(formData.get("firma_id"));
  const context = await requireCalculationContext("update", firmaId, path);
  const current = await editableCalculation(id, firmaId, context.agencijaId, context.godina.id);
  if (!current) calculationRedirect(path, "nije_nacrt");

  const calculationDate = parseDate(formData.get("datum_kalkulacije"));
  const invoiceDate = parseDate(formData.get("datum_racuna_dobavljaca"));
  const warehouseId = text(formData.get("magacin_id"));
  const supplierId = text(formData.get("dobavljac_id"));
  const invoiceNumber = text(formData.get("broj_racuna_dobavljaca"));
  if (!calculationDate || !invoiceDate || !warehouseId || !supplierId || !invoiceNumber) {
    calculationRedirect(path, "obavezna_polja");
  }

  const [warehouse, supplier, duplicate] = await Promise.all([
    prisma.magacin.findFirst({
      where: {
        id: warehouseId,
        agencija_id: context.agencijaId,
        firma_id: firmaId,
        aktivan: true,
        is_deleted: false
      }
    }),
    prisma.komitent.findFirst({
      where: {
        id: supplierId,
        aktivan: true,
        OR: [
          { scope: "GLOBAL" },
          { scope: "AGENCY", agencija_id: context.agencijaId },
          { scope: "COMPANY", firma_id: firmaId }
        ]
      }
    }),
    prisma.kalkulacija.findFirst({
      where: {
        firma_id: firmaId,
        dobavljac_id: supplierId,
        broj_racuna_dobavljaca: invoiceNumber,
        datum_racuna_dobavljaca: invoiceDate,
        is_deleted: false,
        NOT: { id }
      },
      select: { id: true }
    })
  ]);
  if (
    !warehouse ||
    !supplier
  ) {
    calculationRedirect(path, "neispravne_reference");
  }
  if (duplicate) calculationRedirect(path, "dupli_racun");

  const updated = await prisma.kalkulacija.update({
    where: { id },
    data: {
      magacin_id: warehouse.id,
      poslovna_jedinica_id: warehouse.poslovna_jedinica_id,
      dobavljac_id: supplier.id,
      broj_racuna_dobavljaca: invoiceNumber,
      datum_racuna_dobavljaca: invoiceDate,
      datum_kalkulacije: calculationDate,
      datum_valute: parseDate(formData.get("datum_valute")),
      tip_prodaje:
        text(formData.get("tip_prodaje")) === calculationSaleTypes.wholesale
          ? calculationSaleTypes.wholesale
          : calculationSaleTypes.retail,
      napomena: nullableText(formData.get("napomena")),
      konto_robe_sifra: null,
      updated_by: context.user.id
    }
  });
  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "update_calculation",
    tipEntiteta: "Kalkulacija",
    entitetId: id,
    staraVrijednost: current,
    novaVrijednost: updated
  });
  revalidateCalculation(id);
  calculationRedirect(path, "sacuvana");
}

export async function addCalculationLine(formData: FormData) {
  const id = text(formData.get("kalkulacija_id"));
  const path = detailPath(id);
  const firmaId = text(formData.get("firma_id"));
  const context = await requireCalculationContext("update", firmaId, path);
  const current = await editableCalculation(id, firmaId, context.agencijaId, context.godina.id);
  if (!current) calculationRedirect(path, "nije_nacrt");

  const itemId = text(formData.get("artikal_id"));
  const quantity = parseScaledInteger(text(formData.get("kolicina")), 3);
  const invoicePrice = parseScaledInteger(text(formData.get("fakturna_cijena")), 4);
  const rebate = parseScaledInteger(text(formData.get("rabat_procenat")) || "0", 4);
  const saleGross = parseScaledInteger(text(formData.get("prodajna_cijena_sa_pdv")), 4);
  if (
    !itemId ||
    quantity === null ||
    quantity <= BigInt(0) ||
    invoicePrice === null ||
    invoicePrice < BigInt(0) ||
    rebate === null ||
    rebate < BigInt(0) ||
    rebate > BigInt(1000000) ||
    saleGross === null ||
    saleGross <= BigInt(0)
  ) {
    calculationRedirect(path, "stavka_iznosi");
  }

  const item = await prisma.artikal.findFirst({
    where: {
      id: itemId,
      agencija_id: context.agencijaId,
      firma_id: firmaId,
      aktivan: true,
      is_deleted: false,
      usluga: false,
      prati_zalihe: true
    },
    select: { id: true, pdv_stopa: { select: { procenat: true } } }
  });
  if (!item) calculationRedirect(path, "stavka_artikal");
  const vat = item.pdv_stopa ? decimalToScaled(item.pdv_stopa.procenat, 2) : BigInt(0);
  const amount = calculateLineAmounts({
    quantityMilli: quantity,
    invoiceUnitPriceTenThousand: invoicePrice,
    rebatePercentTenThousand: rebate,
    vatPercentHundred: vat,
    dependentCostCents: BigInt(0),
    marginPercentTenThousand: BigInt(0),
    saleGrossUnitPriceTenThousand: saleGross
  });

  const createdLine = await prisma.$transaction(async (tx) => {
    const last = await tx.stavkaKalkulacije.findFirst({
      where: { kalkulacija_id: id },
      orderBy: { redni_broj: "desc" },
      select: { redni_broj: true }
    });
    const created = await tx.stavkaKalkulacije.create({
      data: {
        kalkulacija_id: id,
        redni_broj: (last?.redni_broj ?? 0) + 1,
        artikal_id: item.id,
        kolicina: scaledToDecimal(quantity, 3),
        fakturna_cijena: scaledToDecimal(invoicePrice, 4),
        fakturna_vrijednost: cents(amount.invoiceValueCents),
        rabat_procenat: scaledToDecimal(rebate, 4),
        rabat_iznos: cents(amount.rebateCents),
        neto_fakturna_cijena: scaledToDecimal(amount.netInvoiceUnitPriceTenThousand, 4),
        neto_fakturna_vrijednost: cents(amount.netInvoiceValueCents),
        nabavna_vrijednost: cents(amount.acquisitionValueCents),
        jedinicna_nabavna_cijena: scaledToDecimal(amount.unitAcquisitionTenThousand, 4),
        ulazni_pdv_stopa: scaledToDecimal(vat, 2),
        ulazni_pdv_iznos: cents(amount.inputVatCents),
        marza_procenat: scaledToDecimal(amount.marginPercentTenThousand, 4),
        marza_iznos: cents(amount.marginCents),
        prodajna_cijena_bez_pdv: scaledToDecimal(amount.saleNetUnitTenThousand, 4),
        prodajna_cijena_sa_pdv: scaledToDecimal(amount.saleGrossUnitTenThousand, 4),
        prodajna_vrijednost_bez_pdv: cents(amount.saleNetValueCents),
        prodajna_vrijednost_sa_pdv: cents(amount.saleGrossValueCents),
        ukalkulisani_pdv_iznos: cents(amount.includedVatCents),
        razlika_u_cijeni: cents(amount.marginCents),
        ruc_procenat: scaledToDecimal(amount.rucPercentTenThousand, 4),
        created_by: context.user.id,
        updated_by: context.user.id
      }
    });
    await recalculateCalculation(tx, id, context.user.id);
    return created;
  });
  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "add_calculation_line",
    tipEntiteta: "StavkaKalkulacije",
    entitetId: createdLine.id,
    novaVrijednost: createdLine
  });
  revalidateCalculation(id);
  calculationRedirect(path, "stavka_dodata");
}

export async function updateCalculationLine(formData: FormData) {
  const id = text(formData.get("kalkulacija_id"));
  const lineId = text(formData.get("stavka_id"));
  const path = detailPath(id);
  const firmaId = text(formData.get("firma_id"));
  const context = await requireCalculationContext("update", firmaId, path);
  const current = await editableCalculation(id, firmaId, context.agencijaId, context.godina.id);
  if (!current) calculationRedirect(path, "nije_nacrt");
  const line = await prisma.stavkaKalkulacije.findFirst({
    where: { id: lineId, kalkulacija_id: id }
  });
  if (!line) calculationRedirect(path, "stavka_artikal");

  const quantity = parseScaledInteger(text(formData.get("kolicina")), 3);
  const invoicePrice = parseScaledInteger(text(formData.get("fakturna_cijena")), 4);
  const rebate = parseScaledInteger(text(formData.get("rabat_procenat")) || "0", 4);
  const saleGross = parseScaledInteger(text(formData.get("prodajna_cijena_sa_pdv")), 4);
  if (
    quantity === null ||
    quantity <= BigInt(0) ||
    invoicePrice === null ||
    invoicePrice < BigInt(0) ||
    rebate === null ||
    rebate < BigInt(0) ||
    rebate > BigInt(1000000) ||
    saleGross === null ||
    saleGross <= BigInt(0)
  ) {
    calculationRedirect(path, "stavka_iznosi");
  }
  const amount = calculateLineAmounts({
    quantityMilli: quantity,
    invoiceUnitPriceTenThousand: invoicePrice,
    rebatePercentTenThousand: rebate,
    vatPercentHundred: decimalToScaled(line.ulazni_pdv_stopa, 2),
    dependentCostCents: decimalToScaled(line.zavisni_trosak, 2),
    marginPercentTenThousand: BigInt(0),
    saleGrossUnitPriceTenThousand: saleGross,
    netInvoiceValueCentsOverride:
      quantity === decimalToScaled(line.kolicina, 3) &&
      invoicePrice === decimalToScaled(line.fakturna_cijena, 4) &&
      rebate === decimalToScaled(line.rabat_procenat, 4) &&
      line.izvor_neto_fakturna_vrijednost !== null
        ? decimalToScaled(line.izvor_neto_fakturna_vrijednost, 2)
        : null,
    inputVatCentsOverride:
      quantity === decimalToScaled(line.kolicina, 3) &&
      invoicePrice === decimalToScaled(line.fakturna_cijena, 4) &&
      rebate === decimalToScaled(line.rabat_procenat, 4) &&
      line.izvor_ulazni_pdv_iznos !== null
        ? decimalToScaled(line.izvor_ulazni_pdv_iznos, 2)
        : null
  });
  const preserveSourceAmounts =
    quantity === decimalToScaled(line.kolicina, 3) &&
    invoicePrice === decimalToScaled(line.fakturna_cijena, 4) &&
    rebate === decimalToScaled(line.rabat_procenat, 4);
  const updatedLine = await prisma.$transaction(async (tx) => {
    const updated = await tx.stavkaKalkulacije.update({
      where: { id: line.id },
      data: {
        kolicina: scaledToDecimal(quantity, 3),
        fakturna_cijena: scaledToDecimal(invoicePrice, 4),
        fakturna_vrijednost: cents(amount.invoiceValueCents),
        rabat_procenat: scaledToDecimal(rebate, 4),
        rabat_iznos: cents(amount.rebateCents),
        neto_fakturna_cijena: scaledToDecimal(amount.netInvoiceUnitPriceTenThousand, 4),
        neto_fakturna_vrijednost: cents(amount.netInvoiceValueCents),
        izvor_neto_fakturna_vrijednost: preserveSourceAmounts
          ? line.izvor_neto_fakturna_vrijednost
          : null,
        marza_procenat: scaledToDecimal(amount.marginPercentTenThousand, 4),
        prodajna_cijena_sa_pdv: scaledToDecimal(amount.saleGrossUnitTenThousand, 4),
        izvor_ulazni_pdv_iznos: preserveSourceAmounts ? line.izvor_ulazni_pdv_iznos : null,
        updated_by: context.user.id
      }
    });
    await recalculateCalculation(tx, id, context.user.id);
    return updated;
  });
  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "update_calculation_line",
    tipEntiteta: "StavkaKalkulacije",
    entitetId: line.id,
    staraVrijednost: line,
    novaVrijednost: updatedLine
  });
  revalidateCalculation(id);
  calculationRedirect(path, "stavka_sacuvana");
}

export async function deleteCalculationLine(formData: FormData) {
  const id = text(formData.get("kalkulacija_id"));
  const lineId = text(formData.get("stavka_id"));
  const path = detailPath(id);
  const firmaId = text(formData.get("firma_id"));
  const context = await requireCalculationContext("delete", firmaId, path);
  const current = await editableCalculation(id, firmaId, context.agencijaId, context.godina.id);
  if (!current) calculationRedirect(path, "nije_nacrt");
  const existingLine = await prisma.stavkaKalkulacije.findFirst({
    where: { id: lineId, kalkulacija_id: id }
  });
  if (!existingLine) calculationRedirect(path, "stavka_artikal");
  await prisma.$transaction(async (tx) => {
    const deleted = await tx.stavkaKalkulacije.deleteMany({
      where: { id: lineId, kalkulacija_id: id }
    });
    if (deleted.count !== 1) throw new Error("Stavka nije pronađena.");
    await recalculateCalculation(tx, id, context.user.id);
  });
  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "delete_calculation_line",
    tipEntiteta: "StavkaKalkulacije",
    entitetId: lineId,
    staraVrijednost: existingLine
  });
  revalidateCalculation(id);
  calculationRedirect(path, "stavka_obrisana");
}

export async function addDependentCost(formData: FormData) {
  const id = text(formData.get("kalkulacija_id"));
  const path = detailPath(id);
  const firmaId = text(formData.get("firma_id"));
  const context = await requireCalculationContext("update", firmaId, path);
  const current = await editableCalculation(id, firmaId, context.agencijaId, context.godina.id);
  if (!current) calculationRedirect(path, "nije_nacrt");
  const amount = parseScaledInteger(text(formData.get("iznos")), 2);
  const type = text(formData.get("vrsta"));
  if (!type || amount === null || amount <= BigInt(0)) calculationRedirect(path, "trosak_iznos");

  const createdCost = await prisma.$transaction(async (tx) => {
    const created = await tx.zavisniTrosakKalkulacije.create({
      data: {
        kalkulacija_id: id,
        vrsta: type,
        opis: nullableText(formData.get("opis")),
        iznos: cents(amount),
        nacin_raspodjele: dependentCostAllocationMethods.byValue,
        created_by: context.user.id,
        updated_by: context.user.id
      }
    });
    await recalculateCalculation(tx, id, context.user.id);
    return created;
  });
  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "add_calculation_dependent_cost",
    tipEntiteta: "ZavisniTrosakKalkulacije",
    entitetId: createdCost.id,
    novaVrijednost: createdCost
  });
  revalidateCalculation(id);
  calculationRedirect(path, "trosak_dodat");
}

export async function deleteDependentCost(formData: FormData) {
  const id = text(formData.get("kalkulacija_id"));
  const costId = text(formData.get("trosak_id"));
  const path = detailPath(id);
  const firmaId = text(formData.get("firma_id"));
  const context = await requireCalculationContext("delete", firmaId, path);
  const current = await editableCalculation(id, firmaId, context.agencijaId, context.godina.id);
  if (!current) calculationRedirect(path, "nije_nacrt");
  const existingCost = await prisma.zavisniTrosakKalkulacije.findFirst({
    where: { id: costId, kalkulacija_id: id }
  });
  if (!existingCost) calculationRedirect(path, "trosak_iznos");
  await prisma.$transaction(async (tx) => {
    const deleted = await tx.zavisniTrosakKalkulacije.deleteMany({
      where: { id: costId, kalkulacija_id: id }
    });
    if (deleted.count !== 1) throw new Error("Trošak nije pronađen.");
    await recalculateCalculation(tx, id, context.user.id);
  });
  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "delete_calculation_dependent_cost",
    tipEntiteta: "ZavisniTrosakKalkulacije",
    entitetId: costId,
    staraVrijednost: existingCost
  });
  revalidateCalculation(id);
  calculationRedirect(path, "trosak_obrisan");
}

export async function postCalculation(formData: FormData) {
  const id = text(formData.get("kalkulacija_id"));
  const firmaId = text(formData.get("firma_id"));
  const path = detailPath(id);
  const context = await requireCalculationContext("post", firmaId, path);

  const result = await prisma.$transaction(async (tx) => {
    const calculation = await tx.kalkulacija.findFirst({
      where: {
        id,
        agencija_id: context.agencijaId,
        firma_id: firmaId,
        poslovna_godina_id: context.godina.id,
        status: calculationStatuses.draft,
        is_deleted: false
      },
      include: {
        stavke: { orderBy: { redni_broj: "asc" } }
      }
    });
    if (!calculation) return { ok: false as const, reason: "nije_nacrt" };
    if (!calculation.stavke.length) return { ok: false as const, reason: "knjizenje_stavke" };
    const period = await tx.pdvPeriod.findFirst({
      where: {
        firma_id: firmaId,
        poslovna_godina_id: context.godina.id,
        mjesec: calculation.datum_racuna_dobavljaca.getUTCMonth() + 1
      },
      select: { status: true }
    });
    if (period?.status === "LOCKED") return { ok: false as const, reason: "pdv_period" };

    const [vatRates, journalType, duplicateKuf, postingSettings] = await Promise.all([
      tx.pdvStopa.findMany({
        where: { agencija_id: context.agencijaId, aktivna: true },
        orderBy: [{ redosljed: "asc" }]
      }),
      tx.vrstaNaloga.findFirst({
        where: {
          sifra: standardJournalTypes[3][0],
          aktivan: true,
          OR: [
            { sistemska: true },
            { agencija_id: context.agencijaId },
            { firma_id: firmaId }
          ]
        },
        select: { id: true, prefiks: true }
      }),
      tx.kufEntry.findFirst({
        where: {
          firma_id: firmaId,
          dobavljac_id: calculation.dobavljac_id,
          supplier_invoice_number: calculation.broj_racuna_dobavljaca,
          invoice_date: calculation.datum_racuna_dobavljaca,
          is_deleted: false
        },
        select: { id: true }
      }),
      tx.firmaPodrazumijevanoKonto.findMany({
        where: {
          firma_id: firmaId,
          dokument_tip: calculationPostingScope.documentType,
          podvrsta: calculationPostingScope.subtype,
          pdv_stopa_sifra: calculationPostingScope.vatRate,
          namjena: { in: calculationPostingFields.map((field) => field.purpose) }
        }
      })
    ]);
    if (!journalType) return { ok: false as const, reason: "knjizenje_vrsta_naloga" };
    if (duplicateKuf) return { ok: false as const, reason: "dupli_racun" };

    const groups = new Map<
      string,
      {
        rate: (typeof vatRates)[number];
        base: bigint;
        vat: bigint;
        deductible: bigint;
        nonDeductible: bigint;
      }
    >();
    for (const line of calculation.stavke) {
      const rate = vatRates.find(
        (item) =>
          decimalToScaled(item.procenat, 2) === decimalToScaled(line.ulazni_pdv_stopa, 2)
      );
      if (!rate) return { ok: false as const, reason: "knjizenje_pdv" };
      const group = groups.get(rate.sifra) ?? {
        rate,
        base: BigInt(0),
        vat: BigInt(0),
        deductible: BigInt(0),
        nonDeductible: BigInt(0)
      };
      const vat = decimalToScaled(line.ulazni_pdv_iznos, 2);
      group.base += decimalToScaled(line.neto_fakturna_vrijednost, 2);
      group.vat += vat;
      if (context.firma.pdv_obveznik) group.deductible += vat;
      else group.nonDeductible += vat;
      groups.set(rate.sifra, group);
    }

    const totalBase = [...groups.values()].reduce((sum, group) => sum + group.base, BigInt(0));
    const totalVat = [...groups.values()].reduce((sum, group) => sum + group.vat, BigInt(0));
    const totalDeductible = [...groups.values()].reduce(
      (sum, group) => sum + group.deductible,
      BigInt(0)
    );
    const totalGross = totalBase + totalVat;
    const isRetail = calculation.tip_prodaje === calculationSaleTypes.retail;
    const settingMap = new Map(
      postingSettings.map((setting) => [setting.namjena, setting])
    );
    const postingAmounts = new Map<string, bigint>([
      [
        "CALCULATION_GOODS",
        isRetail
          ? decimalToScaled(calculation.ukupno_prodajna_vrijednost_sa_pdv, 2)
          : decimalToScaled(calculation.ukupno_nabavna_vrijednost, 2)
      ],
      ["CALCULATION_INPUT_VAT", totalDeductible],
      ["CALCULATION_SUPPLIER", totalGross],
      [
        "CALCULATION_PRICE_DIFFERENCE",
        isRetail ? decimalToScaled(calculation.ukupno_razlika_u_cijeni, 2) : BigInt(0)
      ],
      [
        "CALCULATION_INCLUDED_VAT",
        isRetail ? decimalToScaled(calculation.ukupno_ukalkulisani_pdv, 2) : BigInt(0)
      ],
      [
        "CALCULATION_DEPENDENT_COSTS",
        decimalToScaled(calculation.ukupno_zavisni_troskovi, 2)
      ]
    ]);
    const postingLines: Array<{
      accountCode: string;
      direction: "D" | "P";
      amount: bigint;
    }> = [];

    for (const field of calculationPostingFields) {
      const amount = postingAmounts.get(field.purpose) ?? BigInt(0);
      if (amount === BigInt(0)) continue;
      const setting = settingMap.get(field.purpose);
      if (!setting?.sifra_konta) {
        throw new CalculationPostError("knjizenje_podesavanja");
      }
      const configuredDirection = setting.smjer === "P" ? "P" : "D";
      postingLines.push({
        accountCode: setting.sifra_konta,
        direction:
          amount < BigInt(0)
            ? configuredDirection === "D" ? "P" : "D"
            : configuredDirection,
        amount: amount < BigInt(0) ? -amount : amount
      });
    }

    const debit = postingLines
      .filter((line) => line.direction === "D")
      .reduce((sum, line) => sum + line.amount, BigInt(0));
    const credit = postingLines
      .filter((line) => line.direction === "P")
      .reduce((sum, line) => sum + line.amount, BigInt(0));
    if (!postingLines.length || debit !== credit) {
      throw new CalculationPostError("knjizenje_nije_balansiran");
    }
    const journalNumber = await nextJournalNumber(
      tx,
      firmaId,
      context.godina.id,
      journalType.id
    );
    const journal = await tx.nalog.create({
      data: {
        agencija_id: context.agencijaId,
        firma_id: firmaId,
        poslovna_godina_id: context.godina.id,
        poslovna_jedinica_id: calculation.poslovna_jedinica_id,
        vrsta_naloga_id: journalType.id,
        broj: journalNumber,
        sifra: formatJournalCode(journalType.prefiks, context.godina.godina, journalNumber),
        datum: calculation.datum_kalkulacije,
        opis: `Kalkulacija ${calculation.interni_broj}`,
        status: journalStatuses.draft,
        source_type: "CALCULATION",
        source_module: "agencija.robno.kalkulacije",
        izvorni_dokument_id: calculation.id,
        kreirao_korisnik_id: context.user.id,
        created_by: context.user.id,
        updated_by: context.user.id
      }
    });
    let lineNumber = 1;
    for (const line of postingLines) {
      const account = await resolveCompanyAccount(tx, firmaId, line.accountCode);
      if (!account) throw new CalculationPostError("knjizenje_konto");
      await tx.stavkaNaloga.create({
        data: {
          nalog_id: journal.id,
          konto_id: account.id,
          komitent_id: calculation.dobavljac_id,
          poslovna_jedinica_id: calculation.poslovna_jedinica_id,
          duguje: line.direction === "D" ? cents(line.amount) : "0.00",
          potrazuje: line.direction === "P" ? cents(line.amount) : "0.00",
          opis: `Kalkulacija ${calculation.interni_broj}`,
          broj_dokumenta: calculation.broj_racuna_dobavljaca,
          datum_dokumenta: calculation.datum_racuna_dobavljaca,
          datum_valute: calculation.datum_valute,
          redni_broj: lineNumber,
          created_by: context.user.id,
          updated_by: context.user.id
        }
      });
      lineNumber += 1;
    }
    for (const line of calculation.stavke) {
      const state = await tx.stanjeZaliha.findUnique({
        where: {
          firma_id_poslovna_godina_id_magacin_id_artikal_id: {
            firma_id: firmaId,
            poslovna_godina_id: context.godina.id,
            magacin_id: calculation.magacin_id,
            artikal_id: line.artikal_id
          }
        }
      });
      const oldQuantity = state ? decimalToScaled(state.kolicina, 3) : BigInt(0);
      const oldValue = state ? decimalToScaled(state.nabavna_vrijednost, 2) : BigInt(0);
      const quantity = decimalToScaled(line.kolicina, 3);
      const acquisition = decimalToScaled(line.nabavna_vrijednost, 2);
      const newQuantity = oldQuantity + quantity;
      const newValue = oldValue + acquisition;
      const average = newQuantity > BigInt(0)
        ? (newValue * BigInt(100000) + newQuantity / BigInt(2)) / newQuantity
        : BigInt(0);
      const retailValue = isRetail
        ? decimalToScaled(line.prodajna_vrijednost_sa_pdv, 2)
        : BigInt(0);
      const priceDifference = isRetail
        ? decimalToScaled(line.razlika_u_cijeni, 2)
        : BigInt(0);
      const includedVat = isRetail
        ? decimalToScaled(line.ukalkulisani_pdv_iznos, 2)
        : BigInt(0);

      await tx.stanjeZaliha.upsert({
        where: {
          firma_id_poslovna_godina_id_magacin_id_artikal_id: {
            firma_id: firmaId,
            poslovna_godina_id: context.godina.id,
            magacin_id: calculation.magacin_id,
            artikal_id: line.artikal_id
          }
        },
        create: {
          agencija_id: context.agencijaId,
          firma_id: firmaId,
          poslovna_godina_id: context.godina.id,
          magacin_id: calculation.magacin_id,
          artikal_id: line.artikal_id,
          kolicina: scaledToDecimal(newQuantity, 3),
          prosjecna_nabavna_cijena: scaledToDecimal(average, 4),
          nabavna_vrijednost: cents(newValue),
          maloprodajna_vrijednost: cents(retailValue),
          razlika_u_cijeni: cents(priceDifference),
          ukalkulisani_pdv: cents(includedVat)
        },
        update: {
          kolicina: scaledToDecimal(newQuantity, 3),
          prosjecna_nabavna_cijena: scaledToDecimal(average, 4),
          nabavna_vrijednost: cents(newValue),
          maloprodajna_vrijednost: {
            increment: cents(retailValue)
          },
          razlika_u_cijeni: { increment: cents(priceDifference) },
          ukalkulisani_pdv: { increment: cents(includedVat) }
        }
      });
      await tx.prometZaliha.create({
        data: {
          agencija_id: context.agencijaId,
          firma_id: firmaId,
          poslovna_godina_id: context.godina.id,
          magacin_id: calculation.magacin_id,
          artikal_id: line.artikal_id,
          kalkulacija_id: calculation.id,
          stavka_kalkulacije_id: line.id,
          tip_dokumenta: "CALCULATION",
          dokument_id: calculation.id,
          stavka_dokumenta_id: line.id,
          datum_prometa: calculation.datum_kalkulacije,
          smjer: "IN",
          kolicina: line.kolicina,
          jedinicna_nabavna_cijena: line.jedinicna_nabavna_cijena,
          nabavna_vrijednost: line.nabavna_vrijednost,
          prodajna_cijena_sa_pdv: line.prodajna_cijena_sa_pdv,
          prodajna_vrijednost: line.prodajna_vrijednost_sa_pdv,
          razlika_u_cijeni: line.razlika_u_cijeni,
          ukalkulisani_pdv: line.ukalkulisani_pdv_iznos,
          prosjecna_cijena_nakon: scaledToDecimal(average, 4),
          kolicina_nakon: scaledToDecimal(newQuantity, 3),
          created_by: context.user.id
        }
      });
      await tx.artikal.update({
        where: { id: line.artikal_id },
        data: {
          posljednja_nabavna_cijena: line.jedinicna_nabavna_cijena,
          updated_by: context.user.id
        }
      });
      const priceType = isRetail ? itemPriceTypes.retail : itemPriceTypes.wholesale;
      await tx.cijenaArtikla.updateMany({
        where: {
          firma_id: firmaId,
          artikal_id: line.artikal_id,
          magacin_id: calculation.magacin_id,
          tip: priceType,
          aktivna: true,
          is_deleted: false
        },
        data: { aktivna: false, updated_by: context.user.id }
      });
      await tx.cijenaArtikla.create({
        data: {
          agencija_id: context.agencijaId,
          firma_id: firmaId,
          artikal_id: line.artikal_id,
          tip: priceType,
          cijena_bez_pdv: line.prodajna_cijena_bez_pdv,
          cijena_sa_pdv: line.prodajna_cijena_sa_pdv,
          pdv_stopa_procenat: line.ulazni_pdv_stopa,
          valuta: calculation.valuta,
          magacin_id: calculation.magacin_id,
          vazi_od: calculation.datum_kalkulacije,
          aktivna: true,
          napomena: `Kreirano iz ${calculation.interni_broj}`,
          created_by: context.user.id,
          updated_by: context.user.id
        }
      });
    }

    await tx.kalkulacija.update({
      where: { id: calculation.id },
      data: {
        status: calculationStatuses.waitingKuf,
        kuf_book_id: null,
        kuf_entry_id: null,
        nalog_id: journal.id,
        posted_at: new Date(),
        posted_by: context.user.id,
        updated_by: context.user.id
      }
    });
    return { ok: true as const, journalCode: journal.sifra };
  }).catch((error: unknown) => {
    if (error instanceof CalculationPostError) {
      calculationRedirect(path, error.reason);
    }
    throw error;
  });

  if (!result.ok) calculationRedirect(path, result.reason);
  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "finalize_calculation",
    tipEntiteta: "Kalkulacija",
    entitetId: id,
    novaVrijednost: result
  });
  revalidateCalculation(id);
  revalidatePath("/agencija/racuni/kuf");
  revalidatePath("/agencija/nalozi");
  calculationRedirect(path, `zavrsena:${result.journalCode ?? ""}`);
}

export async function deleteCalculation(formData: FormData) {
  const id = text(formData.get("kalkulacija_id"));
  const firmaId = text(formData.get("firma_id"));
  const context = await requireCalculationContext("delete", firmaId, detailPath(id));
  const current = await editableCalculation(id, firmaId, context.agencijaId, context.godina.id);
  if (!current) calculationRedirect(detailPath(id), "nije_nacrt");
  await prisma.kalkulacija.update({
    where: { id },
    data: {
      status: calculationStatuses.deleted,
      is_deleted: true,
      deleted_at: new Date(),
      deleted_by: context.user.id,
      delete_reason: nullableText(formData.get("delete_reason")) ?? "Obrisan nacrt kalkulacije",
      updated_by: context.user.id
    }
  });
  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "delete_calculation",
    tipEntiteta: "Kalkulacija",
    entitetId: id,
    staraVrijednost: current
  });
  revalidateCalculation(id);
  calculationRedirect("/agencija/robno/kalkulacije", "obrisana");
}
