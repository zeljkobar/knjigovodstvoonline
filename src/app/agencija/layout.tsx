import { logout } from "@/app/actions";
import { AgencyTopBar } from "@/components/AgencyTopBar";
import { AgencyWorkspaceShell } from "@/components/AgencyWorkspaceShell";
import { requireAgencyWorkspaceUser } from "@/lib/auth";
import { getAgencyNavigation } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

export default async function AgencijaLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireAgencyWorkspaceUser();
  const navigation = getAgencyNavigation(user.rola);
  const workContext = await readWorkContext();
  const [agencija, firme] = user.agencija_id
    ? await Promise.all([
        prisma.agencija.findUnique({
          where: {
            id: user.agencija_id
          },
          select: {
            naziv: true
          }
        }),
        prisma.firma.findMany({
          where:
            user.rola === "admin_agencije"
              ? {
                  agencija_id: user.agencija_id,
                  is_deleted: false,
                  aktivan: true
                }
              : {
                  agencija_id: user.agencija_id,
                  is_deleted: false,
                  aktivan: true,
                  korisnici: {
                    some: {
                      korisnik_id: user.id,
                      is_deleted: false
                    }
                  }
                },
          orderBy: {
            naziv: "asc"
          },
          select: {
            id: true,
            naziv: true,
            pib: true
          }
        })
      ])
    : [null, []];
  const activeFirm =
    firme.find((firma) => firma.id === workContext.firmaId) ?? null;
  const poslovneGodine = activeFirm
    ? await prisma.poslovnaGodina.findMany({
        where: {
          firma_id: activeFirm.id
        },
        orderBy: {
          godina: "desc"
        },
        select: {
          id: true,
          godina: true,
          zakljucena: true
        }
      })
    : [];
  const activeYear =
    poslovneGodine.find((godina) => godina.id === workContext.poslovnaGodinaId) ??
    poslovneGodine[0] ??
    null;

  return (
    <AgencyWorkspaceShell
      logoutAction={logout}
      navigation={navigation}
      userName={user.korisnicko_ime}
    >
      <>
        <AgencyTopBar
          agencyName={agencija?.naziv ?? "Agencija"}
          activeFirmId={activeFirm?.id ?? ""}
          activeYearId={activeYear?.id ?? ""}
          currentYear={activeYear?.godina ?? new Date().getFullYear()}
          firms={firme}
          navigation={navigation}
          years={poslovneGodine}
          userName={user.korisnicko_ime}
        />
        {children}
      </>
    </AgencyWorkspaceShell>
  );
}
