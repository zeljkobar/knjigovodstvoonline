import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { requireRole } from "./auth";
import { prisma } from "./prisma";
import { readWorkContext } from "./work-context";
import { hasAllPermissions } from "./permissions";

export const clientSections = [
  { href: "/klijent/izvjestaji/kupci", label: "Kupci", modules: ["izvjestaji", "nalozi"] },
  { href: "/klijent/izvjestaji/ino-kupci", label: "Ino kupci", modules: ["izvjestaji", "nalozi"] },
  { href: "/klijent/izvjestaji/dobavljaci", label: "Dobavljači", modules: ["izvjestaji", "nalozi"] },
  { href: "/klijent/izvjestaji/ino-dobavljaci", label: "Ino dobavljači", modules: ["izvjestaji", "nalozi"] },
  { href: "/klijent/robno/kalkulacije", label: "Robni dokumenti", modules: ["robno"] },
  { href: "/klijent/robno/sifarnici", label: "Artikli i cjenovnik", modules: ["robno"] },
  { href: "/klijent/robno/lager", label: "Lager lista", modules: ["robno"] },
  { href: "/klijent/robno/kartica-artikla", label: "Kartica artikla", modules: ["robno"] },
  { href: "/klijent/pdv", label: "PDV pregled", modules: ["izvjestaji", "pdv"] }
];

export const getClientContext = cache(async () => {
  const user = await requireRole("klijent");
  const work = await readWorkContext();
  const companies = await prisma.firma.findMany({
    where: { agencija_id: user.agencija_id!, aktivan: true, is_deleted: false,
      korisnici: { some: { korisnik_id: user.id, is_deleted: false } } },
    select: { id: true, naziv: true, pib: true, pdv_obveznik: true },
    orderBy: { naziv: "asc" }
  });
  // Standard client accounts belong to one company; cookies cannot select another.
  const firma = companies.length === 1 ? companies[0] : null;
  const years = firma ? await prisma.poslovnaGodina.findMany({
    where: { firma_id: firma.id }, orderBy: { godina: "desc" },
    select: { id: true, godina: true, datum_od: true, datum_do: true }
  }) : [];
  const year = years.find((item) => item.id === work.poslovnaGodinaId)
    ?? years.find((item) => item.godina === new Date().getFullYear()) ?? years[0] ?? null;
  return { user, companies, firma, years, year };
});

export async function requireClientContext(modules: string[]) {
  const context = await getClientContext();
  if (!context.firma || !context.year || !(await hasAllPermissions(context.user,
    modules.map((modul) => ({ firmaId: context.firma!.id, modul, akcija: "view" as const }))))) notFound();
  return { ...context, firma: context.firma, year: context.year };
}

export function clientScope(context: Awaited<ReturnType<typeof requireClientContext>>) {
  return { agencija_id: context.user.agencija_id!, firma_id: context.firma.id,
    poslovna_godina_id: context.year.id };
}
