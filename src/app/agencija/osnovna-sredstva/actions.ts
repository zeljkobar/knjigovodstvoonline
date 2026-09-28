"use server";
import { parseTaxClassification } from "@/lib/fixed-assets-tax-groups";

import { parseDepreciationFields, completeDepreciationFields, scaledDecimal, decimalString } from "@/lib/fixed-assets-rates";
import { calculateAssetPeriods } from "@/lib/fixed-assets-calculation";
import { parameterInput, usageInput } from "@/lib/fixed-assets-input";
import { assertAssetHistoryUnposted } from "@/lib/fixed-assets-batches";
import { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAnyRole, requireRole } from "@/lib/auth";
import { auditLogInTransaction } from "@/lib/audit";
import {
  fixedAssetCentsToDecimal,
  fixedAssetContextMatches,
  fixedAssetOpeningDates,
  fixedAssetDepreciationEligibility,
  fixedAssetDecimalToCents,
  fixedAssetTypes,
  parseFixedAssetDate,
  parseFixedAssetMoney
} from "@/lib/fixed-assets";
import { requirePermissionForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function optionalText(formData: FormData, name: string) {
  return text(formData, name) || null;
}

function integer(formData: FormData, name: string) {
  const raw = text(formData, name);
  const parsed = /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function redirectNew(code: string): never {
  redirect(`/agencija/osnovna-sredstva/novo?poruka=${encodeURIComponent(code)}`);
}

function redirectSettings(code: string): never {
  redirect(`/agencija/osnovna-sredstva/podesavanja?poruka=${encodeURIComponent(code)}`);
}

function redirectAsset(assetId: string, code: string): never {
  redirect(`/agencija/osnovna-sredstva/${assetId}?poruka=${encodeURIComponent(code)}`);
}

async function requestMetadata() {
  const requestHeaders = await headers();

  return {
    ipAddress:
      requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      requestHeaders.get("x-real-ip"),
    userAgent: requestHeaders.get("user-agent")
  };
}

async function lockFixedAssetYear(tx: Prisma.TransactionClient, yearId: string, companyId: string, agencyId: string) {
  await tx.$queryRaw(Prisma.sql`
    SELECT y.id FROM poslovne_godine y JOIN firme f ON f.id = y.firma_id
    WHERE y.id = ${yearId}::uuid AND y.firma_id = ${companyId}::uuid
      AND f.agencija_id = ${agencyId}::uuid
    FOR UPDATE OF y
  `);
}

async function assertFixedAssetPeriodOpen(tx: Prisma.TransactionClient, companyId: string, yearId: string, from: Date, to: Date) {
  const periods = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
    SELECT status FROM pdv_periodi WHERE firma_id = ${companyId}::uuid
      AND poslovna_godina_id = ${yearId}::uuid
      AND datum_od <= ${to} AND datum_do >= ${from}
    ORDER BY datum_od FOR UPDATE
  `);
  if (periods.some((period) => period.status === "LOCKED")) throw new Error("VAT_PERIOD_LOCKED");
}

export async function createFixedAssetCategory(formData: FormData) {
  const user = await requireRole("admin_agencije");
  const workContext = await readWorkContext();
  if (!fixedAssetContextMatches(formData, workContext)) redirectSettings("kontekst_promijenjen");
  const code = text(formData, "sifra").toUpperCase();
  const name = text(formData, "naziv");
  const usefulLifeMonths = integer(formData, "korisni_vijek_mjeseci");
  const accountIds = {
    asset: optionalText(formData, "konto_sredstva_id"),
    accumulated: optionalText(formData, "konto_ispravke_id"),
    expense: optionalText(formData, "konto_troska_id"),
    disposal: optionalText(formData, "konto_neotpisane_vrijednosti_id")
  };

  if (!user.agencija_id || !workContext.firmaId || !code || !name) {
    redirectSettings("kategorija_obavezno");
  }

  if (usefulLifeMonths !== null && (usefulLifeMonths <= 0 || usefulLifeMonths > 1200)) {
    redirectSettings("kategorija_vijek");
  }

  await requirePermissionForUser(user, {
    firmaId: workContext.firmaId,
    modul: "osnovna_sredstva",
    akcija: "manage"
  });

  const metadata = await requestMetadata();

  try {
    await prisma.$transaction(async (tx) => {
      const company = await tx.firma.findFirst({
        where: {
          id: workContext.firmaId!,
          agencija_id: user.agencija_id!,
          is_deleted: false,
          aktivan: true
        },
        select: { id: true }
      });

      if (!company) {
        throw new Error("CONTEXT_CHANGED");
      }

      const selectedAccountIds = Object.values(accountIds).filter((id): id is string => Boolean(id));
      const accountCount = selectedAccountIds.length
        ? await tx.firmaKonto.count({
            where: { id: { in: selectedAccountIds }, firma_id: company.id, aktivan: true }
          })
        : 0;
      if (accountCount !== new Set(selectedAccountIds).size) {
        throw new Error("RELATED_SCOPE_INVALID");
      }

      const category = await tx.osKategorija.create({
        data: {
          agencija_id: user.agencija_id!,
          firma_id: company.id,
          sifra: code,
          naziv: name,
          predlozeni_korisni_vijek_mjeseci: usefulLifeMonths,
          konto_sredstva_id: accountIds.asset,
          konto_ispravke_id: accountIds.accumulated,
          konto_troska_id: accountIds.expense,
          konto_neotpisane_vrijednosti_id: accountIds.disposal,
          created_by: user.id,
          updated_by: user.id
        }
      });

      await auditLogInTransaction(
        tx,
        {
          korisnikId: user.id,
          agencijaId: user.agencija_id,
          firmaId: company.id,
          modul: "osnovna_sredstva",
          akcija: "create_category",
          tipEntiteta: "OsKategorija",
          entitetId: category.id,
          novaVrijednost: category
        },
        metadata
      );
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      redirectSettings("kategorija_duplikat");
    }

    redirectSettings("kategorija_greska");
  }

  revalidatePath("/agencija/osnovna-sredstva");
  revalidatePath("/agencija/osnovna-sredstva/novo");
  revalidatePath("/agencija/osnovna-sredstva/podesavanja");
  redirectSettings("kategorija_sacuvana");
}

export async function createFixedAsset(formData: FormData) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();
  if (!fixedAssetContextMatches(formData, workContext)) redirectNew("kontekst_promijenjen");
  const mode = text(formData, "nacin_unosa");
  const inventoryNumber = text(formData, "inventarski_broj");
  const name = text(formData, "naziv");
  const assetType = text(formData, "vrsta_imovine");
  const taxClassification = parseTaxClassification(formData.get("poreska_klasifikacija"), assetType);
  if (!taxClassification) redirectNew("poreska_grupa_neispravna");
  const categoryId = optionalText(formData, "kategorija_id");
  const businessUnitId = optionalText(formData, "poslovna_jedinica_id");
  const acquisitionDate = parseFixedAssetDate(formData.get("datum_nabavke"));
  const availableDate = parseFixedAssetDate(formData.get("datum_raspolozivosti"));
  const openingDate = mode === "OPENING" ? parseFixedAssetDate(formData.get("datum_presjeka")) : null;
  const grossCents = parseFixedAssetMoney(formData.get("nabavna_vrijednost"));
  const accumulatedCents = parseFixedAssetMoney(formData.get("akumulirana_amortizacija"));
  const residualCents = assetType === "LAND" ? 0 : parseFixedAssetMoney(formData.get("ostatak_vrijednosti"));
  const depreciation = parseDepreciationFields(formData, assetType === "LAND");
  const usefulLifeMonths = depreciation?.korisni_vijek_mjeseci ?? null;

  if (
    !user.agencija_id ||
    !workContext.firmaId ||
    !workContext.poslovnaGodinaId ||
    !inventoryNumber ||
    !name ||
    !fixedAssetTypes.includes(assetType as (typeof fixedAssetTypes)[number]) ||
    !availableDate ||
    grossCents === null ||
    grossCents <= 0 ||
    residualCents === null ||
    residualCents < 0 ||
    !depreciation ||
    !["NEW", "OPENING"].includes(mode)
  ) {
    redirectNew("sredstvo_obavezno");
  }

  if (mode === "OPENING" && (accumulatedCents === null || !openingDate)) {
    redirectNew("pocetno_obavezno");
  }

  const effectiveAccumulatedCents = mode === "OPENING" ? accumulatedCents! : 0;
  if (
    effectiveAccumulatedCents < 0 ||
    effectiveAccumulatedCents > grossCents ||
    residualCents > grossCents - effectiveAccumulatedCents
  ) {
    redirectNew("sredstvo_vrijednosti");
  }

  await requirePermissionForUser(user, {
    firmaId: workContext.firmaId,
    modul: "osnovna_sredstva",
    akcija: "create"
  });

  if (mode === "OPENING") {
    await requirePermissionForUser(user, {
      firmaId: workContext.firmaId,
      modul: "osnovna_sredstva",
      akcija: "post"
    });
  }
  if ((acquisitionDate && acquisitionDate > availableDate) ||
      (mode === "OPENING" && availableDate > openingDate!)) redirectNew("datumi_redosljed");
  if (assetType === "LAND" && effectiveAccumulatedCents !== 0) redirectNew("zemljiste_ispravka");

  const metadata = await requestMetadata();
  let createdId = "";

  try {
    createdId = await prisma.$transaction(async (tx) => {
      await lockFixedAssetYear(tx, workContext.poslovnaGodinaId!, workContext.firmaId!, user.agencija_id!);
      const year = await tx.poslovnaGodina.findFirst({
        where: {
          id: workContext.poslovnaGodinaId!,
          firma_id: workContext.firmaId!,
          firma: {
            agencija_id: user.agencija_id!,
            is_deleted: false,
            aktivan: true
          }
        },
        select: { id: true, datum_od: true, datum_do: true, zakljucena: true }
      });

      if (!year) {
        throw new Error("CONTEXT_CHANGED");
      }

      if (year.zakljucena) {
        throw new Error("YEAR_LOCKED");
      }

      const opening = mode === "OPENING" ? fixedAssetOpeningDates(openingDate!, year.datum_od) : null;
      const eventDate = opening?.eventDate ?? acquisitionDate ?? availableDate;
      if (eventDate < year.datum_od || eventDate > year.datum_do) {
        throw new Error("DATE_OUTSIDE_YEAR");
      }

      await assertFixedAssetPeriodOpen(tx, workContext.firmaId!, year.id, eventDate, year.datum_do);
      const [category, businessUnit] = await Promise.all([
        categoryId
          ? tx.osKategorija.findFirst({
              where: {
                id: categoryId,
                agencija_id: user.agencija_id!,
                firma_id: workContext.firmaId!,
                aktivna: true,
                is_deleted: false
              },
              select: {
                id: true,
                konto_sredstva_id: true,
                konto_ispravke_id: true,
                konto_troska_id: true
              }
            })
          : null,
        businessUnitId
          ? tx.poslovnaJedinica.findFirst({
              where: {
                id: businessUnitId,
                agencija_id: user.agencija_id!,
                firma_id: workContext.firmaId!,
                aktivna: true,
                is_deleted: false
              },
              select: { id: true }
            })
          : null
      ]);

      if ((categoryId && !category) || (businessUnitId && !businessUnit)) {
        throw new Error("RELATED_SCOPE_INVALID");
      }

      const asset = await tx.osnovnoSredstvo.create({
        data: {
          agencija_id: user.agencija_id!,
          firma_id: workContext.firmaId!,
          inventarski_broj: inventoryNumber,
          naziv: name,
          opis: optionalText(formData, "opis"),
          serijski_broj: optionalText(formData, "serijski_broj"),
          kategorija_id: category?.id,
          vrsta_imovine: assetType,
          lokacija: optionalText(formData, "lokacija"),
          zaduzena_osoba: optionalText(formData, "zaduzena_osoba"),
          poslovna_jedinica_id: businessUnit?.id,
          broj_dokumenta: optionalText(formData, "broj_dokumenta"),
          datum_nabavke: acquisitionDate,
          datum_raspolozivosti: availableDate,
          status: mode === "OPENING" ? "ACTIVE" : "IN_PREPARATION",
          created_by: user.id,
          updated_by: user.id
        }
      });

      const completed = completeDepreciationFields(depreciation, grossCents-residualCents);
      if (!completed) throw new Error("OPENING_USAGE_INVALID");
      if (completed.metoda === "UNITS_OF_PRODUCTION") {
        const prior = scaledDecimal(completed.prethodni_ucinak)!;
        if (mode === "NEW" && prior !== BigInt(0)) throw new Error("INVALID_VALUE");
        // An imported quantity and accumulated amount must describe the same past usage.
        const expected = scaledDecimal(completed.ocekivani_ucinak)!;
        const numerator = completed.izvor_stope === "MANUAL" ? prior * scaledDecimal(completed.stopa_po_jedinici)! * BigInt(100) : BigInt(grossCents-residualCents) * prior;
        const denominator = completed.izvor_stope === "MANUAL" ? BigInt(1_000_000_000_000) : expected;
        const historical = Number((numerator*BigInt(2)+denominator)/(BigInt(2)*denominator));
        if (Math.min(grossCents-residualCents,historical) !== effectiveAccumulatedCents) throw new Error("OPENING_USAGE_INVALID");
      }
      await tx.osParametar.create({
        data: {
          agencija_id: user.agencija_id!,
          firma_id: workContext.firmaId!,
          sredstvo_id: asset.id,
          vazi_od: opening?.effectiveFrom ?? availableDate,
          ...completed,
          osnovica: fixedAssetCentsToDecimal(grossCents - residualCents),
          ostatak_vrijednosti: fixedAssetCentsToDecimal(residualCents),
          konto_sredstva_id: category?.konto_sredstva_id,
          konto_ispravke_id: category?.konto_ispravke_id,
          konto_troska_id: category?.konto_troska_id,
          poslovna_jedinica_id: businessUnit?.id,
          ...taxClassification,
          razlog_promjene: mode === "OPENING" ? "Preuzeto početno stanje" : "Početni parametri nabavke",
          created_by: user.id,
          updated_by: user.id
        }
      });

      const change = await tx.osPromjena.create({
        data: {
          agencija_id: user.agencija_id!,
          firma_id: workContext.firmaId!,
          poslovna_godina_id: year.id,
          sredstvo_id: asset.id,
          datum: eventDate,
          vrsta: mode === "OPENING" ? "OPENING" : "ACQUISITION",
          status: mode === "OPENING" ? "CONFIRMED" : "DRAFT",
          razlog: mode === "OPENING" ? "Preuzeto stanje bez novog GL knjiženja" : "Nabavka čeka povezivanje sa knjiženim izvorom",
          delta_nabavna_vrijednost: fixedAssetCentsToDecimal(grossCents),
          delta_ispravka_vrijednosti: fixedAssetCentsToDecimal(effectiveAccumulatedCents),
          nabavna_vrijednost: fixedAssetCentsToDecimal(grossCents),
          akumulirana_amortizacija: fixedAssetCentsToDecimal(effectiveAccumulatedCents),
          ostatak_vrijednosti: fixedAssetCentsToDecimal(residualCents),
          preostali_vijek_mjeseci: usefulLifeMonths,
          snapshot: {
            schema_version: 2,
            depreciation: completed,
            tax_classification: taxClassification,
            mode,
            opening_cutoff: openingDate?.toISOString().slice(0, 10) ?? null,
            gross_cents: String(grossCents),
            accumulated_cents: String(effectiveAccumulatedCents),
            residual_cents: String(residualCents),
            useful_life_months: usefulLifeMonths
          },
          created_by: user.id,
          updated_by: user.id
        }
      });

      await auditLogInTransaction(
        tx,
        {
          korisnikId: user.id,
          agencijaId: user.agencija_id,
          firmaId: workContext.firmaId,
          modul: "osnovna_sredstva",
          akcija: "create",
          tipEntiteta: "OsnovnoSredstvo",
          entitetId: asset.id,
          novaVrijednost: {
            inventarski_broj: asset.inventarski_broj,
            naziv: asset.naziv,
            status: asset.status,
            promjena_id: change.id,
            nacin_unosa: mode,
            ...taxClassification
          }
        },
        metadata
      );

      return asset.id;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      redirectNew("inventarski_broj_postoji");
    }
    if (error instanceof Error && error.message === "YEAR_LOCKED") {
      redirectNew("godina_zakljucena");
    }
    if (error instanceof Error && error.message === "DATE_OUTSIDE_YEAR") {
      redirectNew("datum_van_godine");
    }

    if (error instanceof Error && error.message === "OPENING_CUTOFF_INVALID") redirectNew("presjek_pocetka_godine");
    if (error instanceof Error && error.message === "VAT_PERIOD_LOCKED") redirectNew("pdv_zakljucan");
    if (error instanceof Error && error.message === "OPENING_USAGE_INVALID") redirectNew("ucinak_pocetni");
    redirectNew("sredstvo_greska");
  }

  revalidatePath("/agencija/osnovna-sredstva");
  redirect(`/agencija/osnovna-sredstva/${createdId}?poruka=sredstvo_sacuvano`);
}

export async function createFixedAssetParameter(formData: FormData) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();
  const assetId = text(formData, "sredstvo_id");
  if (!fixedAssetContextMatches(formData, workContext)) redirectAsset(assetId, "kontekst_promijenjen");
  const expectedVersion = integer(formData, "ocekivana_verzija");
  const effectiveFrom = parseFixedAssetDate(formData.get("vazi_od"));
  const depreciation = parseDepreciationFields(formData);
  const residualCents = parseFixedAssetMoney(formData.get("ostatak_vrijednosti"));
  const reason = text(formData, "razlog_promjene");

  if (
    !user.agencija_id ||
    !workContext.firmaId ||
    !workContext.poslovnaGodinaId ||
    !assetId ||
    expectedVersion === null ||
    expectedVersion <= 0 ||
    !effectiveFrom ||
    !depreciation ||
    residualCents === null ||
    residualCents < 0 ||
    !reason
  ) {
    redirectAsset(assetId, "parametar_obavezno");
  }

  await requirePermissionForUser(user, {
    firmaId: workContext.firmaId,
    modul: "osnovna_sredstva",
    akcija: "update"
  });

  const metadata = await requestMetadata();

  try {
    await prisma.$transaction(async (tx) => {
      await lockFixedAssetYear(tx, workContext.poslovnaGodinaId!, workContext.firmaId!, user.agencija_id!);
      await assertFuturePeriodsOpen(tx, workContext.firmaId!, effectiveFrom);
      await lockAsset(tx, assetId, workContext.firmaId!, user.agencija_id!);
      const [year, asset] = await Promise.all([
        tx.poslovnaGodina.findFirst({
          where: {
            id: workContext.poslovnaGodinaId!,
            firma_id: workContext.firmaId!,
            firma: { agencija_id: user.agencija_id!, is_deleted: false, aktivan: true }
          },
          select: { datum_od: true, datum_do: true, zakljucena: true }
        }),
        tx.osnovnoSredstvo.findFirst({
          where: {
            id: assetId,
            agencija_id: user.agencija_id!,
            firma_id: workContext.firmaId!,
            status: "ACTIVE",
            is_deleted: false
          },
          select: {
            id: true,
            datum_raspolozivosti: true,
            vrsta_imovine: true,
            verzija: true,
            parametri: { orderBy: { vazi_od: "desc" } },
            ucinci: { where: { is_deleted: false } },
            promjene: {
              where: { status: "CONFIRMED", is_deleted: false },
              select: {
                delta_nabavna_vrijednost: true,
                delta_ispravka_vrijednosti: true
              }
            }
          }
        })
      ]);

      if (!year || !asset || !asset.datum_raspolozivosti || asset.parametri.length === 0) {
        throw new Error("CONTEXT_CHANGED");
      }
      if (year.zakljucena) {
        throw new Error("YEAR_LOCKED");
      }
      if (
        effectiveFrom < year.datum_od ||
        effectiveFrom > year.datum_do ||
        effectiveFrom < asset.datum_raspolozivosti
      ) {
        throw new Error("DATE_OUTSIDE_YEAR");
      }

      if (fixedAssetDepreciationEligibility(asset.vrsta_imovine) !== "SUPPORTED") {
        throw new Error("UNSUPPORTED_ASSET_TYPE");
      }
      await assertFixedAssetPeriodOpen(tx, workContext.firmaId!, workContext.poslovnaGodinaId!, effectiveFrom, year.datum_do);
      await assertAssetHistoryUnposted(tx, asset.id, effectiveFrom);
      const previous = asset.parametri[0];
      if (effectiveFrom <= previous.vazi_od) {
        throw new Error("PARAMETER_ORDER");
      }

      const values = asset.promjene.reduce<{ gross: number; accumulated: number } | null>(
        (sum, change) => {
          const gross = fixedAssetDecimalToCents(change.delta_nabavna_vrijednost);
          const accumulated = fixedAssetDecimalToCents(change.delta_ispravka_vrijednosti);

          return sum === null || gross === null || accumulated === null
            ? null
            : { gross: sum.gross + gross, accumulated: sum.accumulated + accumulated };
        },
        { gross: 0, accumulated: 0 }
      );

      if (!values || residualCents > values.gross - values.accumulated) {
        throw new Error("INVALID_VALUE");
      }

      if (asset.ucinci.some(u => u.datum_do >= effectiveFrom)) throw new Error("FUTURE_USAGE");
      const history = calculateAssetPeriods({ assetId: asset.id, grossCents: values.gross, accumulatedCents: values.accumulated,
        availableDate: asset.datum_raspolozivosti.toISOString().slice(0,10),
        periodFrom: [...asset.parametri].reverse()[0].vazi_od.toISOString().slice(0,10),
        periodTo: new Date(effectiveFrom.getTime()-86400000).toISOString().slice(0,10),
        parameters: asset.parametri.map(parameterInput), usage: asset.ucinci.map(usageInput) });
      if (history.errors.length) throw new Error("HISTORY_INCOMPLETE");
      const remainingBasis = values.gross-values.accumulated-history.totalCents-residualCents;
      if (remainingBasis < 0) throw new Error("INVALID_VALUE");
      if (depreciation.metoda === "UNITS_OF_PRODUCTION" && scaledDecimal(depreciation.prethodni_ucinak)! !== BigInt(0)) throw new Error("INVALID_VALUE");
      const completed = completeDepreciationFields(depreciation, remainingBasis);
      if (!completed) throw new Error("INVALID_VALUE");
      const parameter = await tx.osParametar.create({
        data: {
          agencija_id: user.agencija_id!,
          firma_id: workContext.firmaId!,
          sredstvo_id: asset.id,
          vazi_od: effectiveFrom,
          ...completed,
          osnovica: fixedAssetCentsToDecimal(remainingBasis),
          ostatak_vrijednosti: fixedAssetCentsToDecimal(residualCents),
          konto_sredstva_id: previous.konto_sredstva_id,
          konto_ispravke_id: previous.konto_ispravke_id,
          konto_troska_id: previous.konto_troska_id,
          komitent_id: previous.komitent_id,
          poslovna_jedinica_id: previous.poslovna_jedinica_id,
          poreski_tretman: previous.poreski_tretman,
          poreska_grupa: previous.poreska_grupa,
          razlog_promjene: reason,
          created_by: user.id,
          updated_by: user.id
        }
      });

      const updatedAsset = await tx.osnovnoSredstvo.updateMany({
        where: { id: asset.id, verzija: expectedVersion },
        data: { verzija: { increment: 1 }, updated_by: user.id }
      });

      if (updatedAsset.count !== 1) {
        throw new Error("STALE_ASSET");
      }

      await auditLogInTransaction(
        tx,
        {
          korisnikId: user.id,
          agencijaId: user.agencija_id,
          firmaId: workContext.firmaId,
          modul: "osnovna_sredstva",
          akcija: "create_parameter",
          tipEntiteta: "OsParametar",
          entitetId: parameter.id,
          staraVrijednost: previous,
          novaVrijednost: parameter
        },
        metadata
      );
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      redirectAsset(assetId, "parametar_datum_postoji");
    }
    if (error instanceof Error && error.message === "YEAR_LOCKED") {
      redirectAsset(assetId, "godina_zakljucena");
    }
    if (error instanceof Error && error.message === "DATE_OUTSIDE_YEAR") {
      redirectAsset(assetId, "parametar_datum");
    }
    if (error instanceof Error && error.message === "PARAMETER_ORDER") {
      redirectAsset(assetId, "parametar_redosljed");
    }
    if (error instanceof Error && error.message === "INVALID_VALUE") {
      redirectAsset(assetId, "parametar_vrijednost");
    }
    if (error instanceof Error && error.message === "STALE_ASSET") {
      redirectAsset(assetId, "parametar_zastario");
    }

    if (error instanceof Error && error.message === "VAT_PERIOD_LOCKED") redirectAsset(assetId, "pdv_zakljucan");
    if (error instanceof Error && error.message === "UNSUPPORTED_ASSET_TYPE") redirectAsset(assetId, "vrsta_nepodrzana");
    if (error instanceof Error && ["FUTURE_USAGE", "HISTORY_INCOMPLETE"].includes(error.message)) redirectAsset(assetId, "istorija_ucinka");
    if (error instanceof Error && error.message === "POSTED_HISTORY") redirectAsset(assetId, "proknjizena_istorija");
    redirectAsset(assetId, "parametar_greska");
  }

  revalidatePath(`/agencija/osnovna-sredstva/${assetId}`);
  revalidatePath("/agencija/osnovna-sredstva/obracuni");
  redirectAsset(assetId, "parametar_sacuvan");
}

async function lockAsset(tx: Prisma.TransactionClient, assetId: string, companyId: string, agencyId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM osnovna_sredstva WHERE id=${assetId}::uuid AND firma_id=${companyId}::uuid AND agencija_id=${agencyId}::uuid FOR UPDATE`);
}
async function assertFuturePeriodsOpen(tx: Prisma.TransactionClient, companyId: string, from: Date) {
  const years = await tx.$queryRaw<{ zakljucena:boolean }[]>(Prisma.sql`SELECT zakljucena FROM poslovne_godine WHERE firma_id=${companyId}::uuid AND datum_do >= ${from} ORDER BY datum_od FOR UPDATE`);
  if (years.some(y => y.zakljucena)) throw new Error("YEAR_LOCKED");
  const periods = await tx.$queryRaw<{ status:string }[]>(Prisma.sql`SELECT status FROM pdv_periodi WHERE firma_id=${companyId}::uuid AND datum_do >= ${from} ORDER BY datum_od FOR UPDATE`);
  if (periods.some(p => p.status === "LOCKED")) throw new Error("VAT_PERIOD_LOCKED");
}

export async function saveFixedAssetUsage(formData: FormData) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const context = await readWorkContext();
  const assetId = text(formData,"sredstvo_id"), usageId = optionalText(formData,"ucinak_id");
  if (!fixedAssetContextMatches(formData,context)) redirectAsset(assetId,"kontekst_promijenjen");
  const from = parseFixedAssetDate(formData.get("datum_od")), to = parseFixedAssetDate(formData.get("datum_do"));
  const quantity = scaledDecimal(formData.get("kolicina")), version = integer(formData,"ocekivana_verzija");
  const reason = text(formData,"razlog"), deleting = text(formData,"obrisi") === "1";
  if (!user.agencija_id || !context.firmaId || !context.poslovnaGodinaId || !assetId || !from || !to || from>to || from.toISOString().slice(0,7)!==to.toISOString().slice(0,7) || quantity===null || !version || !reason || reason.length>300) redirectAsset(assetId,"ucinak_neispravan");
  await requirePermissionForUser(user,{ firmaId:context.firmaId,modul:"osnovna_sredstva",akcija:deleting ? "delete" : usageId ? "update" : "create" });
  const metadata = await requestMetadata();
  try {
    await prisma.$transaction(async tx => {
      await lockFixedAssetYear(tx,context.poslovnaGodinaId!,context.firmaId!,user.agencija_id!);
      await assertFuturePeriodsOpen(tx,context.firmaId!,from);
      await lockAsset(tx,assetId,context.firmaId!,user.agencija_id!);
      const year = await tx.poslovnaGodina.findFirst({ where:{id:context.poslovnaGodinaId!,firma_id:context.firmaId!,firma:{agencija_id:user.agencija_id!,is_deleted:false,aktivan:true}} });
      const asset = await tx.osnovnoSredstvo.findFirst({where:{id:assetId,firma_id:context.firmaId!,agencija_id:user.agencija_id!,is_deleted:false,status:{in:["ACTIVE","DISPOSED"]}},include:{parametri:{orderBy:{vazi_od:"asc"}},ucinci:{where:{is_deleted:false}}}});
      if (!year || !asset || from<year.datum_od || to>year.datum_do || !asset.datum_raspolozivosti || from<asset.datum_raspolozivosti || (asset.datum_isknjizenja && to>=asset.datum_isknjizenja)) throw new Error("INVALID_USAGE");
      if (asset.verzija!==version) throw new Error("STALE_ASSET");
      await assertAssetHistoryUnposted(tx, assetId, from);
      const old = usageId ? asset.ucinci.find(u=>u.id===usageId && u.poslovna_godina_id===year.id) : null;
      if (usageId && !old || deleting && !old) throw new Error("INVALID_USAGE");
      if (old) {
        await assertFuturePeriodsOpen(tx,context.firmaId!,old.datum_od);
        await assertAssetHistoryUnposted(tx, assetId, old.datum_od);
      }
      const p = asset.parametri.filter(p=>p.vazi_od<=from).at(-1);
      if (!p || p.metoda!=="UNITS_OF_PRODUCTION" || asset.parametri.some(n=>n.vazi_od>from && n.vazi_od<=to)) throw new Error("INVALID_USAGE");
      // Once a later estimate is saved its opening basis depends on this usage history.
      if (asset.parametri.some(n=>n.vazi_od>from || (old && n.vazi_od>old.datum_od))) throw new Error("FUTURE_PARAMETER");
      if (!deleting && asset.ucinci.some(u=>u.id!==usageId && u.datum_od<=to && u.datum_do>=from)) throw new Error("OVERLAP");
      const used = asset.ucinci.filter(u=>u.id!==usageId && u.parametar_id===p.id).reduce((sum,u)=>sum+scaledDecimal(u.kolicina.toString())!,scaledDecimal(p.prethodni_ucinak?.toString()??"0")!);
      if (!deleting && used+quantity>scaledDecimal(p.ocekivani_ucinak?.toString())!) throw new Error("CAPACITY");
      const data = {datum_od:from,datum_do:to,kolicina:decimalString(quantity),razlog:reason,updated_by:user.id};
      const record = old
        ? await tx.osUcinak.update({where:{id:old.id},data:deleting ? {is_deleted:true,deleted_at:new Date(),deleted_by:user.id,razlog:reason,updated_by:user.id,verzija:{increment:1}} : {...data,parametar_id:p.id,verzija:{increment:1}}})
        : await tx.osUcinak.create({data:{...data,agencija_id:user.agencija_id!,firma_id:context.firmaId!,poslovna_godina_id:year.id,sredstvo_id:assetId,parametar_id:p.id,created_by:user.id}});
      await tx.osnovnoSredstvo.update({where:{id:asset.id},data:{verzija:{increment:1},updated_by:user.id}});
      await auditLogInTransaction(tx,{korisnikId:user.id,agencijaId:user.agencija_id!,firmaId:context.firmaId!,modul:"osnovna_sredstva",akcija:deleting?"delete_usage":old?"update_usage":"create_usage",tipEntiteta:"OsUcinak",entitetId:record.id,staraVrijednost:old,novaVrijednost:record},metadata);
    });
  } catch(error) {
    const code = error instanceof Error ? error.message : "";
    redirectAsset(assetId,({POSTED_HISTORY:"proknjizena_istorija",YEAR_LOCKED:"godina_zakljucena",VAT_PERIOD_LOCKED:"pdv_zakljucan",STALE_ASSET:"parametar_zastario",OVERLAP:"ucinak_preklapanje",CAPACITY:"ucinak_kapacitet",FUTURE_PARAMETER:"ucinak_zavisnost"} as Record<string,string>)[code] ?? "ucinak_neispravan");
  }
  revalidatePath(`/agencija/osnovna-sredstva/${assetId}`);
  revalidatePath("/agencija/osnovna-sredstva/obracuni");
  redirectAsset(assetId,"ucinak_sacuvan");
}
