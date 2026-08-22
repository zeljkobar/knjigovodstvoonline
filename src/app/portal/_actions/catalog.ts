"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import {
  calculateItemPriceAmounts,
  inventoryCentsToDecimal,
  itemPriceTypes,
  normalizeInventoryCode,
  parseInventoryMoneyToCents
} from "@/lib/inventory";
import { prisma } from "@/lib/prisma";

const priceTypes = new Set<string>([
  itemPriceTypes.wholesale,
  itemPriceTypes.retail,
  itemPriceTypes.promotional,
  itemPriceTypes.warehouse
]);

function value(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function nullableValue(formData: FormData, name: string) {
  return value(formData, name) || null;
}

function dateValue(formData: FormData, name: string) {
  const raw = value(formData, name);

  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw ? undefined : null;
  }

  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function integerValue(formData: FormData, name: string) {
  const raw = value(formData, name);

  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function portalRedirect(
  path: string,
  poruka: string,
  params?: Record<string, string | null | undefined>
): never {
  const search = new URLSearchParams({ poruka });

  Object.entries(params ?? {}).forEach(([key, entry]) => {
    if (entry) {
      search.set(key, entry);
    }
  });

  redirect(`${path}?${search.toString()}`);
}

async function requireCatalogMutation(
  action: "create" | "update",
  returnTo: string
) {
  const context = await requireDirectPortalContext(
    { modul: "robno", akcija: action },
    returnTo
  );

  if (context.year.zakljucena) {
    portalRedirect(returnTo, "godina_zakljucana");
  }

  return context;
}

function revalidateCatalog() {
  revalidatePath("/portal");
  revalidatePath("/portal/pos");
  revalidatePath("/portal/fakture");
  revalidatePath("/portal/artikli");
  revalidatePath("/portal/grupe");
  revalidatePath("/portal/cijene");
  revalidatePath("/portal/kupci");
}

async function itemReferences(input: {
  agencijaId: string;
  firmaId: string;
  groupId: string | null;
  unitId: string;
  vatRateId: string | null;
}) {
  const [group, unit, vatRate] = await Promise.all([
    input.groupId
      ? prisma.grupaArtikla.findFirst({
          where: {
            id: input.groupId,
            agencija_id: input.agencijaId,
            firma_id: input.firmaId,
            aktivna: true,
            is_deleted: false
          },
          select: { id: true }
        })
      : Promise.resolve(null),
    prisma.jedinicaMjere.findFirst({
      where: { id: input.unitId, aktivna: true },
      select: { id: true }
    }),
    input.vatRateId
      ? prisma.pdvStopa.findFirst({
          where: {
            id: input.vatRateId,
            agencija_id: input.agencijaId,
            aktivna: true
          },
          select: { id: true, procenat: true }
        })
      : Promise.resolve(null)
  ]);

  return {
    valid:
      Boolean(unit) &&
      (!input.groupId || Boolean(group)) &&
      (!input.vatRateId || Boolean(vatRate)),
    vatPercent: Number(vatRate?.procenat.toString() ?? "0")
  };
}

export async function createPortalItemGroup(formData: FormData) {
  const path = "/portal/grupe";
  const context = await requireCatalogMutation("create", path);
  const agencijaId = context.user.agencija_id!;
  const firmaId = context.firma.id;
  const sifra = normalizeInventoryCode(value(formData, "sifra"));
  const naziv = value(formData, "naziv");

  if (!sifra || !naziv || sifra.length > 30 || naziv.length > 160) {
    portalRedirect(path, "grupa_obavezno");
  }

  const existing = await prisma.grupaArtikla.findFirst({
    where: { firma_id: firmaId, sifra },
    select: { id: true }
  });

  if (existing) {
    portalRedirect(path, "grupa_postoji", { q: sifra });
  }

  const group = await prisma.grupaArtikla.create({
    data: {
      agencija_id: agencijaId,
      firma_id: firmaId,
      sifra,
      naziv,
      napomena: nullableValue(formData, "napomena"),
      created_by: context.user.id,
      updated_by: context.user.id
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId,
    firmaId,
    modul: "portal.artikli",
    akcija: "create_item_group",
    tipEntiteta: "GrupaArtikla",
    entitetId: group.id,
    novaVrijednost: group
  });

  revalidateCatalog();
  portalRedirect(path, "grupa_kreirana", { q: sifra });
}

export async function updatePortalItemGroup(formData: FormData) {
  const path = "/portal/grupe";
  const context = await requireCatalogMutation("update", path);
  const agencijaId = context.user.agencija_id!;
  const firmaId = context.firma.id;
  const id = value(formData, "grupa_id");
  const sifra = normalizeInventoryCode(value(formData, "sifra"));
  const naziv = value(formData, "naziv");

  if (!id || !sifra || !naziv || sifra.length > 30 || naziv.length > 160) {
    portalRedirect(path, "grupa_obavezno");
  }

  const [existing, duplicate] = await Promise.all([
    prisma.grupaArtikla.findFirst({
      where: {
        id,
        agencija_id: agencijaId,
        firma_id: firmaId,
        is_deleted: false
      }
    }),
    prisma.grupaArtikla.findFirst({
      where: { firma_id: firmaId, sifra, NOT: { id } },
      select: { id: true }
    })
  ]);

  if (!existing) {
    portalRedirect(path, "grupa_greska");
  }

  if (duplicate) {
    portalRedirect(path, "grupa_postoji");
  }

  const group = await prisma.grupaArtikla.update({
    where: { id },
    data: {
      sifra,
      naziv,
      napomena: nullableValue(formData, "napomena"),
      updated_by: context.user.id
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId,
    firmaId,
    modul: "portal.artikli",
    akcija: "update_item_group",
    tipEntiteta: "GrupaArtikla",
    entitetId: group.id,
    staraVrijednost: existing,
    novaVrijednost: group
  });

  revalidateCatalog();
  portalRedirect(path, "grupa_sacuvana");
}

export async function togglePortalItemGroup(formData: FormData) {
  const path = "/portal/grupe";
  const context = await requireCatalogMutation("update", path);
  const agencijaId = context.user.agencija_id!;
  const firmaId = context.firma.id;
  const id = value(formData, "grupa_id");
  const aktivna = value(formData, "aktivna") === "true";
  const existing = await prisma.grupaArtikla.findFirst({
    where: {
      id,
      agencija_id: agencijaId,
      firma_id: firmaId,
      is_deleted: false
    }
  });

  if (!existing) {
    portalRedirect(path, "grupa_greska");
  }

  const group = await prisma.grupaArtikla.update({
    where: { id },
    data: { aktivna, updated_by: context.user.id }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId,
    firmaId,
    modul: "portal.artikli",
    akcija: aktivna ? "activate_item_group" : "deactivate_item_group",
    tipEntiteta: "GrupaArtikla",
    entitetId: group.id,
    staraVrijednost: existing,
    novaVrijednost: group
  });

  revalidateCatalog();
  portalRedirect(path, aktivna ? "grupa_aktivirana" : "grupa_deaktivirana");
}

export async function createPortalItem(formData: FormData) {
  const path = "/portal/artikli/novi";
  const context = await requireCatalogMutation("create", path);
  const agencijaId = context.user.agencija_id!;
  const firmaId = context.firma.id;
  const manualCode = normalizeInventoryCode(value(formData, "sifra"));
  const naziv = value(formData, "naziv");
  const barkod = nullableValue(formData, "barkod");
  const groupId = nullableValue(formData, "grupa_artikla_id");
  const unitId = value(formData, "jedinica_mjere_id");
  const vatRateId = nullableValue(formData, "pdv_stopa_id");
  const usluga = value(formData, "usluga") === "on";
  const pratiZalihe = !usluga && value(formData, "prati_zalihe") === "on";
  const retailInput = nullableValue(formData, "maloprodajna_cijena");
  const wholesaleInput = nullableValue(formData, "veleprodajna_cijena");
  const retailCents = retailInput
    ? parseInventoryMoneyToCents(retailInput)
    : null;
  const wholesaleCents = wholesaleInput
    ? parseInventoryMoneyToCents(wholesaleInput)
    : null;

  if (
    !naziv ||
    !unitId ||
    naziv.length > 200 ||
    manualCode.length > 40 ||
    (barkod?.length ?? 0) > 80 ||
    (retailInput && (retailCents === null || retailCents < 0)) ||
    (wholesaleInput && (wholesaleCents === null || wholesaleCents < 0))
  ) {
    portalRedirect(path, "artikal_obavezno");
  }

  const references = await itemReferences({
    agencijaId,
    firmaId,
    groupId,
    unitId,
    vatRateId
  });

  if (!references.valid) {
    portalRedirect(path, "artikal_reference");
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(
          hashtext(${firmaId}),
          hashtext('artikli_sifra')
        )`
      );

      let sifra = manualCode;

      if (!sifra) {
        const rows = await tx.$queryRaw<Array<{ max_code: bigint | null }>>(
          Prisma.sql`SELECT MAX(CAST("sifra" AS bigint)) AS "max_code"
            FROM "artikli"
            WHERE "firma_id" = CAST(${firmaId} AS uuid)
              AND "sifra" ~ '^[0-9]+$'`
        );
        sifra = String((rows[0]?.max_code ?? BigInt(0)) + BigInt(1)).padStart(
          6,
          "0"
        );
      }

      if (sifra.length > 40) {
        throw new Error("ITEM_CODE_TOO_LONG");
      }

      const duplicate = await tx.artikal.findFirst({
        where: {
          firma_id: firmaId,
          OR: [{ sifra }, ...(barkod ? [{ barkod }] : [])]
        },
        select: { sifra: true, barkod: true }
      });

      if (duplicate?.sifra === sifra) {
        throw new Error("DUPLICATE_CODE");
      }

      if (barkod && duplicate?.barkod === barkod) {
        throw new Error("DUPLICATE_BARCODE");
      }

      const item = await tx.artikal.create({
        data: {
          agencija_id: agencijaId,
          firma_id: firmaId,
          grupa_artikla_id: groupId,
          jedinica_mjere_id: unitId,
          pdv_stopa_id: vatRateId,
          sifra,
          naziv,
          barkod,
          usluga,
          prati_zalihe: pratiZalihe,
          napomena: nullableValue(formData, "napomena"),
          created_by: context.user.id,
          updated_by: context.user.id
        }
      });
      const prices = [];

      if (wholesaleCents !== null) {
        const amounts = calculateItemPriceAmounts(
          "BEZ_PDV",
          wholesaleCents,
          references.vatPercent
        );
        prices.push(
          await tx.cijenaArtikla.create({
            data: {
              agencija_id: agencijaId,
              firma_id: firmaId,
              artikal_id: item.id,
              tip: itemPriceTypes.wholesale,
              cijena_bez_pdv: inventoryCentsToDecimal(amounts.netCents),
              cijena_sa_pdv: inventoryCentsToDecimal(amounts.grossCents),
              pdv_stopa_procenat: references.vatPercent.toFixed(2),
              created_by: context.user.id,
              updated_by: context.user.id
            }
          })
        );
      }

      if (retailCents !== null) {
        const amounts = calculateItemPriceAmounts(
          "SA_PDV",
          retailCents,
          references.vatPercent
        );
        prices.push(
          await tx.cijenaArtikla.create({
            data: {
              agencija_id: agencijaId,
              firma_id: firmaId,
              artikal_id: item.id,
              tip: itemPriceTypes.retail,
              cijena_bez_pdv: inventoryCentsToDecimal(amounts.netCents),
              cijena_sa_pdv: inventoryCentsToDecimal(amounts.grossCents),
              pdv_stopa_procenat: references.vatPercent.toFixed(2),
              created_by: context.user.id,
              updated_by: context.user.id
            }
          })
        );
      }

      return { item, prices };
    });

    await auditLog({
      korisnikId: context.user.id,
      agencijaId,
      firmaId,
      modul: "portal.artikli",
      akcija: "create_item",
      tipEntiteta: "Artikal",
      entitetId: result.item.id,
      novaVrijednost: result.item
    });

    for (const price of result.prices) {
      await auditLog({
        korisnikId: context.user.id,
        agencijaId,
        firmaId,
        modul: "portal.artikli",
        akcija: "create_item_price",
        tipEntiteta: "CijenaArtikla",
        entitetId: price.id,
        novaVrijednost: price
      });
    }

    revalidateCatalog();
    redirect(`/portal/artikli/${result.item.id}?poruka=artikal_kreiran`);
  } catch (error) {
    if (error instanceof Error && error.message === "DUPLICATE_CODE") {
      portalRedirect(path, "artikal_sifra_postoji");
    }

    if (error instanceof Error && error.message === "DUPLICATE_BARCODE") {
      portalRedirect(path, "artikal_barkod_postoji");
    }

    if (
      error instanceof Error &&
      (error.message === "ITEM_CODE_TOO_LONG" ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"))
    ) {
      portalRedirect(path, "artikal_sifra_postoji");
    }

    throw error;
  }
}

export async function updatePortalItem(formData: FormData) {
  const id = value(formData, "artikal_id");
  const path = id ? `/portal/artikli/${id}` : "/portal/artikli";
  const context = await requireCatalogMutation("update", path);
  const agencijaId = context.user.agencija_id!;
  const firmaId = context.firma.id;
  const sifra = normalizeInventoryCode(value(formData, "sifra"));
  const naziv = value(formData, "naziv");
  const barkod = nullableValue(formData, "barkod");
  const groupId = nullableValue(formData, "grupa_artikla_id");
  const unitId = value(formData, "jedinica_mjere_id");
  const vatRateId = nullableValue(formData, "pdv_stopa_id");
  const usluga = value(formData, "usluga") === "on";
  const pratiZalihe = !usluga && value(formData, "prati_zalihe") === "on";

  if (
    !id ||
    !sifra ||
    !naziv ||
    !unitId ||
    sifra.length > 40 ||
    naziv.length > 200 ||
    (barkod?.length ?? 0) > 80
  ) {
    portalRedirect(path, "artikal_obavezno");
  }

  const [existing, duplicate, references] = await Promise.all([
    prisma.artikal.findFirst({
      where: {
        id,
        agencija_id: agencijaId,
        firma_id: firmaId,
        is_deleted: false
      }
    }),
    prisma.artikal.findFirst({
      where: {
        firma_id: firmaId,
        NOT: { id },
        OR: [{ sifra }, ...(barkod ? [{ barkod }] : [])]
      },
      select: { sifra: true, barkod: true }
    }),
    itemReferences({ agencijaId, firmaId, groupId, unitId, vatRateId })
  ]);

  if (!existing) {
    portalRedirect("/portal/artikli", "artikal_greska");
  }

  if (duplicate?.sifra === sifra) {
    portalRedirect(path, "artikal_sifra_postoji");
  }

  if (barkod && duplicate?.barkod === barkod) {
    portalRedirect(path, "artikal_barkod_postoji");
  }

  if (!references.valid) {
    portalRedirect(path, "artikal_reference");
  }

  const item = await prisma.artikal.update({
    where: { id },
    data: {
      sifra,
      naziv,
      barkod,
      grupa_artikla_id: groupId,
      jedinica_mjere_id: unitId,
      pdv_stopa_id: vatRateId,
      usluga,
      prati_zalihe: pratiZalihe,
      napomena: nullableValue(formData, "napomena"),
      updated_by: context.user.id
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId,
    firmaId,
    modul: "portal.artikli",
    akcija: "update_item",
    tipEntiteta: "Artikal",
    entitetId: item.id,
    staraVrijednost: existing,
    novaVrijednost: item
  });

  revalidateCatalog();
  portalRedirect(path, "artikal_sacuvan");
}

export async function togglePortalItem(formData: FormData) {
  const id = value(formData, "artikal_id");
  const path = "/portal/artikli";
  const context = await requireCatalogMutation("update", path);
  const agencijaId = context.user.agencija_id!;
  const firmaId = context.firma.id;
  const aktivan = value(formData, "aktivan") === "true";
  const existing = await prisma.artikal.findFirst({
    where: {
      id,
      agencija_id: agencijaId,
      firma_id: firmaId,
      is_deleted: false
    }
  });

  if (!existing) {
    portalRedirect(path, "artikal_greska");
  }

  const item = await prisma.artikal.update({
    where: { id },
    data: { aktivan, updated_by: context.user.id }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId,
    firmaId,
    modul: "portal.artikli",
    akcija: aktivan ? "activate_item" : "deactivate_item",
    tipEntiteta: "Artikal",
    entitetId: item.id,
    staraVrijednost: existing,
    novaVrijednost: item
  });

  revalidateCatalog();
  portalRedirect(path, aktivan ? "artikal_aktiviran" : "artikal_deaktiviran");
}

async function resolvePriceInput(
  context: Awaited<ReturnType<typeof requireCatalogMutation>>,
  formData: FormData
) {
  const itemId = value(formData, "artikal_id");
  const rawType = value(formData, "tip");
  const type = priceTypes.has(rawType) ? rawType : "";
  const inputType =
    value(formData, "unos_tip") === "SA_PDV" ? "SA_PDV" : "BEZ_PDV";
  const amountCents = parseInventoryMoneyToCents(formData.get("iznos"));
  const validFrom = dateValue(formData, "vazi_od");
  const validTo = dateValue(formData, "vazi_do");
  const warehouseId = nullableValue(formData, "magacin_id");
  const agencijaId = context.user.agencija_id!;
  const firmaId = context.firma.id;

  if (
    !itemId ||
    !type ||
    amountCents === null ||
    amountCents < 0 ||
    validFrom === undefined ||
    validTo === undefined ||
    (validFrom && validTo && validTo < validFrom)
  ) {
    return null;
  }

  const [item, warehouse] = await Promise.all([
    prisma.artikal.findFirst({
      where: {
        id: itemId,
        agencija_id: agencijaId,
        firma_id: firmaId,
        is_deleted: false
      },
      select: {
        id: true,
        pdv_stopa: { select: { procenat: true } }
      }
    }),
    warehouseId
      ? prisma.magacin.findFirst({
          where: {
            id: warehouseId,
            agencija_id: agencijaId,
            firma_id: firmaId,
            aktivan: true,
            is_deleted: false
          },
          select: { id: true }
        })
      : Promise.resolve(null)
  ]);

  if (!item || (warehouseId && !warehouse)) {
    return null;
  }

  const vatPercent = Number(item.pdv_stopa?.procenat.toString() ?? "0");
  const amounts = calculateItemPriceAmounts(
    inputType,
    amountCents,
    vatPercent
  );

  return {
    itemId,
    type,
    vatPercent,
    amounts,
    validFrom,
    validTo,
    warehouseId,
    note: nullableValue(formData, "napomena")
  };
}

export async function createPortalItemPrice(formData: FormData) {
  const path = "/portal/cijene";
  const context = await requireCatalogMutation("create", path);
  const resolved = await resolvePriceInput(context, formData);

  if (!resolved) {
    portalRedirect(path, "cijena_obavezno", {
      artikal_id: value(formData, "artikal_id")
    });
  }

  const agencijaId = context.user.agencija_id!;
  const firmaId = context.firma.id;
  const price = await prisma.cijenaArtikla.create({
    data: {
      agencija_id: agencijaId,
      firma_id: firmaId,
      artikal_id: resolved.itemId,
      tip: resolved.type,
      cijena_bez_pdv: inventoryCentsToDecimal(resolved.amounts.netCents),
      cijena_sa_pdv: inventoryCentsToDecimal(resolved.amounts.grossCents),
      pdv_stopa_procenat: resolved.vatPercent.toFixed(2),
      valuta: "EUR",
      magacin_id: resolved.warehouseId,
      vazi_od: resolved.validFrom,
      vazi_do: resolved.validTo,
      napomena: resolved.note,
      created_by: context.user.id,
      updated_by: context.user.id
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId,
    firmaId,
    modul: "portal.artikli",
    akcija: "create_item_price",
    tipEntiteta: "CijenaArtikla",
    entitetId: price.id,
    novaVrijednost: price
  });

  revalidateCatalog();
  portalRedirect(path, "cijena_kreirana", { artikal_id: resolved.itemId });
}

export async function updatePortalItemPrice(formData: FormData) {
  const path = "/portal/cijene";
  const context = await requireCatalogMutation("update", path);
  const priceId = value(formData, "cijena_id");
  const resolved = await resolvePriceInput(context, formData);
  const agencijaId = context.user.agencija_id!;
  const firmaId = context.firma.id;

  if (!priceId || !resolved) {
    portalRedirect(path, "cijena_obavezno", {
      artikal_id: value(formData, "artikal_id")
    });
  }

  const existing = await prisma.cijenaArtikla.findFirst({
    where: {
      id: priceId,
      agencija_id: agencijaId,
      firma_id: firmaId,
      artikal_id: resolved.itemId,
      is_deleted: false
    }
  });

  if (!existing) {
    portalRedirect(path, "cijena_greska", { artikal_id: resolved.itemId });
  }

  const price = await prisma.cijenaArtikla.update({
    where: { id: priceId },
    data: {
      tip: resolved.type,
      cijena_bez_pdv: inventoryCentsToDecimal(resolved.amounts.netCents),
      cijena_sa_pdv: inventoryCentsToDecimal(resolved.amounts.grossCents),
      pdv_stopa_procenat: resolved.vatPercent.toFixed(2),
      magacin_id: resolved.warehouseId,
      vazi_od: resolved.validFrom,
      vazi_do: resolved.validTo,
      napomena: resolved.note,
      updated_by: context.user.id
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId,
    firmaId,
    modul: "portal.artikli",
    akcija: "update_item_price",
    tipEntiteta: "CijenaArtikla",
    entitetId: price.id,
    staraVrijednost: existing,
    novaVrijednost: price
  });

  revalidateCatalog();
  portalRedirect(path, "cijena_sacuvana", { artikal_id: resolved.itemId });
}

export async function togglePortalItemPrice(formData: FormData) {
  const path = "/portal/cijene";
  const context = await requireCatalogMutation("update", path);
  const agencijaId = context.user.agencija_id!;
  const firmaId = context.firma.id;
  const priceId = value(formData, "cijena_id");
  const itemId = value(formData, "artikal_id");
  const aktivna = value(formData, "aktivna") === "true";
  const existing = await prisma.cijenaArtikla.findFirst({
    where: {
      id: priceId,
      agencija_id: agencijaId,
      firma_id: firmaId,
      artikal_id: itemId,
      is_deleted: false
    }
  });

  if (!existing) {
    portalRedirect(path, "cijena_greska", { artikal_id: itemId });
  }

  const price = await prisma.cijenaArtikla.update({
    where: { id: priceId },
    data: { aktivna, updated_by: context.user.id }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId,
    firmaId,
    modul: "portal.artikli",
    akcija: aktivna ? "activate_item_price" : "deactivate_item_price",
    tipEntiteta: "CijenaArtikla",
    entitetId: price.id,
    staraVrijednost: existing,
    novaVrijednost: price
  });

  revalidateCatalog();
  portalRedirect(path, aktivna ? "cijena_aktivirana" : "cijena_deaktivirana", {
    artikal_id: itemId
  });
}

function customerData(formData: FormData) {
  const isForeign = value(formData, "is_foreign") === "1";
  const countryCode = nullableValue(formData, "country_code")?.toUpperCase() ?? null;
  const registrationDate = dateValue(formData, "datum_registracije");
  const paymentDays = integerValue(formData, "rok_placanja_dana");

  if (registrationDate === undefined || paymentDays === undefined) {
    return null;
  }

  return {
    naziv: value(formData, "naziv"),
    pib: nullableValue(formData, "pib"),
    maticni_broj: nullableValue(formData, "maticni_broj"),
    pdv_broj: nullableValue(formData, "pdv_broj"),
    pravna_forma: nullableValue(formData, "pravna_forma"),
    sifra_djelatnosti: nullableValue(formData, "sifra_djelatnosti"),
    datum_registracije: registrationDate,
    is_foreign: isForeign,
    country_code: countryCode,
    country_name: nullableValue(formData, "country_name"),
    foreign_tax_number: nullableValue(formData, "foreign_tax_number"),
    adresa: nullableValue(formData, "adresa"),
    grad: nullableValue(formData, "grad"),
    drzava: nullableValue(formData, "drzava") ?? "Crna Gora",
    telefon: nullableValue(formData, "telefon"),
    email: nullableValue(formData, "email"),
    web_sajt: nullableValue(formData, "web_sajt"),
    sifraUFirmi: nullableValue(formData, "sifra_u_firmi"),
    paymentDays,
    note: nullableValue(formData, "napomena")
  };
}

function customerDataValid(data: NonNullable<ReturnType<typeof customerData>>) {
  if (!data.naziv || data.naziv.length > 240) {
    return false;
  }

  if (data.pib && !/^\d{8}$/.test(data.pib)) {
    return false;
  }

  if (
    data.is_foreign &&
    (!data.country_code ||
      !/^[A-Z]{2}$/.test(data.country_code) ||
      !data.foreign_tax_number)
  ) {
    return false;
  }

  return true;
}

export async function createPortalCustomer(formData: FormData) {
  const path = "/portal/kupci/novi";
  const context = await requireCatalogMutation("create", path);
  const agencijaId = context.user.agencija_id!;
  const firmaId = context.firma.id;
  const data = customerData(formData);

  if (!data || !customerDataValid(data)) {
    portalRedirect(path, "kupac_obavezno");
  }

  const result = await prisma.$transaction(async (tx) => {
    const existing = data.pib
      ? await tx.komitent.findFirst({
          where: {
            pib: data.pib,
            aktivan: true,
            OR: [
              { scope: "GLOBAL" },
              { scope: "COMPANY", firma_id: firmaId }
            ]
          }
        })
      : null;

    if (existing?.scope === "COMPANY") {
      throw new Error("DUPLICATE_CUSTOMER");
    }

    const customer =
      existing ??
      (await tx.komitent.create({
        data: {
          naziv: data.naziv,
          scope: "COMPANY",
          agencija_id: agencijaId,
          firma_id: firmaId,
          pib: data.pib,
          maticni_broj: data.maticni_broj,
          pdv_broj: data.pdv_broj,
          pravna_forma: data.pravna_forma,
          sifra_djelatnosti: data.sifra_djelatnosti,
          datum_registracije: data.datum_registracije,
          is_foreign: data.is_foreign,
          country_code: data.country_code,
          country_name: data.country_name,
          foreign_tax_number: data.foreign_tax_number,
          adresa: data.adresa,
          grad: data.grad,
          drzava: data.drzava,
          telefon: data.telefon,
          email: data.email,
          web_sajt: data.web_sajt,
          aktivan: true
        }
      }));

    await tx.firmaKomitent.upsert({
      where: {
        firma_id_komitent_id: {
          firma_id: firmaId,
          komitent_id: customer.id
        }
      },
      create: {
        firma_id: firmaId,
        komitent_id: customer.id,
        tip_komitenta: "kupac",
        sifra_u_firmi: data.sifraUFirmi,
        rok_placanja_dana: data.paymentDays,
        napomena: data.note,
        aktivan: true
      },
      update: {
        tip_komitenta: "kupac",
        sifra_u_firmi: data.sifraUFirmi,
        rok_placanja_dana: data.paymentDays,
        napomena: data.note,
        aktivan: true
      }
    });

    return { customer, linked: Boolean(existing) };
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "DUPLICATE_CUSTOMER") {
      return "DUPLICATE" as const;
    }

    throw error;
  });

  if (result === "DUPLICATE") {
    portalRedirect(path, "kupac_postoji");
  }

  await auditLog({
    korisnikId: context.user.id,
    agencijaId,
    firmaId,
    modul: "portal.kupci",
    akcija: result.linked ? "connect_global_customer" : "create_customer",
    tipEntiteta: "Komitent",
    entitetId: result.customer.id,
    novaVrijednost: {
      id: result.customer.id,
      naziv: result.customer.naziv,
      pib: result.customer.pib,
      scope: result.customer.scope
    }
  });

  revalidateCatalog();
  redirect(
    `/portal/kupci/${result.customer.id}?poruka=${
      result.linked ? "kupac_povezan" : "kupac_kreiran"
    }`
  );
}

export async function updatePortalCustomer(formData: FormData) {
  const id = value(formData, "partner_id");
  const path = id ? `/portal/kupci/${id}` : "/portal/kupci";
  const context = await requireCatalogMutation("update", path);
  const agencijaId = context.user.agencija_id!;
  const firmaId = context.firma.id;
  const data = customerData(formData);

  if (!id || !data || !customerDataValid(data)) {
    portalRedirect(path, "kupac_obavezno");
  }

  const existing = await prisma.komitent.findFirst({
    where: {
      id,
      scope: "COMPANY",
      agencija_id: agencijaId,
      firma_id: firmaId
    },
    include: {
      firme: { where: { firma_id: firmaId }, take: 1 }
    }
  });

  if (!existing) {
    portalRedirect(path, "kupac_samo_citanje");
  }

  if (data.pib) {
    const duplicate = await prisma.komitent.findFirst({
      where: {
        pib: data.pib,
        NOT: { id },
        OR: [
          { scope: "GLOBAL" },
          { scope: "COMPANY", firma_id: firmaId }
        ]
      },
      select: { id: true }
    });

    if (duplicate) {
      portalRedirect(path, "kupac_postoji");
    }
  }

  const customer = await prisma.$transaction(async (tx) => {
    const updated = await tx.komitent.update({
      where: { id },
      data: {
        naziv: data.naziv,
        pib: data.pib,
        maticni_broj: data.maticni_broj,
        pdv_broj: data.pdv_broj,
        pravna_forma: data.pravna_forma,
        sifra_djelatnosti: data.sifra_djelatnosti,
        datum_registracije: data.datum_registracije,
        is_foreign: data.is_foreign,
        country_code: data.country_code,
        country_name: data.country_name,
        foreign_tax_number: data.foreign_tax_number,
        adresa: data.adresa,
        grad: data.grad,
        drzava: data.drzava,
        telefon: data.telefon,
        email: data.email,
        web_sajt: data.web_sajt,
        aktivan: true
      }
    });

    await tx.firmaKomitent.upsert({
      where: {
        firma_id_komitent_id: { firma_id: firmaId, komitent_id: id }
      },
      create: {
        firma_id: firmaId,
        komitent_id: id,
        tip_komitenta: "kupac",
        sifra_u_firmi: data.sifraUFirmi,
        rok_placanja_dana: data.paymentDays,
        napomena: data.note,
        aktivan: true
      },
      update: {
        tip_komitenta: "kupac",
        sifra_u_firmi: data.sifraUFirmi,
        rok_placanja_dana: data.paymentDays,
        napomena: data.note,
        aktivan: true
      }
    });

    return updated;
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId,
    firmaId,
    modul: "portal.kupci",
    akcija: "update_customer",
    tipEntiteta: "Komitent",
    entitetId: customer.id,
    staraVrijednost: existing,
    novaVrijednost: customer
  });

  revalidateCatalog();
  portalRedirect(path, "kupac_sacuvan");
}

export async function togglePortalCustomer(formData: FormData) {
  const path = "/portal/kupci";
  const context = await requireCatalogMutation("update", path);
  const agencijaId = context.user.agencija_id!;
  const firmaId = context.firma.id;
  const id = value(formData, "partner_id");
  const aktivan = value(formData, "aktivan") === "true";
  const link = await prisma.firmaKomitent.findFirst({
    where: {
      firma_id: firmaId,
      komitent_id: id,
      komitent: {
        OR: [
          { scope: "GLOBAL" },
          { scope: "COMPANY", firma_id: firmaId, agencija_id: agencijaId }
        ]
      }
    },
    include: { komitent: true }
  });

  if (!link) {
    portalRedirect(path, "kupac_greska");
  }

  await prisma.$transaction(async (tx) => {
    await tx.firmaKomitent.update({
      where: { id: link.id },
      data: { aktivan }
    });

    if (link.komitent.scope === "COMPANY") {
      await tx.komitent.update({ where: { id }, data: { aktivan } });
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId,
    firmaId,
    modul: "portal.kupci",
    akcija: aktivan ? "activate_customer" : "deactivate_customer",
    tipEntiteta: "Komitent",
    entitetId: id,
    staraVrijednost: { aktivan: link.aktivan },
    novaVrijednost: { aktivan }
  });

  revalidateCatalog();
  portalRedirect(path, aktivan ? "kupac_aktiviran" : "kupac_deaktiviran");
}
