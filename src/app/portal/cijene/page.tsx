import Link from "next/link";
import {
  createPortalItemPrice,
  togglePortalItemPrice,
  updatePortalItemPrice
} from "../_actions/catalog";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { hasDirectPortalPermission } from "@/lib/direct-portal-policy";
import { itemPriceTypeLabel, itemPriceTypes } from "@/lib/inventory";
import { prisma } from "@/lib/prisma";

const messages: Record<string, string> = {
  cijena_kreirana: "Cijena je dodata.",
  cijena_sacuvana: "Cijena je sačuvana.",
  cijena_aktivirana: "Cijena je aktivirana.",
  cijena_deaktivirana: "Cijena je deaktivirana.",
  cijena_obavezno: "Artikal, tip cijene, iznos, magacin i period moraju biti ispravni.",
  cijena_greska: "Cijena nije pronađena.",
  godina_zakljucana: "Poslovna godina je zaključana; izmjene nijesu dozvoljene."
};

function inputDate(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? "";
}

export default async function PortalPricesPage({
  searchParams
}: {
  searchParams: Promise<{
    q?: string;
    artikal_id?: string;
    uredi?: string;
    poruka?: string;
  }>;
}) {
  const params = await searchParams;
  const context = await requireDirectPortalContext(
    { modul: "robno", akcija: "view" },
    "/portal/cijene"
  );
  const q = params.q?.trim() ?? "";
  const itemId = params.artikal_id?.trim() ?? "";
  const agencijaId = context.user.agencija_id!;
  const firmaId = context.firma.id;
  const scope = { agencija_id: agencijaId, firma_id: firmaId, is_deleted: false };
  const [selectedItem, itemResults, warehouses] = await Promise.all([
    itemId
      ? prisma.artikal.findFirst({
          where: { ...scope, id: itemId },
          include: {
            pdv_stopa: { select: { procenat: true } },
            jedinica_mjere: { select: { oznaka: true } }
          }
        })
      : Promise.resolve(null),
    prisma.artikal.findMany({
      where: {
        ...scope,
        aktivan: true,
        ...(q
          ? {
              OR: [
                { sifra: { contains: q, mode: "insensitive" as const } },
                { naziv: { contains: q, mode: "insensitive" as const } },
                { barkod: { contains: q, mode: "insensitive" as const } }
              ]
            }
          : {})
      },
      include: {
        pdv_stopa: { select: { procenat: true } },
        _count: { select: { cijene: true } }
      },
      orderBy: [{ sifra: "asc" }, { naziv: "asc" }],
      take: q ? 100 : 30
    }),
    prisma.magacin.findMany({
      where: { ...scope, aktivan: true },
      orderBy: [{ sifra: "asc" }, { naziv: "asc" }],
      select: { id: true, sifra: true, naziv: true }
    })
  ]);
  const prices = selectedItem
    ? await prisma.cijenaArtikla.findMany({
        where: { ...scope, artikal_id: selectedItem.id },
        include: { magacin: { select: { sifra: true, naziv: true } } },
        orderBy: [{ aktivna: "desc" }, { vazi_od: "desc" }, { created_at: "desc" }]
      })
    : [];
  const edited = params.uredi
    ? prices.find((price) => price.id === params.uredi) ?? null
    : null;
  const canCreate = hasDirectPortalPermission(context.permissionKeys, {
    modul: "robno",
    akcija: "create"
  });
  const canUpdate = hasDirectPortalPermission(context.permissionKeys, {
    modul: "robno",
    akcija: "update"
  });
  const allowedTypes = [
    itemPriceTypes.wholesale,
    itemPriceTypes.retail,
    itemPriceTypes.promotional,
    itemPriceTypes.warehouse
  ];

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div><p className="eyebrow">Prodajni šifarnik</p><h2>Cijene artikala</h2><p className="muted-text">Cijene se čuvaju sa PDV snapshotom, periodom važenja i opcionim magacinom.</p></div>
        <Link className="secondary-button" href="/portal/artikli">Artikli</Link>
      </header>

      {params.poruka ? <p className="admin-message">{messages[params.poruka] ?? "Akcija nije završena."}</p> : null}

      <section className="admin-panel">
        <form className="portal-filter-form portal-filter-form--compact" method="get">
          <label className="form-span-2"><span>Pronađi artikal</span><input defaultValue={q} name="q" placeholder="Šifra, naziv ili barkod" /></label>
          <button className="primary-button" type="submit">Pretraži</button>
        </form>
        <div className="panel-header"><h3>Izbor artikla</h3><span>{itemResults.length === 100 ? "Prvih 100 rezultata" : `${itemResults.length} prikazano`}</span></div>
        <div className="table-wrap"><table><thead><tr><th>Šifra</th><th>Naziv</th><th>Tip</th><th>PDV</th><th>Cijena</th><th /></tr></thead><tbody>
          {itemResults.map((item) => <tr key={item.id}><td><strong>{item.sifra}</strong></td><td>{item.naziv}</td><td>{item.usluga ? "Usluga" : "Roba"}</td><td>{item.pdv_stopa?.procenat.toString() ?? "0"}%</td><td>{item._count.cijene}</td><td><Link className="table-button" href={{ pathname: "/portal/cijene", query: { q, artikal_id: item.id } }}>{selectedItem?.id === item.id ? "Izabran" : "Izaberi"}</Link></td></tr>)}
        </tbody></table></div>
      </section>

      {selectedItem ? <>
        {(edited ? canUpdate : canCreate) ? <section className="admin-form-section">
          <div className="panel-header"><div><h3>{edited ? "Izmijeni cijenu" : "Nova cijena"}</h3><p className="muted-text">{selectedItem.sifra} — {selectedItem.naziv}; PDV {selectedItem.pdv_stopa?.procenat.toString() ?? "0"}%</p></div>{edited ? <Link href={{ pathname: "/portal/cijene", query: { q, artikal_id: selectedItem.id } }}>Otkaži</Link> : null}</div>
          <form action={edited ? updatePortalItemPrice : createPortalItemPrice} className="admin-form inventory-price-form">
            <input name="artikal_id" type="hidden" value={selectedItem.id} /><input name="cijena_id" type="hidden" value={edited?.id ?? ""} />
            <label><span>Tip cijene</span><select defaultValue={edited?.tip ?? itemPriceTypes.retail} name="tip">{allowedTypes.map((type) => <option key={type} value={type}>{itemPriceTypeLabel(type)}</option>)}</select></label>
            <label><span>Unos iznosa</span><select defaultValue="BEZ_PDV" name="unos_tip"><option value="BEZ_PDV">Bez PDV-a</option><option value="SA_PDV">Sa PDV-om</option></select></label>
            <label><span>Iznos (EUR)</span><input defaultValue={edited?.cijena_bez_pdv.toString() ?? ""} min="0" name="iznos" required step="0.01" type="number" /></label>
            <label><span>Magacin</span><select defaultValue={edited?.magacin_id ?? ""} name="magacin_id"><option value="">Svi magacini</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.sifra} — {warehouse.naziv}</option>)}</select></label>
            <label><span>Važi od</span><input defaultValue={inputDate(edited?.vazi_od ?? null)} name="vazi_od" type="date" /></label>
            <label><span>Važi do</span><input defaultValue={inputDate(edited?.vazi_do ?? null)} name="vazi_do" type="date" /></label>
            <label className="form-span-2"><span>Napomena</span><input defaultValue={edited?.napomena ?? ""} name="napomena" /></label>
            <button type="submit">{edited ? "Sačuvaj cijenu" : "Dodaj cijenu"}</button>
          </form>
        </section> : null}

        <section className="admin-panel"><div className="panel-header"><h3>Istorija cijena</h3><span>{prices.length} ukupno</span></div><div className="table-wrap"><table><thead><tr><th>Tip</th><th>Bez PDV-a</th><th>Sa PDV-om</th><th>Magacin</th><th>Važenje</th><th>Status</th>{canUpdate ? <th>Akcije</th> : null}</tr></thead><tbody>
          {prices.length ? prices.map((price) => <tr key={price.id}><td>{itemPriceTypeLabel(price.tip)}</td><td>{price.cijena_bez_pdv.toString()} {price.valuta}</td><td>{price.cijena_sa_pdv.toString()} {price.valuta}</td><td>{price.magacin ? `${price.magacin.sifra} — ${price.magacin.naziv}` : "Svi"}</td><td>{price.vazi_od?.toLocaleDateString("sr-Latn-ME") ?? "Odmah"} — {price.vazi_do?.toLocaleDateString("sr-Latn-ME") ?? "bez kraja"}</td><td>{price.aktivna ? "Aktivna" : "Neaktivna"}</td>{canUpdate ? <td><div className="inventory-table-actions"><Link className="table-button" href={{ pathname: "/portal/cijene", query: { q, artikal_id: selectedItem.id, uredi: price.id } }}>Izmijeni</Link><form action={togglePortalItemPrice}><input name="artikal_id" type="hidden" value={selectedItem.id} /><input name="cijena_id" type="hidden" value={price.id} /><input name="aktivna" type="hidden" value={String(!price.aktivna)} /><button className="table-button" type="submit">{price.aktivna ? "Deaktiviraj" : "Aktiviraj"}</button></form></div></td> : null}</tr>) : <tr><td className="empty-state" colSpan={canUpdate ? 7 : 6}>Artikal nema definisane cijene.</td></tr>}
        </tbody></table></div></section>
      </> : <section className="admin-panel"><p className="empty-state">Izaberite artikal da biste uredili njegove cijene.</p></section>}
    </div>
  );
}
