"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accountOverrideTypes } from "@/lib/account-plan";
import { auditLog } from "@/lib/audit";
import { requireAnyRole } from "@/lib/auth";
import { inventoryModule } from "@/lib/inventory";
import { decimalToScaled, parseScaledInteger, roundDivision, scaledToDecimal } from "@/lib/inventory-calculation";
import {
  calculateWriteOffSlice,
  inventoryWriteOffNumber,
  inventoryWriteOffPostingFields,
  inventoryWriteOffPostingScope,
  inventoryWriteOffReasons,
  inventoryWriteOffStatuses
} from "@/lib/inventory-write-off";
import { formatJournalCode, journalStatuses } from "@/lib/journals";
import { hasPermission, type PermissionAction } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

const listPath = "/agencija/robno/otpis";

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

async function requireWriteOffContext(action: PermissionAction, firmaId: string, returnPath: string) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const work = await readWorkContext();
  if (!user.agencija_id || !work.firmaId || !work.poslovnaGodinaId || work.firmaId !== firmaId) go(returnPath, "prava");
  const [firma, godina, allowed] = await Promise.all([
    prisma.firma.findFirst({ where: { id: firmaId, agencija_id: user.agencija_id, aktivan: true, is_deleted: false, ...(user.rola === "admin_agencije" ? {} : { korisnici: { some: { korisnik_id: user.id, is_deleted: false, moze_da_mijenja: true } } }) }, select: { id: true, naziv: true, dozvoli_negativan_lager: true } }),
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
  if (id) { revalidatePath(detailPath(id)); revalidatePath(`/stampa/robno/otpis/${id}`); }
}

function stateValues(state: { kolicina: { toString(): string }; prosjecna_nabavna_cijena: { toString(): string }; nabavna_vrijednost: { toString(): string }; maloprodajna_vrijednost: { toString(): string }; razlika_u_cijeni: { toString(): string }; ukalkulisani_pdv: { toString(): string } } | null) {
  return {
    quantityMilli: decimalToScaled(state?.kolicina ?? { toString: () => "0" }, 3),
    averageCostTenThousand: decimalToScaled(state?.prosjecna_nabavna_cijena ?? { toString: () => "0" }, 4),
    costCents: decimalToScaled(state?.nabavna_vrijednost ?? { toString: () => "0" }, 2),
    retailCents: decimalToScaled(state?.maloprodajna_vrijednost ?? { toString: () => "0" }, 2),
    marginCents: decimalToScaled(state?.razlika_u_cijeni ?? { toString: () => "0" }, 2),
    includedVatCents: decimalToScaled(state?.ukalkulisani_pdv ?? { toString: () => "0" }, 2)
  };
}

async function calculateDraftValues(input: { firmaId: string; yearId: string; warehouseId: string; itemId: string; quantityMilli: bigint; estimatedCost: bigint | null }) {
  const [state, item] = await Promise.all([
    prisma.stanjeZaliha.findUnique({ where: { firma_id_poslovna_godina_id_magacin_id_artikal_id: { firma_id: input.firmaId, poslovna_godina_id: input.yearId, magacin_id: input.warehouseId, artikal_id: input.itemId } } }),
    prisma.artikal.findUnique({ where: { id: input.itemId }, select: { posljednja_nabavna_cijena: true } })
  ]);
  const fallback = input.estimatedCost ?? decimalToScaled(item?.posljednja_nabavna_cijena ?? { toString: () => "0" }, 4);
  try { return calculateWriteOffSlice({ source: stateValues(state), quantityMilli: input.quantityMilli, fallbackUnitCostTenThousand: fallback }); }
  catch { return null; }
}

export async function createInventoryWriteOff(formData: FormData) {
  const firmaId = text(formData.get("firma_id"));
  const context = await requireWriteOffContext("create", firmaId, listPath);
  const warehouseId = text(formData.get("magacin_id"));
  const date = parseDate(formData.get("datum"));
  const reason = text(formData.get("razlog"));
  if (!warehouseId || !date || !inventoryWriteOffReasons.some((item) => item.value === reason)) go(listPath, "obavezna_polja");
  if (reason === "OTHER" && !optionalText(formData.get("opis_razloga"))) go(listPath, "opis_razloga");
  if (date < context.godina.datum_od || date > context.godina.datum_do) go(listPath, "datum_van_godine");
  const warehouse = await prisma.magacin.findFirst({ where: { id: warehouseId, agencija_id: context.agencijaId, firma_id: firmaId, aktivan: true, is_deleted: false }, select: { id: true, poslovna_jedinica_id: true } });
  if (!warehouse) go(listPath, "magacin");
  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`write-off-number:${firmaId}:${context.godina.id}`}))`);
    const last = await tx.otpisRobe.findFirst({ where: { firma_id: firmaId, poslovna_godina_id: context.godina.id }, orderBy: { broj: "desc" }, select: { broj: true } });
    const number = (last?.broj ?? 0) + 1;
    return tx.otpisRobe.create({ data: { agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, magacin_id: warehouseId, poslovna_jedinica_id: warehouse.poslovna_jedinica_id, broj: number, interni_broj: inventoryWriteOffNumber(context.godina.godina, number), datum: date, razlog: reason, opis_razloga: optionalText(formData.get("opis_razloga")), napomena: optionalText(formData.get("napomena")), created_by: context.user.id, updated_by: context.user.id } });
  });
  await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId, modul: inventoryModule, akcija: "create_inventory_write_off", tipEntiteta: "OtpisRobe", entitetId: created.id, novaVrijednost: created });
  refresh(created.id); redirect(`${detailPath(created.id)}?poruka=kreiran`);
}

export async function updateInventoryWriteOffHeader(formData: FormData) {
  const id = text(formData.get("otpis_id")); const firmaId = text(formData.get("firma_id")); const path = detailPath(id);
  const context = await requireWriteOffContext("update", firmaId, path);
  const date = parseDate(formData.get("datum")); const reason = text(formData.get("razlog")); const reasonDescription = optionalText(formData.get("opis_razloga"));
  if (!date || !inventoryWriteOffReasons.some((item) => item.value === reason)) go(path, "obavezna_polja");
  if (reason === "OTHER" && !reasonDescription) go(path, "opis_razloga");
  if (date < context.godina.datum_od || date > context.godina.datum_do) go(path, "datum_van_godine");
  const result = await prisma.otpisRobe.updateMany({ where: { id, agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, status: inventoryWriteOffStatuses.draft, is_deleted: false }, data: { datum: date, razlog: reason, opis_razloga: reasonDescription, napomena: optionalText(formData.get("napomena")), updated_by: context.user.id } });
  if (!result.count) go(path, "nije_nacrt");
  await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId, modul: inventoryModule, akcija: "update_inventory_write_off", tipEntiteta: "OtpisRobe", entitetId: id, novaVrijednost: { datum: date, razlog: reason, opis_razloga: reasonDescription } });
  refresh(id); go(path, "zaglavlje_sacuvano");
}

export async function addInventoryWriteOffLine(formData: FormData) {
  const id = text(formData.get("otpis_id")); const firmaId = text(formData.get("firma_id")); const path = detailPath(id);
  const context = await requireWriteOffContext("update", firmaId, path);
  const itemId = text(formData.get("artikal_id")); const quantity = parseScaledInteger(text(formData.get("kolicina")), 3);
  const estimatedRaw = text(formData.get("procijenjena_cijena")); const estimated = estimatedRaw ? parseScaledInteger(estimatedRaw, 4) : null;
  if (!itemId || quantity === null || quantity <= BigInt(0) || (estimated !== null && estimated <= BigInt(0))) go(path, "stavka");
  const [document, item] = await Promise.all([
    prisma.otpisRobe.findFirst({ where: { id, agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, status: inventoryWriteOffStatuses.draft, is_deleted: false }, select: { id: true, magacin_id: true } }),
    prisma.artikal.findFirst({ where: { id: itemId, agencija_id: context.agencijaId, firma_id: firmaId, aktivan: true, is_deleted: false, usluga: false, prati_zalihe: true }, select: { id: true } })
  ]);
  if (!document || !item) go(path, document ? "artikal" : "nije_nacrt");
  const exists = await prisma.stavkaOtpisaRobe.count({ where: { otpis_robe_id: id, artikal_id: itemId } });
  if (exists) go(path, "dupli_artikal");
  const preview = await calculateDraftValues({ firmaId, yearId: context.godina.id, warehouseId: document.magacin_id, itemId, quantityMilli: quantity, estimatedCost: estimated });
  const last = await prisma.stavkaOtpisaRobe.findFirst({ where: { otpis_robe_id: id }, orderBy: { redni_broj: "desc" }, select: { redni_broj: true } });
  const created = await prisma.stavkaOtpisaRobe.create({ data: { otpis_robe_id: id, redni_broj: (last?.redni_broj ?? 0) + 1, artikal_id: itemId, kolicina: scaledToDecimal(quantity, 3), procijenjena_nabavna_cijena: estimated === null ? null : scaledToDecimal(estimated, 4), jedinicna_nabavna_cijena: preview ? scaledToDecimal(preview.unitCostTenThousand, 4) : "0.0000", nabavna_vrijednost: preview ? scaledToDecimal(preview.costCents, 2) : "0.00", maloprodajna_vrijednost: preview ? scaledToDecimal(preview.retailCents, 2) : "0.00", razlika_u_cijeni: preview ? scaledToDecimal(preview.marginCents, 2) : "0.00", ukalkulisani_pdv: preview ? scaledToDecimal(preview.includedVatCents, 2) : "0.00", napomena: optionalText(formData.get("napomena_stavke")), created_by: context.user.id, updated_by: context.user.id } });
  await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId, modul: inventoryModule, akcija: "add_inventory_write_off_line", tipEntiteta: "StavkaOtpisaRobe", entitetId: created.id, novaVrijednost: created });
  refresh(id); go(path, preview ? "stavka_dodata" : "stavka_dodata_bez_cijene");
}

export async function updateInventoryWriteOffLine(formData: FormData) {
  const id = text(formData.get("otpis_id")); const lineId = text(formData.get("stavka_id")); const firmaId = text(formData.get("firma_id")); const path = detailPath(id);
  const context = await requireWriteOffContext("update", firmaId, path);
  const quantity = parseScaledInteger(text(formData.get("kolicina")), 3); const estimatedRaw = text(formData.get("procijenjena_cijena")); const estimated = estimatedRaw ? parseScaledInteger(estimatedRaw, 4) : null;
  if (quantity === null || quantity <= BigInt(0) || (estimated !== null && estimated <= BigInt(0))) go(path, "stavka");
  const line = await prisma.stavkaOtpisaRobe.findFirst({ where: { id: lineId, otpis_robe_id: id, otpis_robe: { agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, status: inventoryWriteOffStatuses.draft, is_deleted: false } }, include: { otpis_robe: { select: { magacin_id: true } } } });
  if (!line) go(path, "nije_nacrt");
  const preview = await calculateDraftValues({ firmaId, yearId: context.godina.id, warehouseId: line.otpis_robe.magacin_id, itemId: line.artikal_id, quantityMilli: quantity, estimatedCost: estimated });
  const updated = await prisma.stavkaOtpisaRobe.update({ where: { id: lineId }, data: { kolicina: scaledToDecimal(quantity, 3), procijenjena_nabavna_cijena: estimated === null ? null : scaledToDecimal(estimated, 4), jedinicna_nabavna_cijena: preview ? scaledToDecimal(preview.unitCostTenThousand, 4) : "0.0000", nabavna_vrijednost: preview ? scaledToDecimal(preview.costCents, 2) : "0.00", maloprodajna_vrijednost: preview ? scaledToDecimal(preview.retailCents, 2) : "0.00", razlika_u_cijeni: preview ? scaledToDecimal(preview.marginCents, 2) : "0.00", ukalkulisani_pdv: preview ? scaledToDecimal(preview.includedVatCents, 2) : "0.00", napomena: optionalText(formData.get("napomena_stavke")), updated_by: context.user.id } });
  await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId, modul: inventoryModule, akcija: "update_inventory_write_off_line", tipEntiteta: "StavkaOtpisaRobe", entitetId: lineId, staraVrijednost: line, novaVrijednost: updated });
  refresh(id); go(path, preview ? "stavka_sacuvana" : "stavka_dodata_bez_cijene");
}

export async function deleteInventoryWriteOffLine(formData: FormData) {
  const id = text(formData.get("otpis_id")); const lineId = text(formData.get("stavka_id")); const firmaId = text(formData.get("firma_id")); const path = detailPath(id);
  const context = await requireWriteOffContext("update", firmaId, path);
  const line = await prisma.stavkaOtpisaRobe.findFirst({ where: { id: lineId, otpis_robe_id: id, otpis_robe: { agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, status: inventoryWriteOffStatuses.draft, is_deleted: false } } });
  if (!line) go(path, "nije_nacrt");
  await prisma.stavkaOtpisaRobe.delete({ where: { id: lineId } });
  await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId, modul: inventoryModule, akcija: "delete_inventory_write_off_line", tipEntiteta: "StavkaOtpisaRobe", entitetId: lineId, staraVrijednost: line });
  refresh(id); go(path, "stavka_obrisana");
}

export async function deleteInventoryWriteOff(formData: FormData) {
  const id = text(formData.get("otpis_id")); const firmaId = text(formData.get("firma_id")); const path = detailPath(id);
  const context = await requireWriteOffContext("delete", firmaId, path);
  const current = await prisma.otpisRobe.findFirst({ where: { id, agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, status: inventoryWriteOffStatuses.draft, is_deleted: false } });
  if (!current) go(path, "nije_nacrt");
  await prisma.otpisRobe.update({ where: { id }, data: { status: inventoryWriteOffStatuses.deleted, is_deleted: true, deleted_at: new Date(), deleted_by: context.user.id, delete_reason: "Nacrt otpisa obrisan iz korisničkog interfejsa.", updated_by: context.user.id } });
  await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId, modul: inventoryModule, akcija: "delete_inventory_write_off", tipEntiteta: "OtpisRobe", entitetId: id, staraVrijednost: current });
  refresh(id); go(listPath, "obrisan");
}

export async function postInventoryWriteOff(formData: FormData) {
  const id = text(formData.get("otpis_id")); const firmaId = text(formData.get("firma_id")); const path = detailPath(id);
  const context = await requireWriteOffContext("post", firmaId, path);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`inventory-write-off:${id}`}))`);
    const document = await tx.otpisRobe.findFirst({ where: { id, agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, status: inventoryWriteOffStatuses.draft, is_deleted: false }, include: { magacin: true, stavke: { include: { artikal: { select: { sifra: true, naziv: true, posljednja_nabavna_cijena: true } } }, orderBy: { redni_broj: "asc" } } } });
    if (!document) return { ok: false as const, reason: "nije_nacrt" };
    if (!document.stavke.length) return { ok: false as const, reason: "bez_stavki" };
    const [settings, journalType] = await Promise.all([
      tx.firmaPodrazumijevanoKonto.findMany({ where: { firma_id: firmaId, dokument_tip: inventoryWriteOffPostingScope.documentType, podvrsta: inventoryWriteOffPostingScope.subtype, pdv_stopa_sifra: inventoryWriteOffPostingScope.vatRate, namjena: { in: inventoryWriteOffPostingFields.map((field) => field.purpose) } } }),
      tx.vrstaNaloga.findFirst({ where: { sifra: "WRITE_OFF", aktivan: true, OR: [{ sistemska: true }, { agencija_id: context.agencijaId }, { firma_id: firmaId }] }, select: { id: true, prefiks: true } })
    ]);
    if (!journalType) return { ok: false as const, reason: "vrsta_naloga" };
    const settingMap = new Map(settings.map((setting) => [setting.namjena, setting]));
    const expenseSetting = settingMap.get("WRITE_OFF_EXPENSE"); const inventorySetting = settingMap.get("WRITE_OFF_INVENTORY");
    if (!expenseSetting?.sifra_konta || !inventorySetting?.sifra_konta) return { ok: false as const, reason: "podesavanja" };
    if (expenseSetting.smjer !== "D" || inventorySetting.smjer !== "P") return { ok: false as const, reason: "smjer" };
    if (!expenseSetting.sifra_konta.startsWith("5")) return { ok: false as const, reason: "konto_troska" };
    const [expenseAccount, inventoryAccount] = await Promise.all([resolveCompanyAccount(tx, firmaId, expenseSetting.sifra_konta), resolveCompanyAccount(tx, firmaId, inventorySetting.sifra_konta)]);
    if (!expenseAccount || !inventoryAccount) return { ok: false as const, reason: "konto" };

    let totalCost = BigInt(0); let totalRetail = BigInt(0); let totalMargin = BigInt(0); let totalVat = BigInt(0);
    for (const line of document.stavke) {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`stock:${firmaId}:${context.godina.id}:${line.artikal_id}`}))`);
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "stanja_zaliha" WHERE "firma_id" = ${firmaId}::uuid AND "poslovna_godina_id" = ${context.godina.id}::uuid AND "magacin_id" = ${document.magacin_id}::uuid AND "artikal_id" = ${line.artikal_id}::uuid FOR UPDATE`);
      const state = locked[0] ? await tx.stanjeZaliha.findUnique({ where: { id: locked[0].id } }) : null;
      const source = stateValues(state); const quantity = decimalToScaled(line.kolicina, 3);
      const allowNegative = document.magacin.dozvoli_negativan_lager ?? context.firma.dozvoli_negativan_lager;
      if (!allowNegative && source.quantityMilli < quantity) return { ok: false as const, reason: `lager:${line.artikal.sifra}:${scaledToDecimal(source.quantityMilli, 3)}:${scaledToDecimal(quantity, 3)}` };
      const fallback = decimalToScaled(line.procijenjena_nabavna_cijena ?? line.artikal.posljednja_nabavna_cijena ?? { toString: () => "0" }, 4);
      let slice;
      try { slice = calculateWriteOffSlice({ source, quantityMilli: quantity, fallbackUnitCostTenThousand: fallback }); }
      catch { return { ok: false as const, reason: `nabavna:${line.artikal.sifra}` }; }
      totalCost += slice.costCents; totalRetail += slice.retailCents; totalMargin += slice.marginCents; totalVat += slice.includedVatCents;
      const quantityAfter = source.quantityMilli - quantity;
      const costAfter = source.costCents - slice.costCents; const retailAfter = source.retailCents - slice.retailCents; const marginAfter = source.marginCents - slice.marginCents; const vatAfter = source.includedVatCents - slice.includedVatCents;
      const averageAfter = quantityAfter === BigInt(0) ? BigInt(0) : slice.unitCostTenThousand;
      await tx.stanjeZaliha.upsert({ where: { firma_id_poslovna_godina_id_magacin_id_artikal_id: { firma_id: firmaId, poslovna_godina_id: context.godina.id, magacin_id: document.magacin_id, artikal_id: line.artikal_id } }, create: { agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, magacin_id: document.magacin_id, artikal_id: line.artikal_id, kolicina: scaledToDecimal(quantityAfter, 3), prosjecna_nabavna_cijena: scaledToDecimal(averageAfter, 4), nabavna_vrijednost: scaledToDecimal(costAfter, 2), maloprodajna_vrijednost: scaledToDecimal(retailAfter, 2), razlika_u_cijeni: scaledToDecimal(marginAfter, 2), ukalkulisani_pdv: scaledToDecimal(vatAfter, 2) }, update: { kolicina: scaledToDecimal(quantityAfter, 3), prosjecna_nabavna_cijena: scaledToDecimal(averageAfter, 4), nabavna_vrijednost: scaledToDecimal(costAfter, 2), maloprodajna_vrijednost: scaledToDecimal(retailAfter, 2), razlika_u_cijeni: scaledToDecimal(marginAfter, 2), ukalkulisani_pdv: scaledToDecimal(vatAfter, 2) } });
      const retailUnit = slice.retailCents > BigInt(0) ? roundDivision(slice.retailCents * BigInt(100000), quantity) : BigInt(0);
      await tx.stavkaOtpisaRobe.update({ where: { id: line.id }, data: { jedinicna_nabavna_cijena: scaledToDecimal(slice.unitCostTenThousand, 4), nabavna_vrijednost: scaledToDecimal(slice.costCents, 2), prodajna_cijena_sa_pdv: scaledToDecimal(retailUnit, 4), maloprodajna_vrijednost: scaledToDecimal(slice.retailCents, 2), razlika_u_cijeni: scaledToDecimal(slice.marginCents, 2), ukalkulisani_pdv: scaledToDecimal(slice.includedVatCents, 2), updated_by: context.user.id } });
      await tx.prometZaliha.create({ data: { agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, magacin_id: document.magacin_id, artikal_id: line.artikal_id, tip_dokumenta: "WRITE_OFF", dokument_id: document.id, stavka_dokumenta_id: line.id, datum_prometa: document.datum, smjer: "OUT", kolicina: scaledToDecimal(quantity, 3), jedinicna_nabavna_cijena: scaledToDecimal(slice.unitCostTenThousand, 4), nabavna_vrijednost: scaledToDecimal(slice.costCents, 2), prodajna_cijena_sa_pdv: scaledToDecimal(retailUnit, 4), prodajna_vrijednost: scaledToDecimal(slice.retailCents, 2), razlika_u_cijeni: scaledToDecimal(slice.marginCents, 2), ukalkulisani_pdv: scaledToDecimal(slice.includedVatCents, 2), prosjecna_cijena_nakon: scaledToDecimal(averageAfter, 4), kolicina_nakon: scaledToDecimal(quantityAfter, 3), created_by: context.user.id } });
    }

    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`journal-number:${firmaId}:${context.godina.id}:${journalType.id}`}))`);
    const lastJournal = await tx.nalog.findFirst({ where: { firma_id: firmaId, poslovna_godina_id: context.godina.id, vrsta_naloga_id: journalType.id }, orderBy: { broj: "desc" }, select: { broj: true } });
    const journalNumber = (lastJournal?.broj ?? 0) + 1;
    const journal = await tx.nalog.create({ data: { agencija_id: context.agencijaId, firma_id: firmaId, poslovna_godina_id: context.godina.id, poslovna_jedinica_id: document.poslovna_jedinica_id, vrsta_naloga_id: journalType.id, broj: journalNumber, sifra: formatJournalCode(journalType.prefiks, context.godina.godina, journalNumber), datum: document.datum, opis: `Otpis robe ${document.interni_broj}`, status: journalStatuses.draft, source_type: "WRITE_OFF", source_module: "agencija.robno.otpis", izvorni_dokument_id: document.id, kreirao_korisnik_id: context.user.id, created_by: context.user.id, updated_by: context.user.id, stavke: { create: [{ konto_id: expenseAccount.id, poslovna_jedinica_id: document.poslovna_jedinica_id, duguje: scaledToDecimal(totalCost, 2), potrazuje: "0.00", opis: `Trošak otpisa ${document.interni_broj}`, broj_dokumenta: document.interni_broj, datum_dokumenta: document.datum, redni_broj: 1, created_by: context.user.id, updated_by: context.user.id }, { konto_id: inventoryAccount.id, poslovna_jedinica_id: document.poslovna_jedinica_id, duguje: "0.00", potrazuje: scaledToDecimal(totalCost, 2), opis: `Razduženje zaliha ${document.interni_broj}`, broj_dokumenta: document.interni_broj, datum_dokumenta: document.datum, redni_broj: 2, created_by: context.user.id, updated_by: context.user.id }] } } });
    await tx.otpisRobe.update({ where: { id }, data: { status: inventoryWriteOffStatuses.posted, nalog_id: journal.id, ukupna_nabavna_vrijednost: scaledToDecimal(totalCost, 2), ukupna_maloprodajna_vrijednost: scaledToDecimal(totalRetail, 2), ukupna_razlika_u_cijeni: scaledToDecimal(totalMargin, 2), ukupni_ukalkulisani_pdv: scaledToDecimal(totalVat, 2), posted_at: new Date(), posted_by: context.user.id, updated_by: context.user.id } });
    return { ok: true as const, journalCode: journal.sifra ?? String(journalNumber) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (!result.ok) go(path, result.reason);
  await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId, modul: inventoryModule, akcija: "post_inventory_write_off", tipEntiteta: "OtpisRobe", entitetId: id, novaVrijednost: { status: inventoryWriteOffStatuses.posted, nalog: result.journalCode } });
  refresh(id); go(path, `proknjizen:${result.journalCode}`);
}
