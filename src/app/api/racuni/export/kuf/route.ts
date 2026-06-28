import { NextRequest, NextResponse } from "next/server";
import {
  excelDate,
  kufTaxSummary,
  moneyCell,
  postingStatusLabel,
  vatTransactionLabel,
  workbookBuffer,
  workbookResponse
} from "@/lib/invoice-book-export";
import { normalizeFiscalInvoiceNumber } from "@/lib/invoice-number";
import { hasPermission } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

export const runtime = "nodejs";

function parseDateFilter(value: string | null) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function exportFileName(prefix: string, dateFrom: Date | null, dateTo: Date | null) {
  const period = [excelDate(dateFrom), excelDate(dateTo)].filter(Boolean).join("_");

  return `${prefix}${period ? `_${period}` : ""}.xlsx`;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  const workContext = await readWorkContext();
  const dateFrom = parseDateFilter(request.nextUrl.searchParams.get("datum_od"));
  const dateTo = parseDateFilter(request.nextUrl.searchParams.get("datum_do"));

  if (!user) {
    return NextResponse.json({ error: "Sesija je istekla." }, { status: 401 });
  }

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return NextResponse.json({ error: "Izaberite firmu i poslovnu godinu." }, { status: 400 });
  }

  const allowed = await hasPermission(user, {
    firmaId: workContext.firmaId,
    modul: "ulazni_racuni",
    akcija: "export"
  });

  if (!allowed) {
    return NextResponse.json({ error: "Nemate pravo za izvoz KUF-a." }, { status: 403 });
  }

  const [firma, godina, books] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: workContext.firmaId,
        agencija_id: user.agencija_id,
        is_deleted: false,
        aktivan: true
      },
      select: {
        naziv: true
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: workContext.poslovnaGodinaId,
        firma_id: workContext.firmaId
      },
      select: {
        godina: true
      }
    }),
    prisma.kufBook.findMany({
      where: {
        agencija_id: user.agencija_id,
        firma_id: workContext.firmaId,
        poslovna_godina_id: workContext.poslovnaGodinaId,
        is_deleted: false,
        ...(dateFrom || dateTo
          ? {
              kuf_date: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {})
              }
            }
          : {})
      },
      orderBy: [{ kuf_date: "asc" }, { redni_broj: "asc" }],
      select: {
        internal_kuf_number: true,
        kuf_date: true,
        mjesec: true,
        racun_vrsta: {
          select: {
            naziv: true
          }
        },
        redni_broj: true,
        entries: {
          where: {
            is_deleted: false
          },
          orderBy: {
            redni_broj: "asc"
          },
          select: {
            customs_base_amount: true,
            customs_declaration_date: true,
            customs_declaration_number: true,
            customs_duty_amount: true,
            customs_vat_amount: true,
            deductible_vat: true,
            due_date: true,
            goods_value: true,
            internal_kuf_number: true,
            invoice_date: true,
            is_import: true,
            non_deductible_vat: true,
            note: true,
            posting_status: true,
            receipt_date: true,
            redni_broj: true,
            supplier_invoice_number: true,
            total_base: true,
            total_gross: true,
            total_input_vat: true,
            vat_transaction_type: true,
            dobavljac: {
              select: {
                naziv: true,
                pdv_broj: true,
                pib: true
              }
            },
            expense_account: {
              select: {
                naziv: true,
                sifra: true
              }
            },
            tax_lines: {
              orderBy: {
                vat_rate_percent: "asc"
              },
              select: {
                deductible_vat_amount: true,
                input_vat_amount: true,
                non_deductible_vat_amount: true,
                tax_base: true,
                total_with_vat: true,
                vat_rate_percent: true
              }
            }
          }
        }
      }
    })
  ]);

  if (!firma || !godina) {
    return NextResponse.json({ error: "Firma ili poslovna godina nisu dostupni." }, { status: 404 });
  }

  const rows = books.flatMap((book) =>
    book.entries.map((entry) => ({
      "Firma": firma.naziv,
      "Godina": godina.godina,
      "Broj knjige": book.redni_broj,
      "Knjiga": book.internal_kuf_number,
      "Vrsta": book.racun_vrsta.naziv,
      "Mjesec": book.mjesec,
      "Datum KUF-a": excelDate(book.kuf_date),
      "Redni broj računa": entry.redni_broj,
      "Interni KUF broj": entry.internal_kuf_number,
      "Broj računa dobavljača": normalizeFiscalInvoiceNumber(entry.supplier_invoice_number),
      "Datum računa": excelDate(entry.invoice_date),
      "Datum prijema": excelDate(entry.receipt_date),
      "Datum dospijeća": excelDate(entry.due_date),
      "Dobavljač": entry.dobavljac.naziv,
      "PIB dobavljača": entry.dobavljac.pib ?? "",
      "PDV broj dobavljača": entry.dobavljac.pdv_broj ?? "",
      "Tip prometa": vatTransactionLabel(entry.vat_transaction_type),
      "Uvoz": entry.is_import ? "Da" : "Ne",
      "Konto troška": entry.expense_account
        ? `${entry.expense_account.sifra} ${entry.expense_account.naziv}`
        : "",
      "Osnovica": moneyCell(entry.total_base),
      "Ulazni PDV": moneyCell(entry.total_input_vat),
      "Odbitni PDV": moneyCell(entry.deductible_vat),
      "Neodbitni PDV": moneyCell(entry.non_deductible_vat),
      "Ukupno": moneyCell(entry.total_gross),
      "JCI broj": entry.customs_declaration_number ?? "",
      "JCI datum": excelDate(entry.customs_declaration_date),
      "Vrijednost robe": moneyCell(entry.goods_value),
      "Carinska osnovica": moneyCell(entry.customs_base_amount),
      "Carina": moneyCell(entry.customs_duty_amount),
      "PDV po carini": moneyCell(entry.customs_vat_amount),
      "Status knjiženja": postingStatusLabel(entry.posting_status),
      "PDV razrada": kufTaxSummary(entry.tax_lines),
      "Napomena": entry.note ?? ""
    }))
  );

  const buffer = workbookBuffer("KUF", rows, [
    { wch: 28 },
    { wch: 10 },
    { wch: 12 },
    { wch: 18 },
    { wch: 20 },
    { wch: 10 },
    { wch: 14 },
    { wch: 16 },
    { wch: 18 },
    { wch: 22 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 30 },
    { wch: 16 },
    { wch: 18 },
    { wch: 18 },
    { wch: 10 },
    { wch: 24 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 58 },
    { wch: 28 }
  ]);

  return workbookResponse(buffer, exportFileName("kuf", dateFrom, dateTo));
}
