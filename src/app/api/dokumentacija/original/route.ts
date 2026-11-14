import { NextRequest } from "next/server";
import { getCurrentUser, isDirectFiscalTenantUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { DokumentaError, streamDocument, uuidPattern } from "@/lib/dokumentacija";
import { GraphError } from "@/lib/dokumentacija-onedrive";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user?.agencija_id || isDirectFiscalTenantUser(user)) return new Response(null, { status: 403 });
  const id = request.nextUrl.searchParams.get("id");
  const kuf = request.nextUrl.searchParams.get("kuf");
  const value = id ?? kuf;
  if (!value || !uuidPattern.test(value) || (kuf && !uuidPattern.test(kuf))) return new Response(null, { status: 404 });
  const where = { agencija_id: user.agencija_id, status: { not: "UPLOAD" },
    firma: { aktivan: true, is_deleted: false, agencija_id: user.agencija_id },
    ...(id ? { id } : {}),
    ...(kuf ? { kuf_entry_id: kuf, kuf_entry: { is_deleted: false } } : {}),
    ...(user.rola === "klijent" ? { poslao_id: user.id } : {}) };
  const docs = await prisma.primljeniDokument.findMany({ where, orderBy: { created_at: "desc" } });
  const doc = docs.find(item => item.item_id) ?? docs[0];
  if (!doc) return new Response(null, { status: 404 });
  const allowed = await hasPermission(user, { firmaId: doc.firma_id, modul: "dokumentacija", akcija: "view" });
  const accounting = kuf && ["admin_agencije", "korisnik_agencije"].includes(user.rola) &&
    (await hasPermission(user, { firmaId: doc.firma_id, modul: "ulazni_racuni", akcija: "view" }) ||
      await hasPermission(user, { firmaId: doc.firma_id, modul: "nalozi", akcija: "view" }));
  if (!allowed && !accounting) return new Response(null, { status: 403 });
  if (!doc.item_id && doc.qr_link) return Response.redirect(doc.qr_link, 303);
  try {
    const original = await streamDocument(doc);
    if (!original?.ok || !original.body) return new Response("Original nije dostupan na OneDrive-u.", { status: 404 });
    const preview = request.nextUrl.searchParams.get("download") !== "1";
    const mime = /\.pdf$/i.test(doc.naziv) ? "application/pdf" : /\.png$/i.test(doc.naziv) ? "image/png" :
      /\.jpe?g$/i.test(doc.naziv) ? "image/jpeg" : "application/octet-stream";
    const disposition = preview && mime !== "application/octet-stream" ? "inline" : "attachment";
    return new Response(original.body, { headers: {
      "Content-Type": mime, "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(doc.naziv).replace(/'/g, "%27")}`,
      "Cache-Control": "private, no-store",
      ...(original.headers.has("content-length") ? { "Content-Length": original.headers.get("content-length")! } : {})
    } });
  } catch (error) {
    const status = error instanceof GraphError && error.status === 404 ? 404 :
      error instanceof DokumentaError ? error.status : 502;
    return new Response("Original nije dostupan na OneDrive-u.", { status });
  }
}
