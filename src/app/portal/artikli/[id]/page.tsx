import Link from "next/link";
import { notFound } from "next/navigation";
import { updatePortalItem } from "../../_actions/catalog";
import { PortalItemForm } from "@/components/PortalItemForm";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { hasDirectPortalPermission } from "@/lib/direct-portal-policy";
import { itemPriceTypeLabel } from "@/lib/inventory";
import { prisma } from "@/lib/prisma";

const messages: Record<string, string> = {
  artikal_kreiran: "Artikal je kreiran.",
  artikal_sacuvan: "Izmjene artikla su sačuvane.",
  artikal_obavezno: "Šifra, naziv i jedinica mjere su obavezni.",
  artikal_reference: "Izabrana grupa, jedinica mjere ili PDV stopa nije dostupna.",
  artikal_sifra_postoji: "Artikal sa tom šifrom već postoji.",
  artikal_barkod_postoji: "Artikal sa tim barkodom već postoji.",
  godina_zakljucana: "Poslovna godina je zaključana; izmjene nijesu dozvoljene."
};

export default async function PortalItemDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ poruka?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const context = await requireDirectPortalContext(
    { modul: "robno", akcija: "view" },
    `/portal/artikli/${id}`
  );
  const agencijaId = context.user.agencija_id!;
  const [item, groups, units, vatRates] = await Promise.all([
    prisma.artikal.findFirst({
      where: {
        id,
        agencija_id: agencijaId,
        firma_id: context.firma.id,
        is_deleted: false
      },
      include: {
        grupa_artikla: true,
        jedinica_mjere: true,
        pdv_stopa: true,
        cijene: {
          where: { is_deleted: false },
          include: { magacin: { select: { naziv: true } } },
          orderBy: [{ aktivna: "desc" }, { vazi_od: "desc" }, { created_at: "desc" }]
        }
      }
    }),
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

  if (!item) {
    notFound();
  }

  const canUpdate = hasDirectPortalPermission(context.permissionKeys, {
    modul: "robno",
    akcija: "update"
  });

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Prodajni šifarnik / {item.sifra}</p>
          <h2>{item.naziv}</h2>
          <p className="muted-text">
            {item.usluga ? "Usluga" : item.prati_zalihe ? "Roba koja prati zalihe" : "Roba bez praćenja zaliha"}
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-button" href={{ pathname: "/portal/cijene", query: { artikal_id: item.id } }}>Cijene</Link>
          <Link className="secondary-button" href="/portal/artikli">Nazad</Link>
        </div>
      </header>

      {query.poruka ? (
        <p className={query.poruka === "artikal_kreiran" || query.poruka === "artikal_sacuvan" ? "status-banner success" : "status-banner error"}>
          {messages[query.poruka] ?? "Akcija nije završena."}
        </p>
      ) : null}

      {canUpdate ? (
        <section className="admin-form-section">
          <div className="panel-header"><h3>Osnovni podaci</h3></div>
          <PortalItemForm
            action={updatePortalItem}
            buttonLabel="Sačuvaj izmjene"
            groups={groups}
            units={units}
            vatRates={vatRates}
            initial={item}
          />
        </section>
      ) : (
        <section className="admin-panel">
          <h3>Osnovni podaci</h3>
          <dl className="detail-grid">
            <div><dt>Šifra</dt><dd>{item.sifra}</dd></div>
            <div><dt>Barkod</dt><dd>{item.barkod ?? "-"}</dd></div>
            <div><dt>Grupa</dt><dd>{item.grupa_artikla?.naziv ?? "-"}</dd></div>
            <div><dt>Jedinica</dt><dd>{item.jedinica_mjere.oznaka}</dd></div>
            <div><dt>PDV</dt><dd>{item.pdv_stopa?.procenat.toString() ?? "0"}%</dd></div>
            <div><dt>Status</dt><dd>{item.aktivan ? "Aktivan" : "Neaktivan"}</dd></div>
          </dl>
        </section>
      )}

      <section className="admin-panel">
        <div className="panel-header"><h3>Cijene</h3><span>{item.cijene.length} ukupno</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Tip</th><th>Bez PDV-a</th><th>Sa PDV-om</th><th>Magacin</th><th>Važenje</th><th>Status</th></tr></thead>
            <tbody>
              {item.cijene.length ? item.cijene.map((price) => (
                <tr key={price.id}>
                  <td>{itemPriceTypeLabel(price.tip)}</td>
                  <td>{price.cijena_bez_pdv.toString()} {price.valuta}</td>
                  <td>{price.cijena_sa_pdv.toString()} {price.valuta}</td>
                  <td>{price.magacin?.naziv ?? "Sve"}</td>
                  <td>{price.vazi_od?.toLocaleDateString("sr-Latn-ME") ?? "Odmah"} — {price.vazi_do?.toLocaleDateString("sr-Latn-ME") ?? "bez kraja"}</td>
                  <td>{price.aktivna ? "Aktivna" : "Neaktivna"}</td>
                </tr>
              )) : <tr><td className="empty-state" colSpan={6}>Nema definisanih cijena.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
