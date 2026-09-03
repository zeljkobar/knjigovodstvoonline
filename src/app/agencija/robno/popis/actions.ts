"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accountOverrideTypes } from "@/lib/account-plan";
import { auditLog } from "@/lib/audit";
import { requireAnyRole } from "@/lib/auth";
import {
  calculateInventoryCountAdjustment,
  inventoryCountNumber,
  inventoryCountPostingFields,
  inventoryCountPostingScope,
  inventoryCountStatuses
} from "@/lib/inventory-count";
import { inventoryModule } from "@/lib/inventory";
import {
  decimalToScaled,
  parseScaledInteger,
  roundDivision,
  scaledToDecimal
} from "@/lib/inventory-calculation";
import { formatJournalCode, journalStatuses } from "@/lib/journals";
import { hasPermission, type PermissionAction } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

const listPath = "/agencija/robno/popis";

function text(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function optionalText(value: FormDataEntryValue | null) {
  return text(value) || null;
}

function parseDate(value: FormDataEntryValue | null) {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function detailPath(id: string) {
  return `${listPath}/${id}`;
}

function go(path: string, message: string): never {
  redirect(`${path}?poruka=${encodeURIComponent(message)}`);
}

async function requireCountContext(action: PermissionAction, firmaId: string, returnPath: string) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const work = await readWorkContext();
  if (!user.agencija_id || !work.firmaId || !work.poslovnaGodinaId || work.firmaId !== firmaId) go(returnPath, "prava");
  const [firma, godina, allowed] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: firmaId,
        agencija_id: user.agencija_id,
        aktivan: true,
        is_deleted: false,
        ...(user.rola === "admin_agencije" ? {} : { korisnici: { some: { korisnik_id: user.id, is_deleted: false, moze_da_mijenja: true } } })
      },
      select: { id: true, naziv: true }
    }),
    prisma.poslovnaGodina.findFirst({ where: { id: work.poslovnaGodinaId, firma_id: firmaId }, select: { id: true, godina: true, datum_od: true, datum_do: true, zakljucena: true } }),
    hasPermission(user, { firmaId, modul: inventoryModule, akcija: action })
  ]);
  if (!firma || !godina || godina.zakljucena) go(returnPath, "zakljucana_godina");
  if (!allowed) go(returnPath, "prava");
  return { user, agencijaId: user.agencija_id, firma, godina };
}

async function resolveCompanyAccount(tx: Prisma.TransactionClient, firmaId: string, accountCode: string) {
  const existing = await tx.firmaKonto.findUnique({ where: { firma_id_sifra: { firma_id: firmaId, sifra: accountCode } } });
  if (existing) return existing.aktivan && existing.override_type !== accountOverrideTypes.deactivated && existing.tip_konta === "analiticko" && !existing.analitika_obavezna ? existing : null;
  const base = await tx.konto.findFirst({ where: { sifra: accountCode, aktivan: true, tip_konta: "analiticko", analitika_obavezna: false } });
  if (!base) return null;
  return tx.firmaKonto.create({ data: { firma_id: firmaId, konto_id: base.id, sifra: base.sifra, naziv: base.naziv, tip_konta: base.tip_konta, analitika_obavezna: base.analitika_obavezna, sinteticki_konto: base.sinteticki_konto, normalni_saldo: base.normalni_saldo, koristi_radnu_jedinicu: base.koristi_radnu_jedinicu, override_type: accountOverrideTypes.baseLink, aktivan: true } });
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
    revalidatePath(`/stampa/robno/popis/${id}`);
  }
}

function emptyState() {
  return {
    kolicina: "0.000",
    prosjecna_nabavna_cijena: "0.0000",
    nabavna_vrijednost: "0.00",
    maloprodajna_vrijednost: "0.00",
    razlika_u_cijeni: "0.00",
    ukalkulisani_pdv: "0.00"
  };
}

