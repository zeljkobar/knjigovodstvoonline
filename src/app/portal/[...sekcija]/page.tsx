import { notFound, redirect } from "next/navigation";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import {
  canAccessPortalItem,
  getPortalItemBySection
} from "@/lib/portal-navigation";

type PortalSectionPageProps = {
  params: Promise<{
    sekcija: string[];
  }>;
};

const descriptions: Record<string, string> = {
  pos: "Mobilna prodaja i fiskalizacija na postojećem POS jezgru.",
  fakture: "Klasične bezgotovinske fakture sa pregledom prije fiskalizacije.",
  racuni: "Jedinstveni pregled POS i kancelarijskih fiskalnih računa.",
  izvjestaji: "Promet, načini plaćanja i prodaja po artiklima.",
  artikli: "Prodajni šifarnik artikala, usluga, grupa i cijena.",
  kupci: "Pretraga i održavanje kupaca u scope-u vaše firme.",
  podesavanja: "Dozvoljena operativna podešavanja bez fiskalne administracije.",
  pomoc: "Podrška i kratka uputstva za rad u fiskalnom portalu."
};

export default async function PortalSectionPage({
  params
}: PortalSectionPageProps) {
  const { sekcija } = await params;
  const item = getPortalItemBySection(sekcija[0] ?? "");

  if (!item || item.section === "dashboard") {
    notFound();
  }

  const returnTo = `/portal/${sekcija.map(encodeURIComponent).join("/")}`;
  const context = await requireDirectPortalContext(undefined, returnTo);

  if (!canAccessPortalItem(item, context.permissionKeys)) {
    redirect("/portal?stanje=permission_denied");
  }

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">{item.label}</p>
          <h2>{item.label}</h2>
          <p className="muted-text">{descriptions[item.section]}</p>
        </div>
      </header>
      <section className="admin-panel portal-phase-placeholder">
        <h3>Siguran pristup je spreman</h3>
        <p>
          Ovaj modul je sada iza direct-portal tenant i permission guarda.
          Operativni ekran se uključuje u sljedećoj implementacionoj fazi,
          redom iz usvojene specifikacije.
        </p>
      </section>
    </div>
  );
}
