"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accountOverrideTypes } from "@/lib/account-plan";
import { auditLog } from "@/lib/audit";
import { requireAnyRole } from "@/lib/auth";
import { inventoryModule } from "@/lib/inventory";
import {
  decimalToScaled,
  parseScaledInteger,
  roundDivision,
  scaledToDecimal
} from "@/lib/inventory-calculation";
import {
  calculateTransferSlice,
  inventoryTransferNumber,
  inventoryTransferPostingFields,
  inventoryTransferPostingScope,
  inventoryTransferStatuses
} from "@/lib/inventory-transfer";
import { formatJournalCode, journalStatuses } from "@/lib/journals";
import { hasPermission, type PermissionAction } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

const listPath = "/agencija/robno/prenos";

function text(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function optionalText(value: FormDataEntryValue | null) {
  return text(value) || null;
}

function parseDate(value: FormDataEntryValue | null) {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const result = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(result.getTime()) ? null : result;
}

function detailPath(id: string) {
  return `${listPath}/${id}`;
}

function go(path: string, message: string): never {
  redirect(`${path}?poruka=${encodeURIComponent(message)}`);
}

async function requireTransferContext(
  action: PermissionAction,
  firmaId: string,
  returnPath: string
) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const work = await readWorkContext();
  if (
    !user.agencija_id ||
    !work.firmaId ||
    !work.poslovnaGodinaId ||
    work.firmaId !== firmaId
  ) {
    go(returnPath, "prava");
  }
  const [firma, godina, allowed] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: firmaId,
        agencija_id: user.agencija_id,
        aktivan: true,
        is_deleted: false,
        ...(user.rola === "admin_agencije"
          ? {}
          : {
              korisnici: {
                some: {
                  korisnik_id: user.id,
                  is_deleted: false,
                  moze_da_mijenja: true
                }
              }
            })
      },
      select: { id: true, naziv: true, dozvoli_negativan_lager: true }
    }),
    prisma.poslovnaGodina.findFirst({
      where: { id: work.poslovnaGodinaId, firma_id: firmaId },
      select: {
        id: true,
        godina: true,
        datum_od: true,
        datum_do: true,
        zakljucena: true
      }
    }),
    hasPermission(user, { firmaId, modul: inventoryModule, akcija: action })
  ]);
  if (!firma || !godina || godina.zakljucena) go(returnPath, "zakljucana_godina");
  if (!allowed) go(returnPath, "prava");
  return { user, agencijaId: user.agencija_id, firma, godina };
}

async function resolveCompanyAccount(
  tx: Prisma.TransactionClient,
  firmaId: string,
  accountCode: string
) {
  const existing = await tx.firmaKonto.findUnique({
    where: { firma_id_sifra: { firma_id: firmaId, sifra: accountCode } }
  });
  if (existing) {
    return existing.aktivan &&
      existing.override_type !== accountOverrideTypes.deactivated &&
      existing.tip_konta === "analiticko" &&
      !existing.analitika_obavezna
      ? existing
      : null;
  }
  const base = await tx.konto.findFirst({
    where: {
      sifra: accountCode,
      aktivan: true,
      tip_konta: "analiticko",
      analitika_obavezna: false
    }
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
    }
  });
}

function refresh(id?: string) {
  revalidatePath(listPath);
  revalidatePath("/agencija/robno/promet");
  revalidatePath("/agencija/robno/lager");
  revalidatePath("/agencija/robno/kartica-artikla");
  revalidatePath("/agencija/izvjestaji/lager-lista");
  revalidatePath("/agencija/izvjestaji/kartica-artikla");
  if (id) {
    revalidatePath(detailPath(id));
    revalidatePath(`/stampa/robno/prenos/${id}`);
  }
}

