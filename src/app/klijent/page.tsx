import Link from "next/link";
import { DashboardPlaceholder } from "@/components/DashboardPlaceholder";
import { requireRole } from "@/lib/auth";
import { getDirectPortalContext } from "@/lib/direct-portal";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

export default async function KlijentPage() {
  const user = await requireRole("klijent");
  const fiscalPortalContext = await getDirectPortalContext();
  const hasFiscalPortal = fiscalPortalContext.state === "READY";
  const posAccess = await prisma.korisnikPravo.findFirst({
    where: { korisnik_id: user.id, agencija_id: user.agencija_id!, modul: "pos", akcija: "view", dozvoljeno: true },
    select: { id: true }
  });
  if (posAccess && !hasFiscalPortal) redirect("/agencija/pos");

  return (
    <DashboardPlaceholder
      title="Dobro dosao klijent"
      korisnickoIme={user.korisnicko_ime}
    >
      {hasFiscalPortal ? (
        <section className="admin-panel">
          <p className="eyebrow">Prodaja i fiskalni računi</p>
          <h2>Fiskalizacija</h2>
          <p className="muted-text">
            Otvorite POS, fakture, fiskalne račune i prodajne izvještaje za
            firmu {fiscalPortalContext.firma.naziv}.
          </p>
          <Link className="primary-button" href="/portal">
            Otvori fiskalizaciju
          </Link>
        </section>
      ) : null}
    </DashboardPlaceholder>
  );
}
