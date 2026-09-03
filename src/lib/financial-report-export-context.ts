import "server-only";
import { requireAnyRole } from "./auth";
import { hasPermission } from "./permissions";
import { prisma } from "./prisma";
import { readWorkContext } from "./work-context";

export async function financialReportExportContext() {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const context = await readWorkContext();
  if (!user.agencija_id || !context.firmaId || !context.poslovnaGodinaId) return null;
  const [view, exp] = await Promise.all(["view", "export"].map((akcija) => hasPermission(user, {
    firmaId: context.firmaId, modul: "zavrsni_racun", akcija: akcija as "view" | "export"
  })));
  if (!view || !exp) return null;
  const [firma, godina] = await Promise.all([
    prisma.firma.findFirst({ where: { id: context.firmaId, agencija_id: user.agencija_id, is_deleted: false, aktivan: true },
      select: { id: true, naziv: true, pib: true, maticni_broj: true, grad: true, adresa: true, sifra_djelatnosti: true } }),
    prisma.poslovnaGodina.findFirst({ where: { id: context.poslovnaGodinaId, firma_id: context.firmaId },
      select: { id: true, godina: true, datum_od: true, datum_do: true } })
  ]);
  if (!firma || !godina) return null;
  return { user, firma, godina, agencijaId: user.agencija_id };
}
