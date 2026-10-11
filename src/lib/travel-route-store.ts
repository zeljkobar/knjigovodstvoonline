import "server-only";
import { prisma } from "./prisma";
import initial from "./travel-routes.json";
export async function travelRoutes(agencyId: string) {
  const overrides = await prisma.putnaRelacija.findMany({ where: { agencija_id: agencyId }, orderBy: { polazak: "asc" } });
  const map = new Map(initial.map(r => [r.kljuc, { ...r, verzija: "", id: "" }]));
  for (const r of overrides) map.set(r.kljuc, { kljuc: r.kljuc, polazak_drzava: r.polazak_drzava, odrediste_drzava: r.odrediste_drzava, polazak: r.polazak, odrediste: r.odrediste, km: Number(r.km), id: r.id, verzija: r.updated_at.toISOString() });
  return [...map.values()].sort((a,b) => a.kljuc.localeCompare(b.kljuc));
}
