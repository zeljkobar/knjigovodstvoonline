import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { commitOpeningImport, previewOpeningImport, type ImportChoices } from "@/lib/opening-import";
import { OpeningImportError } from "@/lib/primatech-opening";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // This cookie-authenticated upload endpoint must only accept our own forms.
  let sameOrigin = false;
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    sameOrigin = ["http:", "https:"].includes(origin.protocol) && origin.host === (request.headers.get("host") ?? new URL(request.url).host);
  } catch { /* Missing/null origin is not a browser form from our application. */ }
  if (!sameOrigin) return NextResponse.json({ error: "Osvježite stranicu i ponovite uvoz." }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 11 * 1024 * 1024) return NextResponse.json({ error: "Fajlovi su preveliki." }, { status: 413 });
  try {
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      return NextResponse.json({ preview: await previewOpeningImport(await request.formData()) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const body = await request.text();
    if (body.length > 1800000) throw new OpeningImportError("Zahtjev je prevelik.");
    let parsed: { token: string; choices: ImportChoices };
    try { parsed = JSON.parse(body); } catch { throw new OpeningImportError("Neispravan zahtjev."); }
    const journal = await commitOpeningImport(parsed.token, parsed.choices);
    revalidatePath("/agencija/nalozi");
    revalidatePath("/agencija/nalozi/pocetno-stanje");
    return NextResponse.json({ journalId: journal.id }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof OpeningImportError ? error.message : "Uvoz nije završen. Pokušajte ponovo; podaci nijesu djelimično sačuvani." }, { status: error instanceof OpeningImportError ? 400 : 500 });
  }
}
