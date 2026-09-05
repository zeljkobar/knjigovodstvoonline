import { redirect } from "next/navigation";
import { authenticatedHomePath } from "./direct-portal-policy";
import { prisma } from "./prisma";
import { readSession, type SessionUser } from "./session";

const rolePath: Record<SessionUser["rola"], string> = {
  admin: "/admin",
  admin_agencije: "/agencija",
  korisnik_agencije: "/agencija",
  klijent: "/klijent"
};

type UserWithAgencyKind = {
  rola: SessionUser["rola"];
  agencija: {
    is_fiscal_direct_container: boolean;
  } | null;
  firme?: Array<{ firma_id: string }>;
};

export function isDirectFiscalTenantUser(
  user: UserWithAgencyKind | null | undefined
) {
  return Boolean(
    user?.rola === "korisnik_agencije" &&
      user.agencija?.is_fiscal_direct_container
  );
}

export function isFiscalPortalUser(
  user: UserWithAgencyKind | null | undefined
) {
  if (!user || !["korisnik_agencije", "klijent"].includes(user.rola)) {
    return false;
  }

  return isDirectFiscalTenantUser(user) || Boolean(user.firme?.length);
}

export async function getCurrentUser() {
  const session = await readSession();

  if (!session) {
    return null;
  }

  const user = await prisma.korisnik.findFirst({
    where: {
      id: session.korisnikId,
      rola: session.rola,
      aktivan: true,
      is_deleted: false
    },
    select: {
      id: true,
      korisnicko_ime: true,
      rola: true,
      agencija_id: true,
      agencija: {
        select: {
          aktivan: true,
          is_deleted: true,
          is_fiscal_direct_container: true
        }
      },
      firme: {
        where: {
          is_deleted: false,
          access_type: { in: ["FISCAL_CLIENT", "FISCAL_OPERATOR"] },
          firma: {
            aktivan: true,
            is_deleted: false,
            fiscalCompanyLink: { isNot: null }
          }
        },
        take: 1,
        select: { firma_id: true }
      }
    }
  });

  if (
    user?.rola !== "admin" &&
    (!user?.agencija || !user.agencija.aktivan || user.agencija.is_deleted)
  ) {
    return null;
  }

  return user;
}

export async function resolveAuthenticatedHome(korisnikId: string) {
  const user = await prisma.korisnik.findFirst({
    where: {
      id: korisnikId,
      aktivan: true,
      is_deleted: false
    },
    select: {
      rola: true,
      agencija: {
        select: {
          aktivan: true,
          is_deleted: true,
          is_fiscal_direct_container: true
        }
      },
      firme: {
        where: {
          is_deleted: false,
          access_type: { in: ["FISCAL_CLIENT", "FISCAL_OPERATOR"] },
          firma: {
            aktivan: true,
            is_deleted: false,
            fiscalCompanyLink: { isNot: null }
          }
        },
        take: 1,
        select: { firma_id: true }
      }
    }
  });

  if (!user) {
    return "/";
  }

  if (
    user.rola !== "admin" &&
    (!user.agencija || !user.agencija.aktivan || user.agencija.is_deleted)
  ) {
    return "/nalog-deaktiviran?razlog=agencija";
  }

  return authenticatedHomePath(user.rola, isDirectFiscalTenantUser(user));
}

export async function requireRole(rola: SessionUser["rola"]) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/?greska=sesija");
  }

  if (isDirectFiscalTenantUser(user)) {
    redirect("/portal");
  }

  if (user.rola !== rola) {
    redirect(rolePath[user.rola]);
  }

  return user;
}

export async function requireAnyRole(role: SessionUser["rola"][]) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/?greska=sesija");
  }

  if (isDirectFiscalTenantUser(user)) {
    redirect("/portal");
  }

  if (user.rola === "klijent" && isFiscalPortalUser(user)) {
    redirect("/klijent");
  }

  if (!role.includes(user.rola)) {
    redirect(rolePath[user.rola]);
  }

  return user;
}

export async function requireAgencyWorkspaceUser() {
  return requireAnyRole([
    "admin_agencije",
    "korisnik_agencije",
    "klijent"
  ]);
}

export function getRolePath(rola: SessionUser["rola"]) {
  return rolePath[rola];
}
