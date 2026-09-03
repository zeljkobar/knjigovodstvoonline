import { financialReportExportContext } from "@/lib/financial-report-export-context";
import { buildFinancialReportXml, FinancialXmlError, xmlHeaderFields, type XmlHeader } from "@/lib/financial-report-xml";
import { calculateBalanceSheet, calculateIncomeStatement, calculateStatisticalAnnex } from "@/lib/financial-reports";
import { auditLog } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const failure = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  // Fetch-only same-origin endpoint; custom header prevents cross-site form submissions.
  if (request.headers.get("x-financial-xml") !== "1" ||
    request.headers.get("sec-fetch-site") === "cross-site") return failure("Nedozvoljen zahtjev.", 403);
  const context = await financialReportExportContext();
  if (!context) return failure("Izaberite firmu i godinu za koje imate pravo pregleda i izvoza.", 403);
  const form = await request.formData();
  if (form.get("firmaId") !== context.firma.id || form.get("godinaId") !== context.godina.id) {
    return failure("Promijenjen je radni kontekst. Osvježite ekran prije izvoza.", 409);
  }
  if (form.get("potvrda") !== "on") return failure("Potvrdite obim izvoza i nekorišćene obrasce.");
  const header = Object.fromEntries(xmlHeaderFields.map((key) => [key, String(form.get(key) ?? "").trim()])) as XmlHeader;
  // Never trust browser company identity, period or report amounts.
  Object.assign(header, {
    Godina: String(context.godina.godina), DatumOd: context.godina.datum_od.toISOString().slice(0, 10),
    DatumDo: context.godina.datum_do.toISOString().slice(0, 10), NazivObveznika: context.firma.naziv
  });
  const scope = { agencijaId: context.agencijaId, firmaId: context.firma.id, poslovnaGodinaId: context.godina.id };
  try {
    const [bs, bu, sa] = await Promise.all([calculateBalanceSheet(scope), calculateIncomeStatement(scope), calculateStatisticalAnnex(scope)]);
    const xml = buildFinancialReportXml(header, { BilanStanja: bs.rows, BilanUspjeha: bu.rows, StatistickiAneks: sa.rows });
    await auditLog({ korisnikId: context.user.id, agencijaId: context.agencijaId, firmaId: context.firma.id,
      modul: "zavrsni_racun", akcija: "export_xml", tipEntiteta: "PoslovnaGodina", entitetId: context.godina.id,
      novaVrijednost: { godina: context.godina.godina, obrasci: ["BS", "BU", "SA"], ostaliObrasci: "nule", format: "FinansijskiIskazi" } });
    const pib = (context.firma.pib ?? "firma").replace(/[^0-9a-zA-Z_-]/g, "");
    return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="Bilans_${context.godina.godina}_${pib}.xml"`,
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    if (error instanceof FinancialXmlError) return failure(error.message);
    // Do not disclose personal data, report content or database errors.
    return failure("Izvoz nije uspio. Pokušajte ponovo; ako se greška ponavlja, kontaktirajte podršku.", 500);
  }
}
