import Link from "next/link";
import { logout } from "@/app/actions";
import { AgencyTopBar } from "@/components/AgencyTopBar";
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
    <main className="admin-app">
      <aside className="admin-sidebar">
        <div>
          <div className="sidebar-brand">
            <span className="sidebar-logo">SS</span>
            <div>
              <p className="admin-kicker">Računovodstveni</p>
              <h1>Program</h1>
            </div>
          </div>
          <p className="admin-user">{user.korisnicko_ime}</p>
        </div>

        <nav className="admin-nav" aria-label="Agencijska navigacija">
          {navigation.map((item) => (
            <Link href={item.href} key={item.href}>
              <span>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <form action={logout}>
          <button className="sidebar-button" type="submit">
            Odjava
          </button>
        </form>
      </aside>

      <section className="admin-main">
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
      </section>
    </main>
  );
}
