import { fiscalContextRows, fiscalContextReportTitles, fiscalContextSheetNames, isFiscalContextReportKind } from "./fiscal-report-context-groups";
import { fiscalBuyerRows } from "./fiscal-report-buyers";
import * as XLSX from "xlsx";
import type { DirectPortalReport, DirectPortalReportKind } from "./direct-portal-reports";
import { directPortalReportChannelLabels, directPortalReportDocumentLabels, directPortalReportPaymentLabels } from "./direct-portal-reports";
import { reportEnvironments } from "./fiscal-report-policy";

function money(value: bigint) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Iznos prelazi preciznost Excel izvoza.");
  return Number(value) / 100;
}

function excelBusinessTime(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Podgorica", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")));
}

export function fiscalReportSheets(report: DirectPortalReport, company: { naziv: string; pib: string | null }, generatedAt: Date, kind: DirectPortalReportKind = "promet") {
  const summary: unknown[][] = [
    [kind === "avansi" ? "Avansi i lokalna evidencija korišćenja" : isFiscalContextReportKind(kind) ? fiscalContextReportTitles[kind] : kind === "kupci" ? "Promet po kupcima" : kind === "zurnal" ? "Elektronski žurnal" : kind === "korekcije" ? "Korektivni žurnal" : kind === "artikli" ? "Prodaja artikala i usluga" : kind === "placanja" ? "Načini plaćanja na računima" : "Fiskalni promet"], ["Firma", company.naziv], ["PIB", company.pib ?? ""],
    ["Okruženje", reportEnvironments[report.filters.environment ?? "Production"]],
    ["Od", new Date(`${report.filters.periodFrom}T00:00:00Z`)], ["Do (uključeno)", new Date(`${report.filters.periodTo}T00:00:00Z`)],
    ["Kanal", report.filters.salesChannel ? directPortalReportChannelLabels[report.filters.salesChannel] : "Sva prodaja"],
    ["Filter POS kase", report.filters.registerId || "Sve / bez POS kase"], ["Filter kupca", report.filters.buyer],
    ["Vrijeme generisanja (UTC)", generatedAt.toISOString()],
    ["Obuhvat", kind === "avansi" ? "Avansi izdati u periodu; trenutno lokalno korišćenje i umanjenja iz svih godina iste firme. Nije istorijski ili raspoloživi saldo." : "Potvrđena prodaja i korekcije u EUR; bez avansa i informativnih dokumenata. Lokalna evidencija."],
    [], ["Računa", report.totals.ordinaryCount], ["Korekcija", report.totals.correctionCount],
    [kind === "avansi" ? "Avansni računi EUR" : "Prodaja sa PDV-om EUR", money(report.totals.salesGross)], ["Korekcije sa PDV-om EUR", money(report.totals.correctionsGross)],
    ["Osnovica EUR", money(report.totals.base)], ["PDV EUR", money(report.totals.vat)], [kind === "avansi" ? "Iznos avansnih računa EUR" : "Promet nakon korekcija EUR", money(report.totals.gross)]
  ];
  const invoices: unknown[][] = [["ID računa", "Interni broj", "Fiskalni broj", "Datum i vrijeme (Podgorica)", "Tip", "Kanal", "POS kasa", "Kupac", "PIB / poreski broj", "IKOF", "JIKR", "Osnovica EUR", "PDV EUR", "Ukupno EUR", "Doprinos filteru EUR", "Originalni broj", "Originalni IKOF", "Razlog korekcije", "Istorijska jedinica", "Istorijski ENU", "Istorijski operater"]];
  const lines: unknown[][] = [["ID računa", "Fiskalni broj", "Redni broj", "Šifra", "Naziv", "JM", "Količina", "Osnovica EUR", "PDV EUR", "Ukupno EUR"]];
  for (const document of report.documents) {
    invoices.push([document.id, document.localNumber, document.officialNumber,
      excelBusinessTime(document.date),
      directPortalReportDocumentLabels[document.documentType] ?? document.documentType,
      directPortalReportChannelLabels[document.channel] ?? document.channel, document.register, document.buyer, document.buyerTaxNumber,
      document.iic, document.jikr, money(document.base), money(document.vat), money(document.gross), money(document.reportAmount ?? document.gross), document.originalNumber ?? "", document.originalIic ?? "", document.correctionReason ?? "", document.fiscalContext?.businessUnitCode ?? "", document.fiscalContext?.deviceCode ?? "", document.fiscalContext?.operatorCode ?? ""]);
    document.lines.forEach((line, index) => lines.push([document.id, document.officialNumber, index + 1,
      line.code, line.name, line.unit, Number(line.quantity) / 1000, money(line.base), money(line.vat), money(line.gross)]));
  }
  const taxes = [["Kategorija", "Stopa %", "Osnovica EUR", "PDV EUR", "Ukupno EUR"], ...report.taxes.map(tax => [tax.name, tax.rate ? Number(tax.rate) : "", money(tax.base), money(tax.vat), money(tax.gross)])];
  summary.push([], ["Vrsta izvještaja", kind], ["Filter artikla", report.filters.itemId || report.filters.item || "Svi"], ["Filter grupe", report.filters.groupId || "Sve"], ["Filter plaćanja", report.filters.paymentMethod || "Svi"]);
  if (kind === "artikli") summary.push(["Tumačenje", "Sažetak i stavke obuhvataju izabrane artikle. Računi prikazuju cijele dokumente i njihov doprinos filteru odvojeno."]);
  if (kind === "placanja") summary.push(["Tumačenje", "Plaćanja su oznake na dokumentima, ne potvrde stvarnih uplata. Vrijednost računa može se razlikovati od iznosa izabranog načina plaćanja."]);
  const sheets: Array<[string, unknown[][]]> = [["Sažetak", summary], ["Računi", invoices], ["Stavke", lines], ["PDV", taxes]];
  if (kind === "artikli") sheets.push(["Artikli", [["Šifra", "Naziv", "Grupa", "JM", "Količina", "Dokumenata", "Osnovica EUR", "PDV EUR", "Promet EUR"], ...report.items.map(item => [item.code,item.name,item.group,item.unit,Number(item.quantity)/1000,item.invoiceCount,money(item.base),money(item.vat),money(item.gross)])]]);
  if (kind === "placanja") sheets.push(["Plaćanja", [["Način plaćanja", "Iznos EUR"], ...report.payments.map(payment => [directPortalReportPaymentLabels[payment.method] ?? payment.method,money(payment.amount)])]]);
  if (kind === "kupci") sheets.push(["Kupci", [["Kupac", "PIB / poreski broj", "Izvor podataka", "Računa", "Korekcija", "Prodaja EUR", "Korekcije EUR", "Osnovica EUR", "PDV EUR", "Promet EUR"], ...fiscalBuyerRows(report.documents).map(row => [row.name,row.taxNumber,row.historical ? "Snimak računa" : "Trenutni adresar",row.ordinaryCount,row.correctionCount,money(row.sales),money(row.corrections),money(row.base),money(row.vat),money(row.gross)])]]);
  if (isFiscalContextReportKind(kind)) {
    summary.push(["Tumačenje", "Istorijski first-send kodovi. Nije evidentirano ostaje u zbiru; trenutna podešavanja se ne koriste."]);
    sheets.push([fiscalContextSheetNames[kind], [["Fiskalni kod", "Poslovna jedinica ENU-a", "Izvor podataka", "Računa", "Korekcija", "Prodaja EUR", "Korekcije EUR", "Osnovica EUR", "PDV EUR", "Promet EUR"], ...fiscalContextRows(report.documents,kind).map(row => [row.code ?? "Nije evidentirano",row.unitCode ?? "",row.historical ? "Snimak prvog slanja" : "Nije evidentirano",row.ordinaryCount,row.correctionCount,money(row.sales),money(row.corrections),money(row.base),money(row.vat),money(row.gross)])]]);
  }
  if (kind === "avansi") {
    sheets.push(["Avansi", [["Avans", "Kupac", "Avans EUR", "Potvrđeno korišćenje EUR", "Potvrđeno umanjenje EUR", "Čeka umanjenje EUR", "Nepotvrđene veze EUR", "Provjera"], ...report.advances.map(row=>[row.number,row.buyer,money(row.gross),money(row.used),money(row.settled),money(row.unsettled),money(row.pending),row.review ? "Potrebna provjera" : "Lokalna evidencija"])]]);
    sheets.push(["Korišćenja avansa", [["Avans", "Konačni račun", "Iznos korišćenja", "Valuta", "Status", "Umanjenje", "JIKR umanjenja"], ...report.advances.flatMap(row=>row.links.map(link=>[row.number,link.number,money(link.amount),link.currency,link.status,link.settlementNumber,link.settlementJikr]))]]);
    summary.push(["Saldo i rezervacije", "Nijesu potvrđeni ovim lokalnim izvještajem. Nacrti i neuspjeli zahtjevi nijesu potvrđene rezervacije. Avans nije dodatna prodaja niti dokaz bankovne uplate."]);
  }
  return sheets;
}

