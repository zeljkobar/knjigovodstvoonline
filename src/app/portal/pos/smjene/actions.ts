"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { prisma } from "@/lib/prisma";

const shiftsPath = "/portal/pos/smjene";
const maxOpeningCashCents = BigInt("99999999999999");
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function parseOpeningCashCents(input: string) {
  const normalized = input.replace(/\s/g, "").replace(",", ".");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;

  const cents =
    BigInt(match[1]) * BigInt(100) +
    BigInt((match[2] ?? "").padEnd(2, "0") || "0");

  return cents <= maxOpeningCashCents ? cents : null;
}

function centsToDecimal(cents: bigint) {
  const whole = cents / BigInt(100);
  const fraction = (cents % BigInt(100)).toString().padStart(2, "0");
  return new Prisma.Decimal(`${whole}.${fraction}`);
}

function isPrismaError(error: unknown, code: string) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === code
  );
}

async function requireMutableShiftContext() {
  const context = await requireDirectPortalContext(
    { modul: "pos", akcija: "create" },
    shiftsPath
  );

  if (context.year.zakljucena || !context.user.agencija_id) {
    redirect(`${shiftsPath}?poruka=prava`);
  }

  return {
    context,
    agencijaId: context.user.agencija_id
  };
}

export async function openPortalPosShift(formData: FormData) {
  const { context, agencijaId } = await requireMutableShiftContext();
  const registerId = value(formData, "register_id");
  const openingCashCents = parseOpeningCashCents(
    value(formData, "opening_cash_amount")
  );

  if (!uuidPattern.test(registerId)) {
    redirect(`${shiftsPath}?poruka=kasa`);
  }
  if (openingCashCents === null) {
    redirect(`${shiftsPath}?poruka=iznos`);
  }

  const openingCash = centsToDecimal(openingCashCents);

  let result:
    | { status: "created"; id: string; registerName: string }
    | { status: "missing_register" }
    | { status: "already_open" }
    | { status: "occupied" };

  try {
    result = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`portal-pos-shift:${registerId}`}))`
        );

        const register = await tx.posRegister.findFirst({
          where: {
            id: registerId,
            agencija_id: agencijaId,
            firma_id: context.firma.id,
            aktivan: true,
            is_deleted: false
          },
          select: { id: true, naziv: true }
        });

        if (!register) return { status: "missing_register" as const };

        const currentShift = await tx.posSmjena.findFirst({
          where: {
            agencija_id: agencijaId,
            firma_id: context.firma.id,
            pos_register_id: register.id,
            status: "OPEN"
          },
          select: { opened_by: true }
        });

        if (currentShift) {
          return {
            status:
              currentShift.opened_by === context.user.id
                ? ("already_open" as const)
                : ("occupied" as const)
          };
        }

        const shift = await tx.posSmjena.create({
          data: {
            agencija_id: agencijaId,
            firma_id: context.firma.id,
            poslovna_godina_id: context.year.id,
            pos_register_id: register.id,
            opened_by: context.user.id,
            opening_cash_amount: openingCash
          },
          select: { id: true }
        });

        return {
          status: "created" as const,
          id: shift.id,
          registerName: register.naziv
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    if (isPrismaError(error, "P2002")) {
      redirect(`${shiftsPath}?poruka=vec_otvorena`);
    }
    if (isPrismaError(error, "P2034")) {
      redirect(`${shiftsPath}?poruka=pokusaj`);
    }
    throw error;
  }

  if (result.status === "missing_register") {
    redirect(`${shiftsPath}?poruka=kasa`);
  }
  if (result.status === "already_open") {
    redirect(`${shiftsPath}?poruka=vec_otvorena`);
  }
  if (result.status === "occupied") {
    redirect(`${shiftsPath}?poruka=kasa_zauzeta`);
  }

  await auditLog({
    korisnikId: context.user.id,
    agencijaId,
    firmaId: context.firma.id,
    modul: "pos",
    akcija: "open_pos_shift",
    tipEntiteta: "PosSmjena",
    entitetId: result.id,
    novaVrijednost: {
      status: "OPEN",
      registerId,
      register: result.registerName,
      openingCashCents: openingCashCents.toString()
    }
  });

  revalidatePath("/portal/pos");
  revalidatePath(shiftsPath);
  redirect(`${shiftsPath}?poruka=otvorena`);
}

export async function closePortalPosShift(formData: FormData) {
  const { context, agencijaId } = await requireMutableShiftContext();
  const shiftId = value(formData, "shift_id");
  const note = value(formData, "note").slice(0, 500) || null;
  const closedAt = new Date();

  if (!uuidPattern.test(shiftId)) {
    redirect(`${shiftsPath}?poruka=nije_otvorena`);
  }

  let result:
    | {
        id: string;
        registerName: string;
        invoiceCount: number;
        cash: string;
        card: string;
        bankTransfer: string;
        other: string;
        gross: string;
        expectedCash: string;
      }
    | null;

  try {
    result = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`portal-pos-shift:${shiftId}`}))`
        );

        const shift = await tx.posSmjena.findFirst({
          where: {
            id: shiftId,
            agencija_id: agencijaId,
            firma_id: context.firma.id,
            poslovna_godina_id: context.year.id,
            opened_by: context.user.id,
            status: "OPEN",
            pos_register: {
              agencija_id: agencijaId,
              firma_id: context.firma.id,
              aktivan: true,
              is_deleted: false
            }
          },
          include: {
            pos_register: { select: { id: true, naziv: true } }
          }
        });

        if (!shift) return null;

        const invoices = await tx.fiskalniIzlazniRacun.findMany({
          where: {
            agencija_id: agencijaId,
            firma_id: context.firma.id,
            poslovna_godina_id: context.year.id,
            pos_register_id: shift.pos_register_id,
            sales_channel: "POS",
            document_type: { in: ["POS_RECEIPT", "POS_RETURN"] },
            fiscal_status: { in: ["Fiscalized", "StornoCreated"] },
            issued_at: { gte: shift.opened_at, lte: closedAt },
            is_deleted: false
          },
          select: {
            ukupno_sa_pdv: true,
            nacin_placanja: true,
            placanja: {
              select: { payment_method: true, amount: true }
            }
          }
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

          if (invoice.placanja.length === 0) {
            const key =
              invoice.nacin_placanja in totals
                ? invoice.nacin_placanja
                : "OTHER";
            totals[key] = totals[key].plus(invoice.ukupno_sa_pdv);
            continue;
          }

          for (const payment of invoice.placanja) {
            const key =
              payment.payment_method in totals
                ? payment.payment_method
                : "OTHER";
            totals[key] = totals[key].plus(payment.amount);
          }
        }

        const expectedCash = shift.opening_cash_amount.plus(totals.CASH);
        const updated = await tx.posSmjena.updateMany({
          where: {
            id: shift.id,
            opened_by: context.user.id,
            status: "OPEN"
          },
          data: {
            status: "CLOSED",
            closed_at: closedAt,
            closed_by: context.user.id,
            invoice_count: invoices.length,
            cash_total: totals.CASH,
            card_total: totals.CARD,
            bank_transfer_total: totals.BANK_TRANSFER,
            other_total: totals.OTHER,
            gross_total: gross,
            expected_cash_amount: expectedCash,
            note
          }
        });

        if (updated.count !== 1) return null;

        return {
          id: shift.id,
          registerName: shift.pos_register.naziv,
          invoiceCount: invoices.length,
          cash: totals.CASH.toFixed(2),
          card: totals.CARD.toFixed(2),
          bankTransfer: totals.BANK_TRANSFER.toFixed(2),
          other: totals.OTHER.toFixed(2),
          gross: gross.toFixed(2),
          expectedCash: expectedCash.toFixed(2)
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    if (isPrismaError(error, "P2034")) {
      redirect(`${shiftsPath}?poruka=pokusaj`);
    }
    throw error;
  }

  if (!result) {
    redirect(`${shiftsPath}?poruka=nije_otvorena`);
  }

  await auditLog({
    korisnikId: context.user.id,
    agencijaId,
    firmaId: context.firma.id,
    modul: "pos",
    akcija: "close_pos_shift",
    tipEntiteta: "PosSmjena",
    entitetId: result.id,
    staraVrijednost: { status: "OPEN" },
    novaVrijednost: {
      status: "CLOSED",
      register: result.registerName,
      invoiceCount: result.invoiceCount,
      cash: result.cash,
      card: result.card,
      bankTransfer: result.bankTransfer,
      other: result.other,
      total: result.gross,
      expectedCash: result.expectedCash
    }
  });

  revalidatePath("/portal/pos");
  revalidatePath(shiftsPath);
  redirect(`${shiftsPath}?poruka=zatvorena`);
}
