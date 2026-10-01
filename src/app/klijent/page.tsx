import Link from "next/link";
import { hasPermission } from "@/lib/permissions";
import { getClientContext } from "@/lib/client-portal";
import { hasAllPermissions } from "@/lib/permissions";
import { getDirectPortalContext } from "@/lib/direct-portal";

import { loadClientDashboard } from "@/lib/client-dashboard";
import { formatInventoryMoney as money } from "@/app/agencija/_components/inventory-report-utils";

export default async function ClientPage({ searchParams }: {
  searchParams?: Promise<{ prikaz?: string }>;
}) {
  const context = await getClientContext();
  const fiscal = await getDirectPortalContext();
  const foreign = (await searchParams)?.prikaz === "ino";
  const allowed = Boolean(context.firma && context.year && await hasAllPermissions(context.user,
    ["izvjestaji", "nalozi"].map((modul) => ({ firmaId: context.firma!.id, modul, akcija: "view" as const }))));
  const panels = allowed ? await loadClientDashboard(foreign) : [];
  const pos = context.firma && await hasPermission(context.user, { firmaId: context.firma.id, modul: "pos", akcija: "view" });
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Portal firme</p><h1>{context.firma?.naziv ?? "Dobro došli"}</h1><p className="muted-text">Pregled poslovanja za {context.year?.godina ?? "izabranu godinu"}.</p></div></header>
    {!context.firma ? <p className="admin-message">{context.companies.length > 1 ? "Vašem nalogu je dodijeljeno više firmi. Obratite se agenciji da podesi jednu firmu za klijentski pristup." : "Agencija još nije dodijelila firmu vašem nalogu."}</p> : !context.year ? <p className="admin-message">Agencija treba da otvori poslovnu godinu za vašu firmu.</p> : !allowed ? <p className="admin-message">Agencija još nije omogućila pregled kupaca i dobavljača za vaš nalog. Ostali odobreni pregledi dostupni su u meniju.</p> : null}
    {allowed ? <>
      <nav className="client-dashboard-tabs" aria-label="Vrsta partnera">
        <Link href="/klijent" aria-current={!foreign ? "page" : undefined}>Domaći partneri</Link>
        <Link href="/klijent?prikaz=ino" aria-current={foreign ? "page" : undefined}>Ino partneri</Link>
      </nav>
      <section className="client-balance-panels" aria-label="Kupci i dobavljači po visini duga">
        {panels.map((panel) => <article className={`client-balance-panel ${panel.kind}`} key={panel.type}>
          <header>
            <div><p className="eyebrow">{panel.kind === "customers" ? "Potraživanja" : "Obaveze"}</p><h2>{panel.title}</h2></div>
            <span className="client-balance-count">{panel.count} partnera</span>
          </header>
          <div className="client-balance-total">
            <span>{panel.kind === "customers" ? "Kupci vam duguju" : "Dugujete dobavljačima"}</span>
            <strong>{panel.configured ? `${money(panel.total)} €` : "—"}</strong>
          </div>
          {!panel.configured ? <p className="empty-state">Agencija još nije podesila ovaj pregled.</p> : !panel.rows.length ? <p className="empty-state">{panel.kind === "customers" ? "Nema otvorenih potraživanja od kupaca." : "Nema otvorenih obaveza prema dobavljačima."}</p> : <>
            <div className="client-ranking-heading"><h3>Najveći iznosi</h3><span>Od najvećeg ka najmanjem</span></div>
            <ol className="client-partner-ranking">
              {panel.rows.map((row, index) => <li key={row.id}>
                <Link href={`/klijent/izvjestaji/${panel.type}/kartica?partner=${row.id}`}>
                  <span className="client-ranking-number" aria-hidden="true">{index + 1}</span>
                  <div className="client-ranking-content">
                    <div className="client-ranking-label"><strong>{row.name}</strong><span>{money(row.cents)} €</span></div>
                    <div className="client-ranking-track" aria-hidden="true"><span style={{ width: `${row.width}%` }} /></div>
                  </div>
                  <span className="client-ranking-arrow" aria-hidden="true">↗</span>
                </Link>
              </li>)}
            </ol>
          </>}
          <footer><span>{panel.count > 10 ? `Prikazano 10 od ${panel.count} partnera` : "Klik na partnera otvara karticu"}</span><Link href={`/klijent/izvjestaji/${panel.type}`}>Svi {panel.kind === "customers" ? "kupci" : "dobavljači"} →</Link></footer>
        </article>)}
      </section>
      <p className="client-dashboard-note">Stanje prema proknjiženim nalozima izabrane poslovne godine. Prikazana su pozitivna potraživanja i obaveze, bez avansa i preplata.</p>
    </> : null}
    {pos && fiscal.state !== "READY" ? <Link className="primary-button" href="/agencija/pos">Otvori POS / Kasa</Link> : null}
    {fiscal.state === "READY" ? <section className="admin-panel"><h2>Fiskalizacija</h2><p>POS, fakture i prodajni izvještaji za {fiscal.firma.naziv}.</p><Link className="primary-button" href="/portal">Otvori fiskalizaciju</Link></section> : null}
  </div>;
}
