import { redirect } from "next/navigation";
import { requireAnyRole } from "@/lib/auth";
import { hasAllPermissions, type PermissionAction } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

export const posModule = "pos";

export async function getPosContext(action: PermissionAction | PermissionAction[] = "view") {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije", "klijent"]);
  const work = await readWorkContext();
  if (!user.agencija_id || !work.firmaId || !work.poslovnaGodinaId) {
    return { user, firma: null, year: null, allowed: false };
  }
  const [firma, year, allowed] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: work.firmaId,
        agencija_id: user.agencija_id,
        aktivan: true,
        is_deleted: false,
        ...(user.rola === "admin_agencije" ? {} : { korisnici: { some: { korisnik_id: user.id, is_deleted: false } } })
      },
      select: { id: true, naziv: true, skraceni_naziv: true, pib: true, pdv_broj: true, pdv_obveznik: true, dozvoli_negativan_lager: true, adresa: true, grad: true, drzava: true, telefon: true, email: true, web_sajt: true, fiscalCompanyLink: true }
    }),
    prisma.poslovnaGodina.findFirst({ where: { id: work.poslovnaGodinaId, firma_id: work.firmaId }, select: { id: true, godina: true, zakljucena: true } }),
    hasAllPermissions(
      user,
      (Array.isArray(action) ? action : [action]).map((akcija) => ({
        firmaId: work.firmaId,
        modul: posModule,
        akcija
      }))
    )
  ]);
  return { user, firma, year, allowed: Boolean(firma && year && allowed) };
}

export async function requirePosContext(action: PermissionAction | PermissionAction[]) {
  const ctx = await getPosContext(action);
  if (!ctx.allowed || !ctx.firma || !ctx.year || ctx.year.zakljucena) redirect("/agencija/pos?poruka=prava");
  return { ...ctx, firma: ctx.firma, year: ctx.year };
}