export async function createInventoryTransfer(formData: FormData) {
  const firmaId = text(formData.get("firma_id"));
  const context = await requireTransferContext("create", firmaId, listPath);
  const sourceId = text(formData.get("izvorni_magacin_id"));
  const destinationId = text(formData.get("odredisni_magacin_id"));
  const date = parseDate(formData.get("datum"));
  if (!sourceId || !destinationId || sourceId === destinationId || !date) {
    go(listPath, "obavezna_polja");
  }
  if (date < context.godina.datum_od || date > context.godina.datum_do) {
    go(listPath, "datum_van_godine");
  }
  const warehouses = await prisma.magacin.findMany({
    where: {
      id: { in: [sourceId, destinationId] },
      agencija_id: context.agencijaId,
      firma_id: firmaId,
      aktivan: true,
      is_deleted: false
    },
    select: { id: true, poslovna_jedinica_id: true }
  });
  if (warehouses.length !== 2) go(listPath, "magacini");
  const source = warehouses.find((item) => item.id === sourceId)!;
  const destination = warehouses.find((item) => item.id === destinationId)!;
  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`warehouse-transfer-number:${firmaId}:${context.godina.id}`}))`
    );
    const last = await tx.prenosRobe.findFirst({
      where: { firma_id: firmaId, poslovna_godina_id: context.godina.id },
      orderBy: { broj: "desc" },
      select: { broj: true }
    });
    const number = (last?.broj ?? 0) + 1;
    return tx.prenosRobe.create({
      data: {
        agencija_id: context.agencijaId,
        firma_id: firmaId,
        poslovna_godina_id: context.godina.id,
        izvorni_magacin_id: sourceId,
        odredisni_magacin_id: destinationId,
        izvorna_poslovna_jedinica_id: source.poslovna_jedinica_id,
        odredisna_poslovna_jedinica_id: destination.poslovna_jedinica_id,
        broj: number,
        interni_broj: inventoryTransferNumber(context.godina.godina, number),
        datum: date,
        napomena: optionalText(formData.get("napomena")),
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
    akcija: "create_warehouse_transfer",
    tipEntiteta: "PrenosRobe",
    entitetId: created.id,
    novaVrijednost: created
  });
  refresh(created.id);
  redirect(`${detailPath(created.id)}?poruka=kreiran`);
}

export async function updateInventoryTransferHeader(formData: FormData) {
  const id = text(formData.get("prenos_id"));
  const firmaId = text(formData.get("firma_id"));
  const path = detailPath(id);
  const context = await requireTransferContext("update", firmaId, path);
  const sourceId = text(formData.get("izvorni_magacin_id"));
  const destinationId = text(formData.get("odredisni_magacin_id"));
  const date = parseDate(formData.get("datum"));
  if (!sourceId || !destinationId || sourceId === destinationId || !date) {
    go(path, "obavezna_polja");
  }
  if (date < context.godina.datum_od || date > context.godina.datum_do) {
    go(path, "datum_van_godine");
  }
  const warehouses = await prisma.magacin.findMany({
    where: {
      id: { in: [sourceId, destinationId] },
      agencija_id: context.agencijaId,
      firma_id: firmaId,
      aktivan: true,
      is_deleted: false
    },
    select: { id: true, poslovna_jedinica_id: true }
  });
  if (warehouses.length !== 2) go(path, "magacini");
  const current = await prisma.prenosRobe.findFirst({
    where: {
      id,
      agencija_id: context.agencijaId,
      firma_id: firmaId,
      poslovna_godina_id: context.godina.id,
      status: inventoryTransferStatuses.draft,
      is_deleted: false
    }
  });
  if (!current) go(path, "nije_nacrt");
  const source = warehouses.find((item) => item.id === sourceId)!;
  const destination = warehouses.find((item) => item.id === destinationId)!;
  const updated = await prisma.prenosRobe.update({
    where: { id },
    data: {
      izvorni_magacin_id: sourceId,
      odredisni_magacin_id: destinationId,
      izvorna_poslovna_jedinica_id: source.poslovna_jedinica_id,
      odredisna_poslovna_jedinica_id: destination.poslovna_jedinica_id,
      datum: date,
      napomena: optionalText(formData.get("napomena")),
      updated_by: context.user.id
    }
  });
  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "update_warehouse_transfer",
    tipEntiteta: "PrenosRobe",
    entitetId: id,
    staraVrijednost: current,
    novaVrijednost: updated
  });
  refresh(id);
  go(path, "zaglavlje_sacuvano");
}

export async function addInventoryTransferLine(formData: FormData) {
  const id = text(formData.get("prenos_id"));
  const firmaId = text(formData.get("firma_id"));
  const path = detailPath(id);
  const context = await requireTransferContext("update", firmaId, path);
  const itemId = text(formData.get("artikal_id"));
  const quantity = parseScaledInteger(text(formData.get("kolicina")), 3);
  if (!itemId || quantity === null || quantity <= BigInt(0)) go(path, "stavka");
  const [transfer, item] = await Promise.all([
    prisma.prenosRobe.findFirst({
      where: {
        id,
        agencija_id: context.agencijaId,
        firma_id: firmaId,
        poslovna_godina_id: context.godina.id,
        status: inventoryTransferStatuses.draft,
        is_deleted: false
      },
      select: { id: true, izvorni_magacin_id: true }
    }),
    prisma.artikal.findFirst({
      where: {
        id: itemId,
        agencija_id: context.agencijaId,
        firma_id: firmaId,
        aktivan: true,
        is_deleted: false,
        usluga: false,
        prati_zalihe: true
      },
      select: { id: true }
    })
  ]);
  if (!transfer) go(path, "nije_nacrt");
  if (!item) go(path, "artikal");
  const created = await prisma.$transaction(async (tx) => {
    const [last, state] = await Promise.all([
      tx.stavkaPrenosaRobe.findFirst({
        where: { prenos_robe_id: id },
        orderBy: { redni_broj: "desc" },
        select: { redni_broj: true }
      }),
      tx.stanjeZaliha.findUnique({
        where: {
          firma_id_poslovna_godina_id_magacin_id_artikal_id: {
            firma_id: firmaId,
            poslovna_godina_id: context.godina.id,
            magacin_id: transfer.izvorni_magacin_id,
            artikal_id: itemId
          }
        }
      })
    ]);
    const unitCost = decimalToScaled(state?.prosjecna_nabavna_cijena ?? 0, 4);
    const value = roundDivision(quantity * unitCost, BigInt(100000));
    return tx.stavkaPrenosaRobe.create({
      data: {
        prenos_robe_id: id,
        redni_broj: (last?.redni_broj ?? 0) + 1,
        artikal_id: itemId,
        kolicina: scaledToDecimal(quantity, 3),
        jedinicna_nabavna_cijena: scaledToDecimal(unitCost, 4),
        nabavna_vrijednost: scaledToDecimal(value, 2),
        created_by: context.user.id,
        updated_by: context.user.id
      }
    });
  }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return null;
    }
    throw error;
  });
  if (!created) go(path, "dupli_artikal");
  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "add_warehouse_transfer_line",
    tipEntiteta: "StavkaPrenosaRobe",
    entitetId: created.id,
    novaVrijednost: created
  });
  refresh(id);
  go(path, "stavka_dodata");
}

export async function updateInventoryTransferLine(formData: FormData) {
  const id = text(formData.get("prenos_id"));
  const lineId = text(formData.get("stavka_id"));
  const firmaId = text(formData.get("firma_id"));
  const path = detailPath(id);
  const context = await requireTransferContext("update", firmaId, path);
  const quantity = parseScaledInteger(text(formData.get("kolicina")), 3);
  if (quantity === null || quantity <= BigInt(0)) go(path, "stavka");
  const current = await prisma.stavkaPrenosaRobe.findFirst({
    where: {
      id: lineId,
      prenos_robe_id: id,
      prenos_robe: {
        agencija_id: context.agencijaId,
        firma_id: firmaId,
        poslovna_godina_id: context.godina.id,
        status: inventoryTransferStatuses.draft,
        is_deleted: false
      }
    },
    include: { prenos_robe: { select: { izvorni_magacin_id: true } } }
  });
  if (!current) go(path, "nije_nacrt");
  const state = await prisma.stanjeZaliha.findUnique({
    where: {
      firma_id_poslovna_godina_id_magacin_id_artikal_id: {
        firma_id: firmaId,
        poslovna_godina_id: context.godina.id,
        magacin_id: current.prenos_robe.izvorni_magacin_id,
        artikal_id: current.artikal_id
      }
    }
  });
  const unitCost = decimalToScaled(state?.prosjecna_nabavna_cijena ?? 0, 4);
  const value = roundDivision(quantity * unitCost, BigInt(100000));
  const updated = await prisma.stavkaPrenosaRobe.update({
    where: { id: lineId },
    data: {
      kolicina: scaledToDecimal(quantity, 3),
      jedinicna_nabavna_cijena: scaledToDecimal(unitCost, 4),
      nabavna_vrijednost: scaledToDecimal(value, 2),
      updated_by: context.user.id
    }
  });
  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "update_warehouse_transfer_line",
    tipEntiteta: "StavkaPrenosaRobe",
    entitetId: lineId,
    staraVrijednost: current,
    novaVrijednost: updated
  });
  refresh(id);
  go(path, "stavka_sacuvana");
}

export async function deleteInventoryTransferLine(formData: FormData) {
  const id = text(formData.get("prenos_id"));
  const lineId = text(formData.get("stavka_id"));
  const firmaId = text(formData.get("firma_id"));
  const path = detailPath(id);
  const context = await requireTransferContext("delete", firmaId, path);
  const current = await prisma.stavkaPrenosaRobe.findFirst({
    where: {
      id: lineId,
      prenos_robe_id: id,
      prenos_robe: {
        agencija_id: context.agencijaId,
        firma_id: firmaId,
        poslovna_godina_id: context.godina.id,
        status: inventoryTransferStatuses.draft,
        is_deleted: false
      }
    }
  });
  if (!current) go(path, "nije_nacrt");
  await prisma.stavkaPrenosaRobe.delete({ where: { id: lineId } });
  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "delete_warehouse_transfer_line",
    tipEntiteta: "StavkaPrenosaRobe",
    entitetId: lineId,
    staraVrijednost: current
  });
  refresh(id);
  go(path, "stavka_obrisana");
}

export async function deleteInventoryTransfer(formData: FormData) {
  const id = text(formData.get("prenos_id"));
  const firmaId = text(formData.get("firma_id"));
  const path = detailPath(id);
  const context = await requireTransferContext("delete", firmaId, path);
  const current = await prisma.prenosRobe.findFirst({
    where: {
      id,
      agencija_id: context.agencijaId,
      firma_id: firmaId,
      poslovna_godina_id: context.godina.id,
      status: inventoryTransferStatuses.draft,
      is_deleted: false
    }
  });
  if (!current) go(path, "nije_nacrt");
  await prisma.prenosRobe.update({
    where: { id },
    data: {
      status: inventoryTransferStatuses.deleted,
      is_deleted: true,
      deleted_at: new Date(),
      deleted_by: context.user.id,
      delete_reason: "Brisanje nacrta prenosa robe",
      updated_by: context.user.id
    }
  });
  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "delete_warehouse_transfer",
    tipEntiteta: "PrenosRobe",
    entitetId: id,
    staraVrijednost: current
  });
  refresh(id);
  go(listPath, "obrisan");
}

export async function postInventoryTransfer(formData: FormData) {
  const id = text(formData.get("prenos_id"));
  const firmaId = text(formData.get("firma_id"));
  const path = detailPath(id);
  const context = await requireTransferContext("post", firmaId, path);

  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`warehouse-transfer:${id}`}))`
      );
      const transfer = await tx.prenosRobe.findFirst({
        where: {
          id,
          agencija_id: context.agencijaId,
          firma_id: firmaId,
          poslovna_godina_id: context.godina.id,
          status: inventoryTransferStatuses.draft,
          is_deleted: false
        },
        include: {
          izvorni_magacin: true,
          odredisni_magacin: true,
          stavke: {
            include: { artikal: { select: { sifra: true, naziv: true } } },
            orderBy: { redni_broj: "asc" }
          }
        }
      });
      if (!transfer) return { ok: false as const, reason: "nije_nacrt" };
      if (!transfer.stavke.length) return { ok: false as const, reason: "bez_stavki" };
      if (transfer.izvorni_magacin_id === transfer.odredisni_magacin_id) {
        return { ok: false as const, reason: "magacini" };
      }

      const [settings, journalType] = await Promise.all([
        tx.firmaPodrazumijevanoKonto.findMany({
          where: {
            firma_id: firmaId,
            dokument_tip: inventoryTransferPostingScope.documentType,
            podvrsta: inventoryTransferPostingScope.subtype,
            pdv_stopa_sifra: inventoryTransferPostingScope.vatRate,
            namjena: {
              in: inventoryTransferPostingFields.map((field) => field.purpose)
            }
          }
        }),
        tx.vrstaNaloga.findFirst({
          where: {
            sifra: "WAREHOUSE_TRANSFER",
            aktivan: true,
            OR: [
              { sistemska: true },
              { agencija_id: context.agencijaId },
              { firma_id: firmaId }
            ]
          },
          select: { id: true, prefiks: true }
        })
      ]);
      if (!journalType) return { ok: false as const, reason: "vrsta_naloga" };
      const settingMap = new Map(settings.map((setting) => [setting.namjena, setting]));
      const sourceSetting = settingMap.get("TRANSFER_SOURCE_INVENTORY");
      const destinationSetting = settingMap.get("TRANSFER_DESTINATION_INVENTORY");
      if (!sourceSetting?.sifra_konta || !destinationSetting?.sifra_konta) {
        return { ok: false as const, reason: "podesavanja" };
      }
      if (sourceSetting.smjer !== "P" || destinationSetting.smjer !== "D") {
        return { ok: false as const, reason: "smjer" };
      }
      const [sourceAccount, destinationAccount] = await Promise.all([
        resolveCompanyAccount(tx, firmaId, sourceSetting.sifra_konta),
        resolveCompanyAccount(tx, firmaId, destinationSetting.sifra_konta)
      ]);
      if (!sourceAccount || !destinationAccount) {
        return { ok: false as const, reason: "konto" };
      }

      let totalCost = BigInt(0);
      for (const line of transfer.stavke) {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`stock:${firmaId}:${context.godina.id}:${line.artikal_id}`}))`
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "stanja_zaliha" WHERE "firma_id" = ${firmaId}::uuid AND "poslovna_godina_id" = ${context.godina.id}::uuid AND "artikal_id" = ${line.artikal_id}::uuid AND "magacin_id" IN (${transfer.izvorni_magacin_id}::uuid, ${transfer.odredisni_magacin_id}::uuid) FOR UPDATE`
        );
        const [sourceState, destinationState] = await Promise.all([
          tx.stanjeZaliha.findUnique({
            where: {
              firma_id_poslovna_godina_id_magacin_id_artikal_id: {
                firma_id: firmaId,
                poslovna_godina_id: context.godina.id,
                magacin_id: transfer.izvorni_magacin_id,
                artikal_id: line.artikal_id
              }
            }
          }),
          tx.stanjeZaliha.findUnique({
            where: {
              firma_id_poslovna_godina_id_magacin_id_artikal_id: {
                firma_id: firmaId,
                poslovna_godina_id: context.godina.id,
                magacin_id: transfer.odredisni_magacin_id,
                artikal_id: line.artikal_id
              }
            }
          })
        ]);
        const quantity = decimalToScaled(line.kolicina, 3);
        const available = decimalToScaled(sourceState?.kolicina ?? 0, 3);
        const allowNegative =
          transfer.izvorni_magacin.dozvoli_negativan_lager ??
          context.firma.dozvoli_negativan_lager;
        if (!allowNegative && available < quantity) {
          return {
            ok: false as const,
            reason: `lager:${line.artikal.sifra}:${scaledToDecimal(available, 3)}`
          };
        }
        const averageCost = decimalToScaled(sourceState?.prosjecna_nabavna_cijena ?? 0, 4);
        if (averageCost <= BigInt(0)) {
          return { ok: false as const, reason: `nabavna:${line.artikal.sifra}` };
        }
        const slice = calculateTransferSlice(
          {
            quantityMilli: available,
            averageCostTenThousand: averageCost,
            costCents: decimalToScaled(sourceState?.nabavna_vrijednost ?? 0, 2),
            retailCents: decimalToScaled(sourceState?.maloprodajna_vrijednost ?? 0, 2),
            marginCents: decimalToScaled(sourceState?.razlika_u_cijeni ?? 0, 2),
            includedVatCents: decimalToScaled(sourceState?.ukalkulisani_pdv ?? 0, 2)
          },
          quantity
        );
        totalCost += slice.costCents;
        const sourceQuantityAfter = available - quantity;
        const sourceCostAfter = decimalToScaled(sourceState?.nabavna_vrijednost ?? 0, 2) - slice.costCents;
        const sourceRetailAfter = decimalToScaled(sourceState?.maloprodajna_vrijednost ?? 0, 2) - slice.retailCents;
        const sourceMarginAfter = decimalToScaled(sourceState?.razlika_u_cijeni ?? 0, 2) - slice.marginCents;
        const sourceVatAfter = decimalToScaled(sourceState?.ukalkulisani_pdv ?? 0, 2) - slice.includedVatCents;
        const destinationQuantityBefore = decimalToScaled(destinationState?.kolicina ?? 0, 3);
        const destinationCostBefore = decimalToScaled(destinationState?.nabavna_vrijednost ?? 0, 2);
        const destinationQuantityAfter = destinationQuantityBefore + quantity;
        const destinationCostAfter = destinationCostBefore + slice.costCents;
        const destinationAverage =
          destinationQuantityAfter > BigInt(0)
            ? roundDivision(destinationCostAfter * BigInt(100000), destinationQuantityAfter)
            : slice.unitCostTenThousand;
        const retailUnit =
          slice.retailCents > BigInt(0)
            ? roundDivision(slice.retailCents * BigInt(100000), quantity)
            : BigInt(0);

        if (sourceState) {
          await tx.stanjeZaliha.update({
            where: { id: sourceState.id },
            data: {
              kolicina: scaledToDecimal(sourceQuantityAfter, 3),
              prosjecna_nabavna_cijena:
                sourceQuantityAfter === BigInt(0)
                  ? "0.0000"
                  : scaledToDecimal(averageCost, 4),
              nabavna_vrijednost: scaledToDecimal(sourceCostAfter, 2),
              maloprodajna_vrijednost: scaledToDecimal(sourceRetailAfter, 2),
              razlika_u_cijeni: scaledToDecimal(sourceMarginAfter, 2),
              ukalkulisani_pdv: scaledToDecimal(sourceVatAfter, 2)
            }
          });
        } else {
          await tx.stanjeZaliha.create({
            data: {
              agencija_id: context.agencijaId,
              firma_id: firmaId,
              poslovna_godina_id: context.godina.id,
              magacin_id: transfer.izvorni_magacin_id,
              artikal_id: line.artikal_id,
              kolicina: scaledToDecimal(sourceQuantityAfter, 3),
              prosjecna_nabavna_cijena: scaledToDecimal(averageCost, 4),
              nabavna_vrijednost: scaledToDecimal(sourceCostAfter, 2),
              maloprodajna_vrijednost: scaledToDecimal(sourceRetailAfter, 2),
              razlika_u_cijeni: scaledToDecimal(sourceMarginAfter, 2),
              ukalkulisani_pdv: scaledToDecimal(sourceVatAfter, 2)
            }
          });
        }
        await tx.stanjeZaliha.upsert({
          where: {
            firma_id_poslovna_godina_id_magacin_id_artikal_id: {
              firma_id: firmaId,
              poslovna_godina_id: context.godina.id,
              magacin_id: transfer.odredisni_magacin_id,
              artikal_id: line.artikal_id
            }
          },
          create: {
            agencija_id: context.agencijaId,
            firma_id: firmaId,
            poslovna_godina_id: context.godina.id,
            magacin_id: transfer.odredisni_magacin_id,
            artikal_id: line.artikal_id,
            kolicina: scaledToDecimal(destinationQuantityAfter, 3),
            prosjecna_nabavna_cijena: scaledToDecimal(destinationAverage, 4),
            nabavna_vrijednost: scaledToDecimal(destinationCostAfter, 2),
            maloprodajna_vrijednost: scaledToDecimal(
              decimalToScaled(destinationState?.maloprodajna_vrijednost ?? 0, 2) + slice.retailCents,
              2
            ),
            razlika_u_cijeni: scaledToDecimal(
              decimalToScaled(destinationState?.razlika_u_cijeni ?? 0, 2) + slice.marginCents,
              2
            ),
            ukalkulisani_pdv: scaledToDecimal(
              decimalToScaled(destinationState?.ukalkulisani_pdv ?? 0, 2) + slice.includedVatCents,
              2
            )
          },
          update: {
            kolicina: scaledToDecimal(destinationQuantityAfter, 3),
            prosjecna_nabavna_cijena: scaledToDecimal(destinationAverage, 4),
            nabavna_vrijednost: scaledToDecimal(destinationCostAfter, 2),
            maloprodajna_vrijednost: scaledToDecimal(
              decimalToScaled(destinationState?.maloprodajna_vrijednost ?? 0, 2) + slice.retailCents,
              2
            ),
            razlika_u_cijeni: scaledToDecimal(
              decimalToScaled(destinationState?.razlika_u_cijeni ?? 0, 2) + slice.marginCents,
              2
            ),
            ukalkulisani_pdv: scaledToDecimal(
              decimalToScaled(destinationState?.ukalkulisani_pdv ?? 0, 2) + slice.includedVatCents,
              2
            )
          }
        });
        await tx.stavkaPrenosaRobe.update({
          where: { id: line.id },
          data: {
            jedinicna_nabavna_cijena: scaledToDecimal(slice.unitCostTenThousand, 4),
            nabavna_vrijednost: scaledToDecimal(slice.costCents, 2),
            prodajna_cijena_sa_pdv: scaledToDecimal(retailUnit, 4),
            prodajna_vrijednost: scaledToDecimal(slice.retailCents, 2),
            razlika_u_cijeni: scaledToDecimal(slice.marginCents, 2),
            ukalkulisani_pdv: scaledToDecimal(slice.includedVatCents, 2),
            updated_by: context.user.id
          }
        });
        await tx.prometZaliha.createMany({
          data: [
            {
              agencija_id: context.agencijaId,
              firma_id: firmaId,
              poslovna_godina_id: context.godina.id,
              magacin_id: transfer.izvorni_magacin_id,
              artikal_id: line.artikal_id,
              tip_dokumenta: "WAREHOUSE_TRANSFER_OUT",
              dokument_id: transfer.id,
              stavka_dokumenta_id: line.id,
              datum_prometa: transfer.datum,
              smjer: "OUT",
              kolicina: scaledToDecimal(quantity, 3),
              jedinicna_nabavna_cijena: scaledToDecimal(slice.unitCostTenThousand, 4),
              nabavna_vrijednost: scaledToDecimal(slice.costCents, 2),
              prodajna_cijena_sa_pdv: scaledToDecimal(retailUnit, 4),
              prodajna_vrijednost: scaledToDecimal(slice.retailCents, 2),
              razlika_u_cijeni: scaledToDecimal(slice.marginCents, 2),
              ukalkulisani_pdv: scaledToDecimal(slice.includedVatCents, 2),
              prosjecna_cijena_nakon: scaledToDecimal(
                sourceQuantityAfter === BigInt(0) ? BigInt(0) : averageCost,
                4
              ),
              kolicina_nakon: scaledToDecimal(sourceQuantityAfter, 3),
              created_by: context.user.id
            },
            {
              agencija_id: context.agencijaId,
              firma_id: firmaId,
              poslovna_godina_id: context.godina.id,
              magacin_id: transfer.odredisni_magacin_id,
              artikal_id: line.artikal_id,
              tip_dokumenta: "WAREHOUSE_TRANSFER_IN",
              dokument_id: transfer.id,
              stavka_dokumenta_id: line.id,
              datum_prometa: transfer.datum,
              smjer: "IN",
              kolicina: scaledToDecimal(quantity, 3),
              jedinicna_nabavna_cijena: scaledToDecimal(slice.unitCostTenThousand, 4),
              nabavna_vrijednost: scaledToDecimal(slice.costCents, 2),
              prodajna_cijena_sa_pdv: scaledToDecimal(retailUnit, 4),
              prodajna_vrijednost: scaledToDecimal(slice.retailCents, 2),
              razlika_u_cijeni: scaledToDecimal(slice.marginCents, 2),
              ukalkulisani_pdv: scaledToDecimal(slice.includedVatCents, 2),
              prosjecna_cijena_nakon: scaledToDecimal(destinationAverage, 4),
              kolicina_nakon: scaledToDecimal(destinationQuantityAfter, 3),
              created_by: context.user.id
            }
          ]
        });
      }

      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`journal-number:${firmaId}:${context.godina.id}:${journalType.id}`}))`
      );
      const lastJournal = await tx.nalog.findFirst({
        where: {
          firma_id: firmaId,
          poslovna_godina_id: context.godina.id,
          vrsta_naloga_id: journalType.id
        },
        orderBy: { broj: "desc" },
        select: { broj: true }
      });
      const journalNumber = (lastJournal?.broj ?? 0) + 1;
      const sameBusinessUnit =
        transfer.izvorna_poslovna_jedinica_id ===
        transfer.odredisna_poslovna_jedinica_id;
      const journal = await tx.nalog.create({
        data: {
          agencija_id: context.agencijaId,
          firma_id: firmaId,
          poslovna_godina_id: context.godina.id,
          poslovna_jedinica_id: sameBusinessUnit
            ? transfer.izvorna_poslovna_jedinica_id
            : null,
          vrsta_naloga_id: journalType.id,
          broj: journalNumber,
          sifra: formatJournalCode(
            journalType.prefiks,
            context.godina.godina,
            journalNumber
          ),
          datum: transfer.datum,
          opis: `Prenos robe ${transfer.interni_broj}`,
          status: journalStatuses.draft,
          source_type: "WAREHOUSE_TRANSFER",
          source_module: "agencija.robno.prenos",
          izvorni_dokument_id: transfer.id,
          kreirao_korisnik_id: context.user.id,
          created_by: context.user.id,
          updated_by: context.user.id,
          stavke: {
            create: [
              {
                konto_id: destinationAccount.id,
                poslovna_jedinica_id: transfer.odredisna_poslovna_jedinica_id,
                duguje: scaledToDecimal(totalCost, 2),
                potrazuje: "0.00",
                opis: `Ulaz po prenosu ${transfer.interni_broj}`,
                broj_dokumenta: transfer.interni_broj,
                datum_dokumenta: transfer.datum,
                redni_broj: 1,
                created_by: context.user.id,
                updated_by: context.user.id
              },
              {
                konto_id: sourceAccount.id,
                poslovna_jedinica_id: transfer.izvorna_poslovna_jedinica_id,
                duguje: "0.00",
                potrazuje: scaledToDecimal(totalCost, 2),
                opis: `Izlaz po prenosu ${transfer.interni_broj}`,
                broj_dokumenta: transfer.interni_broj,
                datum_dokumenta: transfer.datum,
                redni_broj: 2,
                created_by: context.user.id,
                updated_by: context.user.id
              }
            ]
          }
        }
      });
      await tx.prenosRobe.update({
        where: { id: transfer.id },
        data: {
          status: inventoryTransferStatuses.posted,
          nalog_id: journal.id,
          ukupna_nabavna_vrijednost: scaledToDecimal(totalCost, 2),
          posted_at: new Date(),
          posted_by: context.user.id,
          updated_by: context.user.id
        }
      });
      return { ok: true as const, journalCode: journal.sifra ?? String(journalNumber) };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
  if (!result.ok) go(path, result.reason);
  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId,
    modul: inventoryModule,
    akcija: "post_warehouse_transfer",
    tipEntiteta: "PrenosRobe",
    entitetId: id,
    novaVrijednost: { status: inventoryTransferStatuses.posted, nalog: result.journalCode }
  });
  refresh(id);
  go(path, `proknjizen:${result.journalCode}`);
}
