import { revalidatePath } from "next/cache";
import { exportCorporateTax, saveCorporateTax } from "@/lib/corporate-tax-service";
import { CorporateTaxError } from "@/lib/corporate-tax";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const fail = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
  if (request.headers.get("x-corporate-tax") !== "1" || request.headers.get("sec-fetch-site") === "cross-site") return fail("Nedozvoljen zahtjev.", 403);
  try {
    const text = await request.text();
    if (text.length > 30000) return fail("Zahtjev je prevelik.");
    let body;
    try { body = JSON.parse(text); } catch { return fail("Neispravan zahtjev."); }
    if (!body || !["save", "export"].includes(body.intent)) return fail("Nepoznata akcija.");
    if (body.intent === "export") {
      const result = await exportCorporateTax(body);
      return new Response(result.xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="${result.fileName}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }
    const result = await saveCorporateTax(body);
    revalidatePath("/agencija/zavrsni-racun/porez-na-dobit");
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error instanceof CorporateTaxError ? error.message : "Prijava nije obrađena. Pokušajte ponovo.", error instanceof CorporateTaxError ? 400 : 500);
  }
}
