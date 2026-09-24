import type { Virman } from "@prisma/client";
import { requireAnyRole } from "./auth";
import { hasPermission, type PermissionAction } from "./permissions";
import { prisma } from "./prisma";
import { decimalToScaled, scaledToDecimal } from "./inventory-calculation";
import { readWorkContext } from "./work-context";
import type { PayrollPaymentOrderPrintRow } from "./payroll-payment-order-print";

export const manualPaymentOrderStatuses = {
  draft: "DRAFT",
  printed: "PRINTED",
  template: "TEMPLATE"
} as const;

export type ManualPaymentOrderStatus =
  (typeof manualPaymentOrderStatuses)[keyof typeof manualPaymentOrderStatuses];

export async function getManualPaymentOrderContext(action: PermissionAction = "view") {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const work = await readWorkContext();

  if (!user.agencija_id || !work.firmaId || !work.poslovnaGodinaId) {
    return { user, firma: null, godina: null, allowed: false };
  }

  const [firma, godina, allowed] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: work.firmaId,
        agencija_id: user.agencija_id,
        aktivan: true,
        is_deleted: false,
        ...(user.rola === "admin_agencije"
          ? {}
          : {
              korisnici: {
                some: { korisnik_id: user.id, is_deleted: false }
              }
            })
      },
      select: {
        id: true,
        naziv: true,
        adresa: true,
        opstina: true,
        grad: true,
        bankovni_racuni: {
          where: { aktivan: true, is_deleted: false },
          orderBy: [{ glavni: "desc" }, { created_at: "asc" }],
          take: 1,
          select: { broj_racuna: true, naziv_banke: true }
        }
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: { id: work.poslovnaGodinaId, firma_id: work.firmaId },
      select: {
        id: true,
        godina: true,
        datum_od: true,
        datum_do: true,
        zakljucena: true
      }
    }),
    hasPermission(user, {
      firmaId: work.firmaId,
      modul: "virmani",
      akcija: action
    })
  ]);

  return { user, firma, godina, allowed };
}

export function manualPaymentOrderAmountInput(value: Virman["iznos"]) {
  return scaledToDecimal(decimalToScaled(value, 2), 2);
}

export function manualPaymentOrderAmountDecimal(amountCent: number) {
  return scaledToDecimal(BigInt(amountCent), 2);
}

export function manualPaymentOrderToPrintRow(
  order: Pick<
    Virman,
    | "id"
    | "nalogodavac_naziv"
    | "nalogodavac_mjesto"
    | "nalogodavac_racun"
    | "svrha_placanja"
    | "primalac_naziv"
    | "primalac_mjesto"
    | "primalac_racun"
    | "iznos"
    | "sifra_placanja"
    | "model_zaduzenja"
    | "poziv_na_broj_zaduzenja"
    | "model_odobrenja"
    | "poziv_na_broj_odobrenja"
    | "datum_valute"
  >
): PayrollPaymentOrderPrintRow {
  return {
    id: order.id,
    type: "MANUAL",
    typeLabel: "Virman",
    payerName: order.nalogodavac_naziv,
    payerLocation: order.nalogodavac_mjesto,
    payerAccount: order.nalogodavac_racun,
    purpose: order.svrha_placanja,
    recipientName: order.primalac_naziv,
    recipientLocation: order.primalac_mjesto,
    recipientAccount: order.primalac_racun,
    amountCent: Number(decimalToScaled(order.iznos, 2)),
    paymentCode: order.sifra_placanja,
    debitReferenceModel: order.model_zaduzenja,
    debitReference: order.poziv_na_broj_zaduzenja,
    creditReferenceModel: order.model_odobrenja,
    creditReference: order.poziv_na_broj_odobrenja,
    paymentDate: order.datum_valute?.toISOString().slice(0, 10) ?? null,
    errors: []
  };
}
