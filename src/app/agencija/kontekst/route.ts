import { NextResponse } from "next/server";
import { requireAgencyWorkspaceUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ACTIVE_COMPANY_COOKIE,
  ACTIVE_YEAR_COOKIE,
  workContextCookieOptions
} from "@/lib/work-context";

function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith("/agencija")) {
    return "/agencija";
  }

  return value;
}

export async function GET(request: Request) {
  const user = await requireAgencyWorkspaceUser();
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
  const response = NextResponse.redirect(new URL(returnTo, request.url));

  if (!user?.agencija_id) {
    return response;
  }

  const requestedCompanyId = url.searchParams.get("firma_id")?.trim() ?? "";
  const requestedYearId = url.searchParams.get("poslovna_godina_id")?.trim() ?? "";

  if (!requestedCompanyId) {
    response.cookies.delete(ACTIVE_COMPANY_COOKIE);
    response.cookies.delete(ACTIVE_YEAR_COOKIE);
    return response;
  }

  const companyWhere =
    user.rola === "admin_agencije"
      ? {
          id: requestedCompanyId,
          agencija_id: user.agencija_id,
          is_deleted: false,
          aktivan: true
        }
      : {
          id: requestedCompanyId,
          agencija_id: user.agencija_id,
          is_deleted: false,
          aktivan: true,
          korisnici: {
            some: {
              korisnik_id: user.id,
              is_deleted: false
            }
          }
        };

  const firma = await prisma.firma.findFirst({
    where: companyWhere,
    select: {
      id: true,
      poslovne_godine: {
        orderBy: {
          godina: "desc"
        },
        select: {
          id: true
        }
      }
    }
  });

  if (!firma) {
    response.cookies.delete(ACTIVE_COMPANY_COOKIE);
    response.cookies.delete(ACTIVE_YEAR_COOKIE);
    return response;
  }

  response.cookies.set(
    ACTIVE_COMPANY_COOKIE,
    firma.id,
    workContextCookieOptions()
  );

  const validYear = requestedYearId
    ? await prisma.poslovnaGodina.findFirst({
        where: {
          id: requestedYearId,
          firma_id: firma.id
        },
        select: {
          id: true
        }
      })
    : null;
  const yearId = validYear?.id ?? firma.poslovne_godine[0]?.id ?? null;

  if (yearId) {
    response.cookies.set(ACTIVE_YEAR_COOKIE, yearId, workContextCookieOptions());
  } else {
    response.cookies.delete(ACTIVE_YEAR_COOKIE);
  }

  return response;
}
