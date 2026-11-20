import { loadAgencyFiscalExport } from "@/lib/agency-fiscal-export";
import { fiscalReportPdf } from "@/lib/fiscal-pdf";
import { fiscalReportWorkbook } from "@/lib/fiscal-report-xlsx";
import { auditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const result = await loadAgencyFiscalExport(Object.fromEntries(new URL(request.url).searchParams));
  if (result.error) return new Response(result.error, { status: result.status });
  const { context, filters, report, generatedAt, kind } = result;
  const pdf=new URL(request.url).searchParams.get("format")==="pdf";
  let bytes;
  try {bytes = pdf?await fiscalReportPdf(report,context.firma,generatedAt,kind):fiscalReportWorkbook(report, context.firma, generatedAt, kind);}
  catch{return new Response("PDF nije dostupan ili je obuhvat prevelik. Izaberite uži period.",{status:413});}
  await auditLog({ agencijaId: context.user.agencija_id!, firmaId: context.firma.id, korisnikId: context.user.id,
    modul: "izvjestaji", akcija: pdf?"export_pdf":"export_xlsx", tipEntiteta: "fiscal_turnover",
    novaVrijednost: { tip: kind, period_od: filters.periodFrom, period_do: filters.periodTo, okruzenje: filters.environment, kanal: filters.salesChannel, kasa: filters.registerId, broj_dokumenata: report.documents.length } });
  return new Response(new Uint8Array(bytes), { headers: {
    "Content-Type": pdf?"application/pdf":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="fiskalni-${kind}-${filters.environment}-${filters.periodFrom}-${filters.periodTo}.${pdf?"pdf":"xlsx"}"`,
    "Cache-Control": "private, no-store"
  } });
}
