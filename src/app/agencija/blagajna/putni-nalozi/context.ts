import { requireAnyRole } from "@/lib/auth";
import { readWorkContext } from "@/lib/work-context";
import { hasPermission, type PermissionAction } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
export const travelPath = "/agencija/blagajna/putni-nalozi";
export async function travelContext(action: PermissionAction = "view") {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const work = await readWorkContext();
  const firma = work.firmaId && user.agencija_id ? await prisma.firma.findFirst({ where: { id: work.firmaId, agencija_id: user.agencija_id, aktivan: true, is_deleted: false, ...(user.rola === "admin_agencije" ? {} : { korisnici: { some: { korisnik_id: user.id, is_deleted: false } } }) } }) : null;
  const godina = firma && work.poslovnaGodinaId ? await prisma.poslovnaGodina.findFirst({ where: { id: work.poslovnaGodinaId, firma_id: firma.id } }) : null;
  if (!firma || !godina || !user.agencija_id) redirect(`${travelPath}/kontekst`);
  if (!await hasPermission(user, { firmaId: firma.id, modul: "putni_nalozi", akcija: "view" }) || !await hasPermission(user, { firmaId: firma.id, modul: "putni_nalozi", akcija: action })) redirect("/agencija?greska=prava");
  return { user, firma, godina, agencyId: user.agencija_id };
}
