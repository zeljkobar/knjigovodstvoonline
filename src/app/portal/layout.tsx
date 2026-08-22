import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "@/app/actions";
import { PortalNavigation } from "@/components/PortalNavigation";
import {
  getDirectPortalContext,
  type DirectPortalContext
} from "@/lib/direct-portal";
import { resolveAuthenticatedHome } from "@/lib/auth";
import { getDirectPortalNavigation } from "@/lib/portal-navigation";

function accessIssue(context: DirectPortalContext) {
  if (context.state === "NO_COMPANY") {
    return {
      title: "Pristup firmi nije podešen",
      description:
        "Vaš nalog trenutno nema jednu aktivnu direktnu firmu. Kontaktirajte podršku prije nastavka."
    };
  }

  if (context.state === "MULTIPLE_COMPANIES") {
    return {
      title: "Potrebna je intervencija podrške",
      description:
        "Nalog je povezan sa više direktnih firmi, pa sistem nije birao firmu umjesto vas.",
      correlationId: context.correlationId
    };
  }

  if (context.state === "NO_VIEW_PERMISSION") {
    return {
      title: "Pristup portalu nije odobren",
      description:
        "Firma je pronađena, ali nalogu nedostaje osnovno pravo pregleda fiskalizacije. Kontaktirajte podršku."
    };
  }

  if (context.state === "NO_YEAR") {
    return {
      title: "Poslovna godina nije spremna",
      description:
        "Za firmu ne postoji tekuća niti aktivna nezaključana poslovna godina. Kreiranje dokumenata je blokirano do administratorske intervencije."
    };
  }

  return {
    title: "Portal trenutno nije dostupan",
    description: "Ponovo se prijavite ili kontaktirajte podršku."
  };
}

export default async function PortalLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const context = await getDirectPortalContext();

  if (context.state === "UNAUTHENTICATED") {
    redirect("/?greska=sesija");
  }

  if (context.state === "NOT_DIRECT") {
    redirect(await resolveAuthenticatedHome(context.user.id));
  }

  if (context.state !== "READY") {
    const issue = accessIssue(context);

    return (
      <main className="portal-access-page">
        <section className="portal-access-card" role="alert">
          <span className="sidebar-logo" aria-hidden="true">
            SS
          </span>
          <p className="eyebrow">Direktni fiskalni portal</p>
          <h1>{issue.title}</h1>
          <p>{issue.description}</p>
          {issue.correlationId ? (
            <p className="portal-correlation">
              ID za podršku: <strong>{issue.correlationId}</strong>
            </p>
          ) : null}
          <form action={logout}>
            <button className="secondary-button" type="submit">
              Odjava
            </button>
          </form>
        </section>
      </main>
    );
  }

  if (!context.workContextMatches) {
    redirect("/portal/kontekst?returnTo=%2Fportal");
  }

  const navigation = getDirectPortalNavigation(
    context.permissionKeys,
    Boolean(context.firma.posPodesavanje?.aktivan)
  );
  const firmName = context.firma.skraceni_naziv || context.firma.naziv;
  const readinessTone = context.readiness.blocksChanges ? "warning" : "ready";

  return (
    <main className="portal-app">
      <aside className="portal-sidebar">
        <div>
          <Link className="portal-brand" href="/portal">
            <span className="sidebar-logo" aria-hidden="true">
              SS
            </span>
            <span>
              <small>SUMMA</small>
              <strong>Fiskalni portal</strong>
            </span>
          </Link>
          <p className="portal-sidebar-company">{firmName}</p>
        </div>

        <PortalNavigation items={navigation} />

        <form action={logout}>
          <button className="portal-logout" type="submit">
            Odjava
          </button>
        </form>
      </aside>

      <section className="portal-main">
        <header className="portal-topbar">
          <div>
            <span>Firma</span>
            <strong>{firmName}</strong>
            {context.firma.pib ? <small>PIB {context.firma.pib}</small> : null}
          </div>
          <div className="portal-topbar-meta">
            {context.readiness.code === "TEST" ? (
              <span className="portal-environment-badge">TEST</span>
            ) : null}
            {context.year.zakljucena ? (
              <span className="portal-year-badge">
                {context.year.godina} · zaključana
              </span>
            ) : (
              <span className="portal-year-badge">{context.year.godina}</span>
            )}
            <span className={`portal-readiness ${readinessTone}`}>
              {context.readiness.label}
            </span>
            <span className="portal-user">{context.user.korisnicko_ime}</span>
          </div>
          <form className="portal-mobile-logout" action={logout}>
            <button type="submit">Odjava</button>
          </form>
        </header>

        <div className="portal-content">{children}</div>
      </section>

      <div className="portal-mobile-navigation-host">
        <PortalNavigation items={navigation} />
      </div>
    </main>
  );
}
