"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { posModule, requirePosContext } from "@/lib/pos";
import { prisma } from "@/lib/prisma";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function parseMoney(input: string) {
  const normalized = input.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  return new Prisma.Decimal(normalized);
}

export async function openPosShift(formData: FormData) {
  const ctx = await requirePosContext("create");
  const registerId = value(formData, "register_id");
  const openingCash = parseMoney(value(formData, "opening_cash_amount"));
  if (!openingCash) redirect("/agencija/pos/smjene?poruka=iznos");

  const register = await prisma.posRegister.findFirst({
    where: { id: registerId, agencija_id: ctx.user.agencija_id!, firma_id: ctx.firma.id, aktivan: true, is_deleted: false },
    select: { id: true, naziv: true }
  });
  if (!register) redirect("/agencija/pos/smjene?poruka=kasa");

  try {
    const shift = await prisma.posSmjena.create({
      data: {
        agencija_id: ctx.user.agencija_id!,
        firma_id: ctx.firma.id,
        poslovna_godina_id: ctx.year.id,
        pos_register_id: register.id,
        opened_by: ctx.user.id,
        opening_cash_amount: openingCash
      }
    });
    await auditLog({
      korisnikId: ctx.user.id,
      agencijaId: ctx.user.agencija_id,
      firmaId: ctx.firma.id,
      modul: posModule,
      akcija: "open_pos_shift",
      tipEntiteta: "PosSmjena",
      entitetId: shift.id,
      novaVrijednost: { registerId: register.id, register: register.naziv, openingCash: openingCash.toFixed(2) }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      redirect("/agencija/pos/smjene?poruka=vec_otvorena");
    }
    throw error;
  }

  revalidatePath("/agencija/pos");
  revalidatePath("/agencija/pos/smjene");
  redirect("/agencija/pos/smjene?poruka=otvorena");
}

export async function closePosShift(formData: FormData) {
  const ctx = await requirePosContext("create");
  const shiftId = value(formData, "shift_id");
  const note = value(formData, "note") || null;
  const closedAt = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const shift = await tx.posSmjena.findFirst({
      where: {
        id: shiftId,
        agencija_id: ctx.user.agencija_id!,
        firma_id: ctx.firma.id,
        poslovna_godina_id: ctx.year.id,
        status: "OPEN"
      },
      include: { pos_register: { select: { naziv: true } } }
    });
    if (!shift) return null;

    const invoices = await tx.fiskalniIzlazniRacun.findMany({
      where: {
        agencija_id: ctx.user.agencija_id!,
        firma_id: ctx.firma.id,
        poslovna_godina_id: ctx.year.id,
        pos_register_id: shift.pos_register_id,
        sales_channel: "POS",
        document_type: { in: ["POS_RECEIPT", "POS_RETURN"] },
        fiscal_status: { in: ["Fiscalized", "StornoCreated"] },
        issued_at: { gte: shift.opened_at, lte: closedAt },
        is_deleted: false
      },
      select: { ukupno_sa_pdv: true, placanja: { select: { payment_method: true, amount: true } } }
    });

    const totals: Record<string, Prisma.Decimal> = {
      CASH: new Prisma.Decimal(0),
      CARD: new Prisma.Decimal(0),
      BANK_TRANSFER: new Prisma.Decimal(0),
      OTHER: new Prisma.Decimal(0)
    };
    let gross = new Prisma.Decimal(0);
    for (const invoice of invoices) {
      gross = gross.plus(invoice.ukupno_sa_pdv);
      for (const payment of invoice.placanja) {
        const key = payment.payment_method in totals ? payment.payment_method : "OTHER";
        totals[key] = totals[key].plus(payment.amount);
      }
    }

    return tx.posSmjena.update({
      where: { id: shift.id },
      data: {
        status: "CLOSED",
        closed_at: closedAt,
        closed_by: ctx.user.id,
        invoice_count: invoices.length,
        cash_total: totals.CASH,
        card_total: totals.CARD,
        bank_transfer_total: totals.BANK_TRANSFER,
        other_total: totals.OTHER,
        gross_total: gross,
        expected_cash_amount: shift.opening_cash_amount.plus(totals.CASH),
        note
      },
      include: { pos_register: { select: { naziv: true } } }
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (!result) redirect("/agencija/pos/smjene?poruka=nije_otvorena");
  await auditLog({
    korisnikId: ctx.user.id,
    agencijaId: ctx.user.agencija_id,
    firmaId: ctx.firma.id,
    modul: posModule,
    akcija: "close_pos_shift",
    tipEntiteta: "PosSmjena",
    entitetId: result.id,
    novaVrijednost: {
      register: result.pos_register.naziv,
      invoiceCount: result.invoice_count,
      cash: result.cash_total.toFixed(2),
      card: result.card_total.toFixed(2),
      bankTransfer: result.bank_transfer_total.toFixed(2),
      total: result.gross_total.toFixed(2),
      expectedCash: result.expected_cash_amount.toFixed(2)
    }
  });

  revalidatePath("/agencija/pos");
  revalidatePath("/agencija/pos/smjene");
  redirect("/agencija/pos/smjene?poruka=zatvorena");
}
