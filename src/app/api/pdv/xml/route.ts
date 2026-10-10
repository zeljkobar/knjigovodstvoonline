import { NextRequest, NextResponse } from "next/server";
import { getPdvContextForApi, normalizePdvMonth } from "@/lib/pdv-service";
import { prisma } from "@/lib/prisma";

function rowAmount(value: unknown) {
  return Number(value?.toString() ?? 0);
}

function amountText(value: number) {
  return value.toFixed(4);
}

function booleanText(value: number) {
  return value > 0 ? "true" : "false";
}

function filenamePart(value: string) {
  return value
    .toLowerCase()
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackFilename(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/"/g, "");
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

  const versionId=request.nextUrl.searchParams.get("verzija");
  const version=versionId?await prisma.pdvVerzija.findFirst({where:{id:versionId,pdv_period_id:prijava.pdv_period_id}}):null;
  if(versionId&&!version) return NextResponse.json({error:"Verzija ne postoji u izabranom periodu."},{status:404});
  if(!version) await prisma.pdvPrijava.update({where:{id:prijava.id},data:{xml_generated_at:new Date()}});
  const rows=version?(version.snapshot as {prijava:{stavke:Array<{sifra:string;rucna_vrijednost:string|null;sistemska_vrijednost:string}>}}).prijava.stavke:prijava.stavke;
  const valueByRow=new Map(rows.map(row=>[row.sifra,rowAmount(row.rucna_vrijednost??row.sistemska_vrijednost)]));
  const value = (row: string) => valueByRow.get(row) ?? 0;
  const amountTag = (name: string, row: string, fallback = 0) =>
    `  <${name}>${amountText(valueByRow.has(row) ? value(row) : fallback)}</${name}>`;
  const xml = `<?xml version="1.0"?>
<PR_PDV_2025 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <BezTransakcija>${booleanText(value("9"))}</BezTransakcija>
${amountTag("Iznos10", "10")}
${amountTag("Iznos11", "11")}
${amountTag("Iznos12", "12")}
${amountTag("Iznos13", "13")}
${amountTag("Iznos14", "14")}
${amountTag("Iznos15", "15")}
${amountTag("Iznos16", "16")}
${amountTag("Iznos17", "17")}
${amountTag("Iznos18", "18")}
${amountTag("Iznos19", "19")}
${amountTag("Iznos20", "20")}
${amountTag("Iznos21A", "21")}
  <Iznos21B>0.0000</Iznos21B>
${amountTag("Iznos22", "22")}
${amountTag("Iznos23A", "23")}
  <Iznos23B>0.0000</Iznos23B>
${amountTag("Iznos24", "24")}
${amountTag("Iznos25", "25")}
${amountTag("Iznos26", "26")}
${amountTag("Iznos27", "27")}
${amountTag("Iznos28", "28")}
${amountTag("Iznos29", "29")}
  <ZahtjevamPovracaj>${booleanText(value("30"))}</ZahtjevamPovracaj>
</PR_PDV_2025>
`;
  const fileMonth = String(month).padStart(2, "0");
  const fileName = `pdv ${filenamePart(context.firma.naziv)} ${fileMonth}-${context.poslovnaGodina.godina}${version ? ` v${version.broj}` : ""}.xml`;
  const asciiFileName = fallbackFilename(fileName) || `pdv ${fileMonth}-${context.poslovnaGodina.godina}${version ? ` v${version.broj}` : ""}.xml`;

  return new Response(xml, {
    headers: {
      "Content-Disposition": `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Type": "application/xml; charset=utf-8"
    }
  });
}
