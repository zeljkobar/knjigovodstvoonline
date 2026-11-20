import { requireAnyRole } from "./auth";
import { hasAllPermissions } from "./permissions";
import { prisma } from "./prisma";
import { readWorkContext } from "./work-context";

/** Each channel requires its own module permission; report access cannot widen it. */
export async function getAgencyFiscalReportContext(action: "view" | "export" = "view") {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije", "klijent"]);
  const work = await readWorkContext();
  if (!user.agencija_id || !work.firmaId || !work.poslovnaGodinaId) return null;
  const [firma, year] = await Promise.all([
    prisma.firma.findFirst({ where: { id: work.firmaId, agencija_id: user.agencija_id, aktivan: true, is_deleted: false,
      ...(user.rola === "admin_agencije" ? {} : { korisnici: { some: { korisnik_id: user.id, is_deleted: false } } }) },
      select: { id: true, naziv: true, pib: true } }),
    prisma.poslovnaGodina.findFirst({ where: { id: work.poslovnaGodinaId, firma_id: work.firmaId },
      select: { id: true, datum_od: true, datum_do: true } })
  ]);
  if (!firma || !year) return null;
  const [office, pos] = await Promise.all(["robno", "pos"].map(modul =>
    hasAllPermissions(user, [ { firmaId: firma.id, modul, akcija: "view" }, ...(action === "export" ? [{ firmaId: firma.id, modul, akcija: "export" as const }] : []) ])));
  const channels = [...(office ? ["OFFICE"] : []), ...(pos ? ["POS"] : [])];
  return channels.length ? { user, firma, year, channels } : null;
}
