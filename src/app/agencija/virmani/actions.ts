"use server";

import type { Virman } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import {
  getManualPaymentOrderContext,
  manualPaymentOrderAmountDecimal,
  manualPaymentOrderStatuses,
  manualPaymentOrderToPrintRow
} from "@/lib/manual-payment-orders";
import { hasPermission, type PermissionAction } from "@/lib/permissions";
import { payrollPaymentOrderErrors } from "@/lib/payroll-payment-order-print";
import { prisma } from "@/lib/prisma";
import { parseMoneyToCents } from "@/lib/payroll";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optionalText(formData: FormData, key: string) {
  const value = text(formData, key);
  return value || null;
}

function optionalDate(formData: FormData, key: string) {
  const value = text(formData, key);
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function go(message: string, extra = ""): never {
  redirect(`/agencija/virmani?poruka=${encodeURIComponent(message)}${extra}`);
}

async function mutationContext(action: PermissionAction) {
  const context = await getManualPaymentOrderContext(action);
  const agencijaId = context.user.agencija_id;
  const firma = context.firma;
  const godina = context.godina;
  if (!context.allowed || !agencijaId || !firma || !godina) {
    go("nemate_pravo");
  }
  return { user: context.user, agencijaId, firma, godina };
}

function snapshot(order: Virman) {
  return {
    id: order.id,
    status: order.status,
    naziv_sablona: order.naziv_sablona,
    svrha_placanja: order.svrha_placanja,
    primalac_naziv: order.primalac_naziv,
    primalac_racun: order.primalac_racun,
    iznos: order.iznos.toString(),
    datum_valute: order.datum_valute
  };
}

export async function saveManualPaymentOrder(formData: FormData) {
  const intent = text(formData, "intent");
  const requestedId = optionalText(formData, "id");
  const targetStatus =
    intent === "template"
      ? manualPaymentOrderStatuses.template
      : intent === "print"
        ? manualPaymentOrderStatuses.printed
        : manualPaymentOrderStatuses.draft;
  const context = await mutationContext("view");
  const existing = requestedId
    ? await prisma.virman.findFirst({
        where: {
          id: requestedId,
          agencija_id: context.agencijaId,
          firma_id: context.firma.id,
          is_deleted: false
        }
      })
    : null;

  if (requestedId && !existing) go("virman_nije_pronadjen");

  const mayUpdateExisting =
    existing &&
    existing.status !== manualPaymentOrderStatuses.printed &&
    ((existing.status === manualPaymentOrderStatuses.template &&
      targetStatus === manualPaymentOrderStatuses.template) ||
      (existing.status === manualPaymentOrderStatuses.draft &&
        targetStatus !== manualPaymentOrderStatuses.template));
  const requiredAction: PermissionAction = mayUpdateExisting ? "update" : "create";
  const allowed = await hasPermission(context.user, {
    firmaId: context.firma.id,
    modul: "virmani",
    akcija: requiredAction
  });
  if (!allowed) go("nemate_pravo");

  if (targetStatus !== manualPaymentOrderStatuses.template && context.godina.zakljucena) {
    go("godina_zakljucena");
  }

  if (intent === "print") {
    const canExport = await hasPermission(context.user, {
      firmaId: context.firma.id,
      modul: "virmani",
      akcija: "export"
    });
    if (!canExport) go("nemate_pravo");
  }

  const amountCent = parseMoneyToCents(formData.get("iznos"));
  if (amountCent === null) go("iznos_neispravan");

  const data = {
    agencija_id: context.agencijaId,
    firma_id: context.firma.id,
    poslovna_godina_id:
      targetStatus === manualPaymentOrderStatuses.template ? null : context.godina.id,
    status: targetStatus,
    naziv_sablona:
      targetStatus === manualPaymentOrderStatuses.template
        ? optionalText(formData, "naziv_sablona")
        : null,
    nalogodavac_naziv: text(formData, "nalogodavac_naziv"),
    nalogodavac_mjesto: optionalText(formData, "nalogodavac_mjesto"),
    nalogodavac_racun: optionalText(formData, "nalogodavac_racun"),
    svrha_placanja: text(formData, "svrha_placanja"),
    primalac_naziv: text(formData, "primalac_naziv"),
    primalac_mjesto: optionalText(formData, "primalac_mjesto"),
    primalac_racun: optionalText(formData, "primalac_racun"),
    iznos: manualPaymentOrderAmountDecimal(amountCent),
    sifra_placanja: optionalText(formData, "sifra_placanja"),
    model_zaduzenja: optionalText(formData, "model_zaduzenja"),
    poziv_na_broj_zaduzenja: optionalText(formData, "poziv_na_broj_zaduzenja"),
    model_odobrenja: optionalText(formData, "model_odobrenja"),
    poziv_na_broj_odobrenja: optionalText(formData, "poziv_na_broj_odobrenja"),
    datum_valute: optionalDate(formData, "datum_valute"),
    odstampan_at: targetStatus === manualPaymentOrderStatuses.printed ? new Date() : null,
    updated_by: context.user.id
  };

  if (targetStatus === manualPaymentOrderStatuses.template && !data.naziv_sablona) {
    go("naziv_sablona_obavezan");
  }

  if (
    targetStatus === manualPaymentOrderStatuses.printed &&
    (!data.nalogodavac_naziv ||
      !data.nalogodavac_racun ||
      !data.svrha_placanja ||
      !data.primalac_naziv ||
      !data.primalac_racun ||
      amountCent <= 0)
  ) {
    go("dopunite_virman");
  }

  const saved = mayUpdateExisting
    ? await prisma.virman.update({ where: { id: existing.id }, data })
    : await prisma.virman.create({
        data: { ...data, created_by: context.user.id }
      });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "virmani",
    akcija: mayUpdateExisting ? "update" : "create",
    tipEntiteta: "Virman",
    entitetId: saved.id,
    staraVrijednost: existing ? snapshot(existing) : undefined,
    novaVrijednost: snapshot(saved)
  });

  revalidatePath("/agencija/virmani");
  if (targetStatus === manualPaymentOrderStatuses.printed) {
    redirect(`/stampa/virmani?ids=${saved.id}`);
  }
  if (targetStatus === manualPaymentOrderStatuses.template) {
    go("sablon_sacuvan", `&tab=sabloni&id=${saved.id}`);
  }
  go("nacrt_sacuvan", `&tab=nacrti&id=${saved.id}`);
}

