import { fiscalContextRows, isFiscalContextReportKind } from "@/lib/fiscal-report-context-groups";
import { fiscalBuyerRows } from "@/lib/fiscal-report-buyers";
import { loadBoundedFiscalExport } from "@/lib/fiscal-export-data";
import { fiscalReportPdf } from "@/lib/fiscal-pdf";
import { fiscalReportWorkbook } from "@/lib/fiscal-report-xlsx";
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
    formatPortalMoney(document.gross),
    document.iic ?? "", document.jikr ?? "", document.originalNumber ?? "", document.originalIic ?? "", document.correctionReason ?? "", document.fiscalContext?.businessUnitCode ?? "", document.fiscalContext?.deviceCode ?? "", document.fiscalContext?.operatorCode ?? ""
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
  if (filters.invalidPeriod) return new Response("Neispravan period izvoza.", { status: 400 });
  const format = url.searchParams.get("format") ?? "csv";
  if (!["csv", "xlsx", "pdf"].includes(format)) return new Response("Nepoznat format izvoza.", { status: 400 });
  const report = await loadBoundedFiscalExport(context, filters, kind);
  if (!report) return new Response("Izvoz je prevelik. Izaberite uži period (najviše 5.000 računa i 50.000 stavki).", { status: 413 });
  if (format === "pdf") {
    try {const bytes=await fiscalReportPdf(report,context.firma,new Date(),kind);
      await auditLog({agencijaId:context.user.agencija_id!,firmaId:context.firma.id,korisnikId:context.user.id,modul:"izvjestaji",akcija:"export_pdf",tipEntiteta:"direct_portal_report",novaVrijednost:{tip:kind,period_od:filters.periodFrom,period_do:filters.periodTo}});
      return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="izvjestaj-${kind}.pdf"`,"Cache-Control":"private, no-store"}});
    } catch {return new Response("PDF nije dostupan ili je obuhvat prevelik. Izaberite uži period i pokušajte ponovo.",{status:413});}
  }
  if (format === "xlsx") {
    const bytes = fiscalReportWorkbook(report, context.firma, new Date(), kind);
    await auditLog({ agencijaId: context.user.agencija_id!, firmaId: context.firma.id, korisnikId: context.user.id,
      modul: "izvjestaji", akcija: "export_xlsx", tipEntiteta: "direct_portal_report",
      novaVrijednost: { tip: kind, period_od: filters.periodFrom, period_do: filters.periodTo, okruzenje: filters.environment, broj_dokumenata: report.documents.length } });
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="izvjestaj-${kind}-${filters.environment}-${filters.periodFrom}-${filters.periodTo}.xlsx"`,
      "Cache-Control": "private, no-store"
    } });
  }

  const rows: unknown[][] = [["Okruženje", filters.environment ?? "Production"], ["Period od", filters.periodFrom], ["Period do (uključeno)", filters.periodTo], ["Obuhvat", kind === "avansi" ? "Avansi iz perioda i trenutno lokalno stanje korišćenja; ne potvrđuje raspoloživost i rezervacije." : "Potvrđene fakture i POS prodaja sa korekcijama u EUR; bez avansa i informativnih dokumenata"], []];
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
      "Promet nakon korekcija EUR"
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
  } else if (kind === "avansi") {
    rows.push(["Avans", "Kupac", "Avans EUR", "Potvrđeno korišćenje EUR", "Potvrđeno umanjenje EUR", "Čeka umanjenje EUR", "Nepotvrđene veze EUR"]);
    for (const row of report.advances) rows.push([row.number,row.buyer,...[row.gross,row.used,row.settled,row.unsettled,row.pending].map(formatPortalMoney)]);
    rows.push([], ["Avans", "Konačni račun", "Korišćenje", "Valuta", "Status", "Umanjenje", "JIKR umanjenja"]);
    for (const row of report.advances) for (const link of row.links) rows.push([row.number,link.number,formatPortalMoney(link.amount),link.currency,link.status,link.settlementNumber,link.settlementJikr]);
    rows.push([], ["Tumačenje", "Avansi izdati u periodu; trenutno lokalno korišćenje kroz sve godine iste firme. Raspoloživost i rezervacije nijesu potvrđene. Nije istorijski saldo niti dodatna prodaja."]);
  } else if (isFiscalContextReportKind(kind)) {
    rows.push(["Fiskalni kod", "Poslovna jedinica ENU-a", "Izvor podataka", "Računa", "Korekcija", "Prodaja EUR", "Korekcije EUR", "Osnovica EUR", "PDV EUR", "Promet EUR"]);
    for (const row of fiscalContextRows(report.documents,kind)) rows.push([row.code ?? "Nije evidentirano",row.unitCode ?? "",row.historical ? "Snimak prvog slanja" : "Nije evidentirano",row.ordinaryCount,row.correctionCount,...[row.sales,row.corrections,row.base,row.vat,row.gross].map(formatPortalMoney)]);
  } else if (kind === "kupci") {
    rows.push(["Kupac", "PIB / poreski broj", "Izvor podataka", "Računa", "Korekcija", "Prodaja EUR", "Korekcije EUR", "Osnovica EUR", "PDV EUR", "Promet EUR"]);
    for (const row of fiscalBuyerRows(report.documents)) rows.push([row.name,row.taxNumber,row.historical ? "Snimak računa" : "Trenutni adresar",row.ordinaryCount,row.correctionCount,...[row.sales,row.corrections,row.base,row.vat,row.gross].map(formatPortalMoney)]);
  } else if (kind === "placanja") {
    rows.push(["Način plaćanja", "Neto iznos EUR"]);
    for (const payment of report.payments) {
      rows.push([
        directPortalReportPaymentLabels[payment.method] ?? payment.method,
        formatPortalMoney(payment.amount)
      ]);
    }
  } else {
    rows.push(["Kanal", "Dokumenata", "Promet nakon korekcija EUR"]);
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
    "Ukupno EUR", "IKOF", "JIKR", "Originalni broj", "Originalni IKOF", "Razlog korekcije", "Istorijska jedinica", "Istorijski ENU", "Istorijski operater"
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
      okruzenje: filters.environment ?? "Production",
      tip: kind,
      period_od: filters.periodFrom,
      period_do: filters.periodTo,
      broj_dokumenata: report.documents.length
    }
  });

  const fileName = `izvjestaj-${filters.environment ?? "Production"}-${kind}-${filters.periodFrom}-${filters.periodTo}.csv`;
  return new Response(directPortalCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store"
    }
  });
}
