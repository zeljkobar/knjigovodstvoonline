import { NextResponse } from "next/server";
import { previewPazarImport } from "@/lib/pazar-import";
import { PazarImportError } from "@/lib/pazar-import-policy";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ message: "Neispravno porijeklo zahtjeva." }, { status: 403 });
  try {
    if (Number(request.headers.get("content-length")) > 4000) throw new PazarImportError("Zahtjev je prevelik.");
    const reader = request.body?.getReader();
    if (!reader) throw new PazarImportError("Nedostaju podaci za preuzimanje.");
    const chunks: Uint8Array[] = []; let length = 0;
    try { while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength; if (length > 4000) throw new PazarImportError("Zahtjev je prevelik."); chunks.push(chunk.value); } }
    finally { await reader.cancel().catch(() => {}); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const fields = ["bookId", "companyId", "deviceId", "from", "to"];
    if (!body || fields.some(key => typeof body[key] !== "string" || !body[key] || body[key].length > 120)) throw new PazarImportError("Izaberite firmu, knjigu, kasu i period.");
    const input = Object.fromEntries(fields.map(key => [key, body[key]])) as { bookId: string; companyId: string; deviceId: string; from: string; to: string };
    return NextResponse.json(await previewPazarImport(input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ message: error instanceof PazarImportError ? error.message : "Uvoz nije uspio. Provjerite pristup i podešavanja pa pokušajte ponovo." }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
}
