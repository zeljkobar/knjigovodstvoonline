import Link from "next/link";
import { createPortalItem } from "../../_actions/catalog";
import { PortalItemForm } from "@/components/PortalItemForm";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { prisma } from "@/lib/prisma";

const messages: Record<string, string> = {
  artikal_obavezno: "Naziv, jedinica mjere i ispravne cijene su obavezni.",
  artikal_reference: "Izabrana grupa, jedinica mjere ili PDV stopa nije dostupna.",
  artikal_sifra_postoji: "Artikal sa tom šifrom već postoji.",
  artikal_barkod_postoji: "Artikal sa tim barkodom već postoji.",
  godina_zakljucana: "Poslovna godina je zaključana; novi artikal nije dozvoljen."
};

export default async function NewPortalItemPage({
  searchParams
}: {
  searchParams: Promise<{ poruka?: string }>;
}) {
  const params = await searchParams;
  const context = await requireDirectPortalContext(
    { modul: "robno", akcija: "create" },
    "/portal/artikli/novi"
  );
  const agencijaId = context.user.agencija_id!;
  const [groups, units, vatRates] = await Promise.all([
    prisma.grupaArtikla.findMany({
      where: {
        agencija_id: agencijaId,
        firma_id: context.firma.id,
        aktivna: true,
        is_deleted: false
      },
      orderBy: [{ sifra: "asc" }, { naziv: "asc" }],
      select: { id: true, sifra: true, naziv: true }
    }),
    prisma.jedinicaMjere.findMany({
      where: { aktivna: true },
      orderBy: [{ redosljed: "asc" }, { naziv: "asc" }],
      select: { id: true, sifra: true, naziv: true }
    }),
    prisma.pdvStopa.findMany({
      where: { agencija_id: agencijaId, aktivna: true },
      orderBy: [{ redosljed: "asc" }, { procenat: "asc" }],
      select: { id: true, naziv: true, procenat: true }
    })
  ]);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Prodajni šifarnik</p>
          <h2>Novi artikal ili usluga</h2>
          <p className="muted-text">Šifra se automatski dodjeljuje ako je ne unesete.</p>
        </div>
        <Link className="secondary-button" href="/portal/artikli">Nazad</Link>
      </header>

      {params.poruka ? (
        <p className="status-banner error">
          {messages[params.poruka] ?? "Artikal nije sačuvan."}
        </p>
      ) : null}

      <section className="admin-form-section">
        <PortalItemForm
          action={createPortalItem}
          buttonLabel="Sačuvaj artikal"
          groups={groups}
          units={units}
          vatRates={vatRates}
        />
      </section>
    </div>
  );
}
