import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { oneDriveConsent } from "@/lib/dokumentacija-onedrive";

export async function GET() {
  const user = await getCurrentUser();
  if (user?.rola !== "admin_agencije" || !user.agencija_id) return new Response(null, { status: 403 });
  const state = randomBytes(32).toString("base64url");
  try {
    const response = NextResponse.redirect(oneDriveConsent(state));
    response.cookies.set("dokumenta_oauth", `${user.id}.${state}`, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/api/dokumentacija/callback", maxAge: 600
    });
    return response;
  } catch {
    return new Response("OneDrive integracija nije podešena.", { status: 503 });
  }
}
