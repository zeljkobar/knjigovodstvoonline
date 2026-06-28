import { NextRequest, NextResponse } from "next/server";
import { getPdvContextForApi, normalizePdvMonth } from "@/lib/pdv-service";
import { pdvMonths } from "@/lib/pdv";
import { prisma } from "@/lib/prisma";

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function valueText(value: unknown) {
  return Number(value?.toString() ?? 0).toFixed(2);
}

export async function GET(request: NextRequest) {
  const context = await getPdvContextForApi("export");
  const month = normalizePdvMonth(request.nextUrl.searchParams.get("mjesec"));

  if (!context) {
    return NextResponse.json({ error: "Nemate pravo za izvoz PDV prijave." }, { status: 403 });
  }

  const prijava = await prisma.pdvPrijava.findFirst({
    where: {
      agencija_id: context.agencijaId,
      firma_id: context.firma.id,
      poslovna_godina_id: context.poslovnaGodina.id,
      pdv_period: {
        mjesec: month
      }
    },
    include: {
      stavke: {
        orderBy: {
          redosljed: "asc"
        }
      },
      pdv_period: true
    }
  });

  if (!prijava) {
    return NextResponse.json({ error: "PDV prijava nije generisana." }, { status: 404 });
  }

  await prisma.pdvPrijava.update({
    where: {
      id: prijava.id
    },
    data: {
      xml_generated_at: new Date()
    }
  });

  const rows = prijava.stavke
    .map((row) => {
      const value = row.rucna_vrijednost ?? row.sistemska_vrijednost;

      return `    <Red sifra="${escapeXml(row.sifra)}" kolona="${escapeXml(row.kolona)}">
      <Opis>${escapeXml(row.opis)}</Opis>
      <Vrijednost>${valueText(value)}</Vrijednost>
    </Red>`;
    })
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<PdvPrijava>
  <Firma>${escapeXml(context.firma.naziv)}</Firma>
  <Godina>${context.poslovnaGodina.godina}</Godina>
  <Mjesec>${month}</Mjesec>
  <NazivMjeseca>${escapeXml(pdvMonths[month - 1])}</NazivMjeseca>
  <Status>${escapeXml(prijava.status)}</Status>
  <Redovi>
${rows}
  </Redovi>
</PdvPrijava>
`;

  return new Response(xml, {
    headers: {
      "Content-Disposition": `attachment; filename="pdv-${context.poslovnaGodina.godina}-${String(month).padStart(2, "0")}.xml"`,
      "Content-Type": "application/xml; charset=utf-8"
    }
  });
}
