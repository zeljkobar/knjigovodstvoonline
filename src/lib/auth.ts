import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { readSession, type SessionUser } from "./session";

const rolePath: Record<SessionUser["rola"], string> = {
  admin: "/admin",
  admin_agencije: "/agencija",
  korisnik_agencije: "/agencija",
  klijent: "/klijent"
};

export async function getCurrentUser() {
  const session = await readSession();

  if (!session) {
    return null;
  }

  return prisma.korisnik.findFirst({
    where: {
      id: session.korisnikId,
      rola: session.rola,
      aktivan: true
    },
    select: {
      id: true,
      korisnicko_ime: true,
      rola: true,
      agencija_id: true
    }
  });
}

export async function requireRole(rola: SessionUser["rola"]) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/?greska=sesija");
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

  if (!role.includes(user.rola)) {
    redirect(rolePath[user.rola]);
  }

  return user;
}

export function getRolePath(rola: SessionUser["rola"]) {
  return rolePath[rola];
}