export async function deleteManualPaymentOrder(formData: FormData) {
  const context = await mutationContext("delete");
  const id = text(formData, "delete_id") || text(formData, "id");
  const order = await prisma.virman.findFirst({
    where: {
      id,
      agencija_id: context.agencijaId,
      firma_id: context.firma.id,
      is_deleted: false
    }
  });
  if (!order) go("virman_nije_pronadjen");
  if (order.status !== manualPaymentOrderStatuses.template && context.godina.zakljucena) {
    go("godina_zakljucena");
  }

  const deleted = await prisma.virman.update({
    where: { id: order.id },
    data: {
      is_deleted: true,
      deleted_at: new Date(),
      deleted_by: context.user.id,
      delete_reason: "Obrisano iz modula virmani.",
      updated_by: context.user.id
    }
  });

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "virmani",
    akcija: "delete",
    tipEntiteta: "Virman",
    entitetId: deleted.id,
    staraVrijednost: snapshot(order),
    novaVrijednost: { is_deleted: true }
  });
  revalidatePath("/agencija/virmani");
  go("virman_obrisan");
}

export async function printManualPaymentOrders(formData: FormData) {
  const context = await mutationContext("export");
  const ids = Array.from(
    new Set(formData.getAll("id").map(String).filter(Boolean))
  );
  if (ids.length === 0) go("izaberite_virman");

  const orders = await prisma.virman.findMany({
    where: {
      id: { in: ids },
      agencija_id: context.agencijaId,
      firma_id: context.firma.id,
      poslovna_godina_id: context.godina.id,
      status: { in: [manualPaymentOrderStatuses.draft, manualPaymentOrderStatuses.printed] },
      is_deleted: false
    }
  });
  if (orders.length !== ids.length) go("virman_nije_pronadjen");
  if (
    orders.some(
      (order) => payrollPaymentOrderErrors(manualPaymentOrderToPrintRow(order)).length > 0
    )
  ) {
    go("dopunite_virman");
  }

  const draftIds = orders
    .filter((order) => order.status === manualPaymentOrderStatuses.draft)
    .map((order) => order.id);
  if (draftIds.length > 0) {
    if (context.godina.zakljucena) go("godina_zakljucena");
    const canUpdate = await hasPermission(context.user, {
      firmaId: context.firma.id,
      modul: "virmani",
      akcija: "update"
    });
    if (!canUpdate) go("nemate_pravo");
    await prisma.virman.updateMany({
      where: { id: { in: draftIds } },
      data: {
        status: manualPaymentOrderStatuses.printed,
        odstampan_at: new Date(),
        updated_by: context.user.id
      }
    });
  }

  await auditLog({
    korisnikId: context.user.id,
    agencijaId: context.agencijaId,
    firmaId: context.firma.id,
    modul: "virmani",
    akcija: "export",
    tipEntiteta: "Virman",
    napomena: `Pripremljeno za štampu: ${ids.length} naloga.`,
    novaVrijednost: { ids }
  });
  revalidatePath("/agencija/virmani");
  redirect(`/stampa/virmani?ids=${ids.join(",")}`);
}
