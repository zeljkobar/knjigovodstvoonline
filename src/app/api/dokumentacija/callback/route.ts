import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { connectOneDrive } from "@/lib/dokumentacija-onedrive";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  if (user?.rola !== "admin_agencije" || !user.agencija_id || !state || !code ||
      request.cookies.get("dokumenta_oauth")?.value !== `${user.id}.${state}`) {
    return new Response("OneDrive zahtjev je istekao ili je neispravan.", { status: 403 });
  }
  let result = "povezano";
  try {
    await connectOneDrive(user.agencija_id, code);
    await auditLog({ korisnikId: user.id, agencijaId: user.agencija_id,
      modul: "dokumentacija", akcija: "onedrive_connect", tipEntiteta: "DokumentaOneDrive" });
  } catch {
    result = "greska";
  }
  const response = new NextResponse(null, { status: 303, headers: { Location: `/agencija/dokumentacija?onedrive=${result}` } });
  response.cookies.set("dokumenta_oauth", "", { maxAge: 0, path: "/api/dokumentacija/callback" });
  return response;
}
