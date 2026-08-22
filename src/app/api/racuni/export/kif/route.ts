import { NextRequest, NextResponse } from "next/server";
import {
  excelDate,
  kifTaxSummary,
  moneyCell,
  postingStatusLabel,
  vatTransactionLabel,
  workbookBuffer,
  workbookResponse
} from "@/lib/invoice-book-export";
import { normalizeFiscalInvoiceNumber } from "@/lib/invoice-number";
import { kifEntryKinds } from "@/lib/kif-pazar";
import { hasPermission } from "@/lib/permissions";
import { getCurrentUser, isDirectFiscalTenantUser } from "@/lib/auth";
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

function periodText(from: Date | null, to: Date | null) {
  if (!from || !to) {
    return "";
  }

  const fromText = excelDate(from);
  const toText = excelDate(to);
  return fromText === toText ? fromText : `${fromText} - ${toText}`;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  const workContext = await readWorkContext();
  const dateFrom = parseDateFilter(request.nextUrl.searchParams.get("datum_od"));
  const dateTo = parseDateFilter(request.nextUrl.searchParams.get("datum_do"));

  if (!user) {
    return NextResponse.json({ error: "Sesija je istekla." }, { status: 401 });
  }

  if (isDirectFiscalTenantUser(user)) {
    return NextResponse.json({ error: "Ruta nije dostupna u direktnom portalu." }, { status: 403 });
  }

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return NextResponse.json({ error: "Izaberite firmu i poslovnu godinu." }, { status: 400 });
  }

  const allowed = await hasPermission(user, {
    firmaId: workContext.firmaId,
    modul: "izlazni_racuni",
    akcija: "export"
  });

  if (!allowed) {
    return NextResponse.json({ error: "Nemate pravo za izvoz KIF-a." }, { status: 403 });
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
    prisma.kifBook.findMany({
      where: {
        agencija_id: user.agencija_id,
        firma_id: workContext.firmaId,
        poslovna_godina_id: workContext.poslovnaGodinaId,
        is_deleted: false,
        ...(dateFrom || dateTo
          ? {
              kif_date: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {})
              }
            }
          : {})
      },
      orderBy: [{ kif_date: "asc" }, { redni_broj: "asc" }],
      select: {
        internal_kif_number: true,
        kif_date: true,
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
            entry_kind: true,
            customer_invoice_number: true,
            due_date: true,
            internal_kif_number: true,
            invoice_date: true,
            pazar_period_from: true,
            pazar_period_to: true,
            pazar_report_number: true,
            pazar_cash_register: true,
            is_export: true,
            note: true,
            posting_status: true,
            redni_broj: true,
            total_base: true,
            total_gross: true,
            total_output_vat: true,
            vat_transaction_type: true,
            kupac: {
              select: {
                naziv: true,
                pdv_broj: true,
                pib: true
              }
            },
            tax_lines: {
              orderBy: {
                vat_rate_percent: "asc"
              },
              select: {
                output_vat_amount: true,
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
      "Knjiga": book.internal_kif_number,
      "Vrsta": book.racun_vrsta.naziv,
      "Mjesec": book.mjesec,
      "Datum KIF-a": excelDate(book.kif_date),
      "Redni broj računa": entry.redni_broj,
      "Interni KIF broj": entry.internal_kif_number,
      "Vrsta zapisa": entry.entry_kind === kifEntryKinds.pazar ? "Pazar" : "Izlazna faktura",
      "Broj računa / izvještaja":
        entry.entry_kind === kifEntryKinds.pazar
          ? entry.pazar_report_number ?? entry.customer_invoice_number
          : normalizeFiscalInvoiceNumber(entry.customer_invoice_number),
      "Period pazara": periodText(entry.pazar_period_from, entry.pazar_period_to),
      "Kasa / poslovna jedinica": entry.pazar_cash_register ?? "",
      "Datum računa": excelDate(entry.invoice_date),
      "Datum dospijeća": excelDate(entry.due_date),
      "Kupac": entry.kupac.naziv,
      "PIB kupca": entry.kupac.pib ?? "",
      "PDV broj kupca": entry.kupac.pdv_broj ?? "",
      "Tip prometa": vatTransactionLabel(entry.vat_transaction_type),
      "Izvoz": entry.is_export ? "Da" : "Ne",
      "Osnovica": moneyCell(entry.total_base),
      "Izlazni PDV": moneyCell(entry.total_output_vat),
      "Ukupno": moneyCell(entry.total_gross),
      "Status knjiženja": postingStatusLabel(entry.posting_status),
      "PDV razrada": kifTaxSummary(entry.tax_lines),
      "Napomena": entry.note ?? ""
    }))
  );

  const buffer = workbookBuffer("KIF", rows, [
    { wch: 28 },
    { wch: 10 },
    { wch: 12 },
    { wch: 18 },
    { wch: 20 },
    { wch: 10 },
    { wch: 14 },
    { wch: 16 },
    { wch: 18 },
    { wch: 18 },
    { wch: 24 },
    { wch: 24 },
    { wch: 24 },
    { wch: 20 },
    { wch: 14 },
    { wch: 14 },
    { wch: 30 },
    { wch: 14 },
    { wch: 16 },
    { wch: 18 },
    { wch: 10 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 48 },
    { wch: 28 }
  ]);

  return workbookResponse(buffer, exportFileName("kif", dateFrom, dateTo));
}
