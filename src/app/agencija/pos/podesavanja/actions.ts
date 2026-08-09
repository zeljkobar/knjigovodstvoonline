"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auditLog } from "@/lib/audit";
import { fiscalAdminApi, FiscalAdminApiError } from "@/lib/fiscal-admin-api";
import { posModule, requirePosContext } from "@/lib/pos";
import { prisma } from "@/lib/prisma";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function parseDeposit(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isSafeInteger(Math.round(amount * 100)) && amount >= 0 ? amount : null;
}

export async function configureDefaultPosRegister() {
  const ctx = await requirePosContext("manage");
  const link = ctx.firma.fiscalCompanyLink;
  if (!link?.fiscal_api_company_id || link.is_suspended) redirect("/agencija/pos/podesavanja?poruka=fiskalizacija");
  const actor = { id: ctx.user.id, name: ctx.user.korisnicko_ime };
  let company, readiness, units, devices, operators, warehouse;
  try {
    [company, readiness, units, devices, operators, warehouse] = await Promise.all([
      fiscalAdminApi.getCompany(link.fiscal_api_company_id, actor),
      fiscalAdminApi.getReadiness(link.fiscal_api_company_id, actor),
      fiscalAdminApi.listBusinessUnits(link.fiscal_api_company_id, actor),
      fiscalAdminApi.listDevices(link.fiscal_api_company_id, actor),
      fiscalAdminApi.listOperators(link.fiscal_api_company_id, actor),
      prisma.magacin.findFirst({ where: { firma_id: ctx.firma.id, aktivan: true, is_deleted: false }, orderBy: { created_at: "asc" }, select: { id: true } })
    ]);
  } catch (error) {
    const code = error instanceof FiscalAdminApiError ? error.code : "FISCAL_API_UNAVAILABLE";
    redirect(`/agencija/pos/podesavanja?poruka=api&kod=${encodeURIComponent(code)}`);
  }
  const unit = units.data.find((item) => item.isActive && (!item.environment || item.environment === company.data.environment));
  const device = devices.data.find((item) => item.isActive && item.businessUnitId === unit?.id);
  const operator = operators.data.find((item) => item.isActive && (!item.environment || item.environment === company.data.environment));
  if (!company.data.isActive || !readiness.data.isReady || !unit || !device || !operator) redirect("/agencija/pos/podesavanja?poruka=nije_spremno");

  await prisma.$transaction([
    prisma.posPodesavanje.upsert({
      where: { firma_id: ctx.firma.id },
      create: { agencija_id: ctx.user.agencija_id!, firma_id: ctx.firma.id, aktivan: true, created_by: ctx.user.id, updated_by: ctx.user.id },
      update: { aktivan: true, updated_by: ctx.user.id }
    }),
    prisma.posRegister.upsert({
      where: { firma_id_sifra: { firma_id: ctx.firma.id, sifra: "KASA-1" } },
      create: { agencija_id: ctx.user.agencija_id!, firma_id: ctx.firma.id, magacin_id: warehouse?.id, naziv: "Kasa 1", sifra: "KASA-1", fiscal_business_unit_id: unit.id, fiscal_business_unit_name: unit.name, fiscal_device_id: device.id, fiscal_device_code: device.internalCode, fiscal_operator_id: operator.id, created_by: ctx.user.id, updated_by: ctx.user.id },
      update: { magacin_id: warehouse?.id, fiscal_business_unit_id: unit.id, fiscal_business_unit_name: unit.name, fiscal_device_id: device.id, fiscal_device_code: device.internalCode, fiscal_operator_id: operator.id, aktivan: true, is_deleted: false, updated_by: ctx.user.id }
    })
  ]);
  await auditLog({ korisnikId: ctx.user.id, agencijaId: ctx.user.agencija_id, firmaId: ctx.firma.id, modul: posModule, akcija: "configure_pos_register", tipEntiteta: "PosRegister", novaVrijednost: { sifra: "KASA-1", environment: company.data.environment, device: device.internalCode } });
  revalidatePath("/agencija/pos");
  redirect("/agencija/pos/podesavanja?poruka=sacuvano");
}

export async function updatePosAccountingIntegration(formData: FormData) {
  const ctx = await requirePosContext("manage");
  const enabled = formData.get("accounting_integration") === "on";
  const kifMode = String(formData.get("kif_mode") ?? "DAILY") === "MONTHLY" ? "MONTHLY" : "DAILY";
  const accountingMode = kifMode;
  const settings = await prisma.posPodesavanje.findFirst({
    where: { firma_id: ctx.firma.id, agencija_id: ctx.user.agencija_id! },
    select: { id: true, racunovodstvena_integracija: true, kif_rezim: true, knjizenje_rezim: true }
  });
  if (!settings) redirect("/agencija/pos/podesavanja?poruka=fiskalizacija");

  await prisma.$transaction(async (tx) => {
    await tx.posPodesavanje.update({
      where: { id: settings.id },
      data: { racunovodstvena_integracija: enabled, kif_rezim: kifMode, knjizenje_rezim: accountingMode, updated_by: ctx.user.id }
    });
    if (enabled) {
      await tx.fiskalniIzlazniRacun.updateMany({
        where: {
          agencija_id: ctx.user.agencija_id!,
          firma_id: ctx.firma.id,
          sales_channel: "POS",
          kif_status: "NOT_REQUIRED",
          kif_entry_id: null,
          nalog_id: null,
          is_deleted: false
        },
        data: { kif_status: "WAITING_PAZAR", updated_by: ctx.user.id }
      });
      await tx.fiskalniIzlazniRacun.updateMany({
        where: {
          agencija_id: ctx.user.agencija_id!,
          firma_id: ctx.firma.id,
          sales_channel: "POS",
          nacin_placanja: "BANK_TRANSFER",
          kif_status: "WAITING_PAZAR",
          kif_entry_id: null,
          nalog_id: null,
          is_deleted: false
        },
        data: { kif_status: "ACCOUNTING_PENDING", updated_by: ctx.user.id }
      });
    }
  });
  await auditLog({
    korisnikId: ctx.user.id,
    agencijaId: ctx.user.agencija_id,
    firmaId: ctx.firma.id,
    modul: posModule,
    akcija: "update_pos_accounting_integration",
    tipEntiteta: "PosPodesavanje",
    entitetId: settings.id,
    staraVrijednost: { enabled: settings.racunovodstvena_integracija, kifMode: settings.kif_rezim, accountingMode: settings.knjizenje_rezim },
    novaVrijednost: { enabled, kifMode, accountingMode }
  });
  revalidatePath("/agencija/pos");
  revalidatePath("/agencija/pos/racuni");
  revalidatePath("/agencija/racuni");
  redirect("/agencija/pos/podesavanja?poruka=integracija_sacuvana");
}