function lineSnapshot(state: {
  kolicina: { toString(): string };
  prosjecna_nabavna_cijena: { toString(): string };
  nabavna_vrijednost: { toString(): string };
  maloprodajna_vrijednost: { toString(): string };
  razlika_u_cijeni: { toString(): string };
  ukalkulisani_pdv: { toString(): string };
}) {
  return {
    knjigovodstvena_kolicina: state.kolicina.toString(),
    knjigovodstvena_prosjecna_nabavna_cijena: state.prosjecna_nabavna_cijena.toString(),
    knjigovodstvena_nabavna_vrijednost: state.nabavna_vrijednost.toString(),
    knjigovodstvena_maloprodajna_vrijednost: state.maloprodajna_vrijednost.toString(),
    knjigovodstvena_razlika_u_cijeni: state.razlika_u_cijeni.toString(),
    knjigovodstveni_ukalkulisani_pdv: state.ukalkulisani_pdv.toString()
  };
}

function calculateLineValues(line: {
  knjigovodstvena_kolicina: { toString(): string };
  stvarna_kolicina: { toString(): string } | null;
  knjigovodstvena_prosjecna_nabavna_cijena: { toString(): string };
  rucna_nabavna_cijena_viska: { toString(): string } | null;
  knjigovodstvena_nabavna_vrijednost: { toString(): string };
  knjigovodstvena_maloprodajna_vrijednost: { toString(): string };
  knjigovodstvena_razlika_u_cijeni: { toString(): string };
  knjigovodstveni_ukalkulisani_pdv: { toString(): string };
}) {
  if (!line.stvarna_kolicina) return null;
  return calculateInventoryCountAdjustment({
    book: {
      quantityMilli: decimalToScaled(line.knjigovodstvena_kolicina, 3),
      averageCostTenThousand: decimalToScaled(line.knjigovodstvena_prosjecna_nabavna_cijena, 4),
      costCents: decimalToScaled(line.knjigovodstvena_nabavna_vrijednost, 2),
      retailCents: decimalToScaled(line.knjigovodstvena_maloprodajna_vrijednost, 2),
      marginCents: decimalToScaled(line.knjigovodstvena_razlika_u_cijeni, 2),
      includedVatCents: decimalToScaled(line.knjigovodstveni_ukalkulisani_pdv, 2)
    },
    actualQuantityMilli: decimalToScaled(line.stvarna_kolicina, 3),
    surplusUnitCostTenThousand: line.rucna_nabavna_cijena_viska ? decimalToScaled(line.rucna_nabavna_cijena_viska, 4) : undefined
  });
}

