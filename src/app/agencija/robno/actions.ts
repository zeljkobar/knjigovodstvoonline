"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { requireAnyRole } from "@/lib/auth";
import {
  calculateItemPriceAmounts,
  initialItemPriceTypes,
  inventoryCentsToDecimal,
  inventoryModule,
  itemPriceTypes,
  normalizeInventoryCode,
  parseInventoryMoneyToCents
} from "@/lib/inventory";
import { hasPermission, type PermissionAction } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

function text(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function nullableText(value: FormDataEntryValue | null) {
  const normalized = text(value);

  return normalized || null;
}

function dateValue(value: FormDataEntryValue | null) {
  const normalized = text(value);

  if (!normalized) {
    return null;
  }

  const parsed = new Date(`${normalized}T00:00:00.000Z`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function inventoryRedirect(
  path: string,
  poruka: string,
  params?: Record<string, string | null | undefined>
): never {
  const search = new URLSearchParams({
    poruka
  });

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value) {
      search.set(key, value);
    }
  });

  redirect(`${path}?${search.toString()}`);
}

async function requireInventoryActionContext(
  action: PermissionAction,
  path: string,
  expectedFirmaId: string
) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (
    !user.agencija_id ||
    !workContext.firmaId ||
    !expectedFirmaId ||
    workContext.firmaId !== expectedFirmaId
  ) {
    inventoryRedirect(path, "kontekst");
  }

  const [firma, allowed] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: expectedFirmaId,
        agencija_id: user.agencija_id,
        is_deleted: false,
        aktivan: true,
        ...(user.rola === "admin_agencije"
          ? {}
          : {
              korisnici: {
                some: {
                  korisnik_id: user.id,
                  is_deleted: false
                }
              }
            })
      },
      select: {
        id: true,
        naziv: true,
        dozvoli_negativan_lager: true
      }
    }),
    hasPermission(user, {
      firmaId: expectedFirmaId,
      modul: inventoryModule,
      akcija: action
    })
  ]);

  if (!firma) {
    inventoryRedirect(path, "kontekst");
  }

  if (!allowed) {
    inventoryRedirect(path, "prava");
  }

  return {
    user,
    agencijaId: user.agencija_id,
    firma
  };
}

function inventoryRevalidate() {
  revalidatePath("/agencija/robno");
  revalidatePath("/agencija/robno/sifarnici");
  revalidatePath("/agencija/robno/grupe");
  revalidatePath("/agencija/robno/artikli");
  revalidatePath("/agencija/robno/cijene");
  revalidatePath("/agencija/robno/magacini");
}

function queryParams(formData: FormData) {
  return {
    q: nullableText(formData.get("q")),
    status: nullableText(formData.get("status")),
    tip: nullableText(formData.get("tip")),
    grupa: nullableText(formData.get("grupa"))
  };
}

