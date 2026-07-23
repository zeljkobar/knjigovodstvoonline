import { prisma } from "./prisma";

function normalizeMunicipality(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function containsMunicipality(value: string, municipality: string) {
  return (
    value === municipality ||
    value.startsWith(`${municipality} `) ||
    value.endsWith(` ${municipality}`) ||
    value.includes(` ${municipality} `)
  );
}

export async function findMunicipalitySurtax(value: string | null | undefined, validOn: Date) {
  const normalizedValue = normalizeMunicipality(String(value ?? ""));

  if (!normalizedValue) {
    return null;
  }

  const rows = await prisma.platePrirezStopa.findMany({
    where: {
      aktivan: true,
      valid_from: { lte: validOn },
      OR: [{ valid_to: null }, { valid_to: { gte: validOn } }]
    },
    orderBy: { valid_from: "desc" },
    select: {
      opstina: true,
      djp_sifra: true,
      stopa: true,
      prirez_ziro_racun: true,
      prirez_sifra_placanja: true,
      porez_ziro_racun: true,
      porez_sifra_placanja: true
    }
  });

  return (
    rows
      .sort((left, right) => right.opstina.length - left.opstina.length)
      .find((row) => containsMunicipality(normalizedValue, normalizeMunicipality(row.opstina))) ?? null
  );
}
