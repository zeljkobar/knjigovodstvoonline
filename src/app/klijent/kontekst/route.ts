import { NextRequest, NextResponse } from "next/server";
import { getClientContext } from "@/lib/client-portal";
import { ACTIVE_COMPANY_COOKIE, ACTIVE_YEAR_COOKIE, workContextCookieOptions } from "@/lib/work-context";

export async function GET(request: NextRequest) {
  const context = await getClientContext();
  const firma = context.firma;
  if (!firma) return new NextResponse("Firma nije dostupna.", { status: 403 });
  const year = context.years.find((item) => item.id === request.nextUrl.searchParams.get("godina"));
  if (!year) return new NextResponse("Poslovna godina nije dostupna.", { status: 400 });
  const response = new NextResponse(null, { status: 303, headers: { Location: "/klijent" } });
  response.cookies.set(ACTIVE_COMPANY_COOKIE, firma.id, workContextCookieOptions());
  if (year) response.cookies.set(ACTIVE_YEAR_COOKIE, year.id, workContextCookieOptions());
  else response.cookies.delete(ACTIVE_YEAR_COOKIE);
  return response;
}
