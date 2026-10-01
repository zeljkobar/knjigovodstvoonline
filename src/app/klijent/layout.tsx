import Link from "next/link";
import { logout } from "@/app/actions";
import { clientSections, getClientContext } from "@/lib/client-portal";
import { hasAllPermissions } from "@/lib/permissions";
import { getDirectPortalContext } from "@/lib/direct-portal";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const context = await getClientContext();
  const fiscal = await getDirectPortalContext();
  const visible = await Promise.all(clientSections.map(async (item) => ({ ...item,
    allowed: Boolean(context.firma && await hasAllPermissions(context.user,
      item.modules.map((modul) => ({ firmaId: context.firma!.id, modul, akcija: "view" as const }))))
  })));
  return <main className="portal-app client-app">
    <aside className="portal-sidebar">
      <Link className="portal-brand" href="/klijent"><span className="sidebar-logo">SS</span><span><small>SUMMA SUMMARUM</small><strong>Portal firme</strong></span></Link>
      <p className="portal-sidebar-company">{context.firma?.naziv ?? "Klijentski pristup"}</p>
      <nav className="client-navigation" aria-label="Klijentski meni">
        <Link href="/klijent">Početna</Link>
        {visible.filter((item) => item.allowed).map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
        {fiscal.state === "READY" ? <Link href="/portal">Fiskalizacija</Link> : null}
      </nav>
      <form action={logout}><button className="portal-logout" type="submit">Odjava</button></form>
    </aside>
    <div className="client-main">
      <header className="admin-panel client-context">
        <div className="client-context-identity"><span>Prijavljeni korisnik</span><strong>{context.user.korisnicko_ime}</strong></div>
        {context.firma ? <form action="/klijent/kontekst" className="client-year-form">
          <label>Poslovna godina<select name="godina" defaultValue={context.year?.id ?? ""}>{context.years.map((year) => <option key={year.id} value={year.id}>{year.godina}</option>)}</select></label>
          <button className="secondary-button" type="submit">Prikaži</button>
        </form> : null}
      </header>
      {children}
    </div>
  </main>;
}