export async function createInventoryCount(formData: FormData) {
  const firmaId = text(formData.get("firma_id"));
  const context = await requireCountContext("create", firmaId, listPath);
  const warehouseId = text(formData.get("magacin_id"));
  const date = parseDate(formData.get("datum"));
  if (!warehouseId || !date) go(listPath, "obavezna_polja");
  if (date < context.godina.datum_od || date > context.godina.datum_do) go(listPath, "datum_van_godine");
  const warehouse = await prisma.magacin.findFirst({ where: { id: warehouseId, agencija_id: context.agencijaId, firma_id: firmaId, aktivan: true, is_deleted: false }, select: { id: true, poslovna_jedinica_id: true } });
  if (!warehouse) go(listPath, "magacin");

  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`stock-count:${firmaId}:${context.godina.id}:${warehouseId}`}))`);
    const existing = await tx.popisRobe.findFirst({ where: { firma_id: firmaId, poslovna_godina_id: context.godina.id, magacin_id: warehouseId, status: inventoryCountStatuses.draft, is_deleted: false }, select: { id: true } });
    if (existing) return { id: existing.id, existing: true };
    const [last, items, states] = await Promise.all([
      tx.popisRobe.findFirst({ where: { firma_id: firmaId, poslovna_godina_id: context.godina.id }, orderBy: { broj: "desc" }, select: { broj: true } }),
      tx.artikal.findMany({ where: { agencija_id: context.agencijaId, firma_id: firmaId, is_deleted: false, usluga: false, prati_zalihe: true, OR: [{ aktivan: true }, { stanjaZaliha: { some: { poslovna_godina_id: context.godina.id, magacin_id: warehouseId, kolicina: { not: 0 } } } }] }, select: { id: true, posljednja_nabavna_cijena: true }, orderBy: [{ sifra: "asc" }, { naziv: "asc" }] }),
      tx.stanjeZaliha.findMany({ where: { firma_id: firmaId, poslovna_godina_id: context.godina.id, magacin_id: warehouseId } })
    ]);
    if (!items.length) return { id: "", existing: false };
    const number = (last?.broj ?? 0) + 1;
    const count = await tx.popisRobe.create({ data: { agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, magacin_id: warehouseId, poslovna_jedinica_id: warehouse.poslovna_jedinica_id, broj: number, interni_broj: inventoryCountNumber(context.godina.godina, number), datum: date, napomena: optionalText(formData.get("napomena")), created_by: context.user.id, updated_by: context.user.id } });
    const stateMap = new Map(states.map((state) => [state.artikal_id, state]));
    await tx.stavkaPopisaRobe.createMany({ data: items.map((item, index) => {
      const state = stateMap.get(item.id) ?? emptyState();
      const snapshot = lineSnapshot(state);
      if (decimalToScaled(snapshot.knjigovodstvena_prosjecna_nabavna_cijena, 4) <= BigInt(0) && item.posljednja_nabavna_cijena) snapshot.knjigovodstvena_prosjecna_nabavna_cijena = item.posljednja_nabavna_cijena.toString();
      return { popis_robe_id: count.id, redni_broj: index + 1, artikal_id: item.id, ...snapshot, created_by: context.user.id, updated_by: context.user.id };
    }) });
    return { id: count.id, existing: false };
  });
  if (!created.id) go(listPath, "bez_artikala");
  if (!created.existing) await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId, modul: inventoryModule, akcija: "create_stock_count", tipEntiteta: "PopisRobe", entitetId: created.id, novaVrijednost: { magacin_id: warehouseId, datum: date } });
  refresh(created.id);
  redirect(`${detailPath(created.id)}?poruka=${created.existing ? "postoji_nacrt" : "kreiran"}`);
}

export async function updateInventoryCountHeader(formData: FormData) {
  const id = text(formData.get("popis_id"));
  const firmaId = text(formData.get("firma_id"));
  const path = detailPath(id);
  const context = await requireCountContext("update", firmaId, path);
  const date = parseDate(formData.get("datum"));
  if (!date) go(path, "obavezna_polja");
  if (date < context.godina.datum_od || date > context.godina.datum_do) go(path, "datum_van_godine");
  const result = await prisma.popisRobe.updateMany({ where: { id, agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, status: inventoryCountStatuses.draft, is_deleted: false }, data: { datum: date, napomena: optionalText(formData.get("napomena")), updated_by: context.user.id } });
  if (!result.count) go(path, "nije_nacrt");
  await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId, modul: inventoryModule, akcija: "update_stock_count", tipEntiteta: "PopisRobe", entitetId: id, novaVrijednost: { datum: date, napomena: optionalText(formData.get("napomena")) } });
  refresh(id); go(path, "zaglavlje_sacuvano");
}

export async function updateInventoryCountLine(formData: FormData) {
  const id = text(formData.get("popis_id"));
  const lineId = text(formData.get("stavka_id"));
  const firmaId = text(formData.get("firma_id"));
  const path = detailPath(id);
  const context = await requireCountContext("update", firmaId, path);
  const actual = parseScaledInteger(text(formData.get("stvarna_kolicina")), 3);
  const manualRaw = text(formData.get("rucna_cijena"));
  const manual = manualRaw ? parseScaledInteger(manualRaw, 4) : null;
  if (actual === null || actual < BigInt(0) || (manual !== null && manual < BigInt(0))) go(path, "kolicina");
  const line = await prisma.stavkaPopisaRobe.findFirst({ where: { id: lineId, popis_robe_id: id, popis_robe: { agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, status: inventoryCountStatuses.draft, is_deleted: false } } });
  if (!line) go(path, "nije_nacrt");
  const draft = { ...line, stvarna_kolicina: { toString: () => scaledToDecimal(actual, 3) }, rucna_nabavna_cijena_viska: manual === null ? null : { toString: () => scaledToDecimal(manual, 4) } };
  let adjustment;
  try { adjustment = calculateLineValues(draft); } catch { go(path, "cijena_viska"); }
  await prisma.stavkaPopisaRobe.update({ where: { id: lineId }, data: { stvarna_kolicina: scaledToDecimal(actual, 3), rucna_nabavna_cijena_viska: manual === null ? null : scaledToDecimal(manual, 4), razlika_kolicina: scaledToDecimal(adjustment!.differenceMilli, 3), nabavna_vrijednost_razlike: scaledToDecimal(adjustment!.costCents, 2), maloprodajna_vrijednost_razlike: scaledToDecimal(adjustment!.retailCents, 2), razlika_u_cijeni_razlike: scaledToDecimal(adjustment!.marginCents, 2), ukalkulisani_pdv_razlike: scaledToDecimal(adjustment!.includedVatCents, 2), updated_by: context.user.id } });
  await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId, modul: inventoryModule, akcija: "update_stock_count_line", tipEntiteta: "StavkaPopisaRobe", entitetId: lineId, staraVrijednost: { stvarna_kolicina: line.stvarna_kolicina, rucna_nabavna_cijena_viska: line.rucna_nabavna_cijena_viska }, novaVrijednost: { stvarna_kolicina: scaledToDecimal(actual, 3), rucna_nabavna_cijena_viska: manual === null ? null : scaledToDecimal(manual, 4) } });
  refresh(id); go(path, "stavka_sacuvana");
}

export async function fillInventoryCountBookQuantities(formData: FormData) {
  const id = text(formData.get("popis_id"));
  const firmaId = text(formData.get("firma_id"));
  const path = detailPath(id);
  const context = await requireCountContext("update", firmaId, path);
  const changed = await prisma.$executeRaw(Prisma.sql`
    UPDATE "stavke_popisa_robe" AS s
    SET "stvarna_kolicina" = s."knjigovodstvena_kolicina",
        "razlika_kolicina" = 0,
        "nabavna_vrijednost_razlike" = 0,
        "maloprodajna_vrijednost_razlike" = 0,
        "razlika_u_cijeni_razlike" = 0,
        "ukalkulisani_pdv_razlike" = 0,
        "updated_by" = ${context.user.id}::uuid,
        "updated_at" = CURRENT_TIMESTAMP
    FROM "popisi_robe" AS p
    WHERE s."popis_robe_id" = p."id"
      AND p."id" = ${id}::uuid
      AND p."agencija_id" = ${context.agencijaId}::uuid
      AND p."firma_id" = ${firmaId}::uuid
      AND p."poslovna_godina_id" = ${context.godina.id}::uuid
      AND p."status" = ${inventoryCountStatuses.draft}
      AND p."is_deleted" = false
      AND s."stvarna_kolicina" IS NULL
  `);
  if (!changed) {
    const count = await prisma.popisRobe.count({ where: { id, agencija_id: context.agencijaId, firma_id: firmaId, status: inventoryCountStatuses.draft, is_deleted: false } });
    if (!count) go(path, "nije_nacrt");
  }
  await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId, modul: inventoryModule, akcija: "fill_stock_count_book_quantities", tipEntiteta: "PopisRobe", entitetId: id, novaVrijednost: { popunjeno_stavki: changed } });
  refresh(id); go(path, "popunjeno");
}

export async function refreshInventoryCountSnapshot(formData: FormData) {
  const id = text(formData.get("popis_id"));
  const firmaId = text(formData.get("firma_id"));
  const path = detailPath(id);
  const context = await requireCountContext("update", firmaId, path);
  const count = await prisma.popisRobe.findFirst({ where: { id, agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, status: inventoryCountStatuses.draft, is_deleted: false }, include: { stavke: true } });
  if (!count) go(path, "nije_nacrt");
  const [states, items] = await Promise.all([
    prisma.stanjeZaliha.findMany({ where: { firma_id: firmaId, poslovna_godina_id: context.godina.id, magacin_id: count.magacin_id } }),
    prisma.artikal.findMany({ where: { agencija_id: context.agencijaId, firma_id: firmaId, is_deleted: false, usluga: false, prati_zalihe: true, OR: [{ aktivan: true }, { stanjaZaliha: { some: { poslovna_godina_id: context.godina.id, magacin_id: count.magacin_id, kolicina: { not: 0 } } } }] }, select: { id: true, posljednja_nabavna_cijena: true }, orderBy: [{ sifra: "asc" }, { naziv: "asc" }] })
  ]);
  const stateMap = new Map(states.map((state) => [state.artikal_id, state]));
  await prisma.$transaction(async (tx) => {
    for (const line of count.stavke) {
      const snapshot = lineSnapshot(stateMap.get(line.artikal_id) ?? emptyState());
      const candidate = { ...line, ...Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, { toString: () => value }])) };
      let adjustment = null;
      try { adjustment = calculateLineValues(candidate); } catch { adjustment = null; }
      await tx.stavkaPopisaRobe.update({ where: { id: line.id }, data: { ...snapshot, razlika_kolicina: adjustment ? scaledToDecimal(adjustment.differenceMilli, 3) : "0.000", nabavna_vrijednost_razlike: adjustment ? scaledToDecimal(adjustment.costCents, 2) : "0.00", maloprodajna_vrijednost_razlike: adjustment ? scaledToDecimal(adjustment.retailCents, 2) : "0.00", razlika_u_cijeni_razlike: adjustment ? scaledToDecimal(adjustment.marginCents, 2) : "0.00", ukalkulisani_pdv_razlike: adjustment ? scaledToDecimal(adjustment.includedVatCents, 2) : "0.00", updated_by: context.user.id } });
    }
    const existingItemIds = new Set(count.stavke.map((line) => line.artikal_id));
    const missingItems = items.filter((item) => !existingItemIds.has(item.id));
    if (missingItems.length) {
      await tx.stavkaPopisaRobe.createMany({ data: missingItems.map((item, index) => {
        const snapshot = lineSnapshot(stateMap.get(item.id) ?? emptyState());
        if (decimalToScaled(snapshot.knjigovodstvena_prosjecna_nabavna_cijena, 4) <= BigInt(0) && item.posljednja_nabavna_cijena) snapshot.knjigovodstvena_prosjecna_nabavna_cijena = item.posljednja_nabavna_cijena.toString();
        return { popis_robe_id: id, redni_broj: count.stavke.length + index + 1, artikal_id: item.id, ...snapshot, created_by: context.user.id, updated_by: context.user.id };
      }) });
    }
  });
  await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId, modul: inventoryModule, akcija: "refresh_stock_count_snapshot", tipEntiteta: "PopisRobe", entitetId: id, novaVrijednost: { artikala: items.length } });
  refresh(id); go(path, "stanje_osvjezeno");
}

export async function deleteInventoryCount(formData: FormData) {
  const id = text(formData.get("popis_id"));
  const firmaId = text(formData.get("firma_id"));
  const path = detailPath(id);
  const context = await requireCountContext("delete", firmaId, path);
  const current = await prisma.popisRobe.findFirst({ where: { id, agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, status: inventoryCountStatuses.draft, is_deleted: false } });
  if (!current) go(path, "nije_nacrt");
  await prisma.popisRobe.update({ where: { id }, data: { status: inventoryCountStatuses.deleted, is_deleted: true, deleted_at: new Date(), deleted_by: context.user.id, delete_reason: "Nacrt popisa obrisan iz korisničkog interfejsa.", updated_by: context.user.id } });
  await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId, modul: inventoryModule, akcija: "delete_stock_count", tipEntiteta: "PopisRobe", entitetId: id, staraVrijednost: current });
  refresh(id); go(listPath, "obrisan");
}

export async function postInventoryCount(formData: FormData) {
  const id = text(formData.get("popis_id"));
  const firmaId = text(formData.get("firma_id"));
  const path = detailPath(id);
  const context = await requireCountContext("post", firmaId, path);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`stock-count-post:${id}`}))`);
    const count = await tx.popisRobe.findFirst({ where: { id, agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, status: inventoryCountStatuses.draft, is_deleted: false }, include: { stavke: { include: { artikal: { select: { sifra: true, naziv: true } } }, orderBy: { redni_broj: "asc" } } } });
    if (!count) return { ok: false as const, reason: "nije_nacrt" };
    if (!count.stavke.length) return { ok: false as const, reason: "bez_stavki" };
    if (count.stavke.some((line) => line.stvarna_kolicina === null)) return { ok: false as const, reason: "nepopunjeno" };
    const listedIds = count.stavke.map((line) => line.artikal_id);
    const unlistedState = await tx.stanjeZaliha.findFirst({ where: { firma_id: firmaId, poslovna_godina_id: context.godina.id, magacin_id: count.magacin_id, kolicina: { not: 0 }, artikal_id: { notIn: listedIds } }, include: { artikal: { select: { sifra: true } } } });
    if (unlistedState) return { ok: false as const, reason: `stanje_promijenjeno:${unlistedState.artikal.sifra}` };

    type Prepared = { line: (typeof count.stavke)[number]; state: Awaited<ReturnType<typeof tx.stanjeZaliha.findUnique>>; adjustment: NonNullable<ReturnType<typeof calculateLineValues>> };
    const prepared: Prepared[] = [];
    let surplusTotal = BigInt(0);
    let shortageTotal = BigInt(0);
    for (const line of count.stavke) {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`stock:${firmaId}:${context.godina.id}:${line.artikal_id}`}))`);
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "stanja_zaliha" WHERE "firma_id" = ${firmaId}::uuid AND "poslovna_godina_id" = ${context.godina.id}::uuid AND "magacin_id" = ${count.magacin_id}::uuid AND "artikal_id" = ${line.artikal_id}::uuid FOR UPDATE`);
      const state = rows[0] ? await tx.stanjeZaliha.findUnique({ where: { id: rows[0].id } }) : null;
      const current = state ?? emptyState();
      const changed = decimalToScaled(current.kolicina, 3) !== decimalToScaled(line.knjigovodstvena_kolicina, 3) || decimalToScaled(current.nabavna_vrijednost, 2) !== decimalToScaled(line.knjigovodstvena_nabavna_vrijednost, 2) || decimalToScaled(current.maloprodajna_vrijednost, 2) !== decimalToScaled(line.knjigovodstvena_maloprodajna_vrijednost, 2) || decimalToScaled(current.razlika_u_cijeni, 2) !== decimalToScaled(line.knjigovodstvena_razlika_u_cijeni, 2) || decimalToScaled(current.ukalkulisani_pdv, 2) !== decimalToScaled(line.knjigovodstveni_ukalkulisani_pdv, 2);
      if (changed) return { ok: false as const, reason: `stanje_promijenjeno:${line.artikal.sifra}` };
      let adjustment;
      try { adjustment = calculateLineValues(line); } catch { return { ok: false as const, reason: `cijena_viska:${line.artikal.sifra}` }; }
      if (!adjustment) return { ok: false as const, reason: "nepopunjeno" };
      if (adjustment.kind === "SURPLUS") surplusTotal += adjustment.costCents;
      if (adjustment.kind === "SHORTAGE") shortageTotal += adjustment.costCents;
      prepared.push({ line, state, adjustment });
    }

    if (surplusTotal === BigInt(0) && shortageTotal === BigInt(0)) {
      await tx.popisRobe.update({ where: { id }, data: { status: inventoryCountStatuses.completed, posted_at: new Date(), posted_by: context.user.id, updated_by: context.user.id } });
      return { ok: true as const, journalCode: null, completed: true };
    }

    const neededPurposes = new Set<string>();
    if (surplusTotal > BigInt(0)) { neededPurposes.add("STOCK_COUNT_SURPLUS_INVENTORY"); neededPurposes.add("STOCK_COUNT_SURPLUS_INCOME"); }
    if (shortageTotal > BigInt(0)) { neededPurposes.add("STOCK_COUNT_SHORTAGE_EXPENSE"); neededPurposes.add("STOCK_COUNT_SHORTAGE_INVENTORY"); }
    const [settings, journalType] = await Promise.all([
      tx.firmaPodrazumijevanoKonto.findMany({ where: { firma_id: firmaId, dokument_tip: inventoryCountPostingScope.documentType, podvrsta: inventoryCountPostingScope.subtype, pdv_stopa_sifra: inventoryCountPostingScope.vatRate, namjena: { in: [...neededPurposes] } } }),
      tx.vrstaNaloga.findFirst({ where: { sifra: "STOCK_COUNT", aktivan: true, OR: [{ sistemska: true }, { agencija_id: context.agencijaId }, { firma_id: firmaId }] }, select: { id: true, prefiks: true } })
    ]);
    if (!journalType) return { ok: false as const, reason: "vrsta_naloga" };
    const settingMap = new Map(settings.map((setting) => [setting.namjena, setting]));
    for (const field of inventoryCountPostingFields.filter((item) => neededPurposes.has(item.purpose))) {
      const setting = settingMap.get(field.purpose);
      if (!setting?.sifra_konta) return { ok: false as const, reason: "podesavanja" };
      if (setting.smjer !== field.defaultDirection) return { ok: false as const, reason: "smjer" };
      if (field.purpose === "STOCK_COUNT_SURPLUS_INCOME" && !setting.sifra_konta.startsWith("6")) return { ok: false as const, reason: "konto_prihoda" };
      if (field.purpose === "STOCK_COUNT_SHORTAGE_EXPENSE" && !setting.sifra_konta.startsWith("5")) return { ok: false as const, reason: "konto_troska" };
    }
    const accounts = new Map<string, NonNullable<Awaited<ReturnType<typeof resolveCompanyAccount>>>>();
    for (const purpose of neededPurposes) {
      const account = await resolveCompanyAccount(tx, firmaId, settingMap.get(purpose)!.sifra_konta);
      if (!account) return { ok: false as const, reason: "konto" };
      accounts.set(purpose, account);
    }

    for (const item of prepared) {
      const { line, state, adjustment } = item;
      if (adjustment.kind === "NONE") continue;
      const sign = adjustment.kind === "SURPLUS" ? BigInt(1) : BigInt(-1);
      const oldQuantity = decimalToScaled(state?.kolicina ?? 0, 3);
      const newQuantity = oldQuantity + sign * adjustment.absoluteQuantityMilli;
      const newCost = decimalToScaled(state?.nabavna_vrijednost ?? 0, 2) + sign * adjustment.costCents;
      const newRetail = decimalToScaled(state?.maloprodajna_vrijednost ?? 0, 2) + sign * adjustment.retailCents;
      const newMargin = decimalToScaled(state?.razlika_u_cijeni ?? 0, 2) + sign * adjustment.marginCents;
      const newVat = decimalToScaled(state?.ukalkulisani_pdv ?? 0, 2) + sign * adjustment.includedVatCents;
      const newAverage = newQuantity > BigInt(0) ? roundDivision(newCost * BigInt(100000), newQuantity) : BigInt(0);
      await tx.stanjeZaliha.upsert({ where: { firma_id_poslovna_godina_id_magacin_id_artikal_id: { firma_id: firmaId, poslovna_godina_id: context.godina.id, magacin_id: count.magacin_id, artikal_id: line.artikal_id } }, create: { agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, magacin_id: count.magacin_id, artikal_id: line.artikal_id, kolicina: scaledToDecimal(newQuantity, 3), prosjecna_nabavna_cijena: scaledToDecimal(newAverage, 4), nabavna_vrijednost: scaledToDecimal(newCost, 2), maloprodajna_vrijednost: scaledToDecimal(newRetail, 2), razlika_u_cijeni: scaledToDecimal(newMargin, 2), ukalkulisani_pdv: scaledToDecimal(newVat, 2) }, update: { kolicina: scaledToDecimal(newQuantity, 3), prosjecna_nabavna_cijena: scaledToDecimal(newAverage, 4), nabavna_vrijednost: scaledToDecimal(newCost, 2), maloprodajna_vrijednost: scaledToDecimal(newRetail, 2), razlika_u_cijeni: scaledToDecimal(newMargin, 2), ukalkulisani_pdv: scaledToDecimal(newVat, 2) } });
      const retailUnit = adjustment.retailCents > BigInt(0) ? roundDivision(adjustment.retailCents * BigInt(100000), adjustment.absoluteQuantityMilli) : BigInt(0);
      await tx.prometZaliha.create({ data: { agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, magacin_id: count.magacin_id, artikal_id: line.artikal_id, tip_dokumenta: adjustment.kind === "SURPLUS" ? "STOCK_COUNT_SURPLUS" : "STOCK_COUNT_SHORTAGE", dokument_id: count.id, stavka_dokumenta_id: line.id, datum_prometa: count.datum, smjer: adjustment.kind === "SURPLUS" ? "IN" : "OUT", kolicina: scaledToDecimal(adjustment.absoluteQuantityMilli, 3), jedinicna_nabavna_cijena: scaledToDecimal(adjustment.unitCostTenThousand, 4), nabavna_vrijednost: scaledToDecimal(adjustment.costCents, 2), prodajna_cijena_sa_pdv: scaledToDecimal(retailUnit, 4), prodajna_vrijednost: scaledToDecimal(adjustment.retailCents, 2), razlika_u_cijeni: scaledToDecimal(adjustment.marginCents, 2), ukalkulisani_pdv: scaledToDecimal(adjustment.includedVatCents, 2), prosjecna_cijena_nakon: scaledToDecimal(newAverage, 4), kolicina_nakon: scaledToDecimal(newQuantity, 3), created_by: context.user.id } });
      await tx.stavkaPopisaRobe.update({ where: { id: line.id }, data: { razlika_kolicina: scaledToDecimal(adjustment.differenceMilli, 3), nabavna_vrijednost_razlike: scaledToDecimal(adjustment.costCents, 2), maloprodajna_vrijednost_razlike: scaledToDecimal(adjustment.retailCents, 2), razlika_u_cijeni_razlike: scaledToDecimal(adjustment.marginCents, 2), ukalkulisani_pdv_razlike: scaledToDecimal(adjustment.includedVatCents, 2), updated_by: context.user.id } });
    }

    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`journal-number:${firmaId}:${context.godina.id}:${journalType.id}`}))`);
    const lastJournal = await tx.nalog.findFirst({ where: { firma_id: firmaId, poslovna_godina_id: context.godina.id, vrsta_naloga_id: journalType.id }, orderBy: { broj: "desc" }, select: { broj: true } });
    const journalNumber = (lastJournal?.broj ?? 0) + 1;
    const journalLines: Prisma.StavkaNalogaUncheckedCreateWithoutNalogInput[] = [];
    const addJournalLine = (purpose: string, debit: bigint, credit: bigint, description: string) => journalLines.push({ konto_id: accounts.get(purpose)!.id, poslovna_jedinica_id: count.poslovna_jedinica_id, duguje: scaledToDecimal(debit, 2), potrazuje: scaledToDecimal(credit, 2), opis: description, broj_dokumenta: count.interni_broj, datum_dokumenta: count.datum, redni_broj: journalLines.length + 1, created_by: context.user.id, updated_by: context.user.id });
    if (surplusTotal > BigInt(0)) { addJournalLine("STOCK_COUNT_SURPLUS_INVENTORY", surplusTotal, BigInt(0), `Zalihe po višku ${count.interni_broj}`); addJournalLine("STOCK_COUNT_SURPLUS_INCOME", BigInt(0), surplusTotal, `Prihod od viška ${count.interni_broj}`); }
    if (shortageTotal > BigInt(0)) { addJournalLine("STOCK_COUNT_SHORTAGE_EXPENSE", shortageTotal, BigInt(0), `Trošak manjka ${count.interni_broj}`); addJournalLine("STOCK_COUNT_SHORTAGE_INVENTORY", BigInt(0), shortageTotal, `Zalihe po manjku ${count.interni_broj}`); }
    const journal = await tx.nalog.create({ data: { agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, poslovna_jedinica_id: count.poslovna_jedinica_id, vrsta_naloga_id: journalType.id, broj: journalNumber, sifra: formatJournalCode(journalType.prefiks, context.godina.godina, journalNumber), datum: count.datum, opis: `Popis robe ${count.interni_broj}`, status: journalStatuses.draft, source_type: "STOCK_COUNT", source_module: "agencija.robno.popis", izvorni_dokument_id: count.id, kreirao_korisnik_id: context.user.id, created_by: context.user.id, updated_by: context.user.id, stavke: { create: journalLines } } });
    await tx.popisRobe.update({ where: { id }, data: { status: inventoryCountStatuses.posted, nalog_id: journal.id, ukupna_vrijednost_viska: scaledToDecimal(surplusTotal, 2), ukupna_vrijednost_manjka: scaledToDecimal(shortageTotal, 2), posted_at: new Date(), posted_by: context.user.id, updated_by: context.user.id } });
    return { ok: true as const, journalCode: journal.sifra ?? String(journalNumber), completed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (!result.ok) go(path, result.reason);
  await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId, modul: inventoryModule, akcija: result.completed ? "complete_stock_count_without_difference" : "post_stock_count", tipEntiteta: "PopisRobe", entitetId: id, novaVrijednost: { status: result.completed ? inventoryCountStatuses.completed : inventoryCountStatuses.posted, nalog: result.journalCode } });
  refresh(id); go(path, result.completed ? "zakljucen_bez_razlike" : `proknjizen:${result.journalCode}`);
}
