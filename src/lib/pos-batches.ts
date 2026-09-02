import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { decimalToScaled, scaledToDecimal } from "@/lib/inventory-calculation";
import { kifEntryKinds, pazarPaymentMethods, pazarPeriodTypes } from "@/lib/kif-pazar";
import { prisma } from "@/lib/prisma";

export const posBatchModes = [pazarPeriodTypes.daily, pazarPeriodTypes.monthly] as const;

function utcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day));
}

export function posBatchPeriod(mode: string, selectedDate: Date) {
  const year = selectedDate.getUTCFullYear();
  const month = selectedDate.getUTCMonth();
  if (mode === pazarPeriodTypes.monthly) {
    return { from: utcDate(year, month, 1), to: utcDate(year, month + 1, 0) };
  }
  const day = selectedDate.getUTCDate();
  return { from: utcDate(year, month, day), to: utcDate(year, month, day) };
}

export async function generatePosKifBatch(input: {
  agencijaId: string;
  firmaId: string;
  poslovnaGodinaId: string;
  year: number;
  mode: string;
  selectedDate: Date;
  businessUnitId: string | null;
  userId: string;
}) {
  if (!posBatchModes.includes(input.mode as (typeof posBatchModes)[number])) {
    return { ok: false as const, reason: "rezim" };
  }
  const period = posBatchPeriod(input.mode, input.selectedDate);
  if (period.from.getUTCFullYear() !== input.year || period.to.getUTCFullYear() !== input.year) {
    return { ok: false as const, reason: "godina" };
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pos-kif-batch:${input.firmaId}:${input.mode}:${period.from.toISOString()}`}))`;
    const [year, book, settings, businessUnit, invoices] = await Promise.all([
      tx.poslovnaGodina.findFirst({ where: { id: input.poslovnaGodinaId, firma_id: input.firmaId }, select: { zakljucena: true } }),
      tx.kifBook.findFirst({ where: { agencija_id: input.agencijaId, firma_id: input.firmaId, poslovna_godina_id: input.poslovnaGodinaId, mjesec: period.from.getUTCMonth() + 1, status: "OPEN", is_deleted: false }, orderBy: { created_at: "asc" }, select: { id: true } }),
      tx.posPodesavanje.findUnique({ where: { firma_id: input.firmaId }, select: { racunovodstvena_integracija: true } }),
      input.businessUnitId
        ? tx.poslovnaJedinica.findFirst({ where: { id: input.businessUnitId, agencija_id: input.agencijaId, firma_id: input.firmaId, aktivna: true, is_deleted: false }, select: { id: true } })
        : null,
      tx.fiskalniIzlazniRacun.findMany({
        where: {
          agencija_id: input.agencijaId,
          firma_id: input.firmaId,
          poslovna_godina_id: input.poslovnaGodinaId,
          sales_channel: "POS",
          fiscal_status: "Fiscalized",
          kif_status: "WAITING_PAZAR",
          nacin_placanja: { in: ["CASH", "CARD"] },
          datum_racuna: { gte: period.from, lte: period.to },
          poslovna_jedinica_id: input.businessUnitId,
          is_deleted: false,
          pos_kif_membership: null
        },
        include: { poreske_stavke: true, placanja: true },
        orderBy: [{ datum_racuna: "asc" }, { broj: "asc" }]
      })
    ]);
    if (!year || year.zakljucena) return { ok: false as const, reason: "godina" };
    if (!settings?.racunovodstvena_integracija) return { ok: false as const, reason: "integracija" };
    if (input.businessUnitId && !businessUnit) return { ok: false as const, reason: "jedinica" };
    if (!book) return { ok: false as const, reason: "kif" };
    if (!invoices.length) return { ok: false as const, reason: "nema_racuna" };
    const overlappingPazar = await tx.kifEntry.findFirst({
      where: {
        firma_id: input.firmaId,
        entry_kind: kifEntryKinds.pazar,
        poslovna_jedinica_id: input.businessUnitId,
        is_deleted: false,
        NOT: { source_type: "POS_KIF_BATCH" },
        pazar_period_from: { lte: period.to },
        pazar_period_to: { gte: period.from }
      },
      select: { id: true }
    });
    if (overlappingPazar) return { ok: false as const, reason: "preklapanje" };

    const taxes = new Map<string, { id: string | null; code: string; name: string; percent: Prisma.Decimal; base: bigint; tax: bigint; gross: bigint }>();
    let totalBase = BigInt(0), totalTax = BigInt(0), totalGross = BigInt(0), cash = BigInt(0), card = BigInt(0);
    for (const invoice of invoices) {
      totalBase += decimalToScaled(invoice.ukupno_osnovica, 2);
      totalTax += decimalToScaled(invoice.ukupno_izlazni_pdv, 2);
      totalGross += decimalToScaled(invoice.ukupno_sa_pdv, 2);
      for (const payment of invoice.placanja) {
        if (payment.payment_method === "CASH") cash += decimalToScaled(payment.amount, 2);
        if (payment.payment_method === "CARD") card += decimalToScaled(payment.amount, 2);
      }
      for (const tax of invoice.poreske_stavke) {
        const current = taxes.get(tax.vat_rate_code) ?? { id: null, code: tax.vat_rate_code, name: tax.vat_rate_name, percent: tax.vat_rate_percent, base: BigInt(0), tax: BigInt(0), gross: BigInt(0) };
        current.base += decimalToScaled(tax.tax_base, 2);
        current.tax += decimalToScaled(tax.output_vat_amount, 2);
        current.gross += decimalToScaled(tax.total_with_vat, 2);
        taxes.set(tax.vat_rate_code, current);
      }
    }
    if (cash + card !== totalGross) return { ok: false as const, reason: "naplata" };

    const rateRows = await tx.pdvStopa.findMany({ where: { agencija_id: input.agencijaId, sifra: { in: [...taxes.keys()] } }, select: { id: true, sifra: true } });
    for (const rate of rateRows) { const tax = taxes.get(rate.sifra); if (tax) tax.id = rate.id; }
    let customer = await tx.komitent.findFirst({ where: { firma_id: input.firmaId, scope: "COMPANY", naziv: "KRAJNJI POTROŠAČ", aktivan: true }, select: { id: true } });
    customer ??= await tx.komitent.create({ data: { naziv: "KRAJNJI POTROŠAČ", scope: "COMPANY", agencija_id: input.agencijaId, firma_id: input.firmaId }, select: { id: true } });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kif-entry-number:${input.firmaId}:${input.poslovnaGodinaId}`}))`;
    const last = await tx.kifEntry.findFirst({ where: { firma_id: input.firmaId, poslovna_godina_id: input.poslovnaGodinaId }, orderBy: { redni_broj: "desc" }, select: { redni_broj: true } });
    const redniBroj = (last?.redni_broj ?? 0) + 1;
    const batchId = randomUUID();
    const periodLabel = input.mode === pazarPeriodTypes.monthly ? `${String(period.from.getUTCMonth() + 1).padStart(2, "0")}/${input.year}` : period.from.toLocaleDateString("sr-Latn-ME", { timeZone: "UTC" });
    const entry = await tx.kifEntry.create({ data: {
      kif_book_id: book.id, agencija_id: input.agencijaId, firma_id: input.firmaId, poslovna_godina_id: input.poslovnaGodinaId, kupac_id: customer.id,
      redni_broj: redniBroj, internal_kif_number: `KIF-${input.year}-${String(redniBroj).padStart(4, "0")}`, customer_invoice_number: `POS PAZAR ${periodLabel}`,
      entry_kind: kifEntryKinds.pazar, poslovna_jedinica_id: input.businessUnitId, pazar_period_type: input.mode, pazar_period_from: period.from, pazar_period_to: period.to, pazar_report_number: `POS ${periodLabel}`,
      invoice_date: period.to, vat_transaction_type: "DOMESTIC", total_base: scaledToDecimal(totalBase, 2), total_output_vat: scaledToDecimal(totalTax, 2), total_gross: scaledToDecimal(totalGross, 2),
      payment_status: "PAID", posting_status: "UNPOSTED", posting_mode: "KIF_RULES", source_type: "POS_KIF_BATCH", source_id: batchId,
      note: `Automatski POS zbir: ${invoices.length} računa.`, created_by: input.userId, updated_by: input.userId,
      tax_lines: { createMany: { data: [...taxes.values()].map((tax) => ({ vat_rate_id: tax.id, vat_rate_code: tax.code, vat_rate_name: tax.name, vat_rate_percent: tax.percent, tax_base: scaledToDecimal(tax.base, 2), output_vat_amount: scaledToDecimal(tax.tax, 2), total_with_vat: scaledToDecimal(tax.gross, 2), created_by: input.userId })) } },
      pazar_payments: { createMany: { data: [
        ...(cash ? [{ payment_method: pazarPaymentMethods.cash, amount: scaledToDecimal(cash, 2), created_by: input.userId, updated_by: input.userId }] : []),
        ...(card ? [{ payment_method: pazarPaymentMethods.card, amount: scaledToDecimal(card, 2), created_by: input.userId, updated_by: input.userId }] : [])
      ] } }
    }, select: { id: true } });
    const batch = await tx.posKifBatch.create({ data: { id: batchId, agencija_id: input.agencijaId, firma_id: input.firmaId, poslovna_godina_id: input.poslovnaGodinaId, kif_entry_id: entry.id, aggregation_mode: input.mode, period_from: period.from, period_to: period.to, invoice_count: invoices.length, total_base: scaledToDecimal(totalBase, 2), total_tax: scaledToDecimal(totalTax, 2), total_gross: scaledToDecimal(totalGross, 2), generated_by: input.userId,
      invoices: { createMany: { data: invoices.map((invoice) => ({ fiskalni_izlazni_racun_id: invoice.id })) } },
      accounting_batch: { create: { agencija_id: input.agencijaId, firma_id: input.firmaId, poslovna_godina_id: input.poslovnaGodinaId, aggregation_mode: input.mode, period_from: period.from, period_to: period.to, invoice_count: invoices.length, total_base: scaledToDecimal(totalBase, 2), total_tax: scaledToDecimal(totalTax, 2), total_gross: scaledToDecimal(totalGross, 2), generated_by: input.userId } }
    }, select: { id: true } });
    await tx.fiskalniIzlazniRacun.updateMany({ where: { id: { in: invoices.map((invoice) => invoice.id) } }, data: { kif_status: "IMPORTED", updated_by: input.userId } });
    return { ok: true as const, batchId: batch.id, kifEntryId: entry.id, alreadyGenerated: false, invoiceCount: invoices.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
