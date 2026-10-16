import Link from "next/link";
import { ThemePicker } from "@/components/ThemePicker";
import { logout } from "@/app/actions";
import { requireRole } from "@/lib/auth";

export default async function AdminLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireRole("admin");

  return (
    <main className="admin-app">
      <aside className="admin-sidebar">
        <div>
          <div className="sidebar-brand">
            <span className="sidebar-logo">SS</span>
            <div>
              <p className="admin-kicker">Summa Summarum</p>
              <h1>Admin</h1>
            </div>
          </div>
          <p className="admin-user">{user.korisnicko_ime}</p>
        </div>

        <nav className="admin-nav" aria-label="Admin navigacija">
          <Link href="/admin"><span>▦</span>Pregled</Link>
          <Link href="/admin/agencije"><span>▣</span>Agencije</Link>
          <Link href="/admin/agencijski-korisnici"><span>◉</span>Admini agencija</Link>
          <Link href="/admin/fiskalizacija"><span>▤</span>Fiskalna platforma</Link>
          <Link href="/admin/fiskalizacija/korisnici"><span>◎</span>Fiskalni klijenti</Link>
          <Link href="/admin/fiskalizacija/aplikacije"><span>◇</span>API aplikacije</Link>
          <Link href="/admin/radna-mjesta"><span>▤</span>Radna mjesta</Link>
          <Link href="/admin/globalni-partneri"><span>◇</span>Globalni partneri</Link>
        </nav>

        <form action={logout}>
          <button className="sidebar-button" type="submit">
            Odjava
          </button>
        </form>
      </aside>

      <section className="admin-main"><div className="admin-theme-toolbar"><span>{user.korisnicko_ime}</span><ThemePicker/></div>{children}</section>
    </main>
  );
}