export function fiscalReportWorkbook(report: DirectPortalReport, company: { naziv: string; pib: string | null }, generatedAt: Date, kind: DirectPortalReportKind = "promet") {
  const workbook = XLSX.utils.book_new();
  const sheets = fiscalReportSheets(report, company, generatedAt, kind);
  for (const [name, rows] of sheets) {
    const sheet = XLSX.utils.aoa_to_sheet(rows, { dateNF: "yyyy-mm-dd hh:mm:ss" });
    sheet["!autofilter"] = name !== "Sažetak" ? { ref: sheet["!ref"] ?? "A1" } : undefined;
    sheet["!cols"] = rows[0].map(() => ({ wch: 24 }));
    if (name === "Sažetak") sheet["!cols"] = [{ wch: 34 }, { wch: 90 }];
    // String cells stay text, including leading-zero identifiers and formula-like user input.
    for (const [key, cell] of Object.entries(sheet)) {
      if (key.startsWith("!") || !cell || typeof cell !== "object" || !("t" in cell) || cell.t !== "n") continue;
      const address = XLSX.utils.decode_cell(key);
      const monetary = name === "Avansi" ? address.c >= 2 && address.c <= 6 : name === "Korišćenja avansa" ? address.c === 2 : name === "Računi" ? address.c >= 11 && address.c <= 14 : name === "Stavke" ? address.c >= 7 : name === "PDV" ? address.c >= 2 : name === "Artikli" ? address.c >= 6 : name === "Plaćanja" ? address.c === 1 : (name === "Kupci" || Object.values(fiscalContextSheetNames).includes(name)) ? address.c >= 5 : address.c === 1 && address.r >= 14;
      if (monetary) cell.z = "#,##0.00";
      else if ((name === "Stavke" && address.c === 6) || (name === "Artikli" && address.c === 4)) cell.z = "0.000";
    }
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}
