"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { fiscalAdminApi, FiscalAdminApiError } from "@/lib/fiscal-admin-api";
import { posModule } from "@/lib/pos";
import { prisma } from "@/lib/prisma";

const returnTo = "/portal/podesavanja";
const paymentMethods = new Set(["CASH", "CARD", "BANK_TRANSFER"]);

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optional(value: string) {
  return value || null;
}

function limited(value: string, length: number) {
  return optional(value.slice(0, length));
}

function parseDeposit(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isSafeInteger(Math.round(amount * 100)) && amount >= 0
    ? amount
    : null;
}

async function settingsContext() {
  return requireDirectPortalContext(
    [
      { modul: "pos", akcija: "manage" },
      { modul: "robno", akcija: "manage" }
    ],
    returnTo,
    "any"
  );
}

export async function updatePortalContactSettings(formData: FormData) {
  const context = await settingsContext();
  const current = await prisma.firma.findFirst({
    where: { id: context.firma.id, agencija_id: context.user.agencija_id! },
    select: { telefon: true, email: true, web_sajt: true }
  });
  if (!current) redirect(`${returnTo}?poruka=scope`);
  const next = {
    telefon: limited(text(formData, "telefon"), 80),
    email: limited(text(formData, "email"), 160),
    web_sajt: limited(text(formData, "web_sajt"), 200)
  };
  await prisma.firma.update({
    where: { id: context.firma.id },
    data: { ...next, updated_by: context.user.id }
  });
  await auditLog({ korisnikId: context.user.id, agencijaId: context.user.agencija_id, firmaId: context.firma.id, modul: "fiskalizacija", akcija: "update_portal_contact_settings", tipEntiteta: "Firma", entitetId: context.firma.id, staraVrijednost: current, novaVrijednost: next });
  revalidatePath(returnTo);
  redirect(`${returnTo}?poruka=kontakt`);
}

export async function updatePortalMainBankAccount(formData: FormData) {
  const context = await settingsContext();
  const accountId = text(formData, "bank_account_id");
  const account = await prisma.firmaBankovniRacun.findFirst({
    where: { id: accountId, agencija_id: context.user.agencija_id!, firma_id: context.firma.id, aktivan: true, is_deleted: false },
    select: { id: true, broj_racuna: true }
  });
  if (!account) redirect(`${returnTo}?poruka=racun`);
  await prisma.$transaction([
    prisma.firmaBankovniRacun.updateMany({ where: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, is_deleted: false, glavni: true }, data: { glavni: false, updated_by: context.user.id } }),
    prisma.firmaBankovniRacun.update({ where: { id: account.id }, data: { glavni: true, updated_by: context.user.id } })
  ]);
  await auditLog({ korisnikId: context.user.id, agencijaId: context.user.agencija_id, firmaId: context.firma.id, modul: "fiskalizacija", akcija: "update_portal_main_bank_account", tipEntiteta: "FirmaBankovniRacun", entitetId: account.id, novaVrijednost: { broj_racuna: account.broj_racuna, glavni: true } });
  revalidatePath(returnTo);
  redirect(`${returnTo}?poruka=racun_sacuvan`);
}

