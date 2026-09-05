"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accountOverrideTypes } from "@/lib/account-plan";
import { auditLog } from "@/lib/audit";
import { requireAnyRole } from "@/lib/auth";
import { inventoryModule, itemPriceTypes } from "@/lib/inventory";
import { decimalToScaled, parseScaledInteger, scaledToDecimal } from "@/lib/inventory-calculation";
import {
  calculatePriceAdjustment,
  inventoryPriceAdjustmentNumber,
  inventoryPriceAdjustmentPostingFields,
  inventoryPriceAdjustmentPostingScope,
  inventoryPriceAdjustmentStatuses
} from "@/lib/inventory-price-adjustment";
import { formatJournalCode, journalStatuses } from "@/lib/journals";
import { hasPermission, type PermissionAction } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

const listPath = "/agencija/robno/nivelacija";

function text(value: FormDataEntryValue | null) { return String(value ?? "").trim(); }
function optionalText(value: FormDataEntryValue | null) { return text(value) || null; }
function parseDate(value: FormDataEntryValue | null) {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
function detailPath(id: string) { return `${listPath}/${id}`; }
function go(path: string, message: string): never { redirect(`${path}?poruka=${encodeURIComponent(message)}`); }

async function requireAdjustmentContext(action: PermissionAction, firmaId: string, returnPath: string) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const work = await readWorkContext();
  if (!user.agencija_id || !work.firmaId || !work.poslovnaGodinaId || work.firmaId !== firmaId) go(returnPath, "prava");
  const [firma, godina, allowed] = await Promise.all([
    prisma.firma.findFirst({ where: { id: firmaId, agencija_id: user.agencija_id, aktivan: true, is_deleted: false, ...(user.rola === "admin_agencije" ? {} : { korisnici: { some: { korisnik_id: user.id, is_deleted: false } } }) }, select: { id: true, naziv: true } }),
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
  revalidatePath("/agencija/robno/cijene");
  revalidatePath("/agencija/izvjestaji/lager-lista");
  revalidatePath("/agencija/izvjestaji/kartica-artikla");
  if (id) { revalidatePath(detailPath(id)); revalidatePath(`/stampa/robno/nivelacija/${id}`); }
}

type Stock = { kolicina: { toString(): string }; nabavna_vrijednost: { toString(): string }; maloprodajna_vrijednost: { toString(): string }; razlika_u_cijeni: { toString(): string }; ukalkulisani_pdv: { toString(): string } };
function stockValues(stock: Stock) {
  return { quantityMilli: decimalToScaled(stock.kolicina, 3), costCents: decimalToScaled(stock.nabavna_vrijednost, 2), retailCents: decimalToScaled(stock.maloprodajna_vrijednost, 2), marginCents: decimalToScaled(stock.razlika_u_cijeni, 2), includedVatCents: decimalToScaled(stock.ukalkulisani_pdv, 2) };
}
function calculationData(stock: Stock, vatPercentHundred: bigint, newPriceCents: bigint) {
  return calculatePriceAdjustment({ stock: stockValues(stock), vatPercentHundred, newGrossUnitCents: newPriceCents });
}
function lineData(stock: Stock, vatPercentHundred: bigint, newPriceCents: bigint, userId: string) {
  const amount = calculationData(stock, vatPercentHundred, newPriceCents);
  return {
    knjigovodstvena_kolicina: stock.kolicina.toString(),
    nabavna_vrijednost: stock.nabavna_vrijednost.toString(),
    pdv_stopa_procenat: scaledToDecimal(vatPercentHundred, 2),
    stara_prodajna_cijena_sa_pdv: scaledToDecimal(amount.oldGrossUnitCents, 2),
    nova_prodajna_cijena_sa_pdv: scaledToDecimal(amount.newGrossUnitCents, 2),
    stara_maloprodajna_vrijednost: scaledToDecimal(amount.oldRetailCents, 2),
    nova_maloprodajna_vrijednost: scaledToDecimal(amount.newRetailCents, 2),
    promjena_maloprodajne_vrijednosti: scaledToDecimal(amount.retailChangeCents, 2),
    stara_razlika_u_cijeni: scaledToDecimal(amount.oldMarginCents, 2),
    nova_razlika_u_cijeni: scaledToDecimal(amount.newMarginCents, 2),
    promjena_razlike_u_cijeni: scaledToDecimal(amount.marginChangeCents, 2),
    stari_ukalkulisani_pdv: scaledToDecimal(amount.oldIncludedVatCents, 2),
    novi_ukalkulisani_pdv: scaledToDecimal(amount.newIncludedVatCents, 2),
    promjena_ukalkulisanog_pdv: scaledToDecimal(amount.includedVatChangeCents, 2),
    updated_by: userId
  };
}

export async function createInventoryPriceAdjustment(formData: FormData) {
  const firmaId = text(formData.get("firma_id"));
  const context = await requireAdjustmentContext("create", firmaId, listPath);
  const warehouseId = text(formData.get("magacin_id")); const date = parseDate(formData.get("datum"));
  if (!warehouseId || !date) go(listPath, "obavezna_polja");
  if (date < context.godina.datum_od || date > context.godina.datum_do) go(listPath, "datum_van_godine");
  const warehouse = await prisma.magacin.findFirst({ where: { id: warehouseId, agencija_id: context.agencijaId, firma_id: firmaId, aktivan: true, is_deleted: false, tip_prodaje: "RETAIL" }, select: { id: true, poslovna_jedinica_id: true } });
  if (!warehouse) go(listPath, "magacin");
  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`price-adjustment-number:${firmaId}:${context.godina.id}`}))`);
    const last = await tx.nivelacijaCijena.findFirst({ where: { firma_id: firmaId, poslovna_godina_id: context.godina.id }, orderBy: { broj: "desc" }, select: { broj: true } });
    const number = (last?.broj ?? 0) + 1;
    return tx.nivelacijaCijena.create({ data: { agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, magacin_id: warehouse.id, poslovna_jedinica_id: warehouse.poslovna_jedinica_id, broj: number, interni_broj: inventoryPriceAdjustmentNumber(context.godina.godina, number), datum: date, napomena: optionalText(formData.get("napomena")), created_by: context.user.id, updated_by: context.user.id } });
  });
  await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId, modul: inventoryModule, akcija: "create_inventory_price_adjustment", tipEntiteta: "NivelacijaCijena", entitetId: created.id, novaVrijednost: created });
  refresh(created.id); redirect(`${detailPath(created.id)}?poruka=kreirana`);
}

export async function updateInventoryPriceAdjustmentHeader(formData: FormData) {
  const id = text(formData.get("nivelacija_id")); const firmaId = text(formData.get("firma_id")); const path = detailPath(id);
  const context = await requireAdjustmentContext("update", firmaId, path); const date = parseDate(formData.get("datum"));
  if (!date) go(path, "obavezna_polja");
  if (date < context.godina.datum_od || date > context.godina.datum_do) go(path, "datum_van_godine");
  const result = await prisma.nivelacijaCijena.updateMany({ where: { id, agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, status: inventoryPriceAdjustmentStatuses.draft, is_deleted: false }, data: { datum: date, napomena: optionalText(formData.get("napomena")), updated_by: context.user.id } });
  if (!result.count) go(path, "nije_nacrt");
  await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId, modul: inventoryModule, akcija: "update_inventory_price_adjustment", tipEntiteta: "NivelacijaCijena", entitetId: id, novaVrijednost: { datum: date } });
  refresh(id); go(path, "zaglavlje_sacuvano");
}

export async function addInventoryPriceAdjustmentLine(formData: FormData) {
  const id = text(formData.get("nivelacija_id")); const firmaId = text(formData.get("firma_id")); const path = detailPath(id);
  const context = await requireAdjustmentContext("update", firmaId, path); const itemId = text(formData.get("artikal_id")); const newPrice = parseScaledInteger(text(formData.get("nova_cijena")), 2);
  if (!itemId || newPrice === null || newPrice <= BigInt(0)) go(path, "stavka");
  const [document, item] = await Promise.all([
    prisma.nivelacijaCijena.findFirst({ where: { id, agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, status: inventoryPriceAdjustmentStatuses.draft, is_deleted: false }, select: { id: true, magacin_id: true } }),
    prisma.artikal.findFirst({ where: { id: itemId, agencija_id: context.agencijaId, firma_id: firmaId, aktivan: true, is_deleted: false, usluga: false, prati_zalihe: true }, select: { id: true, pdv_stopa: { select: { procenat: true } } } })
  ]);
  if (!document || !item) go(path, document ? "artikal" : "nije_nacrt");
  const [exists, stock] = await Promise.all([
    prisma.stavkaNivelacijeCijena.count({ where: { nivelacija_cijena_id: id, artikal_id: itemId } }),
    prisma.stanjeZaliha.findUnique({ where: { firma_id_poslovna_godina_id_magacin_id_artikal_id: { firma_id: firmaId, poslovna_godina_id: context.godina.id, magacin_id: document.magacin_id, artikal_id: itemId } } })
  ]);
  if (exists) go(path, "dupli_artikal");
  if (!stock || decimalToScaled(stock.kolicina, 3) <= BigInt(0)) go(path, "bez_stanja");
  const vat = decimalToScaled(item.pdv_stopa?.procenat ?? { toString: () => "0" }, 2);
  let data;
  try { data = lineData(stock, vat, newPrice, context.user.id); } catch { go(path, "neispravan_lager"); }
  if (decimalToScaled({ toString: () => data.promjena_maloprodajne_vrijednosti }, 2) === BigInt(0)) go(path, "bez_promjene");
  const last = await prisma.stavkaNivelacijeCijena.findFirst({ where: { nivelacija_cijena_id: id }, orderBy: { redni_broj: "desc" }, select: { redni_broj: true } });
  const created = await prisma.stavkaNivelacijeCijena.create({ data: { nivelacija_cijena_id: id, redni_broj: (last?.redni_broj ?? 0) + 1, artikal_id: itemId, ...data, created_by: context.user.id } });
  await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId, modul: inventoryModule, akcija: "add_inventory_price_adjustment_line", tipEntiteta: "StavkaNivelacijeCijena", entitetId: created.id, novaVrijednost: created });
  refresh(id); go(path, "stavka_dodata");
}

export async function updateInventoryPriceAdjustmentLine(formData: FormData) {
  const id = text(formData.get("nivelacija_id")); const lineId = text(formData.get("stavka_id")); const firmaId = text(formData.get("firma_id")); const path = detailPath(id);
  const context = await requireAdjustmentContext("update", firmaId, path); const newPrice = parseScaledInteger(text(formData.get("nova_cijena")), 2);
  if (newPrice === null || newPrice <= BigInt(0)) go(path, "stavka");
  const line = await prisma.stavkaNivelacijeCijena.findFirst({ where: { id: lineId, nivelacija_cijena_id: id, nivelacija_cijena: { agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, status: inventoryPriceAdjustmentStatuses.draft, is_deleted: false } } });
  if (!line) go(path, "nije_nacrt");
  const snapshot: Stock = { kolicina: line.knjigovodstvena_kolicina, nabavna_vrijednost: line.nabavna_vrijednost, maloprodajna_vrijednost: line.stara_maloprodajna_vrijednost, razlika_u_cijeni: line.stara_razlika_u_cijeni, ukalkulisani_pdv: line.stari_ukalkulisani_pdv };
  let data;
  try { data = lineData(snapshot, decimalToScaled(line.pdv_stopa_procenat, 2), newPrice, context.user.id); } catch { go(path, "neispravan_lager"); }
  if (decimalToScaled({ toString: () => data.promjena_maloprodajne_vrijednosti }, 2) === BigInt(0)) go(path, "bez_promjene");
  const updated = await prisma.stavkaNivelacijeCijena.update({ where: { id: lineId }, data });
  await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId, modul: inventoryModule, akcija: "update_inventory_price_adjustment_line", tipEntiteta: "StavkaNivelacijeCijena", entitetId: lineId, staraVrijednost: line, novaVrijednost: updated });
  refresh(id); go(path, "stavka_sacuvana");
}

export async function refreshInventoryPriceAdjustmentSnapshot(formData: FormData) {
  const id = text(formData.get("nivelacija_id")); const firmaId = text(formData.get("firma_id")); const path = detailPath(id);
  const context = await requireAdjustmentContext("update", firmaId, path);
  const document = await prisma.nivelacijaCijena.findFirst({ where: { id, agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, status: inventoryPriceAdjustmentStatuses.draft, is_deleted: false }, include: { stavke: { include: { artikal: { select: { pdv_stopa: { select: { procenat: true } } } } } } } });
  if (!document) go(path, "nije_nacrt");
  await prisma.$transaction(async (tx) => {
    for (const line of document.stavke) {
      const stock = await tx.stanjeZaliha.findUnique({ where: { firma_id_poslovna_godina_id_magacin_id_artikal_id: { firma_id: firmaId, poslovna_godina_id: context.godina.id, magacin_id: document.magacin_id, artikal_id: line.artikal_id } } });
      if (!stock || decimalToScaled(stock.kolicina, 3) <= BigInt(0)) throw new Error(`NO_STOCK:${line.artikal_id}`);
      const data = lineData(stock, decimalToScaled(line.artikal.pdv_stopa?.procenat ?? { toString: () => "0" }, 2), decimalToScaled(line.nova_prodajna_cijena_sa_pdv, 2), context.user.id);
      await tx.stavkaNivelacijeCijena.update({ where: { id: line.id }, data });
    }
  }).catch(() => go(path, "neispravan_lager"));
  await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId, modul: inventoryModule, akcija: "refresh_inventory_price_adjustment_snapshot", tipEntiteta: "NivelacijaCijena", entitetId: id });
  refresh(id); go(path, "stanje_osvjezeno");
}

export async function deleteInventoryPriceAdjustmentLine(formData: FormData) {
  const id = text(formData.get("nivelacija_id")); const lineId = text(formData.get("stavka_id")); const firmaId = text(formData.get("firma_id")); const path = detailPath(id);
  const context = await requireAdjustmentContext("update", firmaId, path);
  const line = await prisma.stavkaNivelacijeCijena.findFirst({ where: { id: lineId, nivelacija_cijena_id: id, nivelacija_cijena: { agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, status: inventoryPriceAdjustmentStatuses.draft, is_deleted: false } } });
  if (!line) go(path, "nije_nacrt");
  await prisma.stavkaNivelacijeCijena.delete({ where: { id: lineId } });
  await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId, modul: inventoryModule, akcija: "delete_inventory_price_adjustment_line", tipEntiteta: "StavkaNivelacijeCijena", entitetId: lineId, staraVrijednost: line });
  refresh(id); go(path, "stavka_obrisana");
}

export async function deleteInventoryPriceAdjustment(formData: FormData) {
  const id = text(formData.get("nivelacija_id")); const firmaId = text(formData.get("firma_id")); const path = detailPath(id);
  const context = await requireAdjustmentContext("delete", firmaId, path);
  const current = await prisma.nivelacijaCijena.findFirst({ where: { id, agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, status: inventoryPriceAdjustmentStatuses.draft, is_deleted: false } });
  if (!current) go(path, "nije_nacrt");
  await prisma.nivelacijaCijena.update({ where: { id }, data: { status: inventoryPriceAdjustmentStatuses.deleted, is_deleted: true, deleted_at: new Date(), deleted_by: context.user.id, delete_reason: "Nacrt nivelacije obrisan iz korisničkog interfejsa.", updated_by: context.user.id } });
  await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId, modul: inventoryModule, akcija: "delete_inventory_price_adjustment", tipEntiteta: "NivelacijaCijena", entitetId: id, staraVrijednost: current });
  refresh(id); go(listPath, "obrisana");
}

export async function postInventoryPriceAdjustment(formData: FormData) {
  const id = text(formData.get("nivelacija_id")); const firmaId = text(formData.get("firma_id")); const path = detailPath(id);
  const context = await requireAdjustmentContext("post", firmaId, path);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`inventory-price-adjustment:${id}`}))`);
    const document = await tx.nivelacijaCijena.findFirst({
      where: { id, agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, status: inventoryPriceAdjustmentStatuses.draft, is_deleted: false },
      include: {
        magacin: true,
        stavke: {
          include: { artikal: { select: { sifra: true, naziv: true, pdv_stopa: { select: { procenat: true } } } } },
          orderBy: { redni_broj: "asc" }
        }
      }
    });
    if (!document) return { ok: false as const, reason: "nije_nacrt" };
    if (!document.stavke.length) return { ok: false as const, reason: "bez_stavki" };
    if (document.magacin.tip_prodaje !== "RETAIL") return { ok: false as const, reason: "magacin" };
    const [settings, journalType] = await Promise.all([
      tx.firmaPodrazumijevanoKonto.findMany({ where: { firma_id: firmaId, dokument_tip: inventoryPriceAdjustmentPostingScope.documentType, podvrsta: inventoryPriceAdjustmentPostingScope.subtype, pdv_stopa_sifra: inventoryPriceAdjustmentPostingScope.vatRate, namjena: { in: inventoryPriceAdjustmentPostingFields.map((field) => field.purpose) } } }),
      tx.vrstaNaloga.findFirst({ where: { sifra: "PRICE_ADJUSTMENT", aktivan: true, OR: [{ sistemska: true }, { agencija_id: context.agencijaId }, { firma_id: firmaId }] }, select: { id: true, prefiks: true } })
    ]);
    if (!journalType) return { ok: false as const, reason: "vrsta_naloga" };
    const settingMap = new Map(settings.map((setting) => [setting.namjena, setting]));
    const inventorySetting = settingMap.get("PRICE_ADJUSTMENT_INVENTORY"); const marginSetting = settingMap.get("PRICE_ADJUSTMENT_MARGIN"); const vatSetting = settingMap.get("PRICE_ADJUSTMENT_INCLUDED_VAT");
    if (!inventorySetting?.sifra_konta || !marginSetting?.sifra_konta || !vatSetting?.sifra_konta) return { ok: false as const, reason: "podesavanja" };
    if (inventorySetting.smjer !== "D" || marginSetting.smjer !== "P" || vatSetting.smjer !== "P") return { ok: false as const, reason: "smjer" };
    const [inventoryAccount, marginAccount, vatAccount] = await Promise.all([resolveCompanyAccount(tx, firmaId, inventorySetting.sifra_konta), resolveCompanyAccount(tx, firmaId, marginSetting.sifra_konta), resolveCompanyAccount(tx, firmaId, vatSetting.sifra_konta)]);
    if (!inventoryAccount || !marginAccount || !vatAccount) return { ok: false as const, reason: "konto" };

    let totalRetail = BigInt(0); let totalMargin = BigInt(0); let totalVat = BigInt(0);
    const journalAmounts = new Map<string, { accountId: string; direction: "D" | "P"; cents: bigint; label: string }>();
    const addJournalAmount = (accountId: string, direction: "D" | "P", cents: bigint, label: string) => {
      if (cents <= BigInt(0)) return;
      const key = `${accountId}:${direction}`; const current = journalAmounts.get(key);
      journalAmounts.set(key, { accountId, direction, cents: (current?.cents ?? BigInt(0)) + cents, label });
    };

    for (const line of document.stavke) {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`stock:${firmaId}:${context.godina.id}:${line.artikal_id}`}))`);
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "stanja_zaliha" WHERE "firma_id" = ${firmaId}::uuid AND "poslovna_godina_id" = ${context.godina.id}::uuid AND "magacin_id" = ${document.magacin_id}::uuid AND "artikal_id" = ${line.artikal_id}::uuid FOR UPDATE`);
      const stock = locked[0] ? await tx.stanjeZaliha.findUnique({ where: { id: locked[0].id } }) : null;
      if (!stock) return { ok: false as const, reason: `stanje_promijenjeno:${line.artikal.sifra}` };
      const unchanged = decimalToScaled(stock.kolicina, 3) === decimalToScaled(line.knjigovodstvena_kolicina, 3) && decimalToScaled(stock.nabavna_vrijednost, 2) === decimalToScaled(line.nabavna_vrijednost, 2) && decimalToScaled(stock.maloprodajna_vrijednost, 2) === decimalToScaled(line.stara_maloprodajna_vrijednost, 2) && decimalToScaled(stock.razlika_u_cijeni, 2) === decimalToScaled(line.stara_razlika_u_cijeni, 2) && decimalToScaled(stock.ukalkulisani_pdv, 2) === decimalToScaled(line.stari_ukalkulisani_pdv, 2);
      if (!unchanged) return { ok: false as const, reason: `stanje_promijenjeno:${line.artikal.sifra}` };
      let amount;
      try { amount = calculationData(stock, decimalToScaled(line.artikal.pdv_stopa?.procenat ?? { toString: () => "0" }, 2), decimalToScaled(line.nova_prodajna_cijena_sa_pdv, 2)); }
      catch { return { ok: false as const, reason: `neispravan_lager:${line.artikal.sifra}` }; }
      if (amount.retailChangeCents === BigInt(0)) return { ok: false as const, reason: `bez_promjene:${line.artikal.sifra}` };
      totalRetail += amount.retailChangeCents; totalMargin += amount.marginChangeCents; totalVat += amount.includedVatChangeCents;
      addJournalAmount(inventoryAccount.id, amount.retailChangeCents > BigInt(0) ? "D" : "P", amount.retailChangeCents < BigInt(0) ? -amount.retailChangeCents : amount.retailChangeCents, "Roba u maloprodaji");
      addJournalAmount(marginAccount.id, amount.marginChangeCents > BigInt(0) ? "P" : "D", amount.marginChangeCents < BigInt(0) ? -amount.marginChangeCents : amount.marginChangeCents, "Razlika u cijeni");
      addJournalAmount(vatAccount.id, amount.includedVatChangeCents > BigInt(0) ? "P" : "D", amount.includedVatChangeCents < BigInt(0) ? -amount.includedVatChangeCents : amount.includedVatChangeCents, "Ukalkulisani PDV");

      await tx.stanjeZaliha.update({ where: { id: stock.id }, data: { maloprodajna_vrijednost: scaledToDecimal(amount.newRetailCents, 2), razlika_u_cijeni: scaledToDecimal(amount.newMarginCents, 2), ukalkulisani_pdv: scaledToDecimal(amount.newIncludedVatCents, 2) } });
      await tx.stavkaNivelacijeCijena.update({ where: { id: line.id }, data: lineData(stock, decimalToScaled(line.artikal.pdv_stopa?.procenat ?? { toString: () => "0" }, 2), amount.newGrossUnitCents, context.user.id) });
      await tx.prometZaliha.create({ data: { agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, magacin_id: document.magacin_id, artikal_id: line.artikal_id, tip_dokumenta: amount.retailChangeCents > BigInt(0) ? "PRICE_ADJUSTMENT_UP" : "PRICE_ADJUSTMENT_DOWN", dokument_id: document.id, stavka_dokumenta_id: line.id, datum_prometa: document.datum, smjer: amount.retailChangeCents > BigInt(0) ? "IN" : "OUT", kolicina: "0.000", jedinicna_nabavna_cijena: stock.prosjecna_nabavna_cijena, nabavna_vrijednost: "0.00", prodajna_cijena_sa_pdv: scaledToDecimal(amount.newGrossUnitCents, 2), prodajna_vrijednost: scaledToDecimal(amount.retailChangeCents < BigInt(0) ? -amount.retailChangeCents : amount.retailChangeCents, 2), razlika_u_cijeni: scaledToDecimal(amount.marginChangeCents < BigInt(0) ? -amount.marginChangeCents : amount.marginChangeCents, 2), ukalkulisani_pdv: scaledToDecimal(amount.includedVatChangeCents < BigInt(0) ? -amount.includedVatChangeCents : amount.includedVatChangeCents, 2), prosjecna_cijena_nakon: stock.prosjecna_nabavna_cijena, kolicina_nakon: stock.kolicina, created_by: context.user.id } });
      await tx.cijenaArtikla.updateMany({ where: { firma_id: firmaId, artikal_id: line.artikal_id, magacin_id: document.magacin_id, komitent_id: null, tip: itemPriceTypes.retail, aktivna: true, is_deleted: false }, data: { aktivna: false, updated_by: context.user.id } });
      const newNetCents = amount.newRetailCents - amount.newIncludedVatCents;
      const newNetUnitCents = decimalToScaled(stock.kolicina, 3) > BigInt(0) ? (newNetCents * BigInt(1000) + decimalToScaled(stock.kolicina, 3) / BigInt(2)) / decimalToScaled(stock.kolicina, 3) : BigInt(0);
      await tx.cijenaArtikla.create({ data: { agencija_id: context.agencijaId, firma_id: firmaId, artikal_id: line.artikal_id, tip: itemPriceTypes.retail, cijena_bez_pdv: scaledToDecimal(newNetUnitCents, 2), cijena_sa_pdv: scaledToDecimal(amount.newGrossUnitCents, 2), pdv_stopa_procenat: line.artikal.pdv_stopa?.procenat ?? "0.00", valuta: "EUR", magacin_id: document.magacin_id, vazi_od: document.datum, aktivna: true, napomena: `Nivelacija ${document.interni_broj}`, created_by: context.user.id, updated_by: context.user.id } });
    }

    const journalRows = [...journalAmounts.values()];
    const debit = journalRows.reduce((sum, row) => sum + (row.direction === "D" ? row.cents : BigInt(0)), BigInt(0));
    const credit = journalRows.reduce((sum, row) => sum + (row.direction === "P" ? row.cents : BigInt(0)), BigInt(0));
    if (!journalRows.length || debit !== credit) return { ok: false as const, reason: "neizbalansiran" };
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`journal-number:${firmaId}:${context.godina.id}:${journalType.id}`}))`);
    const lastJournal = await tx.nalog.findFirst({ where: { firma_id: firmaId, poslovna_godina_id: context.godina.id, vrsta_naloga_id: journalType.id }, orderBy: { broj: "desc" }, select: { broj: true } });
    const journalNumber = (lastJournal?.broj ?? 0) + 1;
    const journal = await tx.nalog.create({ data: { agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, poslovna_jedinica_id: document.poslovna_jedinica_id, vrsta_naloga_id: journalType.id, broj: journalNumber, sifra: formatJournalCode(journalType.prefiks, context.godina.godina, journalNumber), datum: document.datum, opis: `Nivelacija cijena ${document.interni_broj}`, status: journalStatuses.draft, source_type: "PRICE_ADJUSTMENT", source_module: "agencija.robno.nivelacija", izvorni_dokument_id: document.id, kreirao_korisnik_id: context.user.id, created_by: context.user.id, updated_by: context.user.id, stavke: { create: journalRows.map((row, index) => ({ konto_id: row.accountId, poslovna_jedinica_id: document.poslovna_jedinica_id, duguje: row.direction === "D" ? scaledToDecimal(row.cents, 2) : "0.00", potrazuje: row.direction === "P" ? scaledToDecimal(row.cents, 2) : "0.00", opis: `${row.label} — ${document.interni_broj}`, broj_dokumenta: document.interni_broj, datum_dokumenta: document.datum, redni_broj: index + 1, created_by: context.user.id, updated_by: context.user.id })) } } });
    await tx.nivelacijaCijena.update({ where: { id }, data: { status: inventoryPriceAdjustmentStatuses.posted, nalog_id: journal.id, ukupna_promjena_maloprodajne_vrijednosti: scaledToDecimal(totalRetail, 2), ukupna_promjena_razlike_u_cijeni: scaledToDecimal(totalMargin, 2), ukupna_promjena_ukalkulisanog_pdv: scaledToDecimal(totalVat, 2), posted_at: new Date(), posted_by: context.user.id, updated_by: context.user.id } });
    return { ok: true as const, journalCode: journal.sifra ?? String(journalNumber) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (!result.ok) go(path, result.reason);
  await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId, modul: inventoryModule, akcija: "post_inventory_price_adjustment", tipEntiteta: "NivelacijaCijena", entitetId: id, novaVrijednost: { status: inventoryPriceAdjustmentStatuses.posted, nalog: result.journalCode } });
  refresh(id); go(path, `proknjizena:${result.journalCode}`);
}
