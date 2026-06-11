import Link from "next/link";
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
        </nav>

        <form action={logout}>
          <button className="sidebar-button" type="submit">
            Odjava
          </button>
        </form>
      </aside>

      <section className="admin-main">{children}</section>
    </main>
  );
}