export async function createItemGroup(formData: FormData) {
  const path = "/agencija/robno/grupe";
  const firmaId = text(formData.get("firma_id"));
  const context = await requireInventoryActionContext("create", path, firmaId);
  const sifra = normalizeInventoryCode(text(formData.get("sifra")));
  const naziv = text(formData.get("naziv"));

  if (!sifra || !naziv) {
    inventoryRedirect(path, "grupa_obavezno");
  }

  const existing = await prisma.grupaArtikla.findFirst({
    where: {
      firma_id: firmaId,
      sifra
    },
    select: {
      id: true
    }
  });

  if (existing) {
    inventoryRedirect(path, "grupa_postoji", {
      q: sifra
    });
  }

  const group = await prisma.grupaArtikla.create({
    data: {
      agencija_id: context.agencijaId,
      firma_id: firmaId,
      sifra,
      naziv,
      napomena: nullableText(formData.get("napomena")),
      created_by: context.user.id,
      updated_by: context.user.id
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "create_item_group",
    tipEntiteta: "GrupaArtikla",
    entitetId: group.id,
    novaVrijednost: group
  });

  inventoryRevalidate();
  inventoryRedirect(path, "grupa_kreirana", {
    q: sifra
  });
}

export async function updateItemGroup(formData: FormData) {
  const path = "/agencija/robno/grupe";
  const firmaId = text(formData.get("firma_id"));
  const groupId = text(formData.get("grupa_id"));
  const params = queryParams(formData);
  const context = await requireInventoryActionContext("update", path, firmaId);
  const sifra = normalizeInventoryCode(text(formData.get("sifra")));
  const naziv = text(formData.get("naziv"));

  if (!groupId || !sifra || !naziv) {
    inventoryRedirect(path, "grupa_obavezno", params);
  }

  const [existingGroup, duplicate] = await Promise.all([
    prisma.grupaArtikla.findFirst({
      where: {
        id: groupId,
        agencija_id: context.agencijaId,
        firma_id: firmaId,
        is_deleted: false
      }
    }),
    prisma.grupaArtikla.findFirst({
      where: {
        firma_id: firmaId,
        sifra,
        NOT: {
          id: groupId
        }
      },
      select: {
        id: true
      }
    })
  ]);

  if (!existingGroup) {
    inventoryRedirect(path, "grupa_greska", params);
  }

  if (duplicate) {
    inventoryRedirect(path, "grupa_postoji", params);
  }

  const group = await prisma.grupaArtikla.update({
    where: {
      id: groupId
    },
    data: {
      sifra,
      naziv,
      napomena: nullableText(formData.get("napomena")),
      updated_by: context.user.id
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "update_item_group",
    tipEntiteta: "GrupaArtikla",
    entitetId: group.id,
    staraVrijednost: existingGroup,
    novaVrijednost: group
  });

  inventoryRevalidate();
  inventoryRedirect(path, "grupa_sacuvana", params);
}

export async function toggleItemGroup(formData: FormData) {
  const path = "/agencija/robno/grupe";
  const firmaId = text(formData.get("firma_id"));
  const groupId = text(formData.get("grupa_id"));
  const params = queryParams(formData);
  const context = await requireInventoryActionContext("update", path, firmaId);
  const aktivna = text(formData.get("aktivna")) === "true";

  const existingGroup = await prisma.grupaArtikla.findFirst({
    where: {
      id: groupId,
      agencija_id: context.agencijaId,
      firma_id: firmaId,
      is_deleted: false
    }
  });

  if (!existingGroup) {
    inventoryRedirect(path, "grupa_greska", params);
  }

  const group = await prisma.grupaArtikla.update({
    where: {
      id: groupId
    },
    data: {
      aktivna,
      updated_by: context.user.id
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: aktivna ? "activate_item_group" : "deactivate_item_group",
    tipEntiteta: "GrupaArtikla",
    entitetId: group.id,
    staraVrijednost: existingGroup,
    novaVrijednost: group
  });

  inventoryRevalidate();
  inventoryRedirect(path, aktivna ? "grupa_aktivirana" : "grupa_deaktivirana", params);
}

async function validateItemReferences(
  agencijaId: string,
  firmaId: string,
  groupId: string | null,
  unitId: string,
  vatRateId: string | null
) {
  const [group, unit, vatRate] = await Promise.all([
    groupId
      ? prisma.grupaArtikla.findFirst({
          where: {
            id: groupId,
            agencija_id: agencijaId,
            firma_id: firmaId,
            aktivna: true,
            is_deleted: false
          },
          select: {
            id: true
          }
        })
      : Promise.resolve(null),
    prisma.jedinicaMjere.findFirst({
      where: {
        id: unitId,
        aktivna: true
      },
      select: {
        id: true
      }
    }),
    vatRateId
      ? prisma.pdvStopa.findFirst({
          where: {
            id: vatRateId,
            agencija_id: agencijaId,
            aktivna: true
          },
          select: {
            id: true,
            procenat: true
          }
        })
      : Promise.resolve(null)
  ]);

  return {
    groupValid: !groupId || Boolean(group),
    unitValid: Boolean(unit),
    vatRateValid: !vatRateId || Boolean(vatRate),
    vatPercent: Number(vatRate?.procenat.toString() ?? "0")
  };
}

export async function createItem(formData: FormData) {
  const path = "/agencija/robno/artikli";
  const firmaId = text(formData.get("firma_id"));
  const params = queryParams(formData);
  const context = await requireInventoryActionContext("create", path, firmaId);
  const manualCode = normalizeInventoryCode(text(formData.get("sifra")));
  const naziv = text(formData.get("naziv"));
  const barkod = nullableText(formData.get("barkod"));
  const groupId = nullableText(formData.get("grupa_artikla_id"));
  const unitId = text(formData.get("jedinica_mjere_id"));
  const vatRateId = nullableText(formData.get("pdv_stopa_id"));
  const usluga = text(formData.get("usluga")) === "on";
  const lastPurchasePriceInput = nullableText(formData.get("posljednja_nabavna_cijena"));
  const lastPurchasePriceCents = lastPurchasePriceInput
    ? parseInventoryMoneyToCents(lastPurchasePriceInput)
    : null;
  const wholesalePriceInput = nullableText(formData.get("veleprodajna_cijena"));
  const wholesalePriceCents = wholesalePriceInput
    ? parseInventoryMoneyToCents(wholesalePriceInput)
    : null;
  const retailPriceInput = nullableText(formData.get("maloprodajna_cijena"));
  const retailPriceCents = retailPriceInput
    ? parseInventoryMoneyToCents(retailPriceInput)
    : null;

  if (
    !naziv ||
    !unitId ||
    (lastPurchasePriceInput &&
      (lastPurchasePriceCents === null || lastPurchasePriceCents < 0))
  ) {
    inventoryRedirect(path, "artikal_obavezno", params);
  }

  if (
    (wholesalePriceInput &&
      (wholesalePriceCents === null || wholesalePriceCents < 0)) ||
    (retailPriceInput && (retailPriceCents === null || retailPriceCents < 0))
  ) {
    inventoryRedirect(path, "artikal_cijena", params);
  }

  const references = await validateItemReferences(
    context.agencijaId,
    firmaId,
    groupId,
    unitId,
    vatRateId
  );

  if (!references.groupValid || !references.unitValid || !references.vatRateValid) {
    inventoryRedirect(path, "artikal_reference", params);
  }

  const { item, prices } = await prisma.$transaction(async (tx) => {
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
      const nextCode = Number(rows[0]?.max_code ?? 0) + 1;
      sifra = String(nextCode).padStart(6, "0");
    }

    const duplicate = await tx.artikal.findFirst({
      where: {
        firma_id: firmaId,
        OR: [
          {
            sifra
          },
          ...(barkod
            ? [
                {
                  barkod
                }
              ]
            : [])
        ]
      },
      select: {
        sifra: true,
        barkod: true
      }
    });

    if (duplicate?.sifra === sifra) {
      inventoryRedirect(path, "artikal_sifra_postoji", params);
    }

    if (barkod && duplicate?.barkod === barkod) {
      inventoryRedirect(path, "artikal_barkod_postoji", params);
    }

    const item = await tx.artikal.create({
      data: {
        agencija_id: context.agencijaId,
        firma_id: firmaId,
        grupa_artikla_id: groupId,
        jedinica_mjere_id: unitId,
        pdv_stopa_id: vatRateId,
        sifra,
        naziv,
        barkod,
        usluga,
        prati_zalihe: !usluga,
        posljednja_nabavna_cijena:
          lastPurchasePriceCents === null
            ? null
            : inventoryCentsToDecimal(lastPurchasePriceCents),
        napomena: nullableText(formData.get("napomena")),
        created_by: context.user.id,
        updated_by: context.user.id
      }
    });

    const prices = [];

    if (wholesalePriceCents !== null) {
      const amounts = calculateItemPriceAmounts(
        "BEZ_PDV",
        wholesalePriceCents,
        references.vatPercent
      );
      prices.push(
        await tx.cijenaArtikla.create({
          data: {
            agencija_id: context.agencijaId,
            firma_id: firmaId,
            artikal_id: item.id,
            tip: itemPriceTypes.wholesale,
            cijena_bez_pdv: inventoryCentsToDecimal(amounts.netCents),
            cijena_sa_pdv: inventoryCentsToDecimal(amounts.grossCents),
            pdv_stopa_procenat: references.vatPercent.toFixed(2),
            valuta: "EUR",
            created_by: context.user.id,
            updated_by: context.user.id
          }
        })
      );
    }

    if (retailPriceCents !== null) {
      const amounts = calculateItemPriceAmounts(
        "SA_PDV",
        retailPriceCents,
        references.vatPercent
      );
      prices.push(
        await tx.cijenaArtikla.create({
          data: {
            agencija_id: context.agencijaId,
            firma_id: firmaId,
            artikal_id: item.id,
            tip: itemPriceTypes.retail,
            cijena_bez_pdv: inventoryCentsToDecimal(amounts.netCents),
            cijena_sa_pdv: inventoryCentsToDecimal(amounts.grossCents),
            pdv_stopa_procenat: references.vatPercent.toFixed(2),
            valuta: "EUR",
            created_by: context.user.id,
            updated_by: context.user.id
          }
        })
      );
    }

    return {
      item,
      prices
    };
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "create_item",
    tipEntiteta: "Artikal",
    entitetId: item.id,
    novaVrijednost: item
  });

  for (const price of prices) {
    await auditLog({
      korisnikId: context.user.id,
      agencijaId: context.agencijaId,
      firmaId,
      modul: inventoryModule,
      akcija: "create_item_price",
      tipEntiteta: "CijenaArtikla",
      entitetId: price.id,
      novaVrijednost: price,
      napomena: "Početna cijena unesena prilikom kreiranja artikla."
    });
  }

  inventoryRevalidate();
  inventoryRedirect(path, "artikal_kreiran", {
    ...params,
    q: item.sifra
  });
}

export async function updateItem(formData: FormData) {
  const path = "/agencija/robno/artikli";
  const firmaId = text(formData.get("firma_id"));
  const itemId = text(formData.get("artikal_id"));
  const params = queryParams(formData);
  const context = await requireInventoryActionContext("update", path, firmaId);
  const sifra = normalizeInventoryCode(text(formData.get("sifra")));
  const naziv = text(formData.get("naziv"));
  const barkod = nullableText(formData.get("barkod"));
  const groupId = nullableText(formData.get("grupa_artikla_id"));
  const unitId = text(formData.get("jedinica_mjere_id"));
  const vatRateId = nullableText(formData.get("pdv_stopa_id"));
  const usluga = text(formData.get("usluga")) === "on";
  const lastPurchasePriceInput = nullableText(formData.get("posljednja_nabavna_cijena"));
  const lastPurchasePriceCents = lastPurchasePriceInput
    ? parseInventoryMoneyToCents(lastPurchasePriceInput)
    : null;

  if (
    !itemId ||
    !sifra ||
    !naziv ||
    !unitId ||
    (lastPurchasePriceInput &&
      (lastPurchasePriceCents === null || lastPurchasePriceCents < 0))
  ) {
    inventoryRedirect(path, "artikal_obavezno", params);
  }

  const [existingItem, duplicate, references] = await Promise.all([
    prisma.artikal.findFirst({
      where: {
        id: itemId,
        agencija_id: context.agencijaId,
        firma_id: firmaId,
        is_deleted: false
      }
    }),
    prisma.artikal.findFirst({
      where: {
        firma_id: firmaId,
        NOT: {
          id: itemId
        },
        OR: [
          {
            sifra
          },
          ...(barkod
            ? [
                {
                  barkod
                }
              ]
            : [])
        ]
      },
      select: {
        sifra: true,
        barkod: true
      }
    }),
    validateItemReferences(context.agencijaId, firmaId, groupId, unitId, vatRateId)
  ]);

  if (!existingItem) {
    inventoryRedirect(path, "artikal_greska", params);
  }

  if (duplicate?.sifra === sifra) {
    inventoryRedirect(path, "artikal_sifra_postoji", params);
  }

  if (barkod && duplicate?.barkod === barkod) {
    inventoryRedirect(path, "artikal_barkod_postoji", params);
  }

  if (!references.groupValid || !references.unitValid || !references.vatRateValid) {
    inventoryRedirect(path, "artikal_reference", params);
  }

  const item = await prisma.artikal.update({
    where: {
      id: itemId
    },
    data: {
      grupa_artikla_id: groupId,
      jedinica_mjere_id: unitId,
      pdv_stopa_id: vatRateId,
      sifra,
      naziv,
      barkod,
      usluga,
      prati_zalihe: !usluga,
      posljednja_nabavna_cijena:
        lastPurchasePriceCents === null
          ? null
          : inventoryCentsToDecimal(lastPurchasePriceCents),
      napomena: nullableText(formData.get("napomena")),
      updated_by: context.user.id
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "update_item",
    tipEntiteta: "Artikal",
    entitetId: item.id,
    staraVrijednost: existingItem,
    novaVrijednost: item
  });

  inventoryRevalidate();
  inventoryRedirect(path, "artikal_sacuvan", params);
}

export async function toggleItem(formData: FormData) {
  const path = "/agencija/robno/artikli";
  const firmaId = text(formData.get("firma_id"));
  const itemId = text(formData.get("artikal_id"));
  const params = queryParams(formData);
  const context = await requireInventoryActionContext("update", path, firmaId);
  const aktivan = text(formData.get("aktivan")) === "true";

  const existingItem = await prisma.artikal.findFirst({
    where: {
      id: itemId,
      agencija_id: context.agencijaId,
      firma_id: firmaId,
      is_deleted: false
    }
  });

  if (!existingItem) {
    inventoryRedirect(path, "artikal_greska", params);
  }

  const item = await prisma.artikal.update({
    where: {
      id: itemId
    },
    data: {
      aktivan,
      updated_by: context.user.id
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: aktivan ? "activate_item" : "deactivate_item",
    tipEntiteta: "Artikal",
    entitetId: item.id,
    staraVrijednost: existingItem,
    novaVrijednost: item
  });

  inventoryRevalidate();
  inventoryRedirect(path, aktivan ? "artikal_aktiviran" : "artikal_deaktiviran", params);
}

function warehouseNegativeStockValue(value: string) {
  if (value === "ALLOW") {
    return true;
  }

  if (value === "BLOCK") {
    return false;
  }

  return null;
}

async function resolveWarehouseBusinessUnit(
  businessUnitId: string,
  agencijaId: string,
  firmaId: string
) {
  if (!businessUnitId) return null;

  return prisma.poslovnaJedinica.findFirst({
    where: {
      id: businessUnitId,
      agencija_id: agencijaId,
      firma_id: firmaId,
      aktivna: true,
      is_deleted: false
    },
    select: { id: true }
  });
}

export async function createWarehouse(formData: FormData) {
  const path = "/agencija/robno/magacini";
  const firmaId = text(formData.get("firma_id"));
  const context = await requireInventoryActionContext("create", path, firmaId);
  const sifra = normalizeInventoryCode(text(formData.get("sifra")));
  const naziv = text(formData.get("naziv"));
  const businessUnitId = text(formData.get("poslovna_jedinica_id"));
  const salesType = text(formData.get("tip_prodaje")) === "WHOLESALE" ? "WHOLESALE" : "RETAIL";

  if (!sifra || !naziv) {
    inventoryRedirect(path, "magacin_obavezno");
  }

  const businessUnit = await resolveWarehouseBusinessUnit(
    businessUnitId,
    context.agencijaId,
    firmaId
  );
  if (businessUnitId && !businessUnit) {
    inventoryRedirect(path, "poslovna_jedinica_greska");
  }

  const existing = await prisma.magacin.findFirst({
    where: {
      firma_id: firmaId,
      sifra
    },
    select: {
      id: true
    }
  });

  if (existing) {
    inventoryRedirect(path, "magacin_postoji", {
      q: sifra
    });
  }

  const warehouse = await prisma.magacin.create({
    data: {
      agencija_id: context.agencijaId,
      firma_id: firmaId,
      sifra,
      naziv,
      poslovna_jedinica_id: businessUnit?.id ?? null,
      tip_prodaje: salesType,
      dozvoli_negativan_lager: warehouseNegativeStockValue(
        text(formData.get("negativan_lager"))
      ),
      napomena: nullableText(formData.get("napomena")),
      created_by: context.user.id,
      updated_by: context.user.id
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "create_warehouse",
    tipEntiteta: "Magacin",
    entitetId: warehouse.id,
    novaVrijednost: warehouse
  });

  inventoryRevalidate();
  inventoryRedirect(path, "magacin_kreiran", {
    q: sifra
  });
}

export async function updateWarehouse(formData: FormData) {
  const path = "/agencija/robno/magacini";
  const firmaId = text(formData.get("firma_id"));
  const warehouseId = text(formData.get("magacin_id"));
  const params = queryParams(formData);
  const context = await requireInventoryActionContext("update", path, firmaId);
  const sifra = normalizeInventoryCode(text(formData.get("sifra")));
  const naziv = text(formData.get("naziv"));
  const businessUnitId = text(formData.get("poslovna_jedinica_id"));
  const salesType = text(formData.get("tip_prodaje")) === "WHOLESALE" ? "WHOLESALE" : "RETAIL";

  if (!warehouseId || !sifra || !naziv) {
    inventoryRedirect(path, "magacin_obavezno", params);
  }

  const businessUnit = await resolveWarehouseBusinessUnit(
    businessUnitId,
    context.agencijaId,
    firmaId
  );
  if (businessUnitId && !businessUnit) {
    inventoryRedirect(path, "poslovna_jedinica_greska", params);
  }

  const [existingWarehouse, duplicate] = await Promise.all([
    prisma.magacin.findFirst({
      where: {
        id: warehouseId,
        agencija_id: context.agencijaId,
        firma_id: firmaId,
        is_deleted: false
      }
    }),
    prisma.magacin.findFirst({
      where: {
        firma_id: firmaId,
        sifra,
        NOT: {
          id: warehouseId
        }
      },
      select: {
        id: true
      }
    })
  ]);

  if (!existingWarehouse) {
    inventoryRedirect(path, "magacin_greska", params);
  }

  if (duplicate) {
    inventoryRedirect(path, "magacin_postoji", params);
  }

  const warehouse = await prisma.magacin.update({
    where: {
      id: warehouseId
    },
    data: {
      sifra,
      naziv,
      poslovna_jedinica_id: businessUnit?.id ?? null,
      tip_prodaje: salesType,
      dozvoli_negativan_lager: warehouseNegativeStockValue(
        text(formData.get("negativan_lager"))
      ),
      napomena: nullableText(formData.get("napomena")),
      updated_by: context.user.id
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "update_warehouse",
    tipEntiteta: "Magacin",
    entitetId: warehouse.id,
    staraVrijednost: existingWarehouse,
    novaVrijednost: warehouse
  });

  inventoryRevalidate();
  inventoryRedirect(path, "magacin_sacuvan", params);
}

export async function toggleWarehouse(formData: FormData) {
  const path = "/agencija/robno/magacini";
  const firmaId = text(formData.get("firma_id"));
  const warehouseId = text(formData.get("magacin_id"));
  const params = queryParams(formData);
  const context = await requireInventoryActionContext("update", path, firmaId);
  const aktivan = text(formData.get("aktivan")) === "true";

  const existingWarehouse = await prisma.magacin.findFirst({
    where: {
      id: warehouseId,
      agencija_id: context.agencijaId,
      firma_id: firmaId,
      is_deleted: false
    }
  });

  if (!existingWarehouse) {
    inventoryRedirect(path, "magacin_greska", params);
  }

  const warehouse = await prisma.magacin.update({
    where: {
      id: warehouseId
    },
    data: {
      aktivan,
      updated_by: context.user.id
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: aktivan ? "activate_warehouse" : "deactivate_warehouse",
    tipEntiteta: "Magacin",
    entitetId: warehouse.id,
    staraVrijednost: existingWarehouse,
    novaVrijednost: warehouse
  });

  inventoryRevalidate();
  inventoryRedirect(path, aktivan ? "magacin_aktiviran" : "magacin_deaktiviran", params);
}

export async function updateCompanyNegativeStockPolicy(formData: FormData) {
  const path = "/agencija/robno/magacini";
  const firmaId = text(formData.get("firma_id"));
  const context = await requireInventoryActionContext("manage", path, firmaId);
  const allowNegativeStock = text(formData.get("dozvoli_negativan_lager")) === "on";

  const company = await prisma.firma.update({
    where: {
      id: firmaId
    },
    data: {
      dozvoli_negativan_lager: allowNegativeStock,
      updated_by: context.user.id
    },
    select: {
      id: true,
      naziv: true,
      dozvoli_negativan_lager: true
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "update_negative_stock_policy",
    tipEntiteta: "Firma",
    entitetId: company.id,
    staraVrijednost: {
      dozvoli_negativan_lager: context.firma.dozvoli_negativan_lager
    },
    novaVrijednost: company
  });

  inventoryRevalidate();
  inventoryRedirect(path, "negativan_lager_sacuvan");
}

const allowedInitialPriceTypes = new Set<string>(
  initialItemPriceTypes.map((option) => option.value)
);

async function resolvePriceInput(
  context: Awaited<ReturnType<typeof requireInventoryActionContext>>,
  firmaId: string,
  itemId: string,
  formData: FormData
) {
  const priceType = text(formData.get("tip"));
  const inputType = text(formData.get("unos_tip")) === "SA_PDV" ? "SA_PDV" : "BEZ_PDV";
  const amountCents = parseInventoryMoneyToCents(formData.get("iznos"));

  if (!itemId || !allowedInitialPriceTypes.has(priceType) || amountCents === null) {
    return null;
  }

  if (amountCents < 0) {
    return null;
  }

  const item = await prisma.artikal.findFirst({
    where: {
      id: itemId,
      agencija_id: context.agencijaId,
      firma_id: firmaId,
      is_deleted: false
    },
    select: {
      id: true,
      sifra: true,
      naziv: true,
      pdv_stopa: {
        select: {
          procenat: true
        }
      }
    }
  });

  if (!item) {
    return null;
  }

  const vatPercent = Number(item.pdv_stopa?.procenat.toString() ?? "0");
  const amounts = calculateItemPriceAmounts(inputType, amountCents, vatPercent);

  return {
    item,
    priceType,
    inputType,
    vatPercent,
    amounts,
    validFrom: dateValue(formData.get("vazi_od")),
    validTo: dateValue(formData.get("vazi_do")),
    note: nullableText(formData.get("napomena"))
  };
}

export async function createItemPrice(formData: FormData) {
  const path = "/agencija/robno/cijene";
  const firmaId = text(formData.get("firma_id"));
  const itemId = text(formData.get("artikal_id"));
  const context = await requireInventoryActionContext("create", path, firmaId);
  const resolved = await resolvePriceInput(context, firmaId, itemId, formData);

  if (!resolved) {
    inventoryRedirect(path, "cijena_obavezno", {
      artikal_id: itemId
    });
  }

  if (resolved.validFrom && resolved.validTo && resolved.validTo < resolved.validFrom) {
    inventoryRedirect(path, "cijena_period", {
      artikal_id: itemId
    });
  }

  const price = await prisma.cijenaArtikla.create({
    data: {
      agencija_id: context.agencijaId,
      firma_id: firmaId,
      artikal_id: itemId,
      tip: resolved.priceType,
      cijena_bez_pdv: inventoryCentsToDecimal(resolved.amounts.netCents),
      cijena_sa_pdv: inventoryCentsToDecimal(resolved.amounts.grossCents),
      pdv_stopa_procenat: resolved.vatPercent.toFixed(2),
      valuta: "EUR",
      vazi_od: resolved.validFrom,
      vazi_do: resolved.validTo,
      napomena: resolved.note,
      created_by: context.user.id,
      updated_by: context.user.id
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "create_item_price",
    tipEntiteta: "CijenaArtikla",
    entitetId: price.id,
    novaVrijednost: price
  });

  inventoryRevalidate();
  inventoryRedirect(path, "cijena_kreirana", {
    artikal_id: itemId
  });
}

export async function updateItemPrice(formData: FormData) {
  const path = "/agencija/robno/cijene";
  const firmaId = text(formData.get("firma_id"));
  const itemId = text(formData.get("artikal_id"));
  const priceId = text(formData.get("cijena_id"));
  const context = await requireInventoryActionContext("update", path, firmaId);
  const resolved = await resolvePriceInput(context, firmaId, itemId, formData);

  if (!priceId || !resolved) {
    inventoryRedirect(path, "cijena_obavezno", {
      artikal_id: itemId
    });
  }

  if (resolved.validFrom && resolved.validTo && resolved.validTo < resolved.validFrom) {
    inventoryRedirect(path, "cijena_period", {
      artikal_id: itemId
    });
  }

  const existingPrice = await prisma.cijenaArtikla.findFirst({
    where: {
      id: priceId,
      agencija_id: context.agencijaId,
      firma_id: firmaId,
      artikal_id: itemId,
      is_deleted: false
    }
  });

  if (!existingPrice) {
    inventoryRedirect(path, "cijena_greska", {
      artikal_id: itemId
    });
  }

  const price = await prisma.cijenaArtikla.update({
    where: {
      id: priceId
    },
    data: {
      tip: resolved.priceType,
      cijena_bez_pdv: inventoryCentsToDecimal(resolved.amounts.netCents),
      cijena_sa_pdv: inventoryCentsToDecimal(resolved.amounts.grossCents),
      pdv_stopa_procenat: resolved.vatPercent.toFixed(2),
      vazi_od: resolved.validFrom,
      vazi_do: resolved.validTo,
      napomena: resolved.note,
      updated_by: context.user.id
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "update_item_price",
    tipEntiteta: "CijenaArtikla",
    entitetId: price.id,
    staraVrijednost: existingPrice,
    novaVrijednost: price
  });

  inventoryRevalidate();
  inventoryRedirect(path, "cijena_sacuvana", {
    artikal_id: itemId
  });
}

export async function toggleItemPrice(formData: FormData) {
  const path = "/agencija/robno/cijene";
  const firmaId = text(formData.get("firma_id"));
  const itemId = text(formData.get("artikal_id"));
  const priceId = text(formData.get("cijena_id"));
  const context = await requireInventoryActionContext("update", path, firmaId);
  const aktivna = text(formData.get("aktivna")) === "true";

  const existingPrice = await prisma.cijenaArtikla.findFirst({
    where: {
      id: priceId,
      agencija_id: context.agencijaId,
      firma_id: firmaId,
      artikal_id: itemId,
      is_deleted: false
    }
  });

  if (!existingPrice) {
    inventoryRedirect(path, "cijena_greska", {
      artikal_id: itemId
    });
  }

  const price = await prisma.cijenaArtikla.update({
    where: {
      id: priceId
    },
    data: {
      aktivna,
      updated_by: context.user.id
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: aktivna ? "activate_item_price" : "deactivate_item_price",
    tipEntiteta: "CijenaArtikla",
    entitetId: price.id,
    staraVrijednost: existingPrice,
    novaVrijednost: price
  });

  inventoryRevalidate();
  inventoryRedirect(path, aktivna ? "cijena_aktivirana" : "cijena_deaktivirana", {
    artikal_id: itemId
  });
}
