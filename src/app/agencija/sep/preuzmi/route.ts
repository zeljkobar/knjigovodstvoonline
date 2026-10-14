import { NextRequest, NextResponse } from "next/server";
import { getSepCompany } from "@/lib/sep-context";
import { prisma } from "@/lib/prisma";
import { decryptSepCredentials } from "@/lib/sep-secrets";
import { downloadSepExcel, SepError, sepPeriod } from "@/lib/sep-client";
import { auditLog } from "@/lib/audit";
import { getPublicAppUrl } from "@/lib/app-url";

export const runtime = "nodejs";
export const maxDuration = 150;
const running = new Set<string>();
function failure(message: string, status = 400) { return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } }); }
export async function POST(request: NextRequest) {
  const allowedOrigin = process.env.NODE_ENV === "production" ? getPublicAppUrl() : new URL(request.url).origin;
  if (request.headers.get("origin") !== allowedOrigin) return failure("Zahtjev mora doći sa ovog sajta.", 403);
  let context: Awaited<ReturnType<typeof getSepCompany>>;
  try { context = await getSepCompany(); } catch { return failure("Nemate pristup ili firma nije izabrana / nema ispravan PIB.", 403); }
  if (running.has(context.scope)) return failure("Preuzimanje je već u toku. Sačekajte završetak.", 429);
  // Tiny URL-encoded/multipart date form: cap the body before parsing it.
  const reader = request.body?.getReader();
  if (!reader) return failure("Nedostaju podaci.");
  const parts: Uint8Array[] = []; let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > 8192) { await reader.cancel(); return failure("Prevelik zahtjev.", 413); }
    parts.push(chunk.value);
  }
  let form: FormData;
  try { form = await new Response(Buffer.concat(parts), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData(); }
  catch { return failure("Neispravan obrazac."); }
  const from = String(form.get("od") ?? ""), to = String(form.get("do") ?? "");
  if (form.get("firma_id") !== context.firm.id) return failure("Firma je promijenjena. Osvježite stranicu.", 409);
  try { sepPeriod(from, to); } catch { return failure("Unesite ispravan period, najviše godinu dana."); }
  running.add(context.scope);
  let credentials: ReturnType<typeof decryptSepCredentials> | undefined;
  try {
    const record = await prisma.agencijaSepSertifikat.findFirst({ where: { agencija_id: context.agencyId, korisnik_id: context.user.id, is_deleted: false } });
    if (!record?.sifrovani_podaci) return failure("Prvo dodajte svoj SEP sertifikat.");
    credentials = decryptSepCredentials(record.sifrovani_podaci, context.scope);
    const result = await downloadSepExcel(credentials, context.firm.pib, from, to);
    // Recheck access and certificate removal/replacement after the remote operation.
    const fresh = await getSepCompany(context.firm.id);
    if (fresh.scope !== context.scope || fresh.firm.pib !== context.firm.pib) return failure("Pristup je promijenjen. Osvježite stranicu.", 409);
    const active = await prisma.agencijaSepSertifikat.count({ where: { id: record.id, agencija_id: context.agencyId, korisnik_id: context.user.id, is_deleted: false, updated_at: record.updated_at } });
    if (!active) return failure("Sertifikat je promijenjen tokom preuzimanja. Pokušajte ponovo.", 409);
    await auditLog({ korisnikId: context.user.id, agencijaId: context.agencyId, firmaId: context.firm.id, modul: "sep", akcija: "EXPORT_EXCEL", tipEntiteta: "Firma", entitetId: context.firm.id, novaVrijednost: { od: from, do: to, broj_racuna: result.count } });
    return new NextResponse(new Uint8Array(result.excel), { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="SEP-${context.firm.pib}-${from}-${to}.xlsx"`,
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-SEP-Count": String(result.count),
    } });
  } catch (error) {
    if (error instanceof SepError) {
      const messages: Record<string, string> = {
        NOT_AUTHORIZED: "SEP nije potvrdio vaše ovlašćenje za ovu firmu.",
        CERTIFICATE_NOT_REGISTERED: "Sertifikat nije registrovan na SEP-u. Prvo dovršite prijavu u SEP portalu.",
        TAXPAYER_NOT_REGISTERED: "Firma nije registrovana na SEP-u.",
        LOGIN_FAILED: "SEP prijava nije uspjela. Provjerite sertifikat i njegovo važenje.",
        TIMEOUT: "SEP nije odgovorio na vrijeme. Pokušajte manji period.",
        TABLE_CHANGED_RETRY: "Spisak računa se promijenio tokom preuzimanja. Pokušajte ponovo.",
      };
      return failure(messages[error.code] ?? "SEP nije omogućio preuzimanje. Pokušajte ponovo ili manji period.", 502);
    }
    return failure("Preuzimanje nije uspjelo. Provjerite sačuvani pristup i serversku konfiguraciju.", 500);
  } finally {
    running.delete(context.scope);
    if (credentials) { credentials.pfx = ""; credentials.password = ""; credentials.jmbg = ""; }
  }
}
