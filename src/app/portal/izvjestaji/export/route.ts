import { auditLog } from "@/lib/audit";
import { formatPortalMoney } from "@/lib/direct-portal-dashboard";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import {
  directPortalCsv,
  directPortalReportChannelLabels,
  directPortalReportDocumentLabels,
  directPortalReportPaymentLabels,
  loadDirectPortalReport,
  parseDirectPortalReportFilters,
  parseDirectPortalReportKind
} from "@/lib/direct-portal-reports";
import { posQuantity } from "@/lib/pos-reports";

export const dynamic = "force-dynamic";

const exportPermission = { modul: "izvjestaji", akcija: "export" };

function searchParamsObject(url: URL) {
  return Object.fromEntries(url.searchParams.entries());
}

function documentRows(report: Awaited<ReturnType<typeof loadDirectPortalReport>>) {
  return report.documents.map((document) => [
    document.date.toLocaleString("sr-Latn-ME", {
      timeZone: "Europe/Podgorica"
    }),
    directPortalReportDocumentLabels[document.documentType] ?? document.documentType,
    directPortalReportChannelLabels[document.channel] ?? document.channel,
    document.localNumber,
    document.officialNumber,
    document.buyer,
    document.buyerTaxNumber,
    document.register,
    document.paymentMethods
      .map((method) => directPortalReportPaymentLabels[method] ?? method)
      .join(", "),
    formatPortalMoney(document.base),
    formatPortalMoney(document.vat),
    formatPortalMoney(document.gross)
  ]);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = parseDirectPortalReportKind(url.searchParams.get("tip"));
  if (!kind) return new Response("Nepoznat izvještaj.", { status: 400 });

  const context = await requireDirectPortalContext(
    exportPermission,
    `/portal/izvjestaji/${kind}`
  );
  const filters = parseDirectPortalReportFilters(
    searchParamsObject(url),
    context.year
  );
  const report = await loadDirectPortalReport(context, filters, kind);

  const rows: unknown[][] = [];
  if (kind === "artikli") {
    rows.push([
      "Šifra",
      "Artikal / usluga",
      "Grupa",
      "JM",
      "Neto količina",
      "Dokumenata",
      "Osnovica EUR",
      "PDV EUR",
      "Neto promet EUR"
    ]);
    for (const item of report.items) {
      rows.push([
        item.code,
        item.name,
        item.group,
        item.unit,
        posQuantity(item.quantity),
        item.invoiceCount,
        formatPortalMoney(item.base),
        formatPortalMoney(item.vat),
        formatPortalMoney(item.gross)
      ]);
    }
  } else if (kind === "placanja") {
    rows.push(["Način plaćanja", "Neto iznos EUR"]);
    for (const payment of report.payments) {
      rows.push([
        directPortalReportPaymentLabels[payment.method] ?? payment.method,
        formatPortalMoney(payment.amount)
      ]);
    }
  } else {
    rows.push(["Kanal", "Dokumenata", "Neto promet EUR"]);
    for (const channel of report.channels) {
      rows.push([
        directPortalReportChannelLabels[channel.channel] ?? channel.channel,
        channel.count,
        formatPortalMoney(channel.gross)
      ]);
    }
  }

  rows.push([]);
  rows.push([
    "Datum i vrijeme",
    "Dokument",
    "Kanal",
    "Lokalni broj",
    "Fiskalni broj",
    "Kupac",
    "PIB / poreski broj",
    "Kasa",
    "Plaćanje",
    "Osnovica EUR",
    "PDV EUR",
    "Ukupno EUR"
  ]);
  rows.push(...documentRows(report));

  await auditLog({
    agencijaId: context.user.agencija_id!,
    firmaId: context.firma.id,
    korisnikId: context.user.id,
    modul: "izvjestaji",
    akcija: "export_csv",
    tipEntiteta: "direct_portal_report",
    novaVrijednost: {
      tip: kind,
      period_od: filters.periodFrom,
      period_do: filters.periodTo,
      broj_dokumenata: report.documents.length
    }
  });

  const fileName = `izvjestaj-${kind}-${filters.periodFrom}-${filters.periodTo}.csv`;
  return new Response(directPortalCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store"
    }
  });
}