export async function updatePortalPosSettings(formData: FormData) {
  const context = await settingsContext();
  const registerId = text(formData, "register_id");
  const warehouseId = text(formData, "magacin_id");
  const paymentMethod = text(formData, "payment_method");
  const printFormat = text(formData, "print_format");
  const dueDays = Number(text(formData, "due_days"));
  const stockPolicy = text(formData, "stock_policy");
  if (!paymentMethods.has(paymentMethod) || !["58", "80"].includes(printFormat) || !Number.isInteger(dueDays) || dueDays < 0 || dueDays > 365 || !["INHERIT", "ALLOW", "BLOCK"].includes(stockPolicy)) redirect(`${returnTo}?poruka=unos`);
  const [register, warehouse] = await Promise.all([
    prisma.posRegister.findFirst({ where: { id: registerId, agencija_id: context.user.agencija_id!, firma_id: context.firma.id, aktivan: true, is_deleted: false }, select: { id: true, magacin_id: true } }),
    warehouseId ? prisma.magacin.findFirst({ where: { id: warehouseId, agencija_id: context.user.agencija_id!, firma_id: context.firma.id, aktivan: true, is_deleted: false }, select: { id: true } }) : null
  ]);
  if (!register || (warehouseId && !warehouse)) redirect(`${returnTo}?poruka=unos`);
  const negativeStock = stockPolicy === "INHERIT" ? null : stockPolicy === "ALLOW";
  await prisma.$transaction(async (tx) => {
    await tx.posPodesavanje.upsert({
      where: { firma_id: context.firma.id },
      create: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, aktivan: true, zahtijeva_smjenu: formData.get("requires_shift") === "on", automatska_stampa: formData.get("auto_print") === "on", format_stampe: printFormat, podrazumijevani_rok_dana: dueDays, podrazumijevana_kasa_id: register.id, created_by: context.user.id, updated_by: context.user.id },
      update: { zahtijeva_smjenu: formData.get("requires_shift") === "on", automatska_stampa: formData.get("auto_print") === "on", format_stampe: printFormat, podrazumijevani_rok_dana: dueDays, podrazumijevana_kasa_id: register.id, updated_by: context.user.id }
    });
    await tx.posRegister.update({ where: { id: register.id }, data: { magacin_id: warehouseId || null, podrazumijevano_placanje: paymentMethod, updated_by: context.user.id } });
    if (warehouse) await tx.magacin.update({ where: { id: warehouse.id }, data: { dozvoli_negativan_lager: negativeStock, updated_by: context.user.id } });
  });
  await auditLog({ korisnikId: context.user.id, agencijaId: context.user.agencija_id, firmaId: context.firma.id, modul: posModule, akcija: "update_direct_portal_operational_settings", tipEntiteta: "PosPodesavanje", entitetId: context.firma.id, novaVrijednost: { registerId, warehouseId: warehouseId || null, paymentMethod, printFormat, dueDays, stockPolicy, requiresShift: formData.get("requires_shift") === "on", autoPrint: formData.get("auto_print") === "on" } });
  revalidatePath(returnTo);
  revalidatePath("/portal/pos");
  redirect(`${returnTo}?poruka=pos`);
}

export async function registerPortalInitialCashDeposit(formData: FormData) {
  const context = await requireDirectPortalContext({ modul: "pos", akcija: "manage" }, returnTo);
  const registerId = text(formData, "register_id");
  const amount = parseDeposit(text(formData, "cash_amount"));
  if (amount === null) redirect(`${returnTo}?poruka=depozit_iznos`);
  const register = await prisma.posRegister.findFirst({ where: { id: registerId, agencija_id: context.user.agencija_id!, firma_id: context.firma.id, aktivan: true, is_deleted: false } });
  const link = context.firma.fiscalCompanyLink;
  if (!register || !link?.fiscal_api_company_id || link.is_suspended) redirect(`${returnTo}?poruka=depozit_podesavanje`);
  const actor = { id: context.user.id, name: context.user.korisnicko_ime };
  try {
    const company = (await fiscalAdminApi.getCompany(link.fiscal_api_company_id, actor)).data;
    if (company.environment !== "Test") redirect(`${returnTo}?poruka=depozit_production`);
    const response = await fiscalAdminApi.registerInitialTestCashDeposit(amount, new Date().toISOString(), actor);
    if (!response.data.isSuccess) redirect(`${returnTo}?poruka=depozit_greska&kod=${encodeURIComponent(response.data.faultCode ?? "CASH_DEPOSIT_FAILED")}`);
    await prisma.posRegister.update({ where: { id: register.id }, data: { cash_deposit_amount: amount.toFixed(2), cash_deposit_environment: company.environment, cash_deposit_fcdc: response.data.fcdc, cash_deposit_registered_at: new Date(), cash_deposit_correlation_id: response.correlationId, updated_by: context.user.id } });
    await auditLog({ korisnikId: context.user.id, agencijaId: context.user.agencija_id, firmaId: context.firma.id, modul: posModule, akcija: "register_initial_cash_deposit", tipEntiteta: "PosRegister", entitetId: register.id, novaVrijednost: { amount: amount.toFixed(2), environment: company.environment, fcdc: response.data.fcdc, source: "direct_portal" } });
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    const code = error instanceof FiscalAdminApiError ? error.code : "CASH_DEPOSIT_FAILED";
    redirect(`${returnTo}?poruka=depozit_greska&kod=${encodeURIComponent(code)}`);
  }
  revalidatePath(returnTo);
  redirect(`${returnTo}?poruka=depozit`);
}
