import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { getCurrentUser } from "./auth";

export type PermissionAction =
  | "view"
  | "create"
  | "update"
  | "delete"
  | "post"
  | "cancel"
  | "export"
  | "approve"
  | "manage";

type PermissionCheck = {
  firmaId?: string | null;
  modul: string;
  akcija: PermissionAction;
};

export async function requireAgencyUser() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/?greska=sesija");
  }

  if (!user.agencija_id || !["admin_agencije", "korisnik_agencije", "klijent"].includes(user.rola)) {
    redirect("/");
  }

  return user;
}

export async function hasPermission(
  user: Awaited<ReturnType<typeof getCurrentUser>>,
  { firmaId, modul, akcija }: PermissionCheck
) {
  if (!user) {
    return false;
  }

  if (user.rola === "admin") {
    return true;
  }

  if (!user.agencija_id) {
    return false;
  }

  if (user.rola === "admin_agencije") {
    if (!firmaId) {
      return true;
    }

    const firma = await prisma.firma.findFirst({
      where: {
        id: firmaId,
        agencija_id: user.agencija_id,
        is_deleted: false
      },
      select: {
        id: true
      }
    });

    return Boolean(firma);
  }

  if (user.rola === "klijent" && modul !== "pos" && akcija !== "view") {
    return false;
  }

  if (firmaId) {
    const firmaPristup = await prisma.korisnikFirma.findFirst({
      where: {
        korisnik_id: user.id,
        firma_id: firmaId,
        is_deleted: false,
        firma: {
          agencija_id: user.agencija_id,
          is_deleted: false
        }
      },
      select: {
        id: true
      }
    });

    if (!firmaPristup) {
      return false;
    }
  }

  const eksplicitnoPravo = await prisma.korisnikPravo.findFirst({
    where: {
      agencija_id: user.agencija_id,
      korisnik_id: user.id,
      firma_id: firmaId ?? null,
      modul,
      akcija
    },
    select: {
      dozvoljeno: true
    }
  });

  if (eksplicitnoPravo) {
    return eksplicitnoPravo.dozvoljeno;
  }

  return false;
}

export async function requirePermission(check: PermissionCheck) {
  const user = await getCurrentUser();
  const allowed = await hasPermission(user, check);

  if (!allowed) {
    redirect("/?greska=prava");
  }

  return user;
}
