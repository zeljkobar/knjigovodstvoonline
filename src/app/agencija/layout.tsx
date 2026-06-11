import Link from "next/link";
import { logout } from "@/app/actions";
import { AgencyTopBar } from "@/components/AgencyTopBar";
import { requireAnyRole } from "@/lib/auth";
import { getAgencyNavigation } from "@/lib/navigation";
import { prisma } from "@/lib/prisma";

export default async function AgencijaLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const navigation = getAgencyNavigation(user.rola);
  const agencija = user.agencija_id
    ? await prisma.agencija.findUnique({
        where: {
          id: user.agencija_id
        },
        select: {
          naziv: true
        }
      })
    : null;

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
          currentYear={new Date().getFullYear()}
          navigation={navigation}
          userName={user.korisnicko_ime}
        />
        {children}
      </section>
    </main>
  );
}