export async function updatePosNegativeStockPolicy(formData: FormData) {
  const ctx = await requirePosContext("manage");
  const registerId = text(formData, "register_id");
  const policy = text(formData, "negative_stock_policy");
  if (!['INHERIT', 'ALLOW', 'BLOCK'].includes(policy)) redirect("/agencija/pos/podesavanja?poruka=lager_politika");
  const register = await prisma.posRegister.findFirst({
    where: { id: registerId, agencija_id: ctx.user.agencija_id!, firma_id: ctx.firma.id, is_deleted: false },
    select: { id: true, magacin: { select: { id: true, naziv: true, dozvoli_negativan_lager: true } } }
  });
  if (!register?.magacin) redirect("/agencija/pos/podesavanja?poruka=lager_magacin");
  const value = policy === "INHERIT" ? null : policy === "ALLOW";
  await prisma.magacin.update({ where: { id: register.magacin.id }, data: { dozvoli_negativan_lager: value, updated_by: ctx.user.id } });
  await auditLog({ korisnikId: ctx.user.id, agencijaId: ctx.user.agencija_id, firmaId: ctx.firma.id, modul: posModule, akcija: "update_pos_negative_stock_policy", tipEntiteta: "Magacin", entitetId: register.magacin.id, staraVrijednost: { dozvoli_negativan_lager: register.magacin.dozvoli_negativan_lager }, novaVrijednost: { dozvoli_negativan_lager: value, pos_register_id: register.id } });
  revalidatePath("/agencija/pos/podesavanja");
  redirect("/agencija/pos/podesavanja?poruka=lager_sacuvan");
}

export async function registerInitialCashDeposit(formData: FormData) {
  const ctx = await requirePosContext("manage");
  const registerId = text(formData, "register_id");
  const amount = parseDeposit(text(formData, "cash_amount"));
  if (amount === null) redirect("/agencija/pos/podesavanja?poruka=depozit_iznos");

  const link = ctx.firma.fiscalCompanyLink;
  const register = await prisma.posRegister.findFirst({
    where: {
      id: registerId,
      agencija_id: ctx.user.agencija_id!,
      firma_id: ctx.firma.id,
      aktivan: true,
      is_deleted: false
    }
  });
  if (!register || !link?.fiscal_api_company_id || link.is_suspended) {
    redirect("/agencija/pos/podesavanja?poruka=fiskalizacija");
  }

  const actor = { id: ctx.user.id, name: ctx.user.korisnicko_ime };
  try {
    const company = (await fiscalAdminApi.getCompany(link.fiscal_api_company_id, actor)).data;
    if (company.environment !== "Test") {
      redirect("/agencija/pos/podesavanja?poruka=depozit_production");
    }
    const response = await fiscalAdminApi.registerInitialTestCashDeposit(amount, new Date().toISOString(), actor);
    if (!response.data.isSuccess) {
      redirect(`/agencija/pos/podesavanja?poruka=depozit_greska&kod=${encodeURIComponent(response.data.faultCode ?? "CASH_DEPOSIT_FAILED")}`);
    }
    await prisma.posRegister.update({
      where: { id: register.id },
      data: {
        cash_deposit_amount: amount.toFixed(2),
        cash_deposit_environment: company.environment,
        cash_deposit_fcdc: response.data.fcdc,
        cash_deposit_registered_at: new Date(),
        cash_deposit_correlation_id: response.correlationId,
        updated_by: ctx.user.id
      }
    });
    await auditLog({
      korisnikId: ctx.user.id,
      agencijaId: ctx.user.agencija_id,
      firmaId: ctx.firma.id,
      modul: posModule,
      akcija: "register_initial_cash_deposit",
      tipEntiteta: "PosRegister",
      entitetId: register.id,
      novaVrijednost: { amount: amount.toFixed(2), environment: company.environment, fcdc: response.data.fcdc }
    });
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    const code = error instanceof FiscalAdminApiError ? error.code : "CASH_DEPOSIT_FAILED";
    redirect(`/agencija/pos/podesavanja?poruka=depozit_greska&kod=${encodeURIComponent(code)}`);
  }
  revalidatePath("/agencija/pos/podesavanja");
  redirect("/agencija/pos/podesavanja?poruka=depozit_sacuvan");
}
