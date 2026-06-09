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
          <p className="admin-kicker">Summa Summarum</p>
          <h1>Admin</h1>
          <p className="admin-user">{user.korisnicko_ime}</p>
        </div>

        <nav className="admin-nav" aria-label="Admin navigacija">
          <Link href="/admin">Pregled</Link>
          <Link href="/admin/agencije">Agencije</Link>
          <Link href="/admin/agencijski-korisnici">Admini agencija</Link>
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
