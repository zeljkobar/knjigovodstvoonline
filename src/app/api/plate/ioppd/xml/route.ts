import { NextRequest, NextResponse } from "next/server";
import { requireAnyRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { buildIoppdMonthData, getIoppdCalculationsForMonth } from "@/lib/payroll-ioppd";
import { asciiIoppdFileName, buildIoppdXml, sanitizeIoppdFileName } from "@/lib/payroll-ioppd-xml";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

function parseMonth(value: string | null) {
  const month = Number(value);

  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
}

function parseYear(value: string | null) {
  const year = Number(value);

  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null;
}

export async function GET(request: NextRequest) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();
  const godina = parseYear(request.nextUrl.searchParams.get("godina"));
  const mjesec = parseMonth(request.nextUrl.searchParams.get("mjesec"));

  if (!user.agencija_id) {
    return NextResponse.json({ error: "Sesija nije vezana za agenciju." }, { status: 401 });
  }

  if (!workContext.firmaId || !workContext.poslovnaGodinaId) {
    return NextResponse.json({ error: "Izaberite firmu i poslovnu godinu." }, { status: 400 });
  }

  if (!godina || !mjesec) {
    return NextResponse.json({ error: "Unesite ispravnu godinu i mjesec." }, { status: 400 });
  }

  const allowed = await hasPermission(user, {
    firmaId: workContext.firmaId,
    modul: "plate",
    akcija: "export"
  });

  if (!allowed) {
    return NextResponse.json({ error: "Nemate pravo za izvoz IOPPD XML-a." }, { status: 403 });
  }

  const [firma, poslovnaGodina] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: workContext.firmaId,
        agencija_id: user.agencija_id,
        aktivan: true,
        is_deleted: false,
        ...(user.rola === "admin_agencije"
          ? {}
          : {
              korisnici: {
                some: {
                  korisnik_id: user.id,
                  is_deleted: false
                }
              }
            })
      },
      select: {
        id: true,
        naziv: true,
        pib: true
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: workContext.poslovnaGodinaId,
        firma_id: workContext.firmaId,
        godina
      },
      select: {
        id: true,
        godina: true
      }
    })
  ]);

  if (!firma || !poslovnaGodina) {
    return NextResponse.json({ error: "Firma ili poslovna godina nisu dostupni." }, { status: 404 });
  }

  const calculations = await getIoppdCalculationsForMonth({
    agencijaId: user.agencija_id,
    firmaId: firma.id,
    poslovnaGodinaId: poslovnaGodina.id,
    godina,
    mjesec
  });

  const data = buildIoppdMonthData(godina, mjesec, calculations);

  if (data.lines.length === 0) {
    return NextResponse.json({ error: "Nema podataka za IOPPD XML." }, { status: 404 });
  }

  const xml = buildIoppdXml(data);
  const fileName = sanitizeIoppdFileName(`IOPPD_${String(godina).slice(-2)}_${mjesec}_${firma.naziv}.xml`);
  const fallbackFileName = asciiIoppdFileName(fileName) || `IOPPD_${String(godina).slice(-2)}_${mjesec}.xml`;

  return new Response(xml, {
    headers: {
      "Content-Disposition": `attachment; filename="${fallbackFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Type": "application/xml; charset=utf-8"
    }
  });
}
